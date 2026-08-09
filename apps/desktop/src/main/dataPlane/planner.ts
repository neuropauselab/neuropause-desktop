/**
 * Phase 6 — Universal Enterprise Data Plane: analysis → import plan.
 *
 * Turns a file into a reviewable PLAN. Nothing is written here. The plan is the
 * artifact a human approves: what was found, where it would go, how confident
 * the machine is, what is wrong with the data, and what requires explicit
 * sign-off because it touches money, payroll or master data.
 */
import { randomUUID } from 'node:crypto';
import { parseFile, type ParsedDocument, type ParsedTable, type SourceFormat } from './parsers';
import { classifyTable, type ColumnMapping, type ConfidenceBand } from './classifier';
import { entityById, requiresExplicitApproval, type CanonicalDomain, type ImportRisk } from './ontology';
import { prepareRows, findNearDuplicates, type DuplicateCandidate, type PreparedRow, type QualityReport } from './quality';
import { sourceSignature } from './mappingMemory';

export interface PlannedTable {
  /**
   * The mapping-memory key for this table's SHAPE (name + normalized headers).
   * Carried on the plan so the reviewer's "remember this mapping" is keyed by
   * exactly the value the store uses — the renderer never re-derives it, and a
   * change to the hashing rule cannot silently split saved mappings in two.
   */
  signature: string;
  tableName: string;
  entityId: string;
  entityLabel: string;
  domain: CanonicalDomain;
  /** Destination enterprise module id. */
  moduleId: string;
  confidence: number;
  band: ConfidenceBand;
  reasons: string[];
  mappings: ColumnMapping[];
  missingRequired: string[];
  report: QualityReport;
  duplicates: DuplicateCandidate[];
  risk: ImportRisk;
  /** True when a human must explicitly approve before any write. */
  requiresApproval: boolean;
  /** Rows that would actually be created if approved. */
  importableRows: number;
  /** Set when the table cannot be imported at all, with the reason. */
  blockedReason: string | null;
  /** Prepared rows, retained so approval can apply the exact analyzed result. */
  rows: PreparedRow[];
}

export interface UnclassifiedTable {
  tableName: string;
  rowCount: number;
  reason: string;
  /** The best guess and its score, so a human can map it manually. */
  bestGuess: string | null;
  bestGuessConfidence: number;
}

export interface ImportPlan {
  planId: string;
  sourceFile: string;
  format: SourceFormat;
  createdAt: string;
  tables: PlannedTable[];
  unclassified: UnclassifiedTable[];
  /** Extracted document text when the source was prose rather than tabular. */
  text: string | null;
  totals: {
    tables: number;
    rows: number;
    importable: number;
    invalid: number;
    incomplete: number;
    duplicates: number;
    /** Tables that need explicit approval. */
    approvalRequired: number;
  };
  /** True when ANY table in the plan requires explicit approval. */
  requiresApproval: boolean;
  warnings: string[];
  /** Set when the file could not be read at all. */
  unsupportedReason: string | null;
}

export interface AnalyzeOptions {
  /** Injected for deterministic tests. */
  now?: () => string;
  idFactory?: () => string;
}

/**
 * Analyze a file and produce an import plan. Never throws for bad input — an
 * unreadable or unsupported file yields a plan with `unsupportedReason` set and
 * zero tables, which the UI can render honestly.
 */
