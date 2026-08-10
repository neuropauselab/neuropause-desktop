/**
 * Data Command Center — view model.
 *
 * All logic lives here, as pure functions over the real Data Plane payloads.
 * The renderer test environment is Node-only (no DOM), so this is what actually
 * gets tested; `DataCommandCenterView.tsx` stays a thin projection of it.
 *
 * Honesty rules encoded here rather than left to the view:
 *   - No metric is invented. Every number traces to a real import run.
 *   - "No data yet" is a distinct state from "zero" — a fresh install shows an
 *     invitation, not a dashboard of zeroes.
 *   - A run where anything failed can never render as success.
 *   - Progress is a STAGE, never a fabricated percentage.
 */
import { DP_MAX_CONTENT_BASE64 } from '@neuropause/shared';
import type {
  DataPlaneColumnMapping,
  DataPlaneOntologyEntity,
  DataPlanePreview,
  DataPlanePreviewRow,
  DataPlaneRowAction,
  DataPlaneExportableModule,
  DataPlaneExportResult,
  DataPlaneInspection,
  DataPlanePlanSummary,
  DataPlaneProvenance,
  DataPlanePendingStatus,
  DataPlaneRelationshipGraph,
  DataPlaneRelationshipOverview,
  DataPlaneRelationshipPass,
  DataPlaneRelationshipPending,
  DataPlaneRunResult,
  DataPlaneSavedMapping,
} from '@neuropause/shared';

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface OverviewMetric {
  key: string;
  label: string;
  value: number;
  /** Rendered under the value; omitted when there is nothing honest to say. */
  hint?: string;
  tone: 'neutral' | 'good' | 'warn' | 'bad';
}

export interface OverviewModel {
  /** True on a fresh install — the UI shows an invitation, not zeroes. */
  empty: boolean;
  metrics: OverviewMetric[];
  recent: {
    planId: string;
    file: string;
    at: string;
    status: DataPlaneRunResult['status'];
    statusLabel: string;
    tone: 'good' | 'warn' | 'bad' | 'neutral';
    imported: number;
  }[];
  /** Plain-language summary for the top of the page. */
  headline: string;
}

const RUN_STATUS_LABEL: Record<DataPlaneRunResult['status'], string> = {
  imported: 'Imported',
  partial: 'Partly imported',
  failed: 'Failed',
  nothing_imported: 'Nothing imported',
};

const RUN_STATUS_TONE: Record<DataPlaneRunResult['status'], 'good' | 'warn' | 'bad' | 'neutral'> = {
  imported: 'good',
  partial: 'warn',
  failed: 'bad',
  nothing_imported: 'neutral',
};

export function buildOverview(history: readonly DataPlaneRunResult[]): OverviewModel {
  if (history.length === 0) {
    return {
      empty: true,
      metrics: [],
      recent: [],
      headline: 'No enterprise data imported yet.',
    };
  }

  const imported = history.reduce((n, r) => n + r.totals.imported, 0);
  const failed = history.reduce((n, r) => n + r.totals.failed, 0);
  const needsReview = history.reduce((n, r) => n + r.totals.needsReview, 0);
  const duplicates = history.reduce((n, r) => n + r.totals.duplicates, 0);
  const awaiting = history.reduce(
    (n, r) => n + r.tables.filter((t) => t.status === 'awaiting_approval').length,
    0,
  );

  const metrics: OverviewMetric[] = [
    { key: 'imported', label: 'Records imported', value: imported, tone: 'good' },
    {
      key: 'review',
      label: 'Needs review',
      value: needsReview,
      tone: needsReview > 0 ? 'warn' : 'neutral',
      ...(needsReview > 0 ? { hint: 'Rows that could not be imported as-is' } : {}),
    },
    {
      key: 'duplicates',
      label: 'Duplicate candidates',
      value: duplicates,
      tone: duplicates > 0 ? 'warn' : 'neutral',
      ...(duplicates > 0 ? { hint: 'Reported, never merged automatically' } : {}),
    },
    {
      key: 'failed',
      label: 'Failed rows',
      value: failed,
      tone: failed > 0 ? 'bad' : 'neutral',
    },
    {
      key: 'awaiting',
      label: 'Awaiting approval',
      value: awaiting,
      tone: awaiting > 0 ? 'warn' : 'neutral',
      ...(awaiting > 0 ? { hint: 'High-risk data held until someone approves it' } : {}),
    },
    { key: 'imports', label: 'Imports run', value: history.length, tone: 'neutral' },
  ];

  const recent = history.slice(0, 8).map((r) => ({
    planId: r.planId,
    file: r.sourceFile,
    at: r.importedAt,
    status: r.status,
    statusLabel: RUN_STATUS_LABEL[r.status],
    tone: RUN_STATUS_TONE[r.status],
    imported: r.totals.imported,
  }));

  const attention = needsReview + awaiting + failed;
  const headline =
    attention === 0
      ? `${imported.toLocaleString()} records imported. Nothing needs your attention.`
      : `${imported.toLocaleString()} records imported · ${attention.toLocaleString()} need your attention.`;

  return { empty: false, metrics, recent, headline };
}

// ---------------------------------------------------------------------------
// Import flow
// ---------------------------------------------------------------------------

/**
 * Stages are named states, not percentages. The backend cannot report fractional
 * progress for analysis or import, and inventing a bar would be a lie.
 */
export type ImportStage =
  'idle' | 'reading' | 'inspecting' | 'analyzing' | 'review' | 'importing' | 'done' | 'error';

export const IMPORT_STAGE_LABEL: Record<ImportStage, string> = {
  idle: 'Choose a file',
  reading: 'Reading file',
  inspecting: 'Identifying format',
  analyzing: 'Analyzing and classifying',
  review: 'Ready for review',
  importing: 'Importing',
  done: 'Complete',
  error: 'Could not continue',
};

