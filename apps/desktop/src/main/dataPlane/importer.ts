/**
 * Phase 6 — Universal Enterprise Data Plane: approval-gated import + provenance.
 *
 * Writes an approved plan into the EXISTING enterprise module stores. Three
 * rules are structural, not advisory:
 *
 *   1. NO WRITE WITHOUT APPROVAL. A table whose plan requires approval and did
 *      not receive it is reported `awaiting_approval` and is not touched.
 *   2. NO FALSE SUCCESS. The result reports imported / skipped / failed
 *      separately; a run where anything failed can never read as "imported".
 *   3. HIGH-RISK IS ALL-OR-NOTHING. The JSON-backed stores have no
 *      transactions, so for money/payroll/master data a partial failure is
 *      COMPENSATED — every record created in that table is soft-deleted and the
 *      table is reported `failed` with `rolledBack: true`. This is compensating
 *      rollback, not ACID, and is documented as such.
 *
 * Every created record carries provenance: source file, sheet, row, the
 * original value and any transformation applied.
 */
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { envelopeStamp, readStoreFile } from '../storage/storeEnvelope';
import { entityById } from './ontology';
import type { ImportPlan, PlannedTable } from './planner';
import type { PreparedRow } from './quality';

export interface FieldProvenance {
  field: string;
  column: string;
  original: string;
  transformation: string | null;
}

export interface ProvenanceRecord {
  recordId: string;
  moduleId: string;
  planId: string;
  sourceFile: string;
  sourceTable: string;
  /** One-based row number in the source file. */
  sourceRow: number;
  confidence: number;
  approvedBy: string | null;
  importedAt: string;
  fields: FieldProvenance[];
}

export type TableImportStatus =
  | 'imported'
  | 'partial'
  | 'failed'
  | 'awaiting_approval'
  | 'blocked'
  | 'skipped';

export interface TableImportResult {
  tableName: string;
  entityId: string;
  moduleId: string;
  status: TableImportStatus;
  imported: number;
  /** Rows deliberately not written (invalid, incomplete, duplicate, user-skipped). */
  skipped: number;
  failed: number;
  duplicates: number;
  needsReview: number;
  createdRecordIds: string[];
  errors: { sourceRow: number; message: string }[];
  /** True when created records were compensated away after a partial failure. */
  rolledBack: boolean;
  note: string | null;
}

export type ImportStatus = 'imported' | 'partial' | 'failed' | 'nothing_imported';

export interface ImportResult {
  planId: string;
  sourceFile: string;
  importedAt: string;
  actor: string | null;
  status: ImportStatus;
  tables: TableImportResult[];
  totals: { imported: number; skipped: number; failed: number; duplicates: number; needsReview: number };
}

export interface ImportDecision {
  tableName: string;
  /** Explicit human approval. Required for any table with `requiresApproval`. */
  approved: boolean;
  /** Row indexes (as in `PlannedTable.rows[].rowIndex`) the reviewer chose to skip. */
  skipRows?: readonly number[];
}

export interface ImportDeps {
  /** Resolve the destination store for a module id. Returns null when unavailable. */
  storeFor: (moduleId: string) => EnterpriseRecordStore | null;
  actor: () => string | null;
  now: () => string;
  /** Enterprise audit sink — the same one the module framework uses. */
  audit: (entry: { action: string; target: string; summary: string }) => void;
  idFactory?: () => string;
}

/**
 * Apply an approved plan. Returns a truthful, per-table account of what happened.
 */
