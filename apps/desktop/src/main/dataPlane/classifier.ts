/**
 * Phase 6 — Universal Enterprise Data Plane: semantic classification + confidence.
 *
 * Two decisions are made here:
 *   1. WHAT is this table? (sheet → canonical entity)
 *   2. WHAT is each column? (column → canonical field)
 *
 * Charter rule, enforced structurally: a column is never classified on its
 * header name alone. Every score combines a NAME signal with an independent
 * VALUE signal (dominant shape, type agreement, uniqueness), and a header match
 * that the data contradicts is actively penalized — that is precisely the case
 * where a naive mapper silently corrupts an import.
 *
 * Every result carries its confidence AND the evidence that produced it, so a
 * reviewer can audit the machine's reasoning rather than trust it.
 */
import type { CellValue, ParsedTable } from './parsers';
import { ONTOLOGY, type CanonicalEntity, type CanonicalField } from './ontology';
import { columnShape, headerTokens, normalizeHeader, type ValueShape } from './normalize';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export const HIGH_CONFIDENCE = 0.85;
export const MEDIUM_CONFIDENCE = 0.6;

export function bandOf(score: number): ConfidenceBand {
  if (score >= HIGH_CONFIDENCE) return 'high';
  if (score >= MEDIUM_CONFIDENCE) return 'medium';
  return 'low';
}

export interface ColumnMapping {
  columnIndex: number;
  header: string;
  /** Target canonical field key, or null when the column is left unmapped. */
  fieldKey: string | null;
  fieldLabel: string | null;
  confidence: number;
  band: ConfidenceBand;
  /** Human-readable evidence — what the machine actually observed. */
  reasons: string[];
  /** Dominant value shape observed in the sample. */
  observedShape: ValueShape;
  /** Share of sampled rows that carried a value. */
  fillRate: number;
}

export interface TableClassification {
  tableName: string;
  entityId: string | null;
  entityLabel: string | null;
  entityConfidence: number;
  entityBand: ConfidenceBand;
  entityReasons: string[];
  mappings: ColumnMapping[];
  /** Required canonical fields with no column mapped to them. */
  missingRequired: string[];
  /** Column indexes deliberately left unmapped. */
  unmappedColumns: number[];
}

/** How many rows to sample when profiling a column. */
export const SAMPLE_SIZE = 200;

function sampleColumn(table: ParsedTable, index: number): CellValue[] {
  const step = Math.max(1, Math.floor(table.rows.length / SAMPLE_SIZE));
  const out: CellValue[] = [];
  for (let i = 0; i < table.rows.length && out.length < SAMPLE_SIZE; i += step) {
    out.push(table.rows[i]?.[index] ?? null);
  }
  return out;
}

interface ColumnProfile {
  index: number;
  header: string;
  normalized: string;
  tokens: string[];
  shape: ValueShape;
  shapeShare: number;
  fillRate: number;
  uniqueRatio: number;
}

function profileColumns(table: ParsedTable): ColumnProfile[] {
  return table.headers.map((header, index) => {
    const sample = sampleColumn(table, index);
    const { shape, share, filled } = columnShape(sample);
    const values = sample.filter((v) => v !== null && String(v).trim() !== '').map((v) => String(v).trim().toLowerCase());
    const uniqueRatio = values.length === 0 ? 0 : new Set(values).size / values.length;
    return {
      index,
      header,
      normalized: normalizeHeader(header),
      tokens: headerTokens(header),
      shape,
      shapeShare: share,
      fillRate: sample.length === 0 ? 0 : filled / sample.length,
      uniqueRatio,
    };
  });
}

/** Name-signal score in [0,1] for a column header against one canonical field. */
function nameScore(profile: ColumnProfile, field: CanonicalField): { score: number; reason: string | null } {
  const norm = profile.normalized;
  if (norm === '') return { score: 0, reason: null };

  for (const syn of field.synonyms) {
    if (norm === syn) return { score: 1, reason: `header "${profile.header}" matches "${syn}"` };
  }
  if (norm === normalizeHeader(field.label)) {
    return { score: 0.95, reason: `header "${profile.header}" matches the field label` };
  }
  // Token containment: every synonym token present in the header (or vice versa).
  let best = 0;
  let bestSyn = '';
  for (const syn of field.synonyms) {
    const synTokens = syn.split(' ').filter(Boolean);
    if (synTokens.length === 0) continue;
    const present = synTokens.filter((t) => profile.tokens.includes(t)).length;
    const coverage = present / synTokens.length;
    const inverse = profile.tokens.length === 0 ? 0 : present / profile.tokens.length;
    // Both directions matter: "invoice no" vs "supplier invoice no".
    const combined = coverage * 0.75 + inverse * 0.25;
    if (coverage === 1 && combined > best) {
      best = Math.min(0.9, 0.6 + combined * 0.3);
      bestSyn = syn;
    } else if (coverage >= 0.5 && combined > best) {
      best = Math.min(0.7, combined * 0.7);
      bestSyn = syn;
    }
  }
  if (best > 0) return { score: best, reason: `header "${profile.header}" overlaps "${bestSyn}"` };
  return { score: 0, reason: null };
}

