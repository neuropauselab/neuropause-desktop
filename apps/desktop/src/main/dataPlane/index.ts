/**
 * Phase 6 — Universal Enterprise Data Plane: subsystem composition + IPC.
 *
 * Composes the existing engine (parse → classify → validate → plan → import)
 * into the secure IPC surface. It owns two stores (provenance, mapping memory)
 * and NO business logic — routing and governance live in the engine modules.
 *
 * Security posture at this boundary:
 *   - File CONTENT crosses IPC as base64; the renderer never supplies a
 *     filesystem path, so an untrusted caller cannot direct the main process to
 *     read an arbitrary location.
 *   - `dp:import` is the only mutating channel. It carries `data:import`, and a
 *     high-risk table additionally requires `data:approve` — checked here, so
 *     the person who may load data is not automatically the person who may
 *     approve payroll or money (segregation of duties).
 *   - Every import is audited through the same enterprise audit sink the module
 *     framework uses.
 */
import { join } from 'node:path';
import type {
  DataPlaneExportableModule,
  DataPlaneExportResult,
  DataPlaneInspection,
  DataPlaneOntologyView,
  DataPlanePlanSummary,
  DataPlaneProvenance,
  DataPlaneRunResult,
  DataPlaneSavedMapping,
  EnterpriseModuleDescriptor,
  EnterprisePermission,
} from '@neuropause/shared';
import {
  DataPlaneAnalyzeRequest,
  DataPlaneExportRequest,
  DataPlaneForgetMappingRequest,
  DataPlaneHistoryRequest,
  DataPlaneImportRequest,
  DataPlaneInspectRequest,
  DataPlaneMappingsRequest,
  DataPlanePlanRequest,
  DataPlaneProvenanceRequest,
  DataPlaneRunRequest,
  DataPlaneSaveMappingRequest,
  EmptyRequest,
  IpcChannel,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import type { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { createLogger } from '../logger';
import { analyzeSource, summarizePlan, type ImportPlan } from './planner';
import { applyImportPlan, ProvenanceStore, type ImportDecision } from './importer';
import { MappingMemoryStore } from './mappingMemory';
import { ONTOLOGY, entityById, requiresExplicitApproval } from './ontology';
import { SUPPORTED_FORMATS, parseFile } from './parsers';
import { buildExport, type ExportCell, type ExportColumn, type ExportTable } from './exporters';

const log = createLogger('data-plane');

/** Analyzed plans are held in memory between analyze and import. */
const MAX_CACHED_PLANS = 20;

export interface DataPlaneSubsystemDeps {
  userDataDir: string;
  /** Resolve a destination enterprise module store by module id. */
  storeFor: (moduleId: string) => EnterpriseRecordStore | null;
  actor: () => string | null;
  /** Active tenant/organization id — the mapping-memory isolation boundary. */
  tenantId: () => string;
  now: () => string;
  audit: (entry: { action: string; target: string; summary: string }) => void;
  /** Throws when the current actor lacks the permission. */
  authorize: (permission: EnterprisePermission) => void;
  /**
   * Every module that holds records, in registration order. Export needs the
   * descriptor — its fields become the columns and its OWN read permission is
   * enforced, so exporting payroll requires the right to read payroll.
   */
  modules: () => readonly EnterpriseModuleDescriptor[];
  /**
   * Ask the user where to put an export and write it. Injected because the save
   * dialog and the filesystem are Electron concerns, and keeping them out of
   * this module is what lets the whole plane run under Node in tests.
   * Resolves to the written path, or null when the user cancelled.
   */
  saveExport: (suggestedName: string, format: string, content: Buffer) => Promise<string | null>;
  /** Fired after a successful import so domain subsystems can react. */
  onImported?: (event: { moduleId: string; recordIds: string[]; planId: string; correlationId: string }) => void;
}

export interface DataPlaneSubsystem {
  handlers: SecureHandlerDef[];
  provenance: ProvenanceStore;
  mappings: MappingMemoryStore;
}

function decodeContent(base64: string, filename: string): Buffer {
  try {
    return Buffer.from(base64, 'base64');
  } catch {
    throw new Error(`Could not read the uploaded content for "${filename}".`);
  }
}

function ontologyView(): DataPlaneOntologyView {
  return {
    entities: ONTOLOGY.map((e) => ({
      id: e.id,
      label: e.label,
      plural: e.plural,
      domain: e.domain,
      moduleId: e.moduleId,
      risk: e.risk,
      requiresApproval: requiresExplicitApproval(e),
      fields: e.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required === true,
        sensitive: f.sensitive === true,
      })),
    })),
    supportedFormats: [...SUPPORTED_FORMATS],
    unsupportedFormats: [
      { format: 'pdf', reason: 'PDF text extraction is not implemented in this build.' },
      { format: 'image', reason: 'OCR is not configured (external dependency).' },
      { format: 'xls', reason: 'Legacy .xls (OLE compound) is refused rather than mis-parsed.' },
    ],
  };
}

