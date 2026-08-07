/**
 * HR → OKRs — the pure objectives-and-key-results engine (Final Wave FW-11).
 *
 * One record = one objective for one owner in one quarter, with 1–12
 * measurable key results carried as a JSON array (the BOM / bank-lines
 * convention): [{"kr":"Ship onboarding v2","target":100,"current":40,"unit":"%"}].
 *
 * Progress is ARITHMETIC, never opinion: each key result contributes
 * min(current / target, 1) — over-achievement is real but one KR can never
 * carry another past its own 100% — and the objective's overall progress is
 * the equal-weighted mean, rounded to a whole percent. The record lifecycle
 * is human-driven (draft → active → closed); check-ins are ordinary edits of
 * an ACTIVE objective whose currents move, with progress re-derived at
 * validate. Closed objectives are period history — immutable.
 *
 * Pure (no I/O) so the module hooks and tests share it.
 */

export const OKRS_MODULE_ID = 'hr-okrs';
export const OKR_KIND = 'okr';

/** Bounds on how many key results one objective may carry. */
export const MAX_KEY_RESULTS = 12;

/** One measurable key result. */
export interface KeyResult {
  kr: string;
  target: number;
  current: number;
  unit: string;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** Parse a strict YYYY-Qn period key; null when invalid. */
export function parseOkrPeriod(value: unknown): { year: number; quarter: number } | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(str(value).trim());
  if (!m) return null;
  return { year: Number(m[1]), quarter: Number(m[2]) };
}

export type ParsedKeyResults = { ok: true; keyResults: KeyResult[] } | { ok: false; error: string };

/** Parse and guard the key-results JSON — every failure names its fix. */
export function parseKeyResults(json: string): ParsedKeyResults {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Key results must be a JSON array — e.g. [{"kr":"Ship v2","target":100,"current":40}].' };
  }
  if (!Array.isArray(raw)) return { ok: false, error: 'Key results must be a JSON ARRAY of objects.' };
  if (raw.length === 0) return { ok: false, error: 'An objective needs at least one key result.' };
  if (raw.length > MAX_KEY_RESULTS) {
    return { ok: false, error: `An objective carries at most ${MAX_KEY_RESULTS} key results — split the objective instead.` };
  }
  const keyResults: KeyResult[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown>;
    const kr = str(item?.kr).trim();
    if (!kr) return { ok: false, error: `Key result ${i + 1}: "kr" (the measurable statement) is required.` };
    const target = num(item?.target);
    if (!Number.isFinite(target) || target <= 0) {
      return { ok: false, error: `Key result ${i + 1}: "target" must be a number greater than zero.` };
    }
    const current = item?.current === undefined ? 0 : num(item?.current);
    if (!Number.isFinite(current) || current < 0) {
      return { ok: false, error: `Key result ${i + 1}: "current" must be zero or a positive number.` };
    }
    keyResults.push({ kr, target, current, unit: str(item?.unit).trim() });
  }
  return { ok: true, keyResults };
}

/** The derived progress figures for one objective. */
export interface OkrProgress {
  /** Per key result, capped 0–100 (whole percent). */
  perKeyResult: number[];
  /** Equal-weighted mean of the capped figures (whole percent). */
  overall: number;
  /** Key results at or past their target. */
  achievedCount: number;
}

/** Derive progress — capped per KR, equal-weighted overall, whole percents. */
export function okrProgress(keyResults: ReadonlyArray<KeyResult>): OkrProgress {
  if (keyResults.length === 0) return { perKeyResult: [], overall: 0, achievedCount: 0 };
  const perKeyResult = keyResults.map((k) => Math.round(Math.min(Math.max(k.current, 0) / k.target, 1) * 100));
  const overall = Math.round(perKeyResult.reduce((s, p) => s + p, 0) / perKeyResult.length);
  const achievedCount = keyResults.filter((k) => k.current >= k.target).length;
  return { perKeyResult, overall, achievedCount };
}
