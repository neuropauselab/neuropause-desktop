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
  DataPlaneExportableModule,
  DataPlaneExportResult,
  DataPlaneInspection,
  DataPlanePlanSummary,
  DataPlaneProvenance,
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
  | 'idle'
  | 'reading'
  | 'inspecting'
  | 'analyzing'
  | 'review'
  | 'importing'
  | 'done'
  | 'error';

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
  return stage === 'reading' || stage === 'inspecting' || stage === 'analyzing' || stage === 'importing';
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
  entity: string;
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

export function buildPlan(plan: DataPlanePlanSummary): PlanModel {
  const tables: PlanTableRow[] = plan.tables.map((t) => ({
    signature: t.signature,
    tableName: t.tableName,
    entity: t.entityLabel,
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

function holdReasonFor(blocked: string | null, requiresApproval: boolean, risk: string): string | null {
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
  } else if (run.status === 'failed') summary = `Nothing was imported. ${failed.toLocaleString()} rows failed.`;
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
    issues.push({ issue: 'Rows that failed to import', severity: 'high', affected: failed, action: 'Open the import and review the errors.' });
  }
  if (rolledBack > 0) {
    issues.push({ issue: 'Imports rolled back after a failure', severity: 'high', affected: rolledBack, action: 'High-risk data was undone rather than half-imported. Re-run after fixing the source.' });
  }
  if (awaiting > 0) {
    issues.push({ issue: 'Groups awaiting approval', severity: 'medium', affected: awaiting, action: 'Approve or decline them in the import.' });
  }
  if (needsReview > 0) {
    issues.push({ issue: 'Rows needing review', severity: 'medium', affected: needsReview, action: 'Fix the source values, or import the rest and handle these separately.' });
  }
  if (duplicates > 0) {
    issues.push({ issue: 'Possible duplicate records', severity: 'low', affected: duplicates, action: 'Review each pair — NeuroPause never merges records for you.' });
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
    return { title: 'You need to sign in', detail: 'Sign in to import enterprise data.', canRetry: false };
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
    return { title: 'This import expired', detail: 'Analyze the file again to continue.', canRetry: true };
  }
  if (/timeout|timed out/i.test(raw)) {
    return { title: 'That took too long', detail: 'The file may be very large. Try again, or split it into smaller files.', canRetry: true };
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
// Approval
// ---------------------------------------------------------------------------

export interface TableApproval {
  tableName: string;
  approved: boolean;
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

export function toApprovals(approvals: Record<string, boolean>, plan: PlanModel): TableApproval[] {
  return plan.tables.map((t) => ({
    tableName: t.tableName,
    // A blocked table is never sent as approved, whatever the checkbox says.
    approved: !t.blocked && approvals[t.tableName] === true,
  }));
}

/** True when at least one APPROVED table needs an explicit sign-off reason. */
export function needsApprovalReason(approvals: Record<string, boolean>, plan: PlanModel): boolean {
  return plan.tables.some((t) => t.requiresApproval && !t.blocked && approvals[t.tableName] === true);
}

export interface ImportReadiness {
  ready: boolean;
  /** Why the button is disabled — shown next to it, never left to guesswork. */
  blockedBecause: string | null;
  approvedTables: number;
  approvedRecords: number;
}

export function importReadiness(
  plan: PlanModel,
  approvals: Record<string, boolean>,
  reason: string,
): ImportReadiness {
  const approved = plan.tables.filter((t) => !t.blocked && approvals[t.tableName] === true);
  const approvedRecords = approved.reduce((n, t) => n + t.records, 0);

  if (approved.length === 0) {
    return {
      ready: false,
      blockedBecause: 'Select at least one group to import.',
      approvedTables: 0,
      approvedRecords: 0,
    };
  }
  if (approvedRecords === 0) {
    return {
      ready: false,
      blockedBecause: 'The selected groups have no rows that passed validation.',
      approvedTables: approved.length,
      approvedRecords: 0,
    };
  }
  if (needsApprovalReason(approvals, plan) && reason.trim().length === 0) {
    return {
      ready: false,
      blockedBecause: 'A high-risk group is selected — record why you are approving it.',
      approvedTables: approved.length,
      approvedRecords,
    };
  }
  return { ready: true, blockedBecause: null, approvedTables: approved.length, approvedRecords };
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
  return `Exported ${result.records.toLocaleString()} ${moduleName} to ${result.filePath ?? 'the chosen file'}.`;
}
