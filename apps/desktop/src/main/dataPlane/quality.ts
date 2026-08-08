/**
 * Phase 6 — Universal Enterprise Data Plane: validation, quality report, dedup.
 *
 * Produces the numbers a reviewer needs BEFORE anything is written: how many
 * rows are valid, invalid, incomplete, duplicated — and exactly why. Nothing
 * here mutates a store; it is pure analysis over parsed rows.
 *
 * Duplicate policy: candidates are REPORTED, never auto-merged. Merging master
 * records is destructive and irreversible in a JSON-backed store, so the
 * decision stays with a human.
 */
import type { CellValue, ParsedTable } from './parsers';
import type { CanonicalEntity } from './ontology';
import type { TableClassification } from './classifier';
import { canonicalName, normalizeValue } from './normalize';

export type RowVerdict = 'valid' | 'invalid' | 'incomplete' | 'duplicate';

export interface FieldIssue {
  fieldKey: string;
  fieldLabel: string;
  columnHeader: string;
  message: string;
  /** The offending original value, truncated. Never a whole record. */
  original: string;
}

export interface PreparedRow {
  /** Zero-based index within `table.rows`. */
  rowIndex: number;
  /** One-based row number in the SOURCE file, for provenance. */
  sourceRow: number;
  verdict: RowVerdict;
  /** Normalized field values ready for the destination module. */
  fields: Record<string, CellValue>;
  /** Title for the enterprise record. */
  title: string;
  issues: FieldIssue[];
  /** Recorded transformations, e.g. `"₹25,000" → 25000 INR`. */
  transformations: string[];
  /** Identity fingerprint used for duplicate detection; null when indeterminable. */
  identity: string | null;
  /** Set when this row duplicates an earlier row in the same import. */
  duplicateOf: number | null;
}

export interface QualityReport {
  totalRows: number;
  valid: number;
  invalid: number;
  incomplete: number;
  duplicates: number;
  /** Rows carrying at least one recorded transformation. */
  transformed: number;
  /** Distinct issue messages with counts, most frequent first. */
  topIssues: { message: string; count: number }[];
  /** Columns present in the source but not mapped to any canonical field. */
  unmappedColumns: string[];
}

export interface DuplicateCandidate {
  rowIndex: number;
  duplicateOfRowIndex: number;
  /** 0..1 — 1 means an exact identity-key match. */
  matchConfidence: number;
  reason: string;
  /** Choices offered to the reviewer. Nothing is applied automatically. */
  resolutions: readonly ['keep_both', 'merge', 'ignore'];
}

const RESOLUTIONS = ['keep_both', 'merge', 'ignore'] as const;

function truncate(s: string, max = 60): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/**
 * Build the identity fingerprint for a row using the entity's identity keys.
 * The first key set that is fully populated wins, so a record with a customer
 * code is matched on code, and one without falls back to name.
 */
function identityOf(entity: CanonicalEntity, fields: Record<string, CellValue>): { key: string; exact: boolean } | null {
  for (const keySet of entity.identityKeys) {
    const parts: string[] = [];
    let complete = true;
    for (const key of keySet) {
      const v = fields[key];
      if (v === null || v === undefined || String(v).trim() === '') {
        complete = false;
        break;
      }
      const field = entity.fields.find((f) => f.key === key);
      // Names are compared on a canonical form so "Pvt Ltd" ≡ "Private Limited".
      parts.push(field?.type === 'text' ? canonicalName(String(v)) : String(v).trim().toLowerCase());
    }
    if (complete && parts.length > 0) {
      return { key: `${keySet.join('|')}=${parts.join('|')}`, exact: keySet.some((k) => entity.fields.find((f) => f.key === k)?.identity === true) };
    }
  }
  return null;
}

/**
 * Normalize and validate every row of a classified table.
 * Never throws: a bad row is marked, not fatal.
 */
