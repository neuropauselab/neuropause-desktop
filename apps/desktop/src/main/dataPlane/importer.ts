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
import type { TenantScope } from '@neuropause/shared';
import { ownershipOf, recordInScope, tenantOnlyKey } from '@neuropause/shared';
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

/**
 * Where a record came from, when it came from a connected system.
 *
 * Program 9. The same store carries file provenance and connector provenance
 * because they answer the same question — "where did this record come from?"
 * — and a second provenance store would be a second answer that can disagree
 * with the first.
 *
 * `externalKey` is the idempotency boundary: connector + account + resource +
 * the provider's own id. Re-syncing the same provider object finds the record
 * it already produced instead of creating a second one.
 */
export interface ConnectorOrigin {
  connectorId: string;
  accountId: string;
  resourceId: string;
  /** The provider's own id for this object. */
  externalId: string;
  /** `connectorId::accountId::resourceId::externalId`. Unique per record. */
  externalKey: string;
  /** The provider's own last-modified stamp, when it supplies one. */
  externalUpdatedAt: string | null;
  syncRunId: string;
  /** Which version of the declared field mapping produced these values. */
  mappingVersion: number;
  /**
   * `created` — this record exists because the connector created it, so a
   * later sync may update every mapped field.
   * `adopted` — the connector matched a record that was ALREADY here. A later
   * sync fills empty fields only; it never overwrites a value a person typed.
   */
  linkage: 'created' | 'adopted';
}

export interface ProvenanceRecord {
  recordId: string;
  moduleId: string;
  planId: string;
  /**
   * The tenant this provenance belongs to (P13A).
   *
   * MUST BE THE SAME TENANT AS THE RECORD IT DESCRIBES. Provenance is a
   * statement ABOUT a record — where it came from, who approved it, what each
   * field originally said — so it is exactly as sensitive as the record and
   * belongs to the same owner. A provenance row that could name a resource in
   * another tenant would be a bridge between tenants: not a copy of the data,
   * but a description of it, which for an import trail is most of the value.
   *
   * Absent or empty means UNRESOLVED — visible to no tenant. Rows written
   * before P13A have no tenant and are inert, the same treatment
   * `ownershipOf` gives every other pre-migration record.
   */
  tenantId?: string | null;
  /** Absent means tenant-level: readable from every workspace in the tenant. */
  workspaceId?: string | null;
  sourceFile: string;
  sourceTable: string;
  /** One-based row number in the source file. */
  sourceRow: number;
  confidence: number;
  approvedBy: string | null;
  importedAt: string;
  fields: FieldProvenance[];
  /**
   * Present when the record arrived over a connector rather than from a file.
   * Absent for every file import, so the two are never confused.
   */
  connector?: ConnectorOrigin;
}

export type TableImportStatus =
  | 'imported'
  | 'partial'
  | 'failed'
  | 'awaiting_approval'
  | 'blocked'
  | 'skipped';

/**
 * What was checked AFTER the write, by reading the destination back.
 *
 * Separate from the counters because they measure different things: `imported`
 * is what the import loop believes it did, `confirmed` is what the store will
 * actually hand back. An import that reports the first as though it were the
 * second is self-certifying, and self-certification is what this whole
 * pipeline is built to refuse.
 */
export interface TableVerification {
  /** False when nothing re-read the store — say so rather than imply a check. */
  checked: boolean;
  sourceRows: number;
  created: number;
  /** Existing records the reviewer chose to update, row by row. */
  updated: number;
  /** Of the records touched (created + updated), how many read straight back. */
  confirmed: number;
  /** Rows this file had already imported on an earlier run. */
  alreadyImported: number;
  /** Every source row accounted for, and every created record readable. */
  reconciled: boolean;
  detail: string;
}