export function initDataPlane(deps: DataPlaneSubsystemDeps): DataPlaneSubsystem {
  const provenance = new ProvenanceStore(join(deps.userDataDir, 'data-plane-provenance.json'));
  const mappings = new MappingMemoryStore(join(deps.userDataDir, 'data-plane-mappings.json'));

  /** planId → analyzed plan. Bounded; plans are re-derivable by re-analyzing. */
  const plans = new Map<string, ImportPlan>();

  const remember = (plan: ImportPlan): void => {
    plans.set(plan.planId, plan);
    while (plans.size > MAX_CACHED_PLANS) {
      const oldest = plans.keys().next().value;
      if (oldest === undefined) break;
      plans.delete(oldest);
    }
  };

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.DataPlaneOntology,
      schema: EmptyRequest,
      requireAuth: true,
      handler: (): DataPlaneOntologyView => ontologyView(),
    },
    {
      channel: IpcChannel.DataPlaneInspect,
      schema: DataPlaneInspectRequest,
      requireAuth: true,
      handler: (p): DataPlaneInspection => {
        const req = p as DataPlaneInspectRequest;
        const buf = decodeContent(req.contentBase64, req.filename);
        const doc = parseFile(req.filename, buf);
        return {
          filename: req.filename,
          format: doc.format,
          bytes: buf.length,
          supported: doc.kind !== 'unsupported',
          unsupportedReason: doc.unsupportedReason ?? null,
          tableNames: doc.tables.map((t) => t.name),
          totalRows: doc.tables.reduce((n, t) => n + t.rows.length, 0),
        };
      },
    },
    {
      channel: IpcChannel.DataPlaneAnalyze,
      schema: DataPlaneAnalyzeRequest,
      requireAuth: true,
      timeoutMs: 120_000,
      handler: async (p): Promise<DataPlanePlanSummary> => {
        const req = p as DataPlaneAnalyzeRequest;
        const buf = decodeContent(req.contentBase64, req.filename);
        const plan = analyzeSource(req.filename, buf, { now: deps.now });

        // Reuse any mapping this tenant has already confirmed for this shape.
        await mappings.load();
        const tenantId = deps.tenantId();
        for (const table of plan.tables) {
          // The planner already carries the signature, so the renderer, the
          // store and this lookup all key off one value.
          const saved = mappings.find(tenantId, table.signature);
          if (saved && saved.entityId === table.entityId) {
            await mappings.noteUse(tenantId, table.signature, deps.now());
          }
        }
        remember(plan);
        log.info('Analyzed source', {
          planId: plan.planId,
          tables: plan.tables.length,
          rows: plan.totals.rows,
        });
        return summarizePlan(plan);
      },
    },
    {
      channel: IpcChannel.DataPlanePlan,
      schema: DataPlanePlanRequest,
      requireAuth: true,
      handler: (p): DataPlanePlanSummary | null => {
        const plan = plans.get((p as DataPlanePlanRequest).planId);
        return plan ? summarizePlan(plan) : null;
      },
    },
    {
      channel: IpcChannel.DataPlaneImport,
      schema: DataPlaneImportRequest,
      requireAuth: true,
      audit: true,
      timeoutMs: 300_000,
      handler: async (p): Promise<DataPlaneRunResult> => {
        const req = p as DataPlaneImportRequest;
        const plan = plans.get(req.planId);
        if (!plan) {
          throw new Error('That import plan is no longer available — re-analyze the file.');
        }

        // Segregation of duties: approving a HIGH-RISK table is a distinct right
        // from loading data. Someone with `data:import` alone cannot wave through
        // money, payroll or master data.
        const approvingHighRisk = req.approvals.some((a) => {
          if (!a.approved) return false;
          const table = plan.tables.find((t) => t.tableName === a.tableName);
          return table?.requiresApproval === true;
        });
        if (approvingHighRisk) deps.authorize('data:approve');

        const decisions: ImportDecision[] = req.approvals.map((a) => ({
          tableName: a.tableName,
          approved: a.approved,
          ...(a.skipRows ? { skipRows: a.skipRows } : {}),
        }));

        const correlationId = `dp_${plan.planId}`;
        const { result, provenance: records } = await applyImportPlan(plan, decisions, {
          storeFor: deps.storeFor,
          actor: deps.actor,
          now: deps.now,
          audit: deps.audit,
        });

        if (req.reason && approvingHighRisk) {
          deps.audit({
            action: 'dataplane.import.approved',
            target: plan.planId,
            summary: `High-risk import approved: ${req.reason}`,
          });
        }

        await provenance.append(result, records);

        // Let domain subsystems react to imported records — one event per
        // destination module, carrying a correlation id so a reaction can never
        // be mistaken for user-driven activity or loop back into the plane.
        if (deps.onImported) {
          for (const table of result.tables) {
            if (table.createdRecordIds.length === 0) continue;
            deps.onImported({
              moduleId: table.moduleId,
              recordIds: table.createdRecordIds,
              planId: plan.planId,
              correlationId,
            });
          }
        }

        log.info('Import finished', { planId: plan.planId, status: result.status, imported: result.totals.imported });
        return result;
      },
    },
    {
      channel: IpcChannel.DataPlaneHistory,
      schema: DataPlaneHistoryRequest,
      requireAuth: true,
      handler: async (p): Promise<DataPlaneRunResult[]> => {
        await provenance.load();
        return provenance.history((p as DataPlaneHistoryRequest).limit ?? 50);
      },
    },
    {
      channel: IpcChannel.DataPlaneRun,
      schema: DataPlaneRunRequest,
      requireAuth: true,
      handler: async (p): Promise<DataPlaneRunResult | null> => {
        await provenance.load();
        return provenance.run((p as DataPlaneRunRequest).planId);
      },
    },
    {
      channel: IpcChannel.DataPlaneProvenance,
      schema: DataPlaneProvenanceRequest,
      requireAuth: true,
      handler: async (p): Promise<DataPlaneProvenance | null> => {
        await provenance.load();
        return provenance.forRecord((p as DataPlaneProvenanceRequest).recordId);
      },
    },
    {
      channel: IpcChannel.DataPlaneMappings,
      schema: DataPlaneMappingsRequest,
      requireAuth: true,
      handler: async (p): Promise<DataPlaneSavedMapping[]> => {
        await mappings.load();
        const req = p as DataPlaneMappingsRequest;
        return mappings.list(deps.tenantId(), req.signature);
      },
    },
    {
      channel: IpcChannel.DataPlaneSaveMapping,
      schema: DataPlaneSaveMappingRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<DataPlaneSavedMapping> => {
        const req = p as DataPlaneSaveMappingRequest;
        if (entityById(req.entityId) === null) {
          throw new Error(`Unknown entity "${req.entityId}".`);
        }
        await mappings.load();
        const saved = await mappings.save(
          { signature: req.signature, entityId: req.entityId, columns: req.columns },
          { tenantId: deps.tenantId(), actor: deps.actor(), now: deps.now() },
        );
        deps.audit({
          action: 'dataplane.mapping.saved',
          target: req.signature,
          summary: `Saved a ${req.columns.length}-column mapping for ${req.entityId} (v${saved.version}).`,
        });
        return saved;
      },
    },
    {
      channel: IpcChannel.DataPlaneForgetMapping,
      schema: DataPlaneForgetMappingRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<{ forgotten: boolean }> => {
        const req = p as DataPlaneForgetMappingRequest;
        await mappings.load();
        const forgotten = await mappings.forget(deps.tenantId(), req.signature);
        if (forgotten) {
          deps.audit({
            action: 'dataplane.mapping.forgotten',
            target: req.signature,
            summary: 'Removed a saved import mapping.',
          });
        }
        return { forgotten };
      },
    },
    {
      channel: IpcChannel.DataPlaneExportable,
      schema: EmptyRequest,
      requireAuth: true,
      handler: async (): Promise<DataPlaneExportableModule[]> => {
        deps.authorize('data:read');
        await provenance.load();
        const out: DataPlaneExportableModule[] = [];
        for (const descriptor of deps.modules()) {
          const store = deps.storeFor(descriptor.id);
          if (!store) continue;
          await store.load();
          const live = store.list().filter((r) => r.status !== 'deleted');
          // A module with nothing in it is not offered — an export that would
          // produce a header row and no data is not a useful thing to show.
          if (live.length === 0) continue;
          out.push({
            moduleId: descriptor.id,
            title: descriptor.title,
            plural: descriptor.plural,
            group: descriptor.group ?? null,
            recordCount: live.length,
            importedCount: provenance.countForModule(descriptor.id),
          });
        }
        return out;
      },
    },
    {
      channel: IpcChannel.DataPlaneExport,
      schema: DataPlaneExportRequest,
      requireAuth: true,
      audit: true,
      timeoutMs: 120_000,
      handler: async (p): Promise<DataPlaneExportResult> => {
        const req = p as DataPlaneExportRequest;

        // Two gates, deliberately. `data:read` is the right to use this surface
        // at all; the module's OWN read permission is the right to see THAT
        // data. Bulk extraction must not be a way around the second one.
        deps.authorize('data:read');
        const descriptor = deps.modules().find((m) => m.id === req.moduleId);
        if (!descriptor) throw new Error(`Unknown module "${req.moduleId}".`);
        deps.authorize(descriptor.permissions.read);

        const store = deps.storeFor(req.moduleId);
        if (!store) throw new Error(`"${descriptor.title}" is not available in this build.`);
        await store.load();
        const live = store.list().filter((r) => r.status !== 'deleted');

        const columns: ExportColumn[] = descriptor.fields.map((f) => ({ key: f.key, label: f.label }));
        const withProvenance = req.includeProvenance === true;
        if (withProvenance) {
          await provenance.load();
          columns.push(
            { key: '__source_file', label: 'Source file' },
            { key: '__source_table', label: 'Source sheet' },
            { key: '__source_row', label: 'Source row' },
            { key: '__imported_at', label: 'Imported at' },
          );
        }

        const rows: Record<string, ExportCell>[] = live.map((record) => {
          const row: Record<string, ExportCell> = {};
          for (const field of descriptor.fields) row[field.key] = record.fields[field.key] ?? null;
          if (withProvenance) {
            const p2 = provenance.forRecord(record.id);
            // A record created by hand has no import provenance. That is stated
            // as empty cells rather than invented.
            row['__source_file'] = p2?.sourceFile ?? null;
            row['__source_table'] = p2?.sourceTable ?? null;
            row['__source_row'] = p2?.sourceRow ?? null;
            row['__imported_at'] = p2?.importedAt ?? null;
          }
          return row;
        });

        const table: ExportTable = { name: descriptor.plural, columns, rows };
        const artifact = buildExport(table, req.format, deps.now());
        const filePath = await deps.saveExport(artifact.filename, artifact.format, artifact.content);

        if (filePath === null) {
          return {
            moduleId: req.moduleId,
            format: req.format,
            records: 0,
            columns: columns.length,
            filePath: null,
            cancelled: true,
          };
        }

        deps.audit({
          action: 'dataplane.export',
          target: req.moduleId,
          summary: `Exported ${rows.length} ${descriptor.plural} as ${req.format.toUpperCase()}.`,
        });
        log.info('Export written', { moduleId: req.moduleId, format: req.format, records: rows.length });

        return {
          moduleId: req.moduleId,
          format: req.format,
          records: rows.length,
          columns: columns.length,
          filePath,
          cancelled: false,
        };
      },
    },
  ];

  log.info('Data Plane ready', { channels: handlers.length, entities: ONTOLOGY.length });
  return { handlers, provenance, mappings };
}