export function prepareRows(
  table: ParsedTable,
  classification: TableClassification,
  entity: CanonicalEntity,
): { rows: PreparedRow[]; report: QualityReport; duplicates: DuplicateCandidate[] } {
  const mapped = classification.mappings.filter((m) => m.fieldKey !== null);
  const fieldByKey = new Map(entity.fields.map((f) => [f.key, f]));

  const rows: PreparedRow[] = [];
  const seen = new Map<string, number>();
  const duplicates: DuplicateCandidate[] = [];
  const issueCounts = new Map<string, number>();

  table.rows.forEach((raw, rowIndex) => {
    const fields: Record<string, CellValue> = {};
    const issues: FieldIssue[] = [];
    const transformations: string[] = [];

    for (const m of mapped) {
      const key = m.fieldKey;
      if (key === null) continue;
      const field = fieldByKey.get(key);
      if (!field) continue;
      const cell = raw[m.columnIndex] ?? null;
      const norm = normalizeValue(cell, field.type);

      if (norm.error !== null) {
        issues.push({
          fieldKey: key,
          fieldLabel: field.label,
          columnHeader: m.header,
          message: `${field.label}: ${norm.error}`,
          original: truncate(String(cell ?? '')),
        });
        continue;
      }
      if (norm.note !== null) transformations.push(`${field.label}: ${norm.note}`);
      if (norm.value !== null) fields[key] = norm.value;
    }

    // Required-field check against the canonical entity.
    for (const field of entity.fields) {
      if (!field.required) continue;
      const v = fields[field.key];
      if (v === null || v === undefined || String(v).trim() === '') {
        issues.push({
          fieldKey: field.key,
          fieldLabel: field.label,
          columnHeader: mapped.find((m) => m.fieldKey === field.key)?.header ?? '(not mapped)',
          message: `${field.label} is required but missing`,
          original: '',
        });
      }
    }

    const hasTypeError = issues.some((i) => !i.message.endsWith('is required but missing'));
    const hasMissing = issues.some((i) => i.message.endsWith('is required but missing'));
    let verdict: RowVerdict = 'valid';
    if (hasTypeError) verdict = 'invalid';
    else if (hasMissing) verdict = 'incomplete';

    const titleValue = fields[entity.titleField];
    const title = titleValue === null || titleValue === undefined || String(titleValue).trim() === ''
      ? `${entity.label} (row ${table.firstDataRowIndex + rowIndex + 1})`
      : String(titleValue);

    const ident = verdict === 'valid' ? identityOf(entity, fields) : null;
    let duplicateOf: number | null = null;
    if (ident) {
      const prior = seen.get(ident.key);
      if (prior !== undefined) {
        duplicateOf = prior;
        verdict = 'duplicate';
        duplicates.push({
          rowIndex,
          duplicateOfRowIndex: prior,
          matchConfidence: ident.exact ? 1 : 0.9,
          reason: ident.exact
            ? `identical identifier (${ident.key.split('=')[0]})`
            : `same normalized ${ident.key.split('=')[0]} as row ${prior + 1}`,
          resolutions: RESOLUTIONS,
        });
      } else {
        seen.set(ident.key, rowIndex);
      }
    }

    for (const i of issues) issueCounts.set(i.message, (issueCounts.get(i.message) ?? 0) + 1);

    rows.push({
      rowIndex,
      sourceRow: table.firstDataRowIndex + rowIndex + 1,
      verdict,
      fields,
      title,
      issues,
      transformations,
      identity: ident?.key ?? null,
      duplicateOf,
    });
  });

  const report: QualityReport = {
    totalRows: rows.length,
    valid: rows.filter((r) => r.verdict === 'valid').length,
    invalid: rows.filter((r) => r.verdict === 'invalid').length,
    incomplete: rows.filter((r) => r.verdict === 'incomplete').length,
    duplicates: rows.filter((r) => r.verdict === 'duplicate').length,
    transformed: rows.filter((r) => r.transformations.length > 0).length,
    topIssues: [...issueCounts.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    unmappedColumns: classification.unmappedColumns.map((i) => table.headers[i] ?? `column_${i + 1}`),
  };

  return { rows, report, duplicates };
}

/** Fuzzy near-duplicate scan across already-prepared rows (name similarity). */
export function findNearDuplicates(rows: readonly PreparedRow[], entity: CanonicalEntity, limit = 200): DuplicateCandidate[] {
  const titleField = entity.titleField;
  const out: DuplicateCandidate[] = [];
  const buckets = new Map<string, number[]>();

  rows.forEach((row) => {
    if (row.verdict !== 'valid') return;
    const v = row.fields[titleField];
    if (v === null || v === undefined) return;
    const canon = canonicalName(String(v));
    if (canon === '') return;
    // Bucket on the first two tokens to keep the comparison near-linear.
    const bucket = canon.split(' ').slice(0, 2).join(' ');
    const list = buckets.get(bucket) ?? [];
    for (const otherIdx of list) {
      if (out.length >= limit) return;
      const other = rows[otherIdx];
      if (!other) continue;
      const otherCanon = canonicalName(String(other.fields[titleField] ?? ''));
      if (otherCanon === canon) continue; // exact matches already handled as duplicates
      const score = similarity(canon, otherCanon);
      if (score >= 0.88) {
        out.push({
          rowIndex: row.rowIndex,
          duplicateOfRowIndex: other.rowIndex,
          matchConfidence: Number(score.toFixed(3)),
          reason: `"${truncate(String(v))}" closely resembles "${truncate(String(other.fields[titleField] ?? ''))}"`,
          resolutions: RESOLUTIONS,
        });
      }
    }
    list.push(row.rowIndex);
    buckets.set(bucket, list);
  });
  return out;
}

/** Token-set Jaccard similarity — cheap, deterministic, good enough for names. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}
