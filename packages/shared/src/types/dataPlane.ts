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
  /**
   * Mapping-memory key for this table's shape (name + normalized headers).
   * The reviewer's "remember this mapping" sends this value back verbatim, so
   * the renderer never re-derives the hash and the two can never disagree.
   */
  signature: string;
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
  /**
   * What the DETECTOR concluded, before any reviewer touched it. Kept
   * alongside the current entity so a corrected table can say what it was
   * corrected FROM rather than quietly presenting the reviewer's answer as
   * the machine's.
   */
  detectedEntityId: string | null;
  detectedConfidence: number;
  classificationMethod: 'detected' | 'reviewer';
  /** Set only when a person overrode the classification. Audited, never silent. */
  override: {
    fromEntityId: string | null;
    toEntityId: string;
    by: string | null;
    at: string;
    reason: string;
  } | null;
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
  /** Records changed in place by an explicit per-row update decision. */
  updatedRecordIds?: string[];
  errors: { sourceRow: number; message: string }[];
  rolledBack: boolean;
  /**
   * What re-reading the destination confirmed. Absent on paths that never
   * wrote. `checked: false` means no verification ran at all — which is a
   * different statement from "verification passed".
   */
  /** Existing records updated by an explicit per-row decision. */
  updated?: number;
  verification?: {
    checked: boolean;
    sourceRows: number;
    created: number;
    updated: number;
    confirmed: number;
    alreadyImported: number;
    reconciled: boolean;
    detail: string;
  };
  note: string | null;
}

export interface DataPlaneRunResult {
  planId: string;
  sourceFile: string;
  importedAt: string;
  actor: string | null;
  status: DataPlaneRunStatus;
  tables: DataPlaneTableResult[];
  totals: {
    imported: number;
    /** Existing records overwritten by an explicit per-row decision. */
    updated?: number;
    skipped: number;
    failed: number;
    duplicates: number;
    needsReview: number;
  };
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

// ── Export ────────────────────────────────────────────────────────────────

export type DataPlaneExportFormat = 'csv' | 'xlsx' | 'json';

/** A module whose records can be exported, with its live count. */
export interface DataPlaneExportableModule {
  moduleId: string;
  title: string;
  plural: string;
  group: string | null;
  /** Records that would be written — deleted records are never exported. */
  recordCount: number;
  /** How many of those records came from an import and carry provenance. */
  importedCount: number;
}

/**
 * The outcome of an export. `filePath` is null when the user dismissed the save
 * dialog — a cancellation is a normal outcome, not an error.
 */
export interface DataPlaneExportResult {
  moduleId: string;
  format: DataPlaneExportFormat;
  records: number;
  columns: number;
  filePath: string | null;
  cancelled: boolean;
}

// ── Cross-domain relationships ────────────────────────────────────────────

export type DataPlaneMatchMethod =
  | 'internal_id'
  | 'business_key'
  | 'normalized_key'
  | 'canonical_name'
  | 'manual';

export type DataPlanePendingStatus = 'ambiguous' | 'unresolved' | 'skipped';

/** One record offered as the target of a reference, with why it was offered. */
export interface DataPlaneRelationshipCandidate {
  id: string;
  title: string;
  matchedOn: string;
  matchedValue: string;
  method: DataPlaneMatchMethod;
  confidence: number;
}

/** A reference waiting on a person or on the arrival of its target. */
export interface DataPlaneRelationshipPending {
  id: string;
  relationshipKey: string;
  relationshipLabel: string;
  sourceModuleId: string;
  sourceRecordId: string;
  sourceTitle: string;
  sourceField: string;
  sourceValue: string;
  targetModuleId: string;
  targetLabel: string;
  status: DataPlanePendingStatus;
  candidates: DataPlaneRelationshipCandidate[];
  reason: string;
  firstSeenAt: string;
  attempts: number;
}

/** A declared relationship, for the coverage view. */
export interface DataPlaneRelationshipDefView {
  key: string;
  label: string;
  fromModuleId: string;
  field: string;
  toModuleId: string;
  toLabel: string;
  keyFields: string[];
  sensitivity: 'financial' | 'operational';
}

export interface DataPlaneRelationshipOverview {
  declared: DataPlaneRelationshipDefView[];
  chains: { id: string; label: string; keys: string[] }[];
  counts: { links: number; ambiguous: number; unresolved: number; skipped: number };
}

/** What one resolution pass did. Every number is a real count. */
export interface DataPlaneRelationshipPass {
  examined: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
  empty: number;
}

export interface DataPlaneRelationshipDecision {
  ok: boolean;
  message: string;
}

export interface DataPlaneRelationshipEdge {
  relationshipKey: string;
  label: string;
  moduleId: string;
  moduleTitle: string;
  recordId: string;
  title: string;
  method: string;
  confidence: number;
  decidedBy: string | null;
  at: string;
  sourceValue: string;
}

/** The connected records one hop out from a record, in both directions. */
export interface DataPlaneRelationshipGraph {
  record: { id: string; title: string; moduleId: string } | null;
  outgoing: DataPlaneRelationshipEdge[];
  incoming: DataPlaneRelationshipEdge[];
}

/* ── Program 7 hardening: row preview + entity override ─────────────────── */

/** What will happen to one row if the import runs as planned. */
export type DataPlaneRowAction = 'create' | 'update' | 'skip' | 'review';

/** A record already in the destination that an incoming row appears to be. */
export interface DataPlaneExistingMatch {
  recordId: string;
  title: string;
  /**
   * `exact` — a declared identity field matched literally.
   * `normalized` — they agree only after canonicalisation ("Acme Ltd" ≡ "ACME
   * Limited"). A strong hint, NOT an identity, and never acted on
   * automatically in either direction.
   */
  kind: 'exact' | 'normalized';
  basis: string;
  differs: { field: string; label: string; existing: string; incoming: string }[];
}

export interface DataPlanePreviewRow {
  rowIndex: number;
  /** One-based row number in the source file. */
  sourceRow: number;
  verdict: 'valid' | 'invalid' | 'incomplete' | 'duplicate';
  action: DataPlaneRowAction;
  title: string;
  /**
   * Mapped values, as they WOULD be written. Sensitive fields are replaced
   * with a redaction marker: a preview exists so a person can check the data,
   * and no check requires putting a password on screen.
   */
  fields: { key: string; label: string; value: string; redacted: boolean }[];
  issues: { field: string; message: string; original: string }[];
  transformations: string[];
  /** Set when this row repeats an earlier row of the SAME file. */
  duplicateOfRow: number | null;
  existingMatch: DataPlaneExistingMatch | null;
}

export interface DataPlanePreview {
  tableName: string;
  entityId: string;
  entityLabel: string;
  /** Total rows matching the current filter — not the page length. */
  total: number;
  offset: number;
  rows: DataPlanePreviewRow[];
  /** Counts across the WHOLE table, so the filter chips can show them. */
  counts: {
    all: number;
    valid: number;
    warning: number;
    invalid: number;
    duplicate: number;
    ambiguous: number;
  };
  /** What the import would do, per action, across the whole table. */
  plan: { create: number; update: number; skip: number; review: number };
}

/** An entity a file can actually be imported as. */
export interface DataPlaneEntityChoice {
  id: string;
  label: string;
  plural: string;
  domain: string;
  requiresApproval: boolean;
  risk: string;
}