export function analyzeSource(filename: string, buf: Buffer, opts: AnalyzeOptions = {}): ImportPlan {
  const now = opts.now ?? ((): string => new Date().toISOString());
  const newId = opts.idFactory ?? ((): string => `imp_${randomUUID()}`);

  let doc: ParsedDocument;
  try {
    doc = parseFile(filename, buf);
  } catch (err) {
    return emptyPlan(newId(), filename, 'unknown', now(), `Could not read the file: ${(err as Error).message}`);
  }

  if (doc.kind === 'unsupported') {
    return emptyPlan(newId(), filename, doc.format, now(), doc.unsupportedReason ?? 'Unsupported file.');
  }

  const tables: PlannedTable[] = [];
  const unclassified: UnclassifiedTable[] = [];

  for (const table of doc.tables) {
    const planned = planTable(table);
    if (planned === null) {
      const c = classifyTable(table);
      unclassified.push({
        tableName: table.name,
        rowCount: table.rows.length,
        reason: c.entityReasons[0] ?? 'no canonical entity matched this table',
        bestGuess: c.entityLabel,
        bestGuessConfidence: c.entityConfidence,
      });
      continue;
    }
    tables.push(planned);
  }

  const totals = {
    tables: tables.length,
    rows: tables.reduce((n, t) => n + t.report.totalRows, 0),
    importable: tables.reduce((n, t) => n + t.importableRows, 0),
    invalid: tables.reduce((n, t) => n + t.report.invalid, 0),
    incomplete: tables.reduce((n, t) => n + t.report.incomplete, 0),
    duplicates: tables.reduce((n, t) => n + t.report.duplicates, 0),
    approvalRequired: tables.filter((t) => t.requiresApproval).length,
  };

  return {
    planId: newId(),
    sourceFile: filename,
    format: doc.format,
    createdAt: now(),
    tables,
    unclassified,
    text: doc.text,
    totals,
    requiresApproval: tables.some((t) => t.requiresApproval),
    warnings: doc.warnings,
    unsupportedReason: null,
  };
}

function planTable(table: ParsedTable): PlannedTable | null {
  const classification = classifyTable(table);
  if (classification.entityId === null) return null;
  const entity = entityById(classification.entityId);
  if (entity === null) return null;

  const { rows, report, duplicates } = prepareRows(table, classification, entity);
  const near = findNearDuplicates(rows, entity);
  const allDuplicates = [...duplicates, ...near];

  // Only clean, non-duplicate rows are importable. Incomplete and invalid rows
  // are surfaced for review rather than partially written.
  const importableRows = rows.filter((r) => r.verdict === 'valid').length;

  let blockedReason: string | null = null;
  if (classification.missingRequired.length > 0) {
    blockedReason = `Required field(s) not mapped: ${classification.missingRequired.join(', ')}.`;
  } else if (importableRows === 0) {
    blockedReason = 'No rows passed validation.';
  }

  return {
    signature: sourceSignature(table.name, classification.mappings.map((m) => m.header)),
    tableName: table.name,
    entityId: entity.id,
    entityLabel: entity.label,
    domain: entity.domain,
    moduleId: entity.moduleId,
    confidence: classification.entityConfidence,
    band: classification.entityBand,
    reasons: classification.entityReasons,
    mappings: classification.mappings,
    missingRequired: classification.missingRequired,
    report,
    duplicates: allDuplicates,
    risk: entity.risk,
    // Low-confidence mappings ALSO force review, independent of entity risk.
    requiresApproval:
      requiresExplicitApproval(entity) ||
      classification.entityBand !== 'high' ||
      classification.mappings.some((m) => m.fieldKey !== null && m.band === 'low'),
    importableRows,
    blockedReason,
    rows,
  };
}

function emptyPlan(
  planId: string,
  sourceFile: string,
  format: SourceFormat,
  createdAt: string,
  unsupportedReason: string,
): ImportPlan {
  return {
    planId,
    sourceFile,
    format,
    createdAt,
    tables: [],
    unclassified: [],
    text: null,
    totals: { tables: 0, rows: 0, importable: 0, invalid: 0, incomplete: 0, duplicates: 0, approvalRequired: 0 },
    requiresApproval: false,
    warnings: [],
    unsupportedReason,
  };
}

/** A compact, renderer-safe view of the plan (drops the row payloads). */
export interface ImportPlanSummary extends Omit<ImportPlan, 'tables'> {
  tables: Omit<PlannedTable, 'rows'>[];
}

export function summarizePlan(plan: ImportPlan): ImportPlanSummary {
  return {
    ...plan,
    tables: plan.tables.map(({ rows: _rows, ...rest }) => rest),
  };
}