export async function applyImportPlan(
  plan: ImportPlan,
  decisions: readonly ImportDecision[],
  deps: ImportDeps,
): Promise<{ result: ImportResult; provenance: ProvenanceRecord[] }> {
  const at = deps.now();
  const actor = deps.actor();
  const byTable = new Map(decisions.map((d) => [d.tableName, d]));
  const results: TableImportResult[] = [];
  const provenance: ProvenanceRecord[] = [];

  for (const table of plan.tables) {
    const decision = byTable.get(table.tableName);
    const base = {
      tableName: table.tableName,
      entityId: table.entityId,
      moduleId: table.moduleId,
      imported: 0,
      skipped: 0,
      failed: 0,
      duplicates: table.report.duplicates,
      needsReview: table.report.invalid + table.report.incomplete,
      createdRecordIds: [] as string[],
      errors: [] as { sourceRow: number; message: string }[],
      rolledBack: false,
    };

    if (table.blockedReason !== null) {
      results.push({ ...base, status: 'blocked', skipped: table.report.totalRows, note: table.blockedReason });
      continue;
    }
    // An explicit decline is a RESOLVED decision — report it as declined, not as
    // still awaiting approval, which would misrepresent a reviewed table as pending.
    if (decision !== undefined && decision.approved === false) {
      results.push({ ...base, status: 'skipped', skipped: table.report.totalRows, note: 'Declined by reviewer.' });
      continue;
    }
    if (table.requiresApproval && decision?.approved !== true) {
      results.push({
        ...base,
        status: 'awaiting_approval',
        skipped: table.report.totalRows,
        note: `${table.entityLabel} is ${table.risk}-risk and requires explicit approval before import.`,
      });
      continue;
    }

    const store = deps.storeFor(table.moduleId);
    if (store === null) {
      results.push({
        ...base,
        status: 'failed',
        skipped: table.report.totalRows,
        note: `Destination module "${table.moduleId}" is not available.`,
      });
      continue;
    }

    results.push(await importTable(table, decision, store, deps, plan, at, actor, provenance, base));
  }

  const totals = results.reduce(
    (acc, r) => ({
      imported: acc.imported + r.imported,
      skipped: acc.skipped + r.skipped,
      failed: acc.failed + r.failed,
      duplicates: acc.duplicates + r.duplicates,
      needsReview: acc.needsReview + r.needsReview,
    }),
    { imported: 0, skipped: 0, failed: 0, duplicates: 0, needsReview: 0 },
  );

  let status: ImportStatus = 'nothing_imported';
  if (totals.imported > 0 && totals.failed === 0) status = 'imported';
  else if (totals.imported > 0 && totals.failed > 0) status = 'partial';
  else if (totals.failed > 0) status = 'failed';

  deps.audit({
    action: 'dataplane.import',
    target: plan.planId,
    summary: `Imported ${totals.imported} record(s) from "${plan.sourceFile}" (${status}); ${totals.failed} failed, ${totals.skipped} skipped.`,
  });

  return {
    result: { planId: plan.planId, sourceFile: plan.sourceFile, importedAt: at, actor, status, tables: results, totals },
    provenance,
  };
}

async function importTable(
  table: PlannedTable,
  decision: ImportDecision | undefined,
  store: EnterpriseRecordStore,
  deps: ImportDeps,
  plan: ImportPlan,
  at: string,
  actor: string | null,
  provenance: ProvenanceRecord[],
  base: Omit<TableImportResult, 'status' | 'note'>,
): Promise<TableImportResult> {
  await store.load();

  const entity = entityById(table.entityId);
  const skip = new Set(decision?.skipRows ?? []);
  const created: string[] = [];
  const errors: { sourceRow: number; message: string }[] = [];
  const localProvenance: ProvenanceRecord[] = [];
  let skipped = 0;

  for (const row of table.rows) {
    if (row.verdict !== 'valid' || skip.has(row.rowIndex)) {
      skipped += 1;
      continue;
    }
    try {
      const record = store.create({
        title: row.title,
        fields: row.fields,
        tags: ['imported'],
        metadata: {
          importPlanId: plan.planId,
          importSourceFile: plan.sourceFile,
          importSourceTable: table.tableName,
          importSourceRow: row.sourceRow,
          importConfidence: table.confidence,
          importedAt: at,
          importedBy: actor,
        },
        actor,
        now: at,
      });
      created.push(record.id);
      localProvenance.push({
        recordId: record.id,
        moduleId: table.moduleId,
        planId: plan.planId,
        sourceFile: plan.sourceFile,
        sourceTable: table.tableName,
        sourceRow: row.sourceRow,
        confidence: table.confidence,
        approvedBy: table.requiresApproval ? actor : null,
        importedAt: at,
        fields: fieldProvenance(table, row),
      });
    } catch (err) {
      errors.push({ sourceRow: row.sourceRow, message: (err as Error).message });
    }
  }

  // High-risk domains are all-or-nothing: compensate rather than leave a
  // half-imported financial or payroll data set behind.
  const mustBeAtomic = entity !== null && entity.risk === 'high';
  if (errors.length > 0 && mustBeAtomic && created.length > 0) {
    for (const id of created) store.softDelete(id, { actor, now: at });
    await store.flush();
    deps.audit({
      action: 'dataplane.import.rollback',
      target: `${plan.planId}:${table.tableName}`,
      summary: `Rolled back ${created.length} record(s) for "${table.tableName}" after ${errors.length} failure(s).`,
    });
    return {
      ...base,
      status: 'failed',
      imported: 0,
      skipped: skipped + created.length,
      failed: errors.length,
      createdRecordIds: [],
      errors,
      rolledBack: true,
      note: `${table.entityLabel} is high-risk; ${errors.length} row(s) failed so the whole table was rolled back (compensating delete).`,
    };
  }

  await store.flush();
  provenance.push(...localProvenance);

  const status: TableImportStatus =
    created.length === 0 ? (errors.length > 0 ? 'failed' : 'skipped') : errors.length > 0 ? 'partial' : 'imported';

  return {
    ...base,
    status,
    imported: created.length,
    skipped,
    failed: errors.length,
    createdRecordIds: created,
    errors,
    rolledBack: false,
    note:
      status === 'partial'
        ? `${created.length} imported, ${errors.length} failed — this table was NOT rolled back because ${table.entityLabel} is ${table.risk}-risk.`
        : null,
  };
}