export interface TableImportResult {
  tableName: string;
  entityId: string;
  moduleId: string;
  status: TableImportStatus;
  imported: number;
  /** Existing records updated by an explicit per-row decision. */
  updated: number;
  /** Rows deliberately not written (invalid, incomplete, duplicate, user-skipped). */
  skipped: number;
  failed: number;
  duplicates: number;
  needsReview: number;
  createdRecordIds: string[];
  /** Records changed in place. Separate from created so both can be broadcast. */
  updatedRecordIds: string[];
  errors: { sourceRow: number; message: string }[];
  /** True when created records were compensated away after a partial failure. */
  rolledBack: boolean;
  /** Absent on paths that never wrote (blocked, declined, awaiting approval). */
  verification?: TableVerification;
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
  totals: { imported: number; updated: number; skipped: number; failed: number; duplicates: number; needsReview: number };
  /**
   * The tenant whose import this was (P13A). Stamped by `ProvenanceStore.append`
   * from the active scope, never by the importer that built the result.
   *
   * An import run names the source filename, the actor who approved it, the
   * modules touched and the row counts — a description of another tenant's
   * business detailed enough to be worth withholding on its own, before any
   * record is read. Absent means unresolved: visible to nobody.
   */
  tenantId?: string | null;
  workspaceId?: string | null;
}

export interface ImportDecision {
  tableName: string;
  /** Explicit human approval. Required for any table with `requiresApproval`. */
  approved: boolean;
  /** Row indexes (as in `PlannedTable.rows[].rowIndex`) the reviewer chose to skip. */
  skipRows?: readonly number[];
  /**
   * Per-row decisions from the preview.
   *
   * `update` is the ONLY way an import may touch a record that already exists,
   * and it is deliberately per-row: the reviewer saw which fields differ
   * before choosing it. There is no bulk "update everything", because a bulk
   * overwrite of master data is indistinguishable from a mistake afterwards.
   */
  rowActions?: readonly {
    rowIndex: number;
    action: 'create' | 'update' | 'skip';
    /** The record the reviewer saw. An update refuses if the match has moved. */
    expectRecordId?: string;
  }[];
}

export interface ImportDeps {
  /** Resolve the destination store for a module id. Returns null when unavailable. */
  storeFor: (moduleId: string) => EnterpriseRecordStore | null;
  actor: () => string | null;
  now: () => string;
  /** Enterprise audit sink — the same one the module framework uses. */
  audit: (entry: { action: string; target: string; summary: string }) => void;
  idFactory?: () => string;
  /**
   * Authorize a WRITE into a destination module. Throws when refused.
   *
   * Export already double-gates: `dp:export` demands the module's own read
   * scope on top of `data:read`, because bulk extraction must not bypass the
   * per-module gate. Bulk INSERTION had no equivalent — `data:import` alone let
   * a principal create records in finance, hr-employees or crm-customers
   * without holding any of those modules' manage scopes. This is that gate.
   *
   * Optional so every existing test constructs `ImportDeps` unchanged; absent,
   * behaviour is exactly as before.
   */
  authorizeWrite?: (moduleId: string) => void;
  /**
   * Re-read a record straight from the destination store. Verification only
   * means something if it reads what was written rather than trusting the
   * counters that wrote it.
   */
  readBack?: (moduleId: string, recordId: string) => boolean;
}

/**
 * The deterministic identity of one imported row.
 *
 * Re-importing the same file used to duplicate every record: `store.create`
 * always mints a fresh uuid, and nothing consulted what had already been
 * imported. The key is the source coordinates, so the SAME row of the SAME
 * table of the SAME file is recognised on a second pass regardless of the plan
 * id — which matters, because re-analysing a file produces a new plan id and
 * would otherwise look like different data.
 */