const SHAPE_FOR_TYPE: Record<string, readonly ValueShape[]> = {
  number: ['number', 'money'],
  date: ['date'],
  text: ['text', 'code', 'email', 'phone', 'url', 'number'],
  boolean: ['text'],
};

/**
 * Value-signal score in [-1,1]. Positive when the observed data agrees with the
 * field, NEGATIVE when it contradicts it — a contradiction must be able to veto
 * a confident-looking header.
 */
function valueScore(profile: ColumnProfile, field: CanonicalField): { score: number; reason: string | null } {
  if (profile.fillRate === 0) return { score: -0.2, reason: 'column is empty in the sample' };

  // Explicit shape expectation (email/phone/date/money/code/url).
  if (field.shape) {
    // 'code' is a weak shape — SKUs, country codes, "NET30" and status flags all
    // look alike — so it never earns a full-strength value signal.
    if (field.shape === 'code') {
      if (profile.shape === 'code' || profile.shape === 'text') {
        return { score: 0.6, reason: 'values look like identifiers' };
      }
      return { score: -0.2, reason: `values look like ${profile.shape}, not an identifier` };
    }
    if (profile.shape === field.shape && profile.shapeShare >= 0.7) {
      return { score: 1, reason: `values look like ${field.shape} (${pct(profile.shapeShare)} of sampled rows)` };
    }
    if (field.shape === 'money' && profile.shape === 'number' && profile.shapeShare >= 0.7) {
      return { score: 0.85, reason: `values are numeric (${pct(profile.shapeShare)} of sampled rows)` };
    }
    if (field.shape === 'date' && profile.shape !== 'date') {
      return { score: -0.9, reason: `expected dates but found ${profile.shape} values` };
    }
    if (field.shape === 'email' && profile.shape !== 'email') {
      return { score: -0.9, reason: `expected email addresses but found ${profile.shape} values` };
    }
    return { score: -0.3, reason: `values look like ${profile.shape}, not ${field.shape}` };
  }

  const allowed = SHAPE_FOR_TYPE[field.type] ?? ['text'];
  if (allowed.includes(profile.shape)) {
    return { score: 0.7, reason: `values are ${profile.shape}, consistent with a ${field.type} field` };
  }
  if (field.type === 'number' && profile.shape !== 'number' && profile.shape !== 'money') {
    return { score: -0.9, reason: `expected numbers but found ${profile.shape} values` };
  }
  return { score: -0.2, reason: `values are ${profile.shape}, unusual for a ${field.type} field` };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

interface Candidate {
  columnIndex: number;
  field: CanonicalField;
  score: number;
  reasons: string[];
}

function scorePair(profile: ColumnProfile, field: CanonicalField): Candidate | null {
  const name = nameScore(profile, field);
  const value = valueScore(profile, field);

  // A column with no name signal is only mappable on an UNAMBIGUOUS value shape.
  // Email and URL qualify; nothing else does — "looks like a code" describes
  // SKUs, country codes and payment terms alike, and mapping on that alone is
  // how a spurious column lands in a customer master.
  const selfEvident = field.shape === 'email' || field.shape === 'url';
  if (name.score === 0 && !(selfEvident && value.score >= 1)) return null;

  let score = name.score * 0.65 + Math.max(0, value.score) * 0.35;
  const reasons: string[] = [];
  if (name.reason) reasons.push(name.reason);
  if (value.reason) reasons.push(value.reason);

  // A conflicting header word vetoes the match outright.
  const conflict = (field.conflicts ?? []).find((w) => profile.tokens.includes(w));
  if (conflict !== undefined) {
    score = Math.min(score, 0.35) - 0.15;
    reasons.push(`header contains "${conflict}", which contradicts ${field.label}`);
  }

  // The data contradicts the header: cap hard. This is the anti-corruption rule.
  if (value.score < 0) {
    score = Math.min(score, 0.45) + value.score * 0.25;
    reasons.push('confidence reduced because the values contradict the header');
  }

  // An identity field should look unique; a non-unique one probably is not it.
  if (field.identity) {
    if (profile.uniqueRatio >= 0.98) {
      score = Math.min(1, score + 0.05);
      reasons.push(`values are unique (${pct(profile.uniqueRatio)}), consistent with an identifier`);
    } else if (profile.uniqueRatio < 0.6 && profile.fillRate > 0.5) {
      score -= 0.15;
      reasons.push(`values repeat (${pct(profile.uniqueRatio)} unique), unusual for an identifier`);
    }
  }

  if (score <= 0) return null;
  return { columnIndex: profile.index, field, score: Math.max(0, Math.min(1, score)), reasons };
}

/** Score how well a whole table matches one candidate entity. */
function scoreEntity(
  table: ParsedTable,
  profiles: readonly ColumnProfile[],
  entity: CanonicalEntity,
): { score: number; reasons: string[]; assigned: Map<number, Candidate> } {
  const candidates: Candidate[] = [];
  for (const profile of profiles) {
    for (const field of entity.fields) {
      const c = scorePair(profile, field);
      if (c) candidates.push(c);
    }
  }
  // Greedy assignment: best score first, one column per field and vice versa.
  candidates.sort((a, b) => b.score - a.score);
  const assigned = new Map<number, Candidate>();
  const usedFields = new Set<string>();
  for (const c of candidates) {
    if (assigned.has(c.columnIndex) || usedFields.has(c.field.key)) continue;
    if (c.score < 0.3) continue;
    assigned.set(c.columnIndex, c);
    usedFields.add(c.field.key);
  }

  const reasons: string[] = [];

  // Signal 1 — the sheet/table name.
  const nameNorm = normalizeHeader(table.name);
  const nameTokens = new Set(headerTokens(table.name));
  let nameHit = 0;
  for (const hint of entity.nameHints) {
    if (nameNorm === hint) {
      nameHit = 1;
      reasons.push(`sheet name "${table.name}" matches ${entity.label}`);
      break;
    }
    if (nameTokens.has(hint)) {
      nameHit = Math.max(nameHit, 0.8);
    }
  }
  if (nameHit > 0 && nameHit < 1) reasons.push(`sheet name "${table.name}" mentions ${entity.label}`);

  // Signal 2 — required-field coverage. Without required fields we cannot import at all.
  const required = entity.fields.filter((f) => f.required);
  const requiredHit = required.filter((f) => usedFields.has(f.key)).length;
  const requiredCoverage = required.length === 0 ? 1 : requiredHit / required.length;
  if (requiredCoverage === 1) reasons.push(`all required fields matched (${required.map((f) => f.label).join(', ')})`);
  else if (requiredHit > 0) reasons.push(`${requiredHit}/${required.length} required fields matched`);

  // Signal 3 — how much of the table this entity explains, and how well.
  const coverage = profiles.length === 0 ? 0 : assigned.size / profiles.length;
  const meanScore =
    assigned.size === 0 ? 0 : [...assigned.values()].reduce((s, c) => s + c.score, 0) / assigned.size;
  if (assigned.size > 0) {
    reasons.push(`${assigned.size} of ${profiles.length} columns mapped at mean confidence ${pct(meanScore)}`);
  }

  // Required coverage dominates: a table missing a required field is not this entity.
  const score = requiredCoverage * 0.45 + meanScore * 0.25 + coverage * 0.15 + nameHit * 0.15;
  return { score, reasons, assigned };
}

/**
 * Classify one parsed table: choose the best canonical entity and map columns.
 * Returns `entityId: null` when nothing matches well enough — an honest "I do
 * not know" rather than a forced guess.
 */
export function classifyTable(table: ParsedTable): TableClassification {
  const profiles = profileColumns(table);

  let best: { entity: CanonicalEntity; score: number; reasons: string[]; assigned: Map<number, Candidate> } | null = null;
  let runnerUp = 0;
  for (const entity of ONTOLOGY) {
    const result = scoreEntity(table, profiles, entity);
    if (best === null || result.score > best.score) {
      if (best) runnerUp = Math.max(runnerUp, best.score);
      best = { entity, ...result };
    } else {
      runnerUp = Math.max(runnerUp, result.score);
    }
  }

  const reasons = best ? [...best.reasons] : [];
  // An entity that barely beats its runner-up is genuinely ambiguous; say so.
  if (best && runnerUp > 0 && best.score - runnerUp < 0.08) {
    reasons.push('another entity scored almost as well — treat this mapping as ambiguous');
  }

  const accepted = best !== null && best.score >= MEDIUM_CONFIDENCE;
  const entity = accepted && best ? best.entity : null;
  const assigned = accepted && best ? best.assigned : new Map<number, Candidate>();
  let entityScore = best?.score ?? 0;
  if (best && runnerUp > 0 && best.score - runnerUp < 0.08) entityScore = Math.min(entityScore, 0.7);

  const mappings: ColumnMapping[] = profiles.map((p) => {
    const c = assigned.get(p.index);
    return {
      columnIndex: p.index,
      header: p.header,
      fieldKey: c ? c.field.key : null,
      fieldLabel: c ? c.field.label : null,
      confidence: c ? c.score : 0,
      band: bandOf(c ? c.score : 0),
      reasons: c ? c.reasons : ['no canonical field matched this column'],
      observedShape: p.shape,
      fillRate: p.fillRate,
    };
  });

  const mappedKeys = new Set(mappings.map((m) => m.fieldKey).filter((k): k is string => k !== null));
  const missingRequired = entity
    ? entity.fields.filter((f) => f.required && !mappedKeys.has(f.key)).map((f) => f.label)
    : [];

  return {
    tableName: table.name,
    entityId: entity?.id ?? null,
    entityLabel: entity?.label ?? null,
    entityConfidence: Number(entityScore.toFixed(4)),
    entityBand: bandOf(entityScore),
    entityReasons: reasons.length > 0 ? reasons : ['no canonical entity matched this table'],
    mappings,
    missingRequired,
    unmappedColumns: mappings.filter((m) => m.fieldKey === null).map((m) => m.columnIndex),
  };
}
