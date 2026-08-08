/**
 * Phase 6 — Universal Enterprise Data Plane: value normalization + shape detection.
 *
 * Two rules govern everything here:
 *   1. Every transformation is RECORDED, never silent. The caller keeps the
 *      original value so provenance can show "₹25,000 → 25000 INR".
 *   2. A value that cannot be normalized with confidence is REJECTED, not
 *      coerced. Guessing at a number is how bad financial data gets imported.
 */
import type { CellValue } from './parsers';
import type { FieldType } from './ontology';

export type ValueShape = 'email' | 'phone' | 'date' | 'money' | 'number' | 'code' | 'url' | 'text' | 'empty';

/** Normalize a header for synonym comparison: lower-case, alphanumeric words. */
export function normalizeHeader(header: string): string {
  return header
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // splits camelCase / PascalCase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function headerTokens(header: string): string[] {
  return normalizeHeader(header).split(' ').filter((t) => t.length > 0);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
const PHONE_RE = /^\+?[(\d][\d\s\-().]{5,}$/;
const CODE_RE = /^[A-Z0-9][A-Z0-9._/-]{1,}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?$/;
const SLASH_DATE_RE = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/;

/** Currency symbols and codes we recognize when normalizing money. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  '₹': 'INR',
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
};
const CURRENCY_CODES = new Set(['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SGD', 'AED', 'ZAR']);

export interface MoneyValue {
  amount: number;
  currency: string | null;
}

/**
 * Parse a money-ish string. Handles symbols, ISO codes, thousands separators,
 * trailing minus and accounting parentheses. Returns null when the text is not
 * unambiguously numeric — we never "best effort" a financial amount.
 */
export function parseMoney(raw: string): MoneyValue | null {
  let s = raw.trim();
  if (s === '') return null;

  let currency: string | null = null;
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (s.includes(symbol)) {
      currency = code;
      s = s.split(symbol).join('');
    }
  }
  const codeMatch = /\b([A-Z]{3})\b/.exec(s);
  if (codeMatch && codeMatch[1] && CURRENCY_CODES.has(codeMatch[1])) {
    currency = currency ?? codeMatch[1];
    s = s.replace(codeMatch[1], '');
  }

  let negative = false;
  s = s.trim();
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/\s/g, '');
  // Reject anything that still carries non-numeric characters beyond separators.
  if (!/^[-+]?[\d,]*\.?\d+$/.test(s)) return null;
  const numeric = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return { amount: negative ? -Math.abs(numeric) : numeric, currency };
}

/** Parse a date into an ISO `YYYY-MM-DD`. Ambiguous D/M vs M/D is resolved conservatively. */
export function parseDateValue(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return null;
  if (ISO_DATE_RE.test(s)) return s.slice(0, 10);

  const m = SLASH_DATE_RE.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    let year: number;
    let month: number;
    let day: number;
    if (String(m[1]).length === 4) {
      year = a;
      month = b;
      day = c;
    } else {
      year = c < 100 ? 2000 + c : c;
      // Ambiguous when both are <= 12. Prefer day-first (the majority world
      // convention) and let the quality report surface the ambiguity.
      if (a > 12) {
        day = a;
        month = b;
      } else if (b > 12) {
        month = a;
        day = b;
      } else {
        day = a;
        month = b;
      }
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== month - 1) return null;
    return d.toISOString().slice(0, 10);
  }

  // Textual months, e.g. "12 Mar 2026" / "Mar 12, 2026".
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed) && /[A-Za-z]{3}/.test(s)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

/** Classify the shape of a single value. */
export function shapeOf(value: CellValue): ValueShape {
  if (value === null) return 'empty';
  if (typeof value === 'boolean') return 'text';
  if (typeof value === 'number') return 'number';
  const s = value.trim();
  if (s === '') return 'empty';
  if (EMAIL_RE.test(s)) return 'email';
  if (URL_RE.test(s)) return 'url';
  if (ISO_DATE_RE.test(s) || SLASH_DATE_RE.test(s)) return 'date';
  // Phone is tested BEFORE money: "+91 98200 11111" strips to a valid number,
  // so a naive money-first order silently classifies phone columns as numeric.
  // A phone must carry a '+' prefix or a separator — that is what distinguishes
  // it from a bare quantity like 1234567.
  const digitCount = (s.match(/\d/g) ?? []).length;
  if (
    PHONE_RE.test(s) &&
    digitCount >= 7 &&
    digitCount <= 15 &&
    (s.startsWith('+') || /[\s\-().]/.test(s))
  ) {
    return 'phone';
  }
  if (parseMoney(s) !== null) {
    return /[₹$€£¥]|\b(INR|USD|EUR|GBP|JPY)\b|[,.]\d{2}$/.test(s) ? 'money' : 'number';
  }
  if (s.length <= 32 && CODE_RE.test(s) && /\d/.test(s)) return 'code';
  return 'text';
}