export function importKeyFor(sourceFile: string, tableName: string, sourceRow: number): string {
  return `${sourceFile}::${tableName}::${sourceRow}`;
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
      updated: 0,
      skipped: 0,
      failed: 0,
      duplicates: table.report.duplicates,
      needsReview: table.report.invalid + table.report.incomplete,
      createdRecordIds: [] as string[],
      updatedRecordIds: [] as string[],
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

    /* The destination module's own write scope. --------------------------
     *
     * Per table rather than per plan: a mixed file where the importer may
     * write customers but not invoices should load the customers and refuse
     * the invoices with a reason, not fail wholesale. Refused is BLOCKED — a
     * closed state that imports nothing.
     */
    try {
      deps.authorizeWrite?.(table.moduleId);
    } catch (err) {
      results.push({
        ...base,
        status: 'blocked',
        skipped: table.report.totalRows,
        note: `You do not have permission to create records in ${table.entityLabel}. ${(err as Error).message}`,
      });
      continue;
    }

    results.push(await importTable(table, decision, store, deps, plan, at, actor, provenance, base));
  }

  const totals = results.reduce(
    (acc, r) => ({
      imported: acc.imported + r.imported,
      updated: acc.updated + r.updated,
      skipped: acc.skipped + r.skipped,
      failed: acc.failed + r.failed,
      duplicates: acc.duplicates + r.duplicates,
      needsReview: acc.needsReview + r.needsReview,
    }),
    { imported: 0, updated: 0, skipped: 0, failed: 0, duplicates: 0, needsReview: 0 },
  );

  // A table that wrote records it could not read back is not a clean import,
  // and the RUN must say so too. Without this the per-table status read
  // `partial` while the headline still read `imported` — and the headline is
  // what anyone scanning a history list believes.
  const unreconciled = results.some((r) => r.verification?.reconciled === false);

  // An UPDATE is a write. A run that overwrote 500 customer master records
  // reported `nothing_imported`, and the audit line said nothing happened —
  // the one durable trace of a bulk master-data change denying it occurred.
  const touchedTotal = totals.imported + totals.updated;
  let status: ImportStatus = 'nothing_imported';
  if (touchedTotal > 0 && totals.failed === 0 && !unreconciled) status = 'imported';
  else if (touchedTotal > 0 && (totals.failed > 0 || unreconciled)) status = 'partial';
  else if (totals.failed > 0) status = 'failed';

  deps.audit({
    action: 'dataplane.import',
    target: plan.planId,
    summary: `Imported ${totals.imported} and updated ${totals.updated} record(s) from "${plan.sourceFile}" (${status}); ${totals.failed} failed, ${totals.skipped} skipped.`,
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
  const rowActions = new Map((decision?.rowActions ?? []).map((r) => [r.rowIndex, r]));
  const created: string[] = [];
  /** Records the reviewer chose to update. Counted apart from creations. */
  const updatedIds: string[] = [];
  const errors: { sourceRow: number; message: string }[] = [];
  const localProvenance: ProvenanceRecord[] = [];
  let skipped = 0;
  let alreadyImported = 0;

  /**
   * Everything this file has already put here, read ONCE.
   *
   * One scan per table rather than a lookup per row: the alternative is N+1
   * over the whole store, which on a 10,000-row import is 10,000 full scans.
   */
  const seen = new Set<string>();
  for (const existing of store.list({ limit: 200_000 })) {
    const key = existing.metadata?.importKey;
    if (typeof key === 'string') seen.add(key);
  }

  for (const row of table.rows) {
    if (row.verdict !== 'valid' || skip.has(row.rowIndex)) {
      skipped += 1;
      continue;
    }

    /* Has THIS FILE already imported THIS ROW? ---------------------------
     *
     * Checked before the row's action, and the order matters for what the
     * user is told. Both paths refuse to duplicate, but they mean different
     * things: "this file already loaded this row" is a statement about the
     * import, while "a matching record exists" is a statement about the
     * business. Letting the identity match answer first would report a
     * re-import as though someone else had entered the data.
     */
    /* The reviewer's decision for this row, or the plan's default. ------
     *
     * `review` never imports on its own: it is the state a normalized-only
     * identity match lands in, and acting on "probably the same record"
     * without a person is precisely the silent merge this pipeline forbids.
     */
    /* Precedence, and it has to be explicit. -----------------------------
     *
     * Two guards can stop a row, and they say different things:
     *
     *   - the importKey guard: "this FILE already loaded this row";
     *   - the row's action: "a matching RECORD already exists".
     *
     * A REVIEWER'S INSTRUCTION outranks both. Correcting a phone number and
     * re-importing the same file is the canonical use of `update`, and
     * whichever guard runs first swallows it — reporting "already imported,
     * not duplicated", which is a truthful-sounding sentence for a human
     * instruction that was silently discarded.
     *
     * Absent an instruction, the file-level fact is the more precise one:
     * "you already imported this" beats "something like it exists".
     */
    const instruction = rowActions.get(row.rowIndex);
    const importKey = importKeyFor(plan.sourceFile, table.tableName, row.sourceRow);

    if (instruction === undefined && seen.has(importKey)) {
      alreadyImported += 1;
      continue;
    }

    const chosen = instruction?.action ?? row.action ?? 'create';
    if (chosen === 'skip' || chosen === 'review') {
      skipped += 1;
      continue;
    }
    if (chosen === 'create' && seen.has(importKey)) {
      alreadyImported += 1;
      continue;
    }

    if (chosen === 'update') {
      const target = row.existingMatch?.recordId;
      if (target === undefined) {
        errors.push({ sourceRow: row.sourceRow, message: 'Update was chosen but no matching record was found.' });
        continue;
      }
      // The match is re-resolved at import time, so it can have moved since
      // the reviewer looked. Refusing is the only safe answer: they approved
      // "update THIS record", not "update whatever now matches".
      if (instruction?.expectRecordId !== undefined && instruction.expectRecordId !== target) {
        errors.push({
          sourceRow: row.sourceRow,
          message: 'The matching record changed since you reviewed this row — re-check it before updating.',
        });
        continue;
      }
      try {
        const existing = store.get(target);
        const updated = store.update(target, {
          // The TITLE too. `store.update` merges fields, so without this a
          // renamed customer keeps its old title forever while `fields.name`
          // holds the new one — and every list, search and export then shows
          // a name that contradicts the record.
          title: row.title,
          fields: row.fields,
          metadata: {
            ...(existing?.metadata ?? {}),
            importKey,
            importPlanId: plan.planId,
            importSourceFile: plan.sourceFile,
            importSourceTable: table.tableName,
            importSourceRow: row.sourceRow,
            importedAt: at,
            importedBy: actor,
          },
          actor,
          now: at,
        });
        if (updated === null) {
          errors.push({ sourceRow: row.sourceRow, message: `Record ${target} no longer exists.` });
          continue;
        }
        updatedIds.push(target);
        localProvenance.push({
          recordId: target,
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
      continue;
    }

    try {
      const record = store.create({
        title: row.title,
        fields: row.fields,
        tags: ['imported'],
        metadata: {
          importKey,
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
      seen.add(importKey);
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
      updated: updatedIds.length,
      skipped: skipped + created.length,
      failed: errors.length,
      createdRecordIds: [],
      // Updates were applied IN PLACE and are not undone — no pre-image is
      // captured, so they cannot be. Reported rather than zeroed, because a
      // note claiming the whole table rolled back while payroll values stayed
      // changed is the worst kind of false success.
      updatedRecordIds: updatedIds,
      errors,
      rolledBack: true,
      note:
        `${table.entityLabel} is high-risk; ${errors.length} row(s) failed so every record CREATED here was rolled back (compensating delete).` +
        (updatedIds.length > 0
          ? ` ${updatedIds.length} record(s) were UPDATED in place and could not be rolled back — no previous values were captured. Check them.`
          : ''),
    };
  }

  await store.flush();
  provenance.push(...localProvenance);

  /* ── Verify: read back what we claim to have written. ─────────────────
   *
   * Every number above came from the loop that did the writing. That is a
   * report on the loop's own intentions, not on the store — and an import
   * whose success is self-certified is exactly the "claim success when
   * verification fails" this pipeline must not do. So the created ids are
   * re-read from the destination and the counts reconciled against the source.
   */
  // Updates are read back too: an update that did not land is the same lie as
  // a create that did not land.
  const touched = [...created, ...updatedIds];
  const confirmed = deps.readBack
    ? touched.filter((id) => deps.readBack?.(table.moduleId, id) === true).length
    : touched.length;
  const accountedFor = created.length + updatedIds.length + skipped + alreadyImported + errors.length;
  const verification: TableVerification = {
    checked: deps.readBack !== undefined,
    sourceRows: table.report.totalRows,
    created: created.length,
    updated: updatedIds.length,
    confirmed,
    alreadyImported,
    reconciled: confirmed === touched.length && accountedFor === table.report.totalRows,
    detail:
      deps.readBack === undefined
        ? 'Verification was not run — nothing re-read the destination, so these counts are the importer reporting on itself.'
        : confirmed !== touched.length
          ? `${touched.length - confirmed} of ${touched.length} record(s) could not be read back after writing. They may not have persisted.`
          : accountedFor !== table.report.totalRows
            ? `${table.report.totalRows} source row(s) but ${accountedFor} accounted for — ${Math.abs(table.report.totalRows - accountedFor)} unexplained.`
            : `All ${table.report.totalRows} source row(s) accounted for, and every created record was read back.`,
  };

  const status: TableImportStatus =
    touched.length === 0
      ? errors.length > 0
        ? 'failed'
        : 'skipped'
      : errors.length > 0 || !verification.reconciled
        ? 'partial'
        : 'imported';

  return {
    ...base,
    status,
    imported: created.length,
    updated: updatedIds.length,
    skipped: skipped + alreadyImported,
    failed: errors.length,
    createdRecordIds: created,
    updatedRecordIds: updatedIds,
    errors,
    rolledBack: false,
    verification,
    note:
      errors.length > 0 && status === 'partial'
        ? `${created.length} imported, ${errors.length} failed — this table was NOT rolled back because ${table.entityLabel} is ${table.risk}-risk.`
        : !verification.reconciled
          ? verification.detail
          : alreadyImported > 0
            ? `${alreadyImported} row(s) were already imported from this file and were not duplicated.`
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
 * The tenant boundary for provenance (P13A).
 *
 * A FUNCTION, and `null` means DENY — identical in shape and contract to
 * `AppendOnlyScopeSource`, because a third spelling of the same idea is how two
 * of them end up disagreeing.
 */
export type ProvenanceScopeSource = () => TenantScope | null;

/**
 * A process-wide fallback scope, for TESTS ONLY. Same seam, same guard and same
 * justification as `setAmbientAppendOnlyScopeForTests`.
 */
let ambientProvenanceScope: ProvenanceScopeSource | null = null;

export function setAmbientProvenanceScopeForTests(source: ProvenanceScopeSource | null): void {
  if (process.env.VITEST === undefined && process.env.NODE_ENV !== 'test') {
    throw new Error(
      'setAmbientProvenanceScopeForTests is a test-only seam and must not be called at runtime.',
    );
  }
  ambientProvenanceScope = source;
}

/**
 * Durable import history + per-record provenance.
 * Electron-free: the constructor takes a file path, matching every other store
 * in this codebase. Atomic write via tmp + rename.
 *
 * P13A — TENANT ENFORCEMENT.
 *
 * Every read filters on the bound scope, and UNBOUND DENIES. The two indexes
 * are now keyed by (scope, key) rather than by key alone: `byExternal` was
 * `connectorId::accountId::resourceId::externalId`, so two tenants syncing the
 * same provider account collided on one row and the second silently ADOPTED
 * the first's provenance — the inventory recorded this as the store's
 * `REQUIRES_MIGRATION` reason, and it is a cross-tenant write, not only a read.
 *
 * The runs list is scoped the same way, because an import run names its plan,
 * its files and its row counts.
 */
export class ProvenanceStore {
  private records: ProvenanceRecord[] = [];
  private runs: ImportResult[] = [];
  private loaded = false;
  /**
   * Both indexes are keyed with the OWNING SCOPE, via `tenantKey`.
   *
   * Keying by `recordId`/`externalKey` alone is what made the store a bridge:
   * one map entry per logical key across every tenant, so whoever wrote last
   * owned the row and whoever read first got someone else's answer. `tenantKey`
   * JSON-encodes its parts, so an id containing the separator cannot collapse
   * two keys into one.
   */
  private byRecord = new Map<string, ProvenanceRecord>();
  /** External identity → the record it produced. The sync idempotency index. */
  private byExternal = new Map<string, ProvenanceRecord>();
  private tmpSeq = 0;
  /** Serialises persists so two concurrent syncs cannot interleave writes. */
  private writeChain: Promise<void> = Promise.resolve();
  private scopeSource: ProvenanceScopeSource | null = null;

  constructor(private readonly filePath: string) {}

  /** Bind the tenant boundary. Chainable. UNBOUND DENIES. */
  bindScope(source: ProvenanceScopeSource): this {
    this.scopeSource = source;
    return this;
  }

  /** Whether a boundary has been bound. For the migration inventory. */
  hasScope(): boolean {
    return this.scopeSource !== null;
  }

  /** The active scope, or `null` meaning DENY. */
  private scopeOrDeny(): TenantScope | null {
    const source = this.scopeSource ?? ambientProvenanceScope;
    return source === null ? null : source();
  }

  /**
   * The scope a WRITE needs. Throws rather than denying quietly — an import
   * that recorded provenance nobody owns would produce exactly the unresolved
   * row this migration exists to remove, and silently.
   */
  private requireScope(): TenantScope {
    const scope = this.scopeOrDeny();
    if (scope === null) {
      throw new Error(
        'Cannot record provenance: no organization and workspace are active, so it would have no owner.',
      );
    }
    return scope;
  }

  /**
   * Index keys are TENANT-scoped, not workspace-scoped.
   *
   * An import belongs to the organization that performed it, not to the
   * workspace someone happened to have open — a record imported from the
   * finance workspace must still explain itself when read from operations.
   * Rows are therefore stamped tenant-level (`workspaceId: null`), which
   * `recordInScope` reads as "visible across this tenant's workspaces", and the
   * indexes must agree with that or a lookup would miss what a filter allows.
   */
  private recordKey(tenantId: string, recordId: string): string {
    return tenantOnlyKey(tenantId, 'record', recordId);
  }

  private externalKey(tenantId: string, external: string): string {
    return tenantOnlyKey(tenantId, 'external', external);
  }

  /** Ownership counts across every row. Three integers, no row content. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    let assigned = 0;
    let unresolved = 0;
    for (const r of this.records) {
      if (ownershipOf(r) === 'assigned') assigned += 1;
      else unresolved += 1;
    }
    return { total: this.records.length, assigned, unresolved };
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const res = await readStoreFile<ProvenanceFile>(this.filePath);
    if (res.state === 'loaded' && res.data) {
      this.records = Array.isArray(res.data.records) ? res.data.records : [];
      this.runs = Array.isArray(res.data.runs) ? res.data.runs : [];
      for (const r of this.records) this.index(r);
    }
    this.loaded = true;
  }

  /**
   * Add a row to both indexes under its OWN scope.
   *
   * A row with no tenant is not indexed at all. That is deliberate: an
   * unresolved row must be unreachable by lookup as well as invisible to
   * filters, or `forExternalKey` would keep handing pre-P13A rows to whichever
   * tenant asked first — which is the adoption bug in a different disguise.
   */
  private index(r: ProvenanceRecord): void {
    if (ownershipOf(r) !== 'assigned') return;
    const tenantId = r.tenantId as string;
    this.byRecord.set(this.recordKey(tenantId, r.recordId), r);
    if (r.connector) this.byExternal.set(this.externalKey(tenantId, r.connector.externalKey), r);
  }

  /** Remove a row from both indexes. Mirrors `index` exactly. */
  private deindex(r: ProvenanceRecord): void {
    if (ownershipOf(r) !== 'assigned') return;
    const tenantId = r.tenantId as string;
    this.byRecord.delete(this.recordKey(tenantId, r.recordId));
    if (r.connector) this.byExternal.delete(this.externalKey(tenantId, r.connector.externalKey));
  }

  async append(run: ImportResult, provenance: readonly ProvenanceRecord[]): Promise<void> {
    await this.load();
    /**
     * P13A — stamped from the ACTIVE SCOPE, never from the payload.
     *
     * The caller builds these rows and could set `tenantId` on them; that value
     * is overwritten here rather than validated, because a write path that
     * accepts a caller's tenant is a write path that can be asked to write
     * somewhere else. There is no argument to this method that can choose an
     * owner.
     */
    const scope = this.requireScope();
    this.runs.unshift(this.ownRun(run, scope));
    this.evictRuns(scope);
    for (const p of provenance) {
      const owned = this.own(p, scope);
      this.records.push(owned);
      this.index(owned);
    }
    this.evictOverflow(scope);
    await this.persist();
  }

  /** Stamp a row with the writing tenant. Tenant-level: see `recordKey`. */
  private own(p: ProvenanceRecord, scope: TenantScope): ProvenanceRecord {
    return { ...p, tenantId: scope.tenantId, workspaceId: null };
  }

  /** Stamp an import run with the writing tenant. */
  private ownRun(run: ImportResult, scope: TenantScope): ImportResult {
    return { ...run, tenantId: scope.tenantId, workspaceId: null };
  }

  /**
   * Trim to the cap, WITHIN THE WRITING TENANT'S ROWS ONLY.
   *
   * Splicing the front of the shared array deleted the globally oldest rows —
   * another tenant's import trail, destroyed by a busy neighbour. Same
   * correction, and the same reasoning, as the eviction fix in
   * `AppendOnlyJsonStore.append`.
   *
   * The cap is applied PER TENANT rather than to the file. That is a real
   * change in meaning and the right one: a shared cap lets any tenant evict any
   * other simply by importing, which is destruction of an audit trail by a
   * party with no authority over it. Beyond losing history, eviction also drops
   * the row from `byExternal`, so the victim's next connector sync no longer
   * recognises the provider objects it already imported and creates duplicates.
   *
   * (The first version of this method carried this comment and did none of it —
   * it sliced the shared array. Caught by adversarial review. A comment that
   * asserts a boundary the code does not draw is worse than no comment, because
   * the next reader stops looking.)
   */
  private evictOverflow(scope: TenantScope): void {
    const mine = this.records.filter((r) => recordInScope(r, scope));
    const overflow = mine.length - MAX_PROVENANCE_RECORDS;
    if (overflow <= 0) return;
    const doomed = new Set(mine.slice(0, overflow));
    this.records = this.records.filter((r) => !doomed.has(r));
    for (const d of doomed) this.deindex(d);
  }

  /**
   * Trim the run history, again within the writing tenant only.
   *
   * `this.runs.length = MAX_IMPORT_RUNS` truncated the shared array, so a
   * tenant performing 500 imports silently erased every other tenant's import
   * history — `history()` and `run()` would return nothing for them.
   */
  private evictRuns(scope: TenantScope): void {
    const mine = this.runs.filter((r) => recordInScope(r, scope));
    const overflow = mine.length - MAX_IMPORT_RUNS;
    if (overflow <= 0) return;
    // `runs` is newest-first, so the oldest of MINE are at the end of my slice.
    const doomed = new Set(mine.slice(mine.length - overflow));
    this.runs = this.runs.filter((r) => !doomed.has(r));
  }

  /**
   * Record provenance for records a connector produced.
   *
   * Deliberately NOT `append`: that one takes an `ImportResult`, which is
   * file-shaped (a plan, tables, rows). A sync run is not an import run, and
   * forcing one into the other's shape would make the history lie about what
   * happened. The RECORDS share a store; the runs do not.
   */
  async appendConnector(provenance: readonly ProvenanceRecord[]): Promise<void> {
    if (provenance.length === 0) return;
    await this.load();
    const scope = this.requireScope();
    for (const raw of provenance) {
      const p = this.own(raw, scope);
      const key = p.connector?.externalKey;
      /**
       * By external key first, then by record.
       *
       * The record fallback is what makes adoption non-destructive: a record
       * that already has FILE provenance is found here, and gains the
       * connector origin alongside it — instead of a second row for the same
       * record whose `sourceFile` then wins every read.
       */
      const existing =
        (key !== undefined
          ? this.byExternal.get(this.externalKey(scope.tenantId, key))
          : undefined) ?? this.byRecord.get(this.recordKey(scope.tenantId, p.recordId));
      if (existing) {
        /**
         * Re-syncing an already-tracked provider object UPDATES its connector
         * origin and NOTHING ELSE.
         *
         * `Object.assign(existing, p)` was worse than it looks: a record
         * imported from a CSV and later adopted by a connector had its
         * `sourceFile`, `sourceRow`, `approvedBy`, `confidence` and per-field
         * original values overwritten by a background sync — so "row 412 of
         * Q3-customers.csv, approved by Priya, original value X" silently
         * became "HubSpot Contacts", and the field-level originals were gone.
         */
        existing.connector = p.connector;
        existing.importedAt = p.importedAt;
        if (key !== undefined) {
          this.byExternal.set(this.externalKey(scope.tenantId, key), existing);
        }
        continue;
      }
      this.records.push(p);
      /**
       * Indexed by EXTERNAL key as well as record id, not skipped when the
       * record already had provenance. Skipping it meant a connector-adopted
       * CSV record was never findable by its provider id — so the next sync
       * fell back to identity matching, and the moment the provider edited the
       * identity field it created a duplicate. `index` does both halves under
       * the row's own tenant.
       */
      this.index(p);
    }
    this.evictOverflow(scope);
    await this.persist();
  }

  /**
   * The rows this caller may see. `[]` when no scope resolves.
   *
   * EVERY read below goes through this or through a tenant-keyed index lookup.
   * There is no accessor on this class that reads `this.records` directly.
   */
  private visible(): ProvenanceRecord[] {
    const scope = this.scopeOrDeny();
    if (scope === null) return [];
    return this.records.filter((r) => recordInScope(r, scope));
  }

  /**
   * The record a given provider object already produced, if any.
   *
   * THIS LOOKUP WAS THE CROSS-TENANT WRITE. Two tenants syncing the same
   * provider account produce the same `externalKey`; with one global index the
   * second tenant's sync found the first tenant's row, took the `existing`
   * branch above, and adopted it — so tenant B's sync silently rewrote tenant
   * A's provenance and tenant B's records inherited A's import trail. Scoping
   * the key means each tenant has its own row for the same provider object,
   * which is the correct model: they are different records that happen to
   * describe the same external thing.
   */
  forExternalKey(externalKey: string): ProvenanceRecord | null {
    const scope = this.scopeOrDeny();
    if (scope === null) return null;
    return this.byExternal.get(this.externalKey(scope.tenantId, externalKey)) ?? null;
  }

  /** Every record a connection produced. Used to explain, and to disconnect. */
  forConnection(connectorId: string, accountId: string): ProvenanceRecord[] {
    return this.visible().filter(
      (r) => r.connector?.connectorId === connectorId && r.connector.accountId === accountId,
    );
  }

  /** Import history, newest first. */
  history(limit = 50): ImportResult[] {
    return this.visibleRuns().slice(0, limit);
  }

  run(planId: string): ImportResult | null {
    return this.visibleRuns().find((r) => r.planId === planId) ?? null;
  }

  /** The import runs this caller may see. */
  private visibleRuns(): ImportResult[] {
    const scope = this.scopeOrDeny();
    if (scope === null) return [];
    return this.runs.filter((r) => recordInScope(r, scope));
  }

  /**
   * Where did this record come from?
   *
   * A `recordId` is a REFERENCE, NOT AN AUTHORIZATION — the same rule the
   * memory store's `get` follows. Resolved through the tenant-keyed index, so
   * holding another tenant's record id yields null rather than its import
   * trail, source filename and approver.
   */
  forRecord(recordId: string): ProvenanceRecord | null {
    const scope = this.scopeOrDeny();
    if (scope === null) return null;
    return this.byRecord.get(this.recordKey(scope.tenantId, recordId)) ?? null;
  }

  /** Every record produced by one import run. */
  forPlan(planId: string): ProvenanceRecord[] {
    return this.visible().filter((r) => r.planId === planId);
  }

  /**
   * Counts for this caller only.
   *
   * A global count tells one tenant how much another has imported. Phase 22 of
   * the program names counts as a leakage channel explicitly, and it is the
   * easiest one to leave open because a number does not look like data.
   */
  counts(): { runs: number; records: number } {
    return { runs: this.visibleRuns().length, records: this.visible().length };
  }

  /**
   * How many records in one module came from an import.
   *
   * Used by export to state plainly how much of a module is imported data
   * rather than implying that everything in it has a traceable source.
   */
  countForModule(moduleId: string): number {
    return this.visible().filter((r) => r.moduleId === moduleId).length;
  }

  private persist(): Promise<void> {
    // Serialised: two concurrent syncs writing the same file interleaved a
    // stale snapshot over a fresh one even with unique temp names.
    this.writeChain = this.writeChain.then(() => this.writeNow()).catch(() => undefined);
    return this.writeChain;
  }

  private async writeNow(): Promise<void> {
    const payload: ProvenanceFile = { ...envelopeStamp(), records: this.records, runs: this.runs };
    /**
     * A UNIQUE temp name, and the same reasoning `SyncStateStore` documents.
     *
     * Up to four accounts sync concurrently, and two of them writing
     * provenance through one fixed `.tmp` path meant the second `rename`
     * failed `ENOENT` — throwing out of the bridge and leaving the file at the
     * earlier snapshot.
     */
    const tmp = `${this.filePath}.${process.pid}.${(this.tmpSeq += 1)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}

export function newPlanId(): string {
  return `imp_${randomUUID()}`;
}
