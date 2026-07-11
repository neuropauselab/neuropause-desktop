/**
 * AI Sandbox — Enterprise Scenario Runner (S3): dataset materialization.
 *
 * Turns a scenario's {@link EnterpriseDatasetRef} into concrete rows the runner feeds to
 * its steps — inline, CSV, JSON, deterministically generated, parameterized, or a
 * reference to EXISTING platform records. Datasets are still owned by S1's dataset store
 * (this only materializes + validates them); there is no second dataset store. Pure over
 * an injected platform + seed.
 */
import type { EnterpriseDatasetRef } from '@neuropause/shared';
import type { EnterprisePlatform } from './platform';

export interface MaterializedDataset {
  rows: Record<string, unknown>[];
  schema: string[];
  source: string;
  valid: boolean;
  errors: string[];
}

export async function materializeDataset(ref: EnterpriseDatasetRef, platform: EnterprisePlatform): Promise<MaterializedDataset> {
  let rows: Record<string, unknown>[] = [];
  switch (ref.source) {
    case 'inline':
      rows = (ref.rows ?? []).map((r) => ({ ...r }));
      break;
    case 'csv':
      rows = parseCsv(ref.raw ?? '');
      break;
    case 'json':
      rows = parseJsonRows(ref.raw ?? '[]');
      break;
    case 'generated':
      rows = generateRows(ref.generate ?? { count: 0 });
      break;
    case 'reference': {
      const list = ref.reference ? await platform.module.list(ref.reference.moduleId, ref.reference.query) : [];
      rows = list.map((rec) => ({ id: rec.id, ...rec.fields }));
      break;
    }
    default:
      rows = [];
  }

  // Parameterized data: merge scenario parameters into every row (row wins on conflict).
  if (ref.parameters && Object.keys(ref.parameters).length) {
    rows = rows.map((r) => ({ ...ref.parameters, ...r }));
  }

  const schema = deriveSchema(rows);
  const errors = validate(rows, ref.validate ?? []);
  return { rows, schema, source: ref.source, valid: errors.length === 0, errors };
}

/* ── CSV / JSON ── */
function parseCsv(raw: string): Record<string, unknown>[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      row[h] = coerce(cells[i] ?? '');
    });
    return row;
  });
}
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}
function parseJsonRows(raw: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
    return [];
  } catch {
    return [];
  }
}
function coerce(v: string): unknown {
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/* ── deterministic generation (seeded, no Math.random) ── */
function generateRows(gen: { count: number; template?: Record<string, unknown>; seed?: number }): Record<string, unknown>[] {
  const rng = mulberry32(gen.seed ?? 1);
  const template = gen.template ?? { name: 'Row {{index}}' };
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < gen.count; i += 1) {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) row[k] = expandToken(v, i, rng);
    rows.push(row);
  }
  return rows;
}
function expandToken(value: unknown, index: number, rng: () => number): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{([^}]+)\}\}/g, (_m, tok: string) => {
    const t = tok.trim();
    if (t === 'index') return String(index);
    if (t === 'index1') return String(index + 1);
    if (t.startsWith('random:')) return String(Math.floor(rng() * Number(t.slice(7) || '100')));
    if (t.startsWith('pick:')) {
      const opts = t.slice(5).split('|');
      return opts[Math.floor(rng() * opts.length)] ?? '';
    }
    if (t === 'id') return `gen-${index + 1}-${Math.floor(rng() * 1e6)}`;
    return '';
  });
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── schema + validation ── */
function deriveSchema(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  return [...keys];
}
function validate(rows: Record<string, unknown>[], required: string[]): string[] {
  const errors: string[] = [];
  if (required.length === 0) return errors;
  rows.forEach((row, i) => {
    for (const col of required) {
      if (!(col in row) || row[col] === undefined || row[col] === '') errors.push(`row ${i}: missing "${col}"`);
    }
  });
  return errors;
}
