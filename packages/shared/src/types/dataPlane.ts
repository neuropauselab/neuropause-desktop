/**
 * Phase 6 — Universal Enterprise Data Plane: wire-facing types.
 *
 * These are the shapes that cross IPC to the renderer. The engine itself lives
 * in the desktop main process (`apps/desktop/src/main/dataPlane/`); only the
 * view-model surface is shared, so the renderer never depends on parser or
 * store internals.
 */

import type { SensitivityClass } from './sensitivity';

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
// `SensitivityClass` is imported at the top of this file.

export type DataPlaneExportFormat = 'csv' | 'xlsx' | 'json';

/**
 * Formats the build can actually produce, and the ones it cannot, with the
 * reason. PDF is absent deliberately: no PDF engine is bundled, and a renamed
 * spreadsheet with a `.pdf` extension is a lie the user only discovers when
 * they try to open it.
 */
export interface DataPlaneExportFormats {
  supported: DataPlaneExportFormat[];
  unavailable: { format: string; reason: string }[];
}

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

/** How much of a module is being exported. */
export type DataPlaneExportScopeKind = 'module' | 'filtered' | 'selected' | 'record';

/** One field offered for export, and whether it may be included. */
export interface DataPlaneExportField {
  key: string;
  label: string;
  sensitivity: SensitivityClass;
  /**
   * False when this field can never be part of an export. Secrets are always
   * false; a restricted field is only selectable by an actor who administers
   * the module.
   */
  selectable: boolean;
  /** Ticked by default. Restricted fields never are. */
  defaultSelected: boolean;
  /** Why it is held back, when it is. Empty for ordinary fields. */
  reason: string;
  /**
   * Values this field can be filtered on, when it is a `select`.
   *
   * Carried on the field rather than fetched separately so the export filter
   * chips offer exactly what the list view offers — one source, so the two
   * cannot drift into showing different options for the same column.
   */
  filterOptions: { value: string; label: string }[] | null;
}

/**
 * What an export WOULD do, computed by the same code that performs it.
 *
 * The point of a separate preview channel is that the number on the button and
 * the number in the file come from one function. A UI that counts rows itself
 * eventually disagrees with the exporter, and the disagreement is invisible.
 */
export interface DataPlaneExportPlan {
  moduleId: string;
  title: string;
  plural: string;
  scope: DataPlaneExportScopeKind;
  scopeLabel: string;
  /** Records that match the requested scope right now. */
  records: number;
  /** Records in the module, ignoring the scope — so "12 of 340" can be shown. */
  totalRecords: number;
  fields: DataPlaneExportField[];
  /** Fields excluded from THIS export, with the reason, named individually. */
  excluded: { key: string; label: string; reason: string }[];
  formats: DataPlaneExportFormats;
  /** True when the actor may include restricted fields if they ask. */
  mayIncludeRestricted: boolean;
  /** Set when the export would be refused, with the reason. */
  blockedReason: string | null;
  /** Set when the scope exceeds what one file may carry. */
  tooLargeReason: string | null;
  /**
   * Filters that were refused, with the reason.
   *
   * A filter that is quietly ignored produces a WIDER export than the caller
   * asked for, and nothing on screen would say so.
   */
  refusedFilters: { field: string; reason: string }[];
  /** Requested record ids that are not in this module (or are deleted). */
  missingRecordIds: string[];
}

/**
 * The manifest written alongside an export package.
 *
 * Answers "who exported what, from where, with which filters, when" without
 * carrying a single business value — so it can be read, logged and kept
 * without re-exposing the data it describes.
 */
export interface DataPlaneExportManifest {
  exportId: string;
  schemaVersion: number;
  createdAt: string;
  createdBy: string;
  application: { name: string; version: string };
  workspaceId: string | null;
  tenantId: string | null;
  source: { moduleId: string; title: string; entityPlural: string };
  scope: {
    kind: DataPlaneExportScopeKind;
    label: string;
    recordCount: number;
    moduleRecordCount: number;
    filters: { field: string; value: string }[];
    recordIds: string[] | null;
  };
  fields: { key: string; label: string }[];
  excludedFields: { key: string; label: string; reason: string }[];
  /** True only when a person explicitly asked for restricted fields. */
  includesRestricted: boolean;
  format: DataPlaneExportFormat;
  dataFile: string;
  /** SHA-256 of the data file, so a copy can be shown to be unaltered. */
  dataFileSha256: string;
  provenance: {
    included: boolean;
    tracedRecords: number;
    untracedRecords: number;
  };
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
  /** Set when a manifest was packaged with the data. */
  manifest: DataPlaneExportManifest | null;
  /** True when the written file is a zip carrying the data plus the manifest. */
  packaged: boolean;
  excluded: { key: string; label: string; reason: string }[];
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