/** The dominant shape across a column's sample, with the share that agreed. */
export function columnShape(values: readonly CellValue[]): { shape: ValueShape; share: number; filled: number } {
  const counts = new Map<ValueShape, number>();
  let filled = 0;
  for (const v of values) {
    const s = shapeOf(v);
    if (s === 'empty') continue;
    filled += 1;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  if (filled === 0) return { shape: 'empty', share: 0, filled: 0 };
  let best: ValueShape = 'text';
  let bestN = 0;
  for (const [shape, n] of counts) {
    if (n > bestN) {
      best = shape;
      bestN = n;
    }
  }
  return { shape: best, share: bestN / filled, filled };
}

export interface NormalizedValue {
  /** The value to store, or null when it could not be normalized. */
  value: CellValue;
  /** True when the stored value differs from the input. */
  transformed: boolean;
  /** Human-readable description of the transformation, for provenance. */
  note: string | null;
  /** Set when the value is present but unusable for the target type. */
  error: string | null;
  /** Currency detected while normalizing a money value. */
  currency?: string;
}

const OK: NormalizedValue = { value: null, transformed: false, note: null, error: null };

/**
 * Normalize one cell for a target field type, recording what changed.
 * Empty stays empty — absence is not an error here; requiredness is checked
 * separately by the quality engine.
 */
export function normalizeValue(raw: CellValue, type: FieldType): NormalizedValue {
  if (raw === null) return { ...OK };
  if (typeof raw === 'string' && raw.trim() === '') return { ...OK };

  if (type === 'number') {
    if (typeof raw === 'number') return { value: raw, transformed: false, note: null, error: null };
    if (typeof raw === 'boolean') return { value: null, transformed: false, note: null, error: 'Boolean is not a number.' };
    const money = parseMoney(raw);
    if (money === null) return { value: null, transformed: false, note: null, error: `"${truncate(raw)}" is not a number.` };
    const note = `"${truncate(raw)}" → ${money.amount}${money.currency ? ` ${money.currency}` : ''}`;
    const out: NormalizedValue = {
      value: money.amount,
      transformed: true,
      note,
      error: null,
    };
    if (money.currency) out.currency = money.currency;
    return out;
  }

  if (type === 'date') {
    if (typeof raw === 'number') {
      // Already-serial dates are converted at parse time; a bare number here is ambiguous.
      return { value: null, transformed: false, note: null, error: `${raw} is not a recognizable date.` };
    }
    const s = String(raw);
    const iso = parseDateValue(s);
    if (iso === null) return { value: null, transformed: false, note: null, error: `"${truncate(s)}" is not a recognizable date.` };
    return { value: iso, transformed: iso !== s, note: iso !== s ? `"${truncate(s)}" → ${iso}` : null, error: null };
  }

  if (type === 'boolean') {
    if (typeof raw === 'boolean') return { value: raw, transformed: false, note: null, error: null };
    const s = String(raw).trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(s)) return { value: true, transformed: true, note: `"${truncate(s)}" → true`, error: null };
    if (['false', 'no', 'n', '0'].includes(s)) return { value: false, transformed: true, note: `"${truncate(s)}" → false`, error: null };
    return { value: null, transformed: false, note: null, error: `"${truncate(s)}" is not a yes/no value.` };
  }

  // text
  const s = typeof raw === 'string' ? raw : String(raw);
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return {
    value: trimmed,
    transformed: trimmed !== s,
    note: trimmed !== s ? 'whitespace normalized' : null,
    error: null,
  };
}

function truncate(s: string, max = 40): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** Company-name canonical form for duplicate detection ("Pvt Ltd" ≡ "Private Limited"). */
const LEGAL_SUFFIXES: readonly (readonly [RegExp, string])[] = [
  [/\bprivate\s+limited\b/g, 'pvt ltd'],
  [/\bpvt\.?\s*ltd\.?\b/g, 'pvt ltd'],
  [/\blimited\b/g, 'ltd'],
  [/\bincorporated\b/g, 'inc'],
  [/\bcorporation\b/g, 'corp'],
  [/\bcompany\b/g, 'co'],
  [/\bllp\b/g, 'llp'],
];

export function canonicalName(raw: string): string {
  let s = raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, to] of LEGAL_SUFFIXES) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}