/** Stages that should render a busy indicator. */
export function isBusyStage(stage: ImportStage): boolean {
  return (
    stage === 'reading' || stage === 'inspecting' || stage === 'analyzing' || stage === 'importing'
  );
}

export interface InspectionModel {
  filename: string;
  format: string;
  sizeLabel: string;
  supported: boolean;
  /** Present only when unsupported — the honest reason, shown verbatim. */
  reason: string | null;
  sheets: string[];
  rows: number;
}

export function buildInspection(inspection: DataPlaneInspection): InspectionModel {
  return {
    filename: inspection.filename,
    format: inspection.format.toUpperCase(),
    sizeLabel: formatBytes(inspection.bytes),
    supported: inspection.supported,
    reason: inspection.unsupportedReason,
    sheets: inspection.tableNames,
    rows: inspection.totalRows,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Mapping review
// ---------------------------------------------------------------------------

export interface MappingRow {
  columnIndex: number;
  source: string;
  target: string;
  targetLabel: string;
  confidencePct: number;
  band: 'high' | 'medium' | 'low';
  status: 'Matched' | 'Needs review' | 'Not mapped';
  /** The engine's evidence, shown so a reviewer can audit the reasoning. */
  reason: string;
  remembered: boolean;
}

export function buildMappingRows(
  mappings: readonly DataPlaneColumnMapping[],
  saved: DataPlaneSavedMapping | null = null,
): MappingRow[] {
  const rememberedHeaders = new Set((saved?.columns ?? []).map((c) => c.header.toLowerCase()));
  return mappings.map((m) => {
    const mapped = m.fieldKey !== null;
    const status: MappingRow['status'] = !mapped
      ? 'Not mapped'
      : m.band === 'high'
        ? 'Matched'
        : 'Needs review';
    return {
      columnIndex: m.columnIndex,
      source: m.header,
      target: m.fieldKey ?? '',
      targetLabel: m.fieldLabel ?? 'Not mapped',
      confidencePct: Math.round(m.confidence * 100),
      band: m.band,
      status,
      reason: m.reasons[0] ?? 'No canonical field matched this column.',
      remembered: rememberedHeaders.has(m.header.toLowerCase()),
    };
  });
}

/** Columns a human must look at before this table can be trusted. */
export function mappingsNeedingReview(rows: readonly MappingRow[]): MappingRow[] {
  return rows.filter((r) => r.status !== 'Matched');
}

// ---------------------------------------------------------------------------
// Import plan
// ---------------------------------------------------------------------------

export interface PlanTableRow {
  /** Mapping-memory key, carried from the plan so "remember this" is exact. */
  signature: string;
  tableName: string;
  entityId: string;
  entity: string;
  /**
   * Set only when a person overrode the detector. Carries what it was
   * corrected FROM, so the screen never presents a reviewer's answer as the
   * machine's own.
   */
  correction: { fromLabel: string; reason: string | null } | null;
  domain: string;
  destination: string;
  records: number;
  confidencePct: number;
  band: 'high' | 'medium' | 'low';
  risk: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  blocked: boolean;
  blockedReason: string | null;
  issues: number;
  duplicates: number;
  /** Plain-language reason the row is held, or null when it is ready. */
  holdReason: string | null;
}

export interface PlanModel {
  planId: string;
  file: string;
  unsupported: string | null;
  tables: PlanTableRow[];
  unclassified: { tableName: string; rowCount: number; reason: string }[];
  totalImportable: number;
  requiresApproval: boolean;
  /** True when there is genuinely nothing to import. */
  nothingToImport: boolean;
  warnings: string[];
}

export function buildPlan(
  plan: DataPlanePlanSummary,
  entities: readonly DataPlaneOntologyEntity[] = [],
): PlanModel {
  /**
   * Entity labels come from the ONTOLOGY, not from the plan.
   *
   * The plan only carries the label of the entity a table has NOW, so
   * resolving `override.fromEntityId` against it would always miss and print a
   * raw id at the reviewer. When the ontology has not loaded yet the id is
   * shown as-is rather than a guessed label.
   */
  const labelFor = new Map(entities.map((e) => [e.id, e.label]));
  const tables: PlanTableRow[] = plan.tables.map((t) => ({
    signature: t.signature,
    tableName: t.tableName,
    entityId: t.entityId,
    entity: t.entityLabel,
    correction:
      t.override === null
        ? null
        : {
            fromLabel:
              t.override.fromEntityId === null
                ? 'not recognised'
                : (labelFor.get(t.override.fromEntityId) ?? t.override.fromEntityId),
            reason: t.override.reason.trim().length > 0 ? t.override.reason.trim() : null,
          },
    domain: t.domain,
    destination: `${titleCase(t.domain)} · ${t.entityLabel}`,
    records: t.importableRows,
    confidencePct: Math.round(t.confidence * 100),
    band: t.band,
    risk: t.risk,
    requiresApproval: t.requiresApproval,
    blocked: t.blockedReason !== null,
    blockedReason: t.blockedReason,
    issues: t.report.invalid + t.report.incomplete,
    duplicates: t.report.duplicates,
    holdReason: holdReasonFor(t.blockedReason, t.requiresApproval, t.risk),
  }));

  return {
    planId: plan.planId,
    file: plan.sourceFile,
    unsupported: plan.unsupportedReason,
    tables,
    unclassified: plan.unclassified.map((u) => ({
      tableName: u.tableName,
      rowCount: u.rowCount,
      reason: u.reason,
    })),
    totalImportable: plan.totals.importable,
    requiresApproval: plan.requiresApproval,
    nothingToImport: plan.tables.length === 0 || plan.totals.importable === 0,
    warnings: plan.warnings,
  };
}

function holdReasonFor(
  blocked: string | null,
  requiresApproval: boolean,
  risk: string,
): string | null {
  if (blocked !== null) return blocked;
  if (requiresApproval) {
    return risk === 'high'
      ? 'Contains money, payroll or master data — needs your explicit approval.'
      : 'Confidence was below the automatic threshold — please review before importing.';
  }
  return null;
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface ResultModel {
  status: DataPlaneRunResult['status'];
  statusLabel: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  /** One honest sentence. Never claims success when anything failed. */
  summary: string;
  imported: number;
  skipped: number;
  failed: number;
  needsReview: number;
  tables: {
    tableName: string;
    status: string;
    statusLabel: string;
    imported: number;
    note: string | null;
    rolledBack: boolean;
    tone: 'good' | 'warn' | 'bad' | 'neutral';
  }[];
  errors: { sourceRow: number; message: string }[];
}

const TABLE_STATUS_LABEL: Record<string, string> = {
  imported: 'Imported',
  partial: 'Partly imported',
  failed: 'Failed',
  awaiting_approval: 'Awaiting approval',
  blocked: 'Blocked',
  skipped: 'Skipped',
};

const TABLE_STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  imported: 'good',
  partial: 'warn',
  failed: 'bad',
  awaiting_approval: 'warn',
  blocked: 'bad',
  skipped: 'neutral',
};

export function buildResult(run: DataPlaneRunResult): ResultModel {
  const { imported, skipped, failed, needsReview } = run.totals;

  let summary: string;
  if (run.status === 'imported') summary = `${imported.toLocaleString()} records imported.`;
  else if (run.status === 'partial') {
    summary = `${imported.toLocaleString()} imported, ${failed.toLocaleString()} failed — this import was not fully successful.`;
  } else if (run.status === 'failed')
    summary = `Nothing was imported. ${failed.toLocaleString()} rows failed.`;
  else {
    const awaiting = run.tables.filter((t) => t.status === 'awaiting_approval').length;
    summary =
      awaiting > 0
        ? `Nothing was imported — ${awaiting} group(s) are waiting for approval.`
        : 'Nothing was imported.';
  }

  return {
    status: run.status,
    statusLabel: RUN_STATUS_LABEL[run.status],
    tone: RUN_STATUS_TONE[run.status],
    summary,
    imported,
    skipped,
    failed,
    needsReview,
    tables: run.tables.map((t) => ({
      tableName: t.tableName,
      status: t.status,
      statusLabel: TABLE_STATUS_LABEL[t.status] ?? t.status,
      imported: t.imported,
      note: t.note,
      rolledBack: t.rolledBack,
      tone: TABLE_STATUS_TONE[t.status] ?? 'neutral',
    })),
    errors: run.tables.flatMap((t) => t.errors).slice(0, 50),
  };
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface ProvenanceRow {
  field: string;
  column: string;
  original: string;
  transformation: string | null;
}

export interface ProvenanceModel {
  recordId: string;
  source: string;
  /** e.g. `finance.xlsx · Invoices · row 1847` */
  location: string;
  confidencePct: number;
  importedAt: string;
  approvedBy: string | null;
  fields: ProvenanceRow[];
}

export function buildProvenance(p: DataPlaneProvenance): ProvenanceModel {
  return {
    recordId: p.recordId,
    source: p.sourceFile,
    location: `${p.sourceFile} · ${p.sourceTable} · row ${p.sourceRow}`,
    confidencePct: Math.round(p.confidence * 100),
    importedAt: p.importedAt,
    approvedBy: p.approvedBy,
    fields: p.fields.map((f) => ({
      field: f.field,
      column: f.column,
      original: f.original,
      transformation: f.transformation,
    })),
  };
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

export interface QualityIssue {
  issue: string;
  severity: 'high' | 'medium' | 'low';
  affected: number;
  action: string;
}

/** Aggregate quality issues across runs. Reports only what actually happened. */
export function buildQualityIssues(history: readonly DataPlaneRunResult[]): QualityIssue[] {
  const failed = history.reduce((n, r) => n + r.totals.failed, 0);
  const needsReview = history.reduce((n, r) => n + r.totals.needsReview, 0);
  const duplicates = history.reduce((n, r) => n + r.totals.duplicates, 0);
  const awaiting = history.reduce(
    (n, r) => n + r.tables.filter((t) => t.status === 'awaiting_approval').length,
    0,
  );
  const rolledBack = history.reduce((n, r) => n + r.tables.filter((t) => t.rolledBack).length, 0);

  const issues: QualityIssue[] = [];
  if (failed > 0) {
    issues.push({
      issue: 'Rows that failed to import',
      severity: 'high',
      affected: failed,
      action: 'Open the import and review the errors.',
    });
  }
  if (rolledBack > 0) {
    issues.push({
      issue: 'Imports rolled back after a failure',
      severity: 'high',
      affected: rolledBack,
      action:
        'High-risk data was undone rather than half-imported. Re-run after fixing the source.',
    });
  }
  if (awaiting > 0) {
    issues.push({
      issue: 'Groups awaiting approval',
      severity: 'medium',
      affected: awaiting,
      action: 'Approve or decline them in the import.',
    });
  }
  if (needsReview > 0) {
    issues.push({
      issue: 'Rows needing review',
      severity: 'medium',
      affected: needsReview,
      action: 'Fix the source values, or import the rest and handle these separately.',
    });
  }
  if (duplicates > 0) {
    issues.push({
      issue: 'Possible duplicate records',
      severity: 'low',
      affected: duplicates,
      action: 'Review each pair — NeuroPause never merges records for you.',
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Turn a thrown IPC error into something a non-technical user can act on.
 * Never surfaces raw internals.
 */
export function friendlyError(err: unknown): { title: string; detail: string; canRetry: boolean } {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown error');

  if (/sign in/i.test(raw)) {
    return {
      title: 'You need to sign in',
      detail: 'Sign in to import enterprise data.',
      canRetry: false,
    };
  }
  if (/permission|not permitted|data:approve|data:import/i.test(raw)) {
    return {
      title: 'Permission required',
      detail: raw.includes('data:approve')
        ? 'Approving money, payroll or master data needs approval rights. Ask an administrator.'
        : 'You do not have permission to do this. Ask an administrator.',
      canRetry: false,
    };
  }
  if (/no longer available|re-analyze/i.test(raw)) {
    return {
      title: 'This import expired',
      detail: 'Analyze the file again to continue.',
      canRetry: true,
    };
  }
  if (/timeout|timed out/i.test(raw)) {
    return {
      title: 'That took too long',
      detail: 'The file may be very large. Try again, or split it into smaller files.',
      canRetry: true,
    };
  }
  if (/unsupported|not implemented|OCR/i.test(raw)) {
    return { title: 'This file type cannot be read', detail: raw, canRetry: false };
  }
  return { title: 'Something went wrong', detail: raw, canRetry: true };
}

/** The formats the product can actually read, for empty-state copy. */
export const SUPPORTED_FORMAT_LABEL = 'Excel, CSV, TSV, JSON, XML, Word or text files';

// ---------------------------------------------------------------------------
// File handling
// ---------------------------------------------------------------------------

/**
 * The largest file this path accepts, in real bytes.
 *
 * The IPC contract caps the base64 STRING, and base64 inflates by 4/3. Deriving
 * the byte limit from that same constant means the UI can never advertise a
 * size the transport will then reject.
 */
export const MAX_UPLOAD_BYTES = Math.floor((DP_MAX_CONTENT_BASE64 / 4) * 3);

export function tooLargeMessage(bytes: number): string | null {
  if (bytes <= MAX_UPLOAD_BYTES) return null;
  return `That file is ${formatBytes(bytes)}. The import path accepts up to ${formatBytes(MAX_UPLOAD_BYTES)} — split it, or export a smaller range.`;
}

/**
 * Encode file bytes for the IPC contract.
 *
 * Chunked deliberately: `String.fromCharCode(...bytes)` overflows the call stack
 * somewhere around a hundred thousand arguments, which means the naive version
 * works on every small test file and fails on exactly the large enterprise
 * export this feature exists for.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Row preview
// ---------------------------------------------------------------------------

export type PreviewFilter = 'all' | 'valid' | 'warning' | 'invalid' | 'duplicate' | 'ambiguous';

export const PREVIEW_FILTERS: readonly { id: PreviewFilter; label: string }[] = [
  { id: 'all', label: 'All rows' },
  { id: 'valid', label: 'Ready' },
  { id: 'warning', label: 'Warnings' },
  { id: 'invalid', label: 'Cannot import' },
  { id: 'duplicate', label: 'Repeated in file' },
  { id: 'ambiguous', label: 'Needs a decision' },
];

export const PREVIEW_PAGE_SIZE = 25;

/** One choice a reviewer may make for a row, with the reason it is offered. */
export interface RowChoice {
  action: 'create' | 'update' | 'skip';
  label: string;
  /** Shown as help text; never a bare verb with no consequence attached. */
  detail: string;
}

export interface PreviewRowModel {
  rowIndex: number;
  sourceRow: number;
  title: string;
  verdictLabel: string;
  verdictTone: 'good' | 'warn' | 'bad' | 'neutral';
  /** What the engine will do if the reviewer chooses nothing. */
  defaultAction: DataPlaneRowAction;
  defaultLabel: string;
  fields: { key: string; label: string; value: string; redacted: boolean }[];
  issues: { field: string; message: string }[];
  transformations: string[];
  /** Set when this row repeats an earlier row of the same file. */
  repeatOfRow: number | null;
  existing: {
    recordId: string;
    title: string;
    kind: 'exact' | 'normalized';
    basis: string;
    certain: boolean;
    differs: { field: string; label: string; existing: string; incoming: string }[];
  } | null;
  choices: RowChoice[];
  /** True when the engine refuses to guess and a person must choose. */
  needsDecision: boolean;
  /** Set when nothing can be done with this row, with the reason. */
  unimportableReason: string | null;
}

export interface PreviewModel {
  tableName: string;
  entityLabel: string;
  total: number;
  offset: number;
  rows: PreviewRowModel[];
  counts: DataPlanePreview['counts'];
  plan: DataPlanePreview['plan'];
  /**
   * The engine's CURRENT default for each row on this page, keyed by row
   * index. Lets a decision be reconciled against what the engine thinks now
   * rather than what it thought when the reviewer clicked.
   */
  defaults: ReadonlyMap<number, DataPlaneRowAction>;
  hasPrev: boolean;
  hasNext: boolean;
  rangeLabel: string;
}

const VERDICT: Record<
  DataPlanePreviewRow['verdict'],
  { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }
> = {
  valid: { label: 'Ready', tone: 'good' },
  incomplete: { label: 'Missing values', tone: 'warn' },
  invalid: { label: 'Cannot import', tone: 'bad' },
  duplicate: { label: 'Repeated in file', tone: 'warn' },
};

const ACTION_LABEL: Record<DataPlaneRowAction, string> = {
  create: 'Create new',
  update: 'Update the existing record',
  skip: 'Skip',
  review: 'Needs your decision',
};

/**
 * What a reviewer is allowed to do with one row.
 *
 * The refusals are the point:
 *   - An EXACT identity match cannot be created. A declared identity field
 *     matched literally, so a second record would be the duplicate the whole
 *     matching pass exists to prevent. Update or skip; there is no third
 *     honest option.
 *   - A row that failed validation offers nothing at all. Choosing "create"
 *     for a row the importer will reject anyway is a button that lies.
 *   - A NORMALIZED match offers all three, because canonicalisation agreeing
 *     is a hint and not an identity — "Acme Ltd" and "ACME Limited" really can
 *     be two companies.
 */
export function rowChoices(row: DataPlanePreviewRow): RowChoice[] {
  if (row.verdict === 'invalid' || row.verdict === 'incomplete') return [];

  const skip: RowChoice = {
    action: 'skip',
    label: 'Skip',
    detail: 'Leave this row out of the import.',
  };

  if (row.existingMatch === null) {
    if (row.duplicateOfRow !== null) {
      return [
        skip,
        {
          action: 'create',
          label: 'Create anyway',
          detail: `Row ${row.duplicateOfRow} in this file looks like the same thing. Creating both makes two records.`,
        },
      ];
    }
    return [
      {
        action: 'create',
        label: 'Create new',
        detail: 'Nothing in the destination matches this row.',
      },
      skip,
    ];
  }

  const update: RowChoice = {
    action: 'update',
    label: 'Update the existing record',
    detail:
      row.existingMatch.differs.length === 0
        ? `Overwrites “${row.existingMatch.title}”. No mapped value differs, so nothing visible would change.`
        : `Overwrites ${row.existingMatch.differs.length} ${row.existingMatch.differs.length === 1 ? 'value' : 'values'} on “${row.existingMatch.title}”.`,
  };

  if (row.existingMatch.kind === 'exact') {
    return [
      skip,
      update,
      // Deliberately no `create`: see the doc comment above.
    ];
  }

  return [
    update,
    {
      action: 'create',
      label: 'Create new — they are different',
      detail: `“${row.existingMatch.title}” only matches after normalising. Creating adds a separate record.`,
    },
    skip,
  ];
}

function unimportableReason(row: DataPlanePreviewRow): string | null {
  if (row.verdict === 'invalid') {
    return row.issues[0]?.message ?? 'A required value is wrong, so this row cannot be written.';
  }
  if (row.verdict === 'incomplete') {
    const missing = row.issues.map((i) => i.field).join(', ');
    return missing.length > 0
      ? `Missing required ${missing}. Fix it in the source file and import again.`
      : 'A required value is missing.';
  }
  return null;
}

export function buildPreview(p: DataPlanePreview): PreviewModel {
  const rows: PreviewRowModel[] = p.rows.map((row) => {
    const choices = rowChoices(row);
    return {
      rowIndex: row.rowIndex,
      sourceRow: row.sourceRow,
      title: row.title,
      verdictLabel: VERDICT[row.verdict].label,
      verdictTone: VERDICT[row.verdict].tone,
      defaultAction: row.action,
      defaultLabel: ACTION_LABEL[row.action],
      fields: row.fields,
      // `original` is deliberately dropped: main redacts it for sensitive
      // fields, and there is no reason to carry a second copy of a raw value
      // into the DOM when the message already names the problem.
      issues: row.issues.map((i) => ({ field: i.field, message: i.message })),
      transformations: row.transformations,
      repeatOfRow: row.duplicateOfRow,
      existing:
        row.existingMatch === null
          ? null
          : {
              recordId: row.existingMatch.recordId,
              title: row.existingMatch.title,
              kind: row.existingMatch.kind,
              basis: row.existingMatch.basis,
              certain: row.existingMatch.kind === 'exact',
              differs: row.existingMatch.differs,
            },
      choices,
      /**
       * A prompt with no answers is not a prompt.
       *
       * `action` and `verdict` are decided in different places, and main has a
       * branch (no destination module) that marks EVERY row `review`, including
       * rows that failed validation and therefore offer no actions. That
       * combination rendered a "Needs a decision" pill above zero buttons, and a
       * counter that could never reach zero.
       */
      needsDecision: row.action === 'review' && choices.length > 0,
      unimportableReason: unimportableReason(row),
    };
  });

  const from = p.total === 0 ? 0 : p.offset + 1;
  const to = p.offset + p.rows.length;
  return {
    tableName: p.tableName,
    entityLabel: p.entityLabel,
    total: p.total,
    offset: p.offset,
    rows,
    counts: p.counts,
    plan: p.plan,
    defaults: new Map(p.rows.map((r) => [r.rowIndex, r.action])),
    hasPrev: p.offset > 0,
    hasNext: to < p.total,
    rangeLabel:
      p.total === 0 ? 'No rows match this filter' : `${from}–${to} of ${p.total.toLocaleString()}`,
  };
}

/** A reviewer's decision about one row, keyed by table then row index. */
export interface RowDecision {
  action: 'create' | 'update' | 'skip';
  /**
   * The record the reviewer was looking at when they chose `update`.
   *
   * Sent back so main can refuse if the match moved underneath them. Without
   * it, "update Acme Ltd" reviewed at 10:00 could overwrite whatever the
   * matcher now points at when the import runs at 10:05.
   */
  expectRecordId?: string;
  /**
   * What the engine WOULD have done, captured when the reviewer chose.
   *
   * Recorded rather than re-derived because the only way to keep the
   * whole-table action counts honest across a paginated table is to know what
   * each answered row was counted as before — including the rows now three
   * pages away. It also makes "how many ambiguous rows are left" exact:
   * `from === 'review'`.
   */
  from: DataPlaneRowAction;
}

export type RowDecisions = Record<string, Record<number, RowDecision>>;

export function setRowDecision(
  all: RowDecisions,
  tableName: string,
  row: PreviewRowModel,
  action: 'create' | 'update' | 'skip',
): RowDecisions {
  const forTable = { ...(all[tableName] ?? {}) };
  forTable[row.rowIndex] = {
    action,
    ...(action === 'update' && row.existing !== null
      ? { expectRecordId: row.existing.recordId }
      : {}),
    from: row.defaultAction,
  };
  return { ...all, [tableName]: forTable };
}

export function clearRowDecisions(all: RowDecisions, tableName: string): RowDecisions {
  const next = { ...all };
  delete next[tableName];
  return next;
}

/**
 * How many rows in this table the engine will not act on without an answer.
 *
 * Derived from the WHOLE-table `plan.review` count and the decisions taken so
 * far, never from the current page: a reviewer who answered the three
 * ambiguous rows on page 1 has not thereby answered the fourteen on page 3.
 * Undecided rows are skipped by the importer — safe, but it must not be
 * silent, so this number is shown next to the button.
 */
export function undecidedRows(
  preview: PreviewModel,
  decided: Record<number, RowDecision> | undefined,
): number {
  // Read straight off the adjusted counts rather than subtracting separately:
  // two expressions for one number is how the header and the footer came to
  // contradict each other.
  return applyDecisions(preview.plan, decided, preview.defaults).review;
}

/** Whole-table action counts with the reviewer's decisions applied. */
export type PlanEffect = { create: number; update: number; skip: number; review: number };

/**
 * Move each decided row from the bucket the engine put it in to the bucket the
 * reviewer chose.
 *
 * Two guards, both load-bearing, because `base` is refetched on every preview
 * call while `d.from` is a snapshot taken when the reviewer clicked — and main
 * re-runs identity matching against the destination on each of those calls, so
 * the engine's own default for a row CAN change underneath a stored decision.
 *
 *   1. `liveDefaults` wins where it is known. For rows on the page in front of
 *      the reviewer there is no need to trust a snapshot at all.
 *   2. A move only happens if there is a unit in `from` to move. Decrementing
 *      with `Math.max(0, …)` while incrementing unconditionally invents rows:
 *      one stale snapshot on a one-row table produced `{skip: 2}` and a footer
 *      reading "this will update 1 record" for the only row set to skip. The
 *      count of rows is not something the UI is entitled to change.
 */
export function applyDecisions(
  base: PlanEffect,
  decided: Record<number, RowDecision> | undefined,
  liveDefaults?: ReadonlyMap<number, DataPlaneRowAction>,
): PlanEffect {
  const out: PlanEffect = { ...base };
  for (const [rowIndex, d] of Object.entries(decided ?? {})) {
    const from = liveDefaults?.get(Number(rowIndex)) ?? d.from;
    if (from === d.action) continue;
    if (out[from] <= 0) continue;
    out[from] -= 1;
    out[d.action] += 1;
  }
  return out;
}

/** The row decisions for one table, in the shape `dp:import` accepts. */
export function toRowActions(
  decided: Record<number, RowDecision> | undefined,
): { rowIndex: number; action: 'create' | 'update' | 'skip'; expectRecordId?: string }[] {
  return Object.entries(decided ?? {}).map(([rowIndex, d]) => ({
    rowIndex: Number(rowIndex),
    action: d.action,
    ...(d.expectRecordId === undefined ? {} : { expectRecordId: d.expectRecordId }),
  }));
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export interface TableApproval {
  tableName: string;
  approved: boolean;
  rowActions?: {
    rowIndex: number;
    action: 'create' | 'update' | 'skip';
    expectRecordId?: string;
  }[];
}

/**
 * The starting approval state for a reviewed plan.
 *
 * A table that requires approval starts UNCHECKED — the whole point of the gate
 * is that a person ticks it. A blocked table can never be approved. Everything
 * else starts checked, because that is the automatic path the engine already
 * judged safe, and forcing a tick on it would train people to tick everything.
 */
export function approvalDefaults(plan: PlanModel): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const t of plan.tables) out[t.tableName] = !t.requiresApproval && !t.blocked;
  return out;
}

export function toApprovals(
  approvals: Record<string, boolean>,
  plan: PlanModel,
  decisions: RowDecisions = {},
): TableApproval[] {
  return plan.tables.map((t) => {
    const approved = !t.blocked && approvals[t.tableName] === true;
    const rowActions = toRowActions(decisions[t.tableName]);
    return {
      tableName: t.tableName,
      // A blocked table is never sent as approved, whatever the checkbox says.
      approved,
      /**
       * Row decisions ride along only for tables actually being imported.
       * Sending them for an unapproved table would be harmless today and a
       * trap tomorrow — the payload would assert intent about writes the
       * reviewer explicitly declined.
       */
      ...(approved && rowActions.length > 0 ? { rowActions } : {}),
    };
  });
}

/**
 * Reconcile the reviewer's ticks with a plan that has just changed underneath
 * them.
 *
 * A reclassify rebuilds one table and leaves the rest alone. Rebuilding the
 * whole approval map from `approvalDefaults` would silently drop ticks the
 * reviewer had already placed on other tables; keeping the old map wholesale
 * would carry a tick from BEFORE the correction onto a table that is now a
 * different thing entirely. So: keep every other table's answer, and reset the
 * corrected one to its new default — which, because an overridden table always
 * requires approval, means unticked.
 */
export function mergeApprovals(
  previous: Record<string, boolean>,
  plan: PlanModel,
  changedTable: string,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const t of plan.tables) {
    if (t.blocked) {
      out[t.tableName] = false;
    } else if (t.tableName === changedTable || !(t.tableName in previous)) {
      out[t.tableName] = !t.requiresApproval;
    } else {
      out[t.tableName] = previous[t.tableName] === true;
    }
  }
  return out;
}

/** True when at least one APPROVED table needs an explicit sign-off reason. */
export function needsApprovalReason(approvals: Record<string, boolean>, plan: PlanModel): boolean {
  return plan.tables.some(
    (t) => t.requiresApproval && !t.blocked && approvals[t.tableName] === true,
  );
}

export interface ImportReadiness {
  ready: boolean;
  /** Why the button is disabled — shown next to it, never left to guesswork. */
  blockedBecause: string | null;
  approvedTables: number;
  approvedRecords: number;
  /**
   * What pressing the button actually does, in one sentence.
   *
   * "About to create N records" was true only while every row was a create.
   * Once a row can update an existing record or be held for a decision, a
   * single create-count is a misstatement of the write about to happen — so
   * this names each kind separately whenever the preview has been consulted.
   */
  summary: string;
  /** Rows across approved tables the engine will not act on without an answer. */
  undecided: number;
}

/**
 * Per-table action counts, once the reviewer has looked at the rows.
 *
 * Absent for a table nobody previewed, and absence is honoured rather than
 * filled in: the fallback sentence talks about rows that PASSED VALIDATION,
 * which is a claim the plan alone can support, instead of guessing how many
 * of them are creates.
 */
export type PlanEffects = Record<string, PlanEffect>;

function effectSentence(total: PlanEffect, tables: number, partial: boolean): string {
  const parts: string[] = [];
  if (total.create > 0) parts.push(`create ${total.create.toLocaleString()}`);
  if (total.update > 0) parts.push(`update ${total.update.toLocaleString()}`);
  const group = `${tables} ${tables === 1 ? 'group' : 'groups'}`;
  if (parts.length === 0) {
    return `Nothing will be written across ${group} — every reviewed row is set to skip.`;
  }
  const scope = partial ? 'Across the groups you have reviewed, this will' : 'This will';
  return `${scope} ${parts.join(' and ')} ${parts.length === 1 ? 'record' : 'records'} across ${group}.`;
}

export function importReadiness(
  plan: PlanModel,
  approvals: Record<string, boolean>,
  reason: string,
  effects: PlanEffects = {},
  decisions: RowDecisions = {},
): ImportReadiness {
  const approved = plan.tables.filter((t) => !t.blocked && approvals[t.tableName] === true);
  const approvedRecords = approved.reduce((n, t) => n + t.records, 0);

  // Only tables the reviewer actually previewed contribute real action counts.
  const reviewed = approved.filter((t) => effects[t.tableName] !== undefined);
  const total: PlanEffect = { create: 0, update: 0, skip: 0, review: 0 };
  for (const t of reviewed) {
    const applied = applyDecisions(effects[t.tableName] as PlanEffect, decisions[t.tableName]);
    total.create += applied.create;
    total.update += applied.update;
    total.skip += applied.skip;
    total.review += applied.review;
  }

  const summary =
    reviewed.length === 0
      ? `About to import ${approvedRecords.toLocaleString()} ${approvedRecords === 1 ? 'row' : 'rows'} that passed validation, across ${approved.length} ${approved.length === 1 ? 'group' : 'groups'}.`
      : effectSentence(total, reviewed.length, reviewed.length < approved.length);

  const base = {
    approvedTables: approved.length,
    approvedRecords,
    summary,
    undecided: total.review,
  };

  if (approved.length === 0) {
    return {
      ...base,
      ready: false,
      blockedBecause: 'Select at least one group to import.',
      approvedTables: 0,
      approvedRecords: 0,
      summary: 'Nothing is selected.',
      undecided: 0,
    };
  }
  if (approvedRecords === 0) {
    return {
      ...base,
      ready: false,
      blockedBecause: 'The selected groups have no rows that passed validation.',
      approvedRecords: 0,
    };
  }
  if (needsApprovalReason(approvals, plan) && reason.trim().length === 0) {
    return {
      ...base,
      ready: false,
      blockedBecause: 'A high-risk group is selected — record why you are approving it.',
    };
  }
  /**
   * Every reviewed row set to skip is NOT a reason to block — a reviewer is
   * entitled to decide a file changes nothing. It IS a reason to stop the
   * button claiming otherwise, which `summary` already handles.
   */
  return { ...base, ready: true, blockedBecause: null };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormatId = 'xlsx' | 'csv' | 'json';

export interface ExportFormatChoice {
  id: ExportFormatId;
  label: string;
  /** What this format is actually good for — not marketing copy. */
  detail: string;
}

export const EXPORT_FORMATS: readonly ExportFormatChoice[] = [
  { id: 'xlsx', label: 'Excel', detail: 'Opens directly in Excel, Numbers or Sheets.' },
  { id: 'csv', label: 'CSV', detail: 'Plain text — the safest thing to hand to another system.' },
  { id: 'json', label: 'JSON', detail: 'Keyed by field name, for scripts and integrations.' },
];

export interface ExportRow {
  moduleId: string;
  name: string;
  group: string;
  records: number;
  imported: number;
  /** Plain-language note about traceability. Empty when there is nothing to say. */
  provenanceNote: string;
}

export function buildExportRows(modules: readonly DataPlaneExportableModule[]): ExportRow[] {
  return modules
    .map((m) => ({
      moduleId: m.moduleId,
      name: m.plural,
      group: m.group ?? 'Other',
      records: m.recordCount,
      imported: m.importedCount,
      provenanceNote:
        m.importedCount === 0
          ? 'No imported records — source columns would be empty.'
          : m.importedCount === m.recordCount
            ? 'Every record can be traced to its source row.'
            : `${m.importedCount.toLocaleString()} of ${m.recordCount.toLocaleString()} can be traced to a source row.`,
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

/**
 * The sentence shown after an export finishes.
 *
 * A cancelled save is reported as cancelled — never as a success with zero
 * records, which is what a naive "exported N records" template would produce.
 */
export function describeExport(result: DataPlaneExportResult, moduleName: string): string {
  if (result.cancelled) return 'Export cancelled — nothing was written.';
  const parts = [
    `Exported ${result.records.toLocaleString()} ${moduleName} to ${result.filePath ?? 'the chosen file'}.`,
  ];
  if (result.packaged) {
    parts.push('The file is a zip containing the data, manifest.json and a README.');
  }
  /**
   * Withheld fields are named in the success message, not only in the
   * manifest. Someone who exports a payroll file and does not notice the bank
   * columns are missing will act on an incomplete file; someone who is told
   * will either accept it or ask for the permission they need.
   */
  if (result.excluded.length > 0) {
    parts.push(
      `${result.excluded.length} field${result.excluded.length === 1 ? '' : 's'} withheld: ${result.excluded
        .map((e) => e.label)
        .join(', ')}.`,
    );
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export interface RelationshipQueueRow {
  id: string;
  /** e.g. `Invoice INV-1004` */
  source: string;
  /** What the source file actually said, verbatim. */
  value: string;
  target: string;
  status: DataPlanePendingStatus;
  statusLabel: string;
  tone: 'warn' | 'bad' | 'neutral';
  reason: string;
  candidates: {
    id: string;
    title: string;
    confidencePct: number;
    /** Plain-language explanation of why this record is offered. */
    why: string;
  }[];
  /** True when there is nothing to choose from — waiting on data, not a person. */
  awaitingData: boolean;
  attempts: number;
}

const PENDING_LABEL: Record<DataPlanePendingStatus, string> = {
  ambiguous: 'Needs a decision',
  unresolved: 'No match yet',
  skipped: 'Left unlinked',
};

const PENDING_TONE: Record<DataPlanePendingStatus, 'warn' | 'bad' | 'neutral'> = {
  ambiguous: 'warn',
  unresolved: 'neutral',
  skipped: 'neutral',
};

const METHOD_WHY: Record<string, string> = {
  internal_id: 'The value is this record’s id.',
  business_key: 'Exact match on',
  normalized_key: 'Matches ignoring case and punctuation on',
  canonical_name: 'The company names are equivalent apart from their legal suffix',
  manual: 'Chosen by a reviewer.',
};

export function buildRelationshipQueue(
  pending: readonly DataPlaneRelationshipPending[],
): RelationshipQueueRow[] {
  return pending.map((p) => ({
    id: p.id,
    source: `${p.sourceTitle}`,
    value: p.sourceValue,
    target: p.targetLabel,
    status: p.status,
    statusLabel: PENDING_LABEL[p.status],
    tone: PENDING_TONE[p.status],
    reason: p.reason,
    candidates: p.candidates.map((c) => ({
      id: c.id,
      title: c.title,
      confidencePct: Math.round(c.confidence * 100),
      why:
        c.method === 'canonical_name' || c.method === 'internal_id' || c.method === 'manual'
          ? (METHOD_WHY[c.method] ?? '')
          : `${METHOD_WHY[c.method] ?? 'Matched on'} “${c.matchedOn}”.`,
    })),
    // An unresolved reference with no candidates is not a decision anyone can
    // make yet — it is waiting for the record it points at to be imported.
    awaitingData: p.status === 'unresolved' && p.candidates.length === 0,
    attempts: p.attempts,
  }));
}

export interface RelationshipSummary {
  /** True before anything has been imported — an invitation, not zeroes. */
  empty: boolean;
  headline: string;
  metrics: OverviewMetric[];
}

export function buildRelationshipSummary(
  overview: DataPlaneRelationshipOverview,
): RelationshipSummary {
  const { links, ambiguous, unresolved, skipped } = overview.counts;
  if (links + ambiguous + unresolved + skipped === 0) {
    return {
      empty: true,
      headline: 'No relationships reconstructed yet.',
      metrics: [],
    };
  }
  const needsAttention = ambiguous;
  return {
    empty: false,
    headline:
      needsAttention === 0
        ? `${links.toLocaleString()} relationships linked. Nothing needs a decision.`
        : `${links.toLocaleString()} linked · ${needsAttention.toLocaleString()} need a decision.`,
    metrics: [
      { key: 'links', label: 'Linked', value: links, tone: 'good' },
      {
        key: 'ambiguous',
        label: 'Need a decision',
        value: ambiguous,
        tone: ambiguous > 0 ? 'warn' : 'neutral',
        ...(ambiguous > 0 ? { hint: 'More than one record could be meant' } : {}),
      },
      {
        key: 'unresolved',
        label: 'Waiting on data',
        value: unresolved,
        tone: 'neutral',
        ...(unresolved > 0 ? { hint: 'Will link when the target is imported' } : {}),
      },
      { key: 'skipped', label: 'Left unlinked', value: skipped, tone: 'neutral' },
    ],
  };
}

/** One honest sentence about what a retry pass actually did. */
export function describeRetryPass(pass: DataPlaneRelationshipPass): string {
  if (pass.examined === 0) return 'Nothing was waiting to be re-checked.';
  if (pass.resolved === 0) {
    return `Re-checked ${pass.examined.toLocaleString()} reference(s); none could be linked yet.`;
  }
  return `Linked ${pass.resolved.toLocaleString()} of ${pass.examined.toLocaleString()} re-checked reference(s).`;
}

export interface GraphSide {
  label: string;
  rows: {
    recordId: string;
    title: string;
    relationship: string;
    module: string;
    /** The literal source value, so the edge is explainable. */
    via: string;
    method: string;
    confidencePct: number;
    decidedBy: string | null;
    /** True when the record at the far end has been deleted. */
    broken: boolean;
  }[];
}

export interface GraphModel {
  found: boolean;
  title: string;
  outgoing: GraphSide;
  incoming: GraphSide;
  /** True when the record exists but has no resolved links at all. */
  isolated: boolean;
}

export function buildGraph(graph: DataPlaneRelationshipGraph): GraphModel {
  const side = (label: string, edges: DataPlaneRelationshipGraph['outgoing']): GraphSide => ({
    label,
    rows: edges.map((e) => ({
      recordId: e.recordId,
      title: e.title,
      relationship: e.label,
      module: e.moduleTitle,
      via: e.sourceValue,
      method: e.method,
      confidencePct: Math.round(e.confidence * 100),
      decidedBy: e.decidedBy,
      broken: e.title.startsWith('(deleted record'),
    })),
  });
  const outgoing = side('Points at', graph.outgoing);
  const incoming = side('Referenced by', graph.incoming);
  return {
    found: graph.record !== null || outgoing.rows.length > 0 || incoming.rows.length > 0,
    title: graph.record?.title ?? '',
    outgoing,
    incoming,
    isolated: outgoing.rows.length === 0 && incoming.rows.length === 0,
  };
}
