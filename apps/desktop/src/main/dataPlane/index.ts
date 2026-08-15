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
import { randomUUID } from 'node:crypto';
import type {
  DataPlaneExportableModule,
  DataPlaneRelationshipDecision,
  DataPlaneRelationshipGraph,
  DataPlaneRelationshipOverview,
  DataPlaneRelationshipPass,
  DataPlaneRelationshipPending,
  DataPlaneExportResult,
  DataPlaneInspection,
  DataPlaneOntologyView,
  DataPlanePlanSummary,
  DataPlaneExportFormats,
  DataPlaneExportManifest,
  DataPlaneExportPlan,
  DataPlanePreview,
  DataPlaneProvenance,
  DataPlaneRunResult,
  DataPlaneSavedMapping,
  EnterpriseModuleDescriptor,
  EnterprisePermission,
} from '@neuropause/shared';
import {
  DataPlaneAnalyzeRequest,
  DataPlaneExportPlanRequest,
  DataPlaneExportRequest,
  DataPlaneRelationshipDecideRequest,
  DataPlaneRelationshipGraphRequest,
  DataPlaneRelationshipQueueRequest,
  DataPlaneRelationshipSkipRequest,
  DataPlaneForgetMappingRequest,
  DataPlaneHistoryRequest,
  DataPlaneImportRequest,
  DataPlaneInspectRequest,
  DataPlaneMappingsRequest,
  DataPlanePlanRequest,
  DataPlanePreviewRequest,
  DataPlaneProvenanceRequest,
  DataPlaneReclassifyRequest,
  DataPlaneRunRequest,
  DataPlaneSaveMappingRequest,
  EmptyRequest,
  IpcChannel,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import type { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { createLogger } from '../logger';
import {
  analyzeSource,
  planTable,
  summarizePlan,
  type ImportPlan,
  type PlannedTable,
  type UnclassifiedTable,
} from './planner';
import { matchExistingRecords, type PreparedRow } from './quality';
import type { CellValue } from './parsers';
import type { CanonicalEntity } from './ontology';
import { ProvenanceStore, type ImportDecision, type ImportDeps } from './importer';
import { governedImport } from '../cst/importTransition';
import { MappingMemoryStore, applySavedMapping } from './mappingMemory';
import { ONTOLOGY, entityById, requiresExplicitApproval } from './ontology';
import { SUPPORTED_FORMATS, parseFile } from './parsers';
import { buildExport, type ExportCell, type ExportColumn, type ExportTable } from './exporters';
import {
  exportBlockedReason,
  resolveFields,
  resolveScope,
  selectableFields,
  tooLargeReason,
} from './exportScope';
import { buildManifest, packageExport, sha256Hex } from './exportManifest';
import { RelationshipEngine } from './relationshipEngine';
import { RelationshipStore, type PendingRelationship } from './relationshipStore';
import { RELATIONSHIPS, RELATIONSHIP_CHAINS, relationshipByKey } from './relationshipModel';

const log = createLogger('data-plane');

/** Analyzed plans are held in memory between analyze and import. */
const MAX_CACHED_PLANS = 20;

/**
 * What this build can actually write, and what it cannot.
 *
 * PDF is named as unavailable rather than omitted. A format that silently
 * disappears from a chooser reads as "not a thing"; a format that says why it
 * is missing reads as an honest boundary — and stops the next person adding a
 * `.pdf` extension to a spreadsheet and calling it done.
 */
const EXPORT_FORMATS: DataPlaneExportFormats = {
  supported: ['csv', 'xlsx', 'json'],
  unavailable: [
    {
      format: 'pdf',
      reason:
        'No PDF engine is bundled in this build. A renamed spreadsheet is not a PDF, so the option is withheld rather than faked.',
    },
  ],
};

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
  /**
   * Fired after a successful import so imported records re-enter the module
   * lifecycle (audit, renderer broadcast, every module's `onChange`).
   *
   * REQUIRED, not optional, and deliberately so. It was optional once, and the
   * composition root was silently reverted to omit it — a full green gate, and
   * imported records invisible to the rest of the system. An optional dependency
   * whose absence is undetectable is not a safe contract. A caller that genuinely
   * wants no reaction passes `() => undefined` and says so at the call site.
   */
  onImported: (event: { moduleId: string; recordIds: string[]; planId: string; correlationId: string }) => void;
  /**
   * Application identity for the export manifest.
   *
   * Injected rather than read from `app.getVersion()` here, because this
   * module must keep running under plain Node in tests — and because a
   * manifest claiming a version is only useful if it is the version that
   * actually wrote the file.
   */
  appVersion: () => string;
  /** Active workspace, when the build has one. Written to the manifest as-is. */
  workspaceId: () => string | null;
}

export interface DataPlaneSubsystem {
  handlers: SecureHandlerDef[];
  provenance: ProvenanceStore;
  mappings: MappingMemoryStore;
  relationships: RelationshipStore;
  relationshipEngine: RelationshipEngine;
  /** Drop analyzed-but-unexecuted import plans. Called on a workspace switch. */
  forgetPlans: () => void;
}

function decodeContent(base64: string, filename: string): Buffer {
  try {
    return Buffer.from(base64, 'base64');
  } catch {
    throw new Error(`Could not read the uploaded content for "${filename}".`);
  }
}

/** The row's bucket, as the filter chips name them. */
function bucketOf(row: PreparedRow): 'valid' | 'warning' | 'invalid' | 'duplicate' | 'ambiguous' {
  if (row.existingMatch?.kind === 'normalized') return 'ambiguous';
  if (row.verdict === 'duplicate') return 'duplicate';
  if (row.verdict === 'invalid') return 'invalid';
  // `incomplete` is a WARNING, not a failure: a required field is missing, the
  // row is understood, and the reviewer may still want it. Collapsing it into
  // "invalid" would hide the difference between unusable and imperfect.
  if (row.verdict === 'incomplete') return 'warning';
  return 'valid';
}

/**
 * Build one page of preview rows.
 *
 * Two rules the shape enforces. Sensitive fields are REDACTED — a preview
 * exists so a person can check the data, and no check requires a password on
 * screen. And the page is capped: the whole reason rows were stripped from the
 * plan summary was that 200,000 of them must not cross IPC, so restoring them
 * unbounded would undo the fix.
 */
function buildPreview(
  table: PlannedTable,
  entity: CanonicalEntity,
  req: DataPlanePreviewRequest,
): DataPlanePreview {
  const sensitive = new Set(entity.fields.filter((f) => f.sensitive === true).map((f) => f.key));
  /**
   * Transformations are keyed by LABEL, not by field key — `"Monthly Salary:
   * "₹1,25,000" → 125000 INR"` — so redacting by key alone missed them
   * entirely and shipped the salary verbatim while the adjacent `original`
   * was dutifully bulleted out. Redacting one and not the other is worse than
   * redacting neither, because it reads as though the value was handled.
   */
  const sensitiveLabels = new Set(
    entity.fields.filter((f) => f.sensitive === true).map((f) => f.label),
  );
  const labelFor = new Map(entity.fields.map((f) => [f.key, f.label]));

  const counts = { all: table.rows.length, valid: 0, warning: 0, invalid: 0, duplicate: 0, ambiguous: 0 };
  const plan = { create: 0, update: 0, skip: 0, review: 0 };
  for (const row of table.rows) {
    counts[bucketOf(row)] += 1;
    plan[row.action ?? 'create'] += 1;
  }

  const mode = req.mode ?? 'all';
  const needle = req.search?.trim().toLowerCase() ?? '';
  const matching = table.rows.filter((row) => {
    if (mode !== 'all' && bucketOf(row) !== mode) return false;
    if (needle === '') return true;
    // Search the values a person can SEE. Redacted fields are excluded, so a
    // search box cannot be used to probe a hidden value character by character.
    const haystack = [
      row.title,
      ...Object.entries(row.fields)
        .filter(([key]) => !sensitive.has(key))
        .map(([, v]) => String(v ?? '')),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });

  const offset = req.offset ?? 0;
  const limit = Math.min(req.limit ?? 25, 100);

  return {
    tableName: table.tableName,
    entityId: entity.id,
    entityLabel: entity.label,
    total: matching.length,
    offset,
    counts,
    plan,
    rows: matching.slice(offset, offset + limit).map((row) => ({
      rowIndex: row.rowIndex,
      sourceRow: row.sourceRow,
      verdict: row.verdict,
      action: row.action ?? 'create',
      title: row.title,
      fields: Object.entries(row.fields).map(([key, value]) => ({
        key,
        label: labelFor.get(key) ?? key,
        value: sensitive.has(key) ? '••••••••' : String(value ?? ''),
        redacted: sensitive.has(key),
      })),
      issues: row.issues.map((i) => ({
        field: i.fieldLabel,
        // The MESSAGE embeds the offending value too ("\"abc\" is not a
        // number."), so redacting only `original` left the value on screen.
        message: sensitive.has(i.fieldKey)
          ? `${i.fieldLabel}: the value could not be read (hidden — sensitive field)`
          : i.message,
        original: sensitive.has(i.fieldKey) ? '••••••••' : i.original,
      })),
      transformations: row.transformations.map((t) => {
        const label = t.split(':')[0]?.trim() ?? '';
        return sensitiveLabels.has(label) ? `${label}: normalized (hidden — sensitive field)` : t;
      }),
      duplicateOfRow: row.duplicateOf === null ? null : row.duplicateOf + 1,
      existingMatch: row.existingMatch
        ? {
            ...row.existingMatch,
            differs: row.existingMatch.differs.filter((d) => !sensitive.has(d.field)),
          }
        : null,
    })),
  };
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
  const relationships = new RelationshipStore(join(deps.userDataDir, 'data-plane-relationships.json'));
  const relationshipEngine = new RelationshipEngine({
    store: relationships,
    storeFor: deps.storeFor,
    describe: (moduleId) => deps.modules().find((m) => m.id === moduleId) ?? null,
    actor: deps.actor,
    now: deps.now,
    audit: deps.audit,
  });

  /**
   * Match a planned table's rows against what is ALREADY in the destination.
   *
   * Run on demand rather than cached at analyze time, because the destination
   * can change between analysing a file and importing it — and a stale "this
   * is new" is exactly how a duplicate gets created.
   */
  const matchAgainstDestination = async (table: PlannedTable): Promise<void> => {
    const entity = entityById(table.entityId);
    const store = deps.storeFor(table.moduleId);
    if (!entity || !store) {
      /**
       * No destination to compare against. Say nothing rather than let a stale
       * action from a previous entity stand — after a reclassify to a module
       * this build does not have, "create" would promise writes that the
       * importer will refuse.
       *
       * `review` only for rows a reviewer could actually decide. Marking an
       * INVALID row `review` produced a "needs a decision" prompt above zero
       * available actions, and a counter that could never reach zero: the row
       * offers no choices, so no choice can ever answer it. A row that failed
       * validation is skipped, and says why.
       */
      for (const row of table.rows) {
        row.existingMatch = null;
        row.action = row.verdict === 'valid' ? 'review' : 'skip';
      }
      return;
    }
    /**
     * The destination module's OWN read scope, exactly as `dp:export`
     * demands it.
     *
     * Without this, preview is a cross-module read oracle: `data:read` alone
     * would return `existingMatch.recordId`, `.title` and `differs[].existing`
     * — the STORED values — for any of the ten ontology modules, reachable by
     * uploading a CSV with the right headers. Bulk extraction is gated; a
     * comparison that hands back the same values must be too.
     */
    const descriptor = deps.modules().find((m) => m.id === table.moduleId);
    if (!descriptor) return;
    deps.authorize(descriptor.permissions.read);
    await store.load();
    matchExistingRecords(
      table.rows,
      entity,
      store.list({ status: 'active', limit: 200_000 }).map((r) => ({
        id: r.id,
        title: r.title,
        fields: r.fields as Record<string, CellValue>,
      })),
    );
  };

  /**
   * Everything an export needs, with both permission gates already applied.
   *
   * Shared by `dp:export.plan` and `dp:export` so a preview can never be
   * computed against a wider permission set than the run. `mayAdminister` is
   * probed, not assumed: `authorize` throws, and the right to see the payroll
   * list is not the right to export the bank accounts in it.
   */
  const exportContextFor = async (
    moduleId: string,
  ): Promise<{
    descriptor: EnterpriseModuleDescriptor;
    store: EnterpriseRecordStore;
    mayAdminister: boolean;
  }> => {
    deps.authorize('data:read');
    const descriptor = deps.modules().find((m) => m.id === moduleId);
    if (!descriptor) throw new Error(`Unknown module "${moduleId}".`);
    deps.authorize(descriptor.permissions.read);

    let mayAdminister = false;
    try {
      deps.authorize(descriptor.permissions.write);
      mayAdminister = true;
    } catch {
      mayAdminister = false;
    }

    const store = deps.storeFor(moduleId);
    if (!store) throw new Error(`"${descriptor.title}" is not available in this build.`);
    await store.load();
    return { descriptor, store, mayAdminister };
  };

  /** Recompute plan-level totals after a table is replaced by a reclassify. */
  const recomputeTotals = (plan: ImportPlan): void => {
    plan.totals = {
      tables: plan.tables.length,
      rows: plan.tables.reduce((n, t) => n + t.report.totalRows, 0),
      importable: plan.tables.reduce((n, t) => n + t.importableRows, 0),
      invalid: plan.tables.reduce((n, t) => n + t.report.invalid, 0),
      incomplete: plan.tables.reduce((n, t) => n + t.report.incomplete, 0),
      duplicates: plan.tables.reduce((n, t) => n + t.report.duplicates, 0),
      approvalRequired: plan.tables.filter((t) => t.requiresApproval).length,
    };
    plan.requiresApproval = plan.tables.some((t) => t.requiresApproval);
  };

  /** Shared shape for the review queue — labels resolved from the declaration. */
  const pendingView = (p: PendingRelationship): DataPlaneRelationshipPending => ({
    id: p.id,
    relationshipKey: p.relationshipKey,
    relationshipLabel: relationshipByKey(p.relationshipKey)?.label ?? p.relationshipKey,
    sourceModuleId: p.sourceModuleId,
    sourceRecordId: p.sourceRecordId,
    sourceTitle: p.sourceTitle,
    sourceField: p.sourceField,
    sourceValue: p.sourceValue,
    targetModuleId: p.targetModuleId,
    targetLabel: p.targetLabel,
    status: p.status,
    candidates: p.candidates,
    reason: p.reason,
    firstSeenAt: p.firstSeenAt,
    attempts: p.attempts,
  });

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
            /**
             * ACTUALLY apply it. `applySavedMapping` existed, was exported and
             * was tested — and was called from nowhere, so a remembered mapping
             * incremented `useCount` and changed not one column. A reviewer who
             * corrected a mapping last week got the machine's guess again this
             * week, with a "Remembered" badge on it.
             *
             * A saved mapping is a REVIEWER'S DECISION, so it outranks the
             * classifier for the columns it covers — and only those. It cannot
             * invent a column this file does not have, and the gate above means
             * it is only consulted when the classifier independently reached
             * the same entity: a remembered mapping must not be the thing that
             * decides what the data IS.
             */
            table.mappings = applySavedMapping(table.mappings, saved, (key) => {
              const entity = entityById(table.entityId);
              return entity?.fields.find((f) => f.key === key)?.label ?? null;
            });
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
          ...(a.rowActions ? { rowActions: a.rowActions } : {}),
        }));

        // Identity matching runs against the destination as it is NOW, not as
        // it was at analyze time. Without this, a row whose default action was
        // computed minutes ago could create a duplicate of a record someone
        // else added in between.
        for (const table of plan.tables) {
          const decision = req.approvals.find((a) => a.tableName === table.tableName);
          // Skip tables nobody approved: matching them scans the destination
          // and mutates rows for a table that will never be written.
          if (decision?.approved !== true && table.requiresApproval) continue;
          await matchAgainstDestination(table);
        }

        const correlationId = `dp_${plan.planId}`;
        // The effect's deps — UNCHANGED. `applyImportPlan` is preserved verbatim;
        // it now runs only inside the CST kernel's `effect`, only on ALLOW + won
        // claim + pre-state revalidation.
        const importDeps: ImportDeps = {
          storeFor: deps.storeFor,
          actor: deps.actor,
          now: deps.now,
          audit: deps.audit,
          /**
           * The destination module's own WRITE scope, on top of `data:import`.
           *
           * `dp:export` has always double-gated on the module's READ scope
           * because bulk extraction must not bypass the per-module gate. Bulk
           * INSERTION had no equivalent: `data:import` alone was enough to
           * create records in finance, hr-employees or crm-customers. This is
           * the missing half.
           */
          authorizeWrite: (moduleId) => {
            const descriptor = deps.modules().find((m) => m.id === moduleId);
            if (!descriptor) throw new Error(`Module "${moduleId}" is not registered.`);
            deps.authorize(descriptor.permissions.write);
          },
          // Verification reads the destination, not the counters that wrote it.
          readBack: (moduleId, recordId) => {
            const store = deps.storeFor(moduleId);
            const record = store?.get(recordId);
            return record !== null && record !== undefined && record.status !== 'deleted';
          },
        };

        // ── The ONE CST boundary (frozen @neuropause/cst 1.3.0). The kernel is the
        // single governance verdict for this consequential transition; the effect
        // above is unchanged. HOLD/DENY ⇒ nothing is written — never a fabricated
        // success. See main/cst/importTransition.ts.
        const governed = await governedImport({
          plan,
          decisions,
          tenantId: deps.tenantId(),
          actorId: deps.actor() ?? '',
          policyVersion: 'dp-import-policy-1',
          importDeps,
        });
        if (governed.result === undefined || governed.provenance === undefined) {
          // A governed refusal (HOLD/DENY) — surface the kernel's own reason so
          // the refusal is legible, and assert nothing about the world.
          const o = governed.outcome;
          throw new Error(
            `Import ${o.verdict} by governance (${o.reason}). Nothing was written.`,
          );
        }
        const result = governed.result;
        const records = governed.provenance;

        if (req.reason && approvingHighRisk) {
          deps.audit({
            action: 'dataplane.import.approved',
            target: plan.planId,
            summary: `High-risk import approved: ${req.reason}`,
          });
        }

        await provenance.append(result, records);

        // Reconstruct relationships for what just arrived, then re-check
        // everything previously parked — which is what makes import ORDER
        // irrelevant. Failures here are reported, never allowed to unwind an
        // import whose records are already committed.
        await relationships.load();
        for (const table of result.tables) {
          const touched = [...table.createdRecordIds, ...table.updatedRecordIds];
          if (touched.length === 0) continue;
          const store = deps.storeFor(table.moduleId);
          if (!store) continue;
          await store.load();
          // UPDATED records are resolved too. An update can change a
          // reference field — an invoice's customer, a lot's product code —
          // and leaving it out meant the link kept pointing at the old target
          // with no sign anything had moved.
          const records = touched
            .map((id) => store.get(id))
            .filter((r): r is NonNullable<typeof r> => r !== null);
          await relationshipEngine.resolveRecords(table.moduleId, records, correlationId);
        }
        const deferred = await relationshipEngine.retryPending(correlationId);
        if (deferred.resolved > 0) {
          log.info('Deferred relationships resolved by this import', { resolved: deferred.resolved });
        }

        // Let domain subsystems react to imported records — one event per
        // destination module, carrying a correlation id so a reaction can never
        // be mistaken for user-driven activity or loop back into the plane.
        for (const table of result.tables) {
          const touched = [...table.createdRecordIds, ...table.updatedRecordIds];
          if (touched.length === 0) continue;
          deps.onImported({
            moduleId: table.moduleId,
            recordIds: touched,
            planId: plan.planId,
            correlationId,
          });
        }

        // The plan is spent. Leaving it cached let the SAME planId be imported
        // a second time; per-row import keys now stop that from duplicating
        // data, but keeping a used plan around only preserves the confusing
        // case where a second click appears to succeed and writes nothing.
        plans.delete(plan.planId);

        log.info('Import finished', { planId: plan.planId, status: result.status, imported: result.totals.imported });
        return result;
      },
    },
    {
      /**
       * Correct what a file represents.
       *
       * Re-plans the table from its RAW source with the chosen entity, so
       * mapping, validation, duplicates, identity matching and the plan are
       * all recomputed. Reusing any of the previous entity's results would
       * leave the reviewer looking at numbers computed for a different
       * question — an override that is worse than no override.
       */
      channel: IpcChannel.DataPlaneReclassify,
      schema: DataPlaneReclassifyRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<DataPlanePlanSummary> => {
        const req = p as DataPlaneReclassifyRequest;
        const plan = plans.get(req.planId);
        if (!plan) throw new Error('That import plan is no longer available — re-analyze the file.');

        // Only entities this build can actually import. A chooser that offers
        // "Sales Order" when nothing can receive one is a promise the product
        // cannot keep.
        if (!entityById(req.entityId)) {
          throw new Error(
            `"${req.entityId}" is not an entity this build can import. Supported: ${ONTOLOGY.map((e) => e.id).join(', ')}.`,
          );
        }

        /**
         * A table the detector placed, OR one it could not place at all.
         *
         * The unclassified branch is the case an override matters most for:
         * a planned table is at least wrong in a nameable way, while an
         * unrecognised one is simply refused. Both are re-planned from the
         * same raw grid by the same call, so neither path can drift.
         */
        const index = plan.tables.findIndex((t) => t.tableName === req.tableName);
        const unclassifiedIndex =
          index >= 0 ? -1 : plan.unclassified.findIndex((u) => u.tableName === req.tableName);
        if (index < 0 && unclassifiedIndex < 0) {
          throw new Error(`No table "${req.tableName}" in this plan.`);
        }

        const current = index >= 0 ? (plan.tables[index] as PlannedTable) : null;
        const source =
          current !== null
            ? current.source
            : (plan.unclassified[unclassifiedIndex] as UnclassifiedTable).source;

        const replanned = planTable(source, req.entityId);
        if (!replanned) {
          throw new Error(`This table cannot be imported as ${req.entityId}.`);
        }
        await matchAgainstDestination(replanned);

        const corrected: PlannedTable = {
          ...replanned,
          /**
           * A reviewer-overridden table ALWAYS requires approval.
           *
           * The forced path reports confidence 1, which lands in the `high`
           * band and switches off `requiresApproval`'s low-confidence clause.
           * That made reclassify a way around `data:approve`: reclassify a
           * medium-confidence products file to the same entity and the
           * segregation-of-duties gate stops firing. Certainty about the
           * reviewer's intent is not certainty about the data.
           */
          requiresApproval: true,
          // The detector's original verdict is preserved, not overwritten:
          // "we thought Customer at 0.62, a person said Invoice" is the whole
          // point of recording an override. For a table it could not place at
          // all, that verdict is genuinely null — not a zero dressed up as one.
          detectedEntityId: current?.detectedEntityId ?? null,
          detectedConfidence: current?.detectedConfidence ?? 0,
          classificationMethod: 'reviewer',
          override: {
            fromEntityId: current?.entityId ?? null,
            toEntityId: req.entityId,
            by: deps.actor(),
            at: deps.now(),
            reason: req.reason?.trim() ?? '',
          },
        };

        if (index >= 0) {
          plan.tables[index] = corrected;
        } else {
          plan.unclassified.splice(unclassifiedIndex, 1);
          plan.tables.push(corrected);
        }
        recomputeTotals(plan);
        // Audited AFTER the plan is consistent but BEFORE it is handed back,
        // so a summary the reviewer acts on always has a matching audit line.
        deps.audit({
          action: 'dataplane.entity.override',
          target: `${plan.planId}:${req.tableName}`,
          summary: `Reclassified "${req.tableName}" from ${current?.entityId ?? 'unrecognised'} to ${req.entityId}${req.reason ? ` — ${req.reason}` : ''}.`,
        });
        return summarizePlan(plan);
      },
    },
    {
      /**
       * A page of prepared rows, bounded and redacted.
       *
       * The rows have always existed in main; `summarizePlan` strips them
       * because 200,000 of them must not cross IPC. This is the seam that lets
       * a reviewer look at the actual data before approving it, without
       * handing the renderer the whole file.
       */
      channel: IpcChannel.DataPlanePreview,
      schema: DataPlanePreviewRequest,
      requireAuth: true,
      handler: async (p): Promise<DataPlanePreview | null> => {
        const req = p as DataPlanePreviewRequest;
        const plan = plans.get(req.planId);
        const table = plan?.tables.find((t) => t.tableName === req.tableName);
        if (!plan || !table) return null;
        const entity = entityById(table.entityId);
        if (!entity) return null;
        // Identity matching needs the destination, which may have changed
        // since the analysis. Recomputed here rather than cached.
        await matchAgainstDestination(table);
        return buildPreview(table, entity, req);
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
          /**
           * The module's OWN read scope, exactly as `dp:export` demands it.
           *
           * Without this, `data:read` alone returned the name and live record
           * count of every module in the build — payroll, finance, medical —
           * to an actor who could not read a single record in any of them.
           * A count is not a value, but "how many employees are there" and
           * "which business systems does this company run" are both answers,
           * and neither was theirs to have.
           */
          try {
            deps.authorize(descriptor.permissions.read);
          } catch {
            continue;
          }
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
      channel: IpcChannel.DataPlaneExportPlan,
      schema: DataPlaneExportPlanRequest,
      requireAuth: true,
      handler: async (p): Promise<DataPlaneExportPlan> => {
        const req = p as DataPlaneExportPlanRequest;
        const { descriptor, store, mayAdminister } = await exportContextFor(req.moduleId);

        // An explicit ceiling on the scan, matching the import path's own
        // `limit: 200_000`. The refusal above `MAX_EXPORT_RECORDS` is what
        // actually protects the file's honesty; this protects the process.
        const scope = resolveScope(store.list({ limit: 200_000 }), descriptor, req.scope);
        const available = selectableFields(descriptor, mayAdminister);
        const wantRestricted = req.includeRestricted === true;
        const fields = resolveFields(descriptor, available, req.fields, wantRestricted && mayAdminister);

        /**
         * The plan applies the SAME administrator gate the run applies.
         *
         * Resolving with a bare `req.includeRestricted` let a read-only actor
         * see `blockedReason: null` and a clean field list, then get a throw
         * when they pressed the button — a preview that disagrees with the
         * run, which is the one thing a preview must never do.
         */
        const restrictedRefusal =
          wantRestricted && !mayAdminister
            ? `Exporting personal or financial identifiers from ${descriptor.plural} requires permission to edit them (${descriptor.permissions.write}).`
            : null;

        return {
          moduleId: descriptor.id,
          title: descriptor.title,
          plural: descriptor.plural,
          scope: scope.kind,
          scopeLabel: scope.label,
          records: scope.records.length,
          totalRecords: scope.total,
          fields: available,
          excluded: fields.excluded,
          formats: EXPORT_FORMATS,
          mayIncludeRestricted: mayAdminister,
          blockedReason: restrictedRefusal ?? exportBlockedReason(scope, fields, descriptor),
          tooLargeReason: tooLargeReason(scope),
          refusedFilters: scope.refusedFilters,
          missingRecordIds: scope.missingIds,
        };
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
        const { descriptor, store, mayAdminister } = await exportContextFor(req.moduleId);

        /**
         * The scope and the field set are resolved by the SAME functions the
         * plan channel calls. A preview that says "12 of 340" and a file with
         * 340 rows in it is not a state this code can reach, because there is
         * only one place either number is computed.
         */
        // An explicit ceiling on the scan, matching the import path's own
        // `limit: 200_000`. The refusal above `MAX_EXPORT_RECORDS` is what
        // actually protects the file's honesty; this protects the process.
        const scope = resolveScope(store.list({ limit: 200_000 }), descriptor, req.scope);
        const available = selectableFields(descriptor, mayAdminister);
        const wantRestricted = req.includeRestricted === true;

        /**
         * Asking for restricted data without the right to administer the
         * module is REFUSED, not quietly downgraded.
         *
         * Silently dropping the fields would produce a file that looks like
         * the one that was asked for and is missing columns — and the caller
         * would have no reason to look.
         */
        if (wantRestricted && !mayAdminister) {
          throw new Error(
            `Exporting personal or financial identifiers from ${descriptor.plural} requires permission to edit them (${descriptor.permissions.write}).`,
          );
        }

        const fields = resolveFields(descriptor, available, req.fields, wantRestricted);

        const blocked = exportBlockedReason(scope, fields, descriptor);
        if (blocked !== null) throw new Error(blocked);
        const tooLarge = tooLargeReason(scope);
        if (tooLarge !== null) throw new Error(tooLarge);

        const columns: ExportColumn[] = [...fields.columns];
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

        let traced = 0;
        const rows: Record<string, ExportCell>[] = scope.records.map((record) => {
          const row: Record<string, ExportCell> = {};
          // Only the RESOLVED keys. Iterating the descriptor here is how the
          // withheld fields used to get written anyway.
          for (const key of fields.keys) row[key] = record.fields[key] ?? null;
          if (withProvenance) {
            const p2 = provenance.forRecord(record.id);
            if (p2) traced += 1;
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

        let manifest: DataPlaneExportManifest | null = null;
        let filename = artifact.filename;
        let content = artifact.content;
        let packaged = false;

        if (req.withManifest === true) {
          manifest = buildManifest({
            exportId: `exp_${randomUUID()}`,
            createdAt: deps.now(),
            createdBy: deps.actor() ?? 'unknown',
            appName: 'NeuroPause',
            appVersion: deps.appVersion(),
            workspaceId: deps.workspaceId(),
            tenantId: deps.tenantId(),
            moduleId: descriptor.id,
            title: descriptor.title,
            entityPlural: descriptor.plural,
            scope: {
              kind: scope.kind,
              label: scope.label,
              recordCount: rows.length,
              moduleRecordCount: scope.total,
              /**
               * The filters that were APPLIED, by label — not the raw request.
               *
               * Copying `req.scope.filters` verbatim wrote whatever the caller
               * sent into `manifest.json`, `README.txt` and the audit line,
               * including a filter naming a field they were not allowed to
               * read. `resolveScope` refuses those now, so what survives here
               * is by construction a non-sensitive column.
               */
              filters: scope.appliedFilters.map((f) => ({ field: f.label, value: f.value })),
              recordIds: req.scope?.recordIds ? [...req.scope.recordIds] : null,
            },
            fields: fields.columns,
            excludedFields: fields.excluded,
            includesRestricted: fields.includesRestricted,
            format: req.format,
            dataFile: artifact.filename,
            // Hashed BEFORE packaging, so the digest describes the data file a
            // reader will extract, not the archive around it.
            dataFileSha256: sha256Hex(artifact.content),
            provenance: {
              included: withProvenance,
              tracedRecords: withProvenance ? traced : 0,
              untracedRecords: withProvenance ? rows.length - traced : 0,
            },
          });
          const pkg = packageExport(artifact.filename, artifact.content, manifest);
          filename = pkg.filename;
          content = pkg.content;
          packaged = true;
        }

        const filePath = await deps.saveExport(filename, packaged ? 'zip' : artifact.format, content);

        if (filePath === null) {
          return {
            moduleId: req.moduleId,
            format: req.format,
            records: 0,
            columns: columns.length,
            filePath: null,
            cancelled: true,
            manifest: null,
            packaged: false,
            excluded: fields.excluded,
          };
        }

        /**
         * The audit line names what actually left, including the things that
         * did not. "Exported 340 Employees" and "exported 340 Employees
         * including bank accounts" are different events, and only one of them
         * is worth finding later.
         */
        deps.audit({
          action: 'dataplane.export',
          target: req.moduleId,
          summary:
            `Exported ${rows.length} ${descriptor.plural} as ${req.format.toUpperCase()}` +
            ` (${scope.label}; ${fields.columns.length} field${fields.columns.length === 1 ? '' : 's'}` +
            `${fields.includesRestricted ? ', INCLUDING restricted identifiers' : ''}` +
            `${fields.excluded.length > 0 ? `; ${fields.excluded.length} withheld` : ''}` +
            `${packaged ? '; packaged with manifest' : ''}).`,
        });
        log.info('Export written', {
          moduleId: req.moduleId,
          format: req.format,
          records: rows.length,
          scope: scope.kind,
          restricted: fields.includesRestricted,
          packaged,
        });

        return {
          moduleId: req.moduleId,
          format: req.format,
          records: rows.length,
          columns: columns.length,
          filePath,
          cancelled: false,
          manifest,
          packaged,
          excluded: fields.excluded,
        };
      },
    },
    {
      channel: IpcChannel.DataPlaneRelationshipOverview,
      schema: EmptyRequest,
      requireAuth: true,
      handler: async (): Promise<DataPlaneRelationshipOverview> => {
        deps.authorize('data:read');
        await relationships.load();
        return {
          declared: RELATIONSHIPS.map((r) => ({
            key: r.key,
            label: r.label,
            fromModuleId: r.fromModuleId,
            field: r.field,
            toModuleId: r.toModuleId,
            toLabel: r.toLabel,
            keyFields: [...r.keyFields],
            sensitivity: r.sensitivity,
          })),
          chains: RELATIONSHIP_CHAINS.map((c) => ({ id: c.id, label: c.label, keys: [...c.keys] })),
          counts: relationships.counts(),
        };
      },
    },
    {
      channel: IpcChannel.DataPlaneRelationshipQueue,
      schema: DataPlaneRelationshipQueueRequest,
      requireAuth: true,
      handler: async (p): Promise<DataPlaneRelationshipPending[]> => {
        deps.authorize('data:read');
        await relationships.load();
        return relationships.queue((p as DataPlaneRelationshipQueueRequest).limit ?? 200).map(pendingView);
      },
    },
    {
      channel: IpcChannel.DataPlaneRelationshipDecide,
      schema: DataPlaneRelationshipDecideRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<DataPlaneRelationshipDecision> => {
        // Choosing which customer an invoice belongs to WRITES a business fact,
        // so it carries the import right, not the read right.
        deps.authorize('data:import');
        const req = p as DataPlaneRelationshipDecideRequest;
        return relationshipEngine.decide(req.pendingId, req.targetRecordId, null);
      },
    },
    {
      channel: IpcChannel.DataPlaneRelationshipSkip,
      schema: DataPlaneRelationshipSkipRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<DataPlaneRelationshipDecision> => {
        deps.authorize('data:import');
        return relationshipEngine.skip((p as DataPlaneRelationshipSkipRequest).pendingId);
      },
    },
    {
      channel: IpcChannel.DataPlaneRelationshipRetry,
      schema: EmptyRequest,
      requireAuth: true,
      timeoutMs: 120_000,
      handler: async (): Promise<DataPlaneRelationshipPass> => {
        deps.authorize('data:import');
        await relationships.load();
        return relationshipEngine.retryPending(null);
      },
    },
    {
      channel: IpcChannel.DataPlaneRelationshipGraph,
      schema: DataPlaneRelationshipGraphRequest,
      requireAuth: true,
      handler: async (p): Promise<DataPlaneRelationshipGraph> => {
        deps.authorize('data:read');
        return relationshipEngine.neighbourhood((p as DataPlaneRelationshipGraphRequest).recordId);
      },
    },
  ];

  log.info('Data Plane ready', {
    channels: handlers.length,
    entities: ONTOLOGY.length,
    relationships: RELATIONSHIPS.length,
  });
  return {
    handlers,
    provenance,
    mappings,
    relationships,
    relationshipEngine,
    /**
     * P11 — forget analyzed plans when the workspace changes.
     *
     * A plan holds the parsed contents of an uploaded file and is redeemed by id
     * with no owner check. Surviving a switch meant a file analyzed in one
     * workspace could be imported into the next, with the rows landing under the
     * NEW scope — the plan is the file, and the file belonged to the other
     * workspace.
     */
    forgetPlans: () => plans.clear(),
  };
}