function fieldProvenance(table: PlannedTable, row: PreparedRow): FieldProvenance[] {
  const out: FieldProvenance[] = [];
  for (const m of table.mappings) {
    if (m.fieldKey === null) continue;
    const value = row.fields[m.fieldKey];
    if (value === undefined) continue;
    const transformation = row.transformations.find((t) => t.startsWith(`${m.fieldLabel}:`)) ?? null;
    out.push({
      field: m.fieldKey,
      column: m.header,
      original: String(value),
      transformation: transformation === null ? null : transformation.slice(String(m.fieldLabel).length + 2),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Provenance store
// ---------------------------------------------------------------------------

interface ProvenanceFile {
  schemaVersion?: number;
  records: ProvenanceRecord[];
  runs: ImportResult[];
}

/** Retention caps — provenance is valuable but must not grow without bound. */
export const MAX_PROVENANCE_RECORDS = 100_000;
export const MAX_IMPORT_RUNS = 500;

/**
 * Durable import history + per-record provenance.
 * Electron-free: the constructor takes a file path, matching every other store
 * in this codebase. Atomic write via tmp + rename.
 */
export class ProvenanceStore {
  private records: ProvenanceRecord[] = [];
  private runs: ImportResult[] = [];
  private loaded = false;
  private byRecord = new Map<string, ProvenanceRecord>();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const res = await readStoreFile<ProvenanceFile>(this.filePath);
    if (res.state === 'loaded' && res.data) {
      this.records = Array.isArray(res.data.records) ? res.data.records : [];
      this.runs = Array.isArray(res.data.runs) ? res.data.runs : [];
      for (const r of this.records) this.byRecord.set(r.recordId, r);
    }
    this.loaded = true;
  }

  async append(run: ImportResult, provenance: readonly ProvenanceRecord[]): Promise<void> {
    await this.load();
    this.runs.unshift(run);
    if (this.runs.length > MAX_IMPORT_RUNS) this.runs.length = MAX_IMPORT_RUNS;
    for (const p of provenance) {
      this.records.push(p);
      this.byRecord.set(p.recordId, p);
    }
    if (this.records.length > MAX_PROVENANCE_RECORDS) {
      const drop = this.records.splice(0, this.records.length - MAX_PROVENANCE_RECORDS);
      for (const d of drop) this.byRecord.delete(d.recordId);
    }
    await this.persist();
  }

  /** Import history, newest first. */
  history(limit = 50): ImportResult[] {
    return this.runs.slice(0, limit);
  }

  run(planId: string): ImportResult | null {
    return this.runs.find((r) => r.planId === planId) ?? null;
  }

  /** Where did this record come from? */
  forRecord(recordId: string): ProvenanceRecord | null {
    return this.byRecord.get(recordId) ?? null;
  }

  /** Every record produced by one import run. */
  forPlan(planId: string): ProvenanceRecord[] {
    return this.records.filter((r) => r.planId === planId);
  }

  counts(): { runs: number; records: number } {
    return { runs: this.runs.length, records: this.records.length };
  }

  private async persist(): Promise<void> {
    const payload: ProvenanceFile = { ...envelopeStamp(), records: this.records, runs: this.runs };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}

export function newPlanId(): string {
  return `imp_${randomUUID()}`;
}
