/**
 * Phase 6 — Universal Enterprise Data Plane: wire-facing types.
 *
 * These are the shapes that cross IPC to the renderer. The engine itself lives
 * in the desktop main process (`apps/desktop/src/main/dataPlane/`); only the
 * view-model surface is shared, so the renderer never depends on parser or
 * store internals.
 */

export type DataPlaneConfidenceBand = 'high' | 'medium' | 'low';
export type DataPlaneRisk = 'low' | 'medium' | 'high';

export type DataPlaneFormat =
  | 'xlsx'
  | 'csv'
  | 'tsv'
  | 'json'
  | 'xml'
  | 'docx'
  | 'txt'
  | 'pdf'
  | 'image'
  | 'unknown';

/** Cheap pre-flight: what is this file, and can we read it at all? */
export interface DataPlaneInspection {
  filename: string;
  format: DataPlaneFormat;
  bytes: number;
  supported: boolean;
  /** Present when `supported` is false — the honest reason, never a guess. */
  unsupportedReason: string | null;
  tableNames: string[];
  totalRows: number;
}

export interface DataPlaneColumnMapping {
  columnIndex: number;
  header: string;
  fieldKey: string | null;
  fieldLabel: string | null;
  confidence: number;
  band: DataPlaneConfidenceBand;
  /** Why the engine decided this — shown to the reviewer verbatim. */
  reasons: string[];
  observedShape: string;
  fillRate: number;
}

export interface DataPlaneQualityReport {
  totalRows: number;
  valid: number;
  invalid: number;
  incomplete: number;
  duplicates: number;
  transformed: number;
  topIssues: { message: string; count: number }[];
  unmappedColumns: string[];
}

export interface DataPlaneDuplicate {
  rowIndex: number;
  duplicateOfRowIndex: number;
  matchConfidence: number;
  reason: string;
  resolutions: readonly string[];
}

export interface DataPlanePlannedTable {
  tableName: string;
  entityId: string;
  entityLabel: string;
  domain: string;
  moduleId: string;
  confidence: number;
  band: DataPlaneConfidenceBand;
  reasons: string[];
  mappings: DataPlaneColumnMapping[];
  missingRequired: string[];
  report: DataPlaneQualityReport;
  duplicates: DataPlaneDuplicate[];
  risk: DataPlaneRisk;
  requiresApproval: boolean;
  importableRows: number;
  blockedReason: string | null;
}

export interface DataPlaneUnclassifiedTable {
  tableName: string;
  rowCount: number;
  reason: string;
  bestGuess: string | null;
  bestGuessConfidence: number;
}

/** The reviewable plan. Producing one writes nothing. */
export interface DataPlanePlanSummary {
  planId: string;
  sourceFile: string;
  format: DataPlaneFormat;
  createdAt: string;
  tables: DataPlanePlannedTable[];
  unclassified: DataPlaneUnclassifiedTable[];
  text: string | null;
  totals: {
    tables: number;
    rows: number;
    importable: number;
    invalid: number;
    incomplete: number;
    duplicates: number;
    approvalRequired: number;
  };
  requiresApproval: boolean;
  warnings: string[];
  unsupportedReason: string | null;
}

export type DataPlaneTableStatus =
  | 'imported'
  | 'partial'
  | 'failed'
  | 'awaiting_approval'
  | 'blocked'
  | 'skipped';

export type DataPlaneRunStatus = 'imported' | 'partial' | 'failed' | 'nothing_imported';

export interface DataPlaneTableResult {
  tableName: string;
  entityId: string;
  moduleId: string;
  status: DataPlaneTableStatus;
  imported: number;
  skipped: number;
  failed: number;
  duplicates: number;
  needsReview: number;
  createdRecordIds: string[];
  errors: { sourceRow: number; message: string }[];
  rolledBack: boolean;
  note: string | null;
}

export interface DataPlaneRunResult {
  planId: string;
  sourceFile: string;
  importedAt: string;
  actor: string | null;
  status: DataPlaneRunStatus;
  tables: DataPlaneTableResult[];
  totals: { imported: number; skipped: number; failed: number; duplicates: number; needsReview: number };
}

export interface DataPlaneFieldProvenance {
  field: string;
  column: string;
  original: string;
  transformation: string | null;
}

/** Where did this record come from? */
export interface DataPlaneProvenance {
  recordId: string;
  moduleId: string;
  planId: string;
  sourceFile: string;
  sourceTable: string;
  sourceRow: number;
  confidence: number;
  approvedBy: string | null;
  importedAt: string;
  fields: DataPlaneFieldProvenance[];
}

/** A remembered column→field mapping, scoped to one tenant. */
export interface DataPlaneSavedMapping {
  signature: string;
  entityId: string;
  columns: { header: string; fieldKey: string }[];
  tenantId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  /** How many imports have reused this mapping. */
  useCount: number;
}

/** One canonical entity, for the mapping-review UI. */
export interface DataPlaneOntologyEntity {
  id: string;
  label: string;
  plural: string;
  domain: string;
  moduleId: string;
  risk: DataPlaneRisk;
  requiresApproval: boolean;
  fields: { key: string; label: string; type: string; required: boolean; sensitive: boolean }[];
}

export interface DataPlaneOntologyView {
  entities: DataPlaneOntologyEntity[];
  supportedFormats: string[];
  /** Formats we deliberately do not read, with the reason. */
  unsupportedFormats: { format: string; reason: string }[];
}
