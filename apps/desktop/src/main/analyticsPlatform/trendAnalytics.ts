/**
 * Phase 6 Stage 12 — deterministic trend composition (D-4).
 *
 * Compares RECORDED values only: the 90-day daily health history (the one long
 * series the platform keeps) and the Stage 10 decision-window deltas. Every
 * point-in-time composition in the series registry gets an honest
 * `unavailable` row saying no recorded series exists — the trend view never
 * turns a snapshot into a trend. Direction is a fixed deterministic rule
 * (|delta| ≤ STABLE_EPSILON → stable), never extrapolation, smoothing, or
 * prediction. Pure; reads injected.
 */
import type { EanaTrendDirection, EanaTrendReport, EanaTrendRow, EanaUnavailable } from '@neuropause/shared';
import { SERIES_REGISTRY } from './analyticsRegistry';

export const TREND_DISCLOSURE =
  'Trends compare recorded values over recorded windows — deterministic deltas with a fixed stability threshold. No extrapolation, no smoothing, no prediction; series the platform does not record are declared unavailable, never inferred.';

/** |delta| at or under this reads as stable (health scores are 0–100). */
export const STABLE_EPSILON = 1;

export interface TrendInput {
  nowIso: string;
  /** The recorded daily history (day 'YYYY-MM-DD', overall, engineering). */
  history: { day: string; overall: number; engineering: number }[] | null;
  /** Stage 10 decision-window deltas, composed verbatim. */
  valueDeltas:
    | { decisionId: string; title: string; deltas: { label: string; before: number | null; after: number | null }[] }[]
    | null;
  failures: Record<string, string>;
}

export function directionFor(from: number | null, to: number | null): { direction: EanaTrendDirection; delta: number | null } {
  if (from === null || to === null) return { direction: 'unavailable', delta: null };
  const delta = to - from;
  if (Math.abs(delta) <= STABLE_EPSILON) return { direction: 'stable', delta };
  return { direction: delta > 0 ? 'improving' : 'regressing', delta };
}

export function buildTrendReport(input: TrendInput): EanaTrendReport {
  const unavailable: EanaUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));
  const rows: EanaTrendRow[] = [];

  const sorted = input.history === null ? null : [...input.history].sort((a, b) => (a.day < b.day ? -1 : 1));
  const first = sorted?.at(0) ?? null;
  const last = sorted?.at(-1) ?? null;
  const windowLabel = first && last ? `${first.day} → ${last.day} (${sorted!.length} recorded day(s))` : 'no recorded window';

  const histRow = (seriesId: string, label: string, from: number | null, to: number | null): EanaTrendRow => {
    if (input.history === null) {
      return { seriesId, label, kind: 'daily-history', windowLabel: 'history unreadable', from: null, to: null, delta: null, direction: 'unavailable', detail: 'the health history store was unreadable this pass' };
    }
    if (!first || !last || sorted!.length < 2) {
      return { seriesId, label, kind: 'daily-history', windowLabel, from: from ?? null, to: to ?? null, delta: null, direction: 'unavailable', detail: `only ${sorted!.length} recorded point(s) — a trend needs at least two` };
    }
    const d = directionFor(from, to);
    return {
      seriesId,
      label,
      kind: 'daily-history',
      windowLabel,
      from,
      to,
      delta: d.delta,
      direction: d.direction,
      detail: `${from} → ${to} (${d.delta !== null && d.delta >= 0 ? '+' : ''}${d.delta}) over the recorded window (stable within ±${STABLE_EPSILON})`,
    };
  };
  rows.push(histRow('org-health-history', 'Org health (90-day daily history)', first?.overall ?? null, last?.overall ?? null));
  rows.push(histRow('engineering-health-history', 'Engineering health (90-day daily history)', first?.engineering ?? null, last?.engineering ?? null));

  if (input.valueDeltas === null) {
    rows.push({ seriesId: 'decision-window-deltas', label: 'Decision-window value deltas (Stage 10)', kind: 'decision-window', windowLabel: 'unreadable', from: null, to: null, delta: null, direction: 'unavailable', detail: 'the Stage 10 value report was unreadable this pass' });
  } else {
    for (const v of input.valueDeltas) {
      for (const delta of v.deltas) {
        const d = directionFor(delta.before, delta.after);
        rows.push({
          seriesId: `decision:${v.decisionId}:${delta.label}`,
          label: `${v.title} — ${delta.label}`,
          kind: 'decision-window',
          windowLabel: 'the decision window (Stage 10, measured)',
          from: delta.before,
          to: delta.after,
          delta: d.delta,
          direction: d.direction,
          detail:
            d.direction === 'unavailable'
              ? 'a window edge is missing from the recorded history — declared, not interpolated'
              : `${delta.before} → ${delta.after} over the decision window`,
        });
      }
    }
  }

  // Every point-in-time series is DECLARED untrendable — the registry says
  // which is which, and the trend view repeats it instead of inventing series.
  for (const s of SERIES_REGISTRY.filter((x) => x.kind === 'point-in-time')) {
    rows.push({
      seriesId: s.id,
      label: s.label,
      kind: 'point-in-time',
      windowLabel: 'no recorded series',
      from: null,
      to: null,
      delta: null,
      direction: 'unavailable',
      detail: `${s.detail} A snapshot is not a trend — declared, never inferred.`,
    });
  }

  return {
    generatedAt: input.nowIso,
    rows,
    totals: {
      improving: rows.filter((r) => r.direction === 'improving').length,
      stable: rows.filter((r) => r.direction === 'stable').length,
      regressing: rows.filter((r) => r.direction === 'regressing').length,
      unavailable: rows.filter((r) => r.direction === 'unavailable').length,
    },
    disclosure: TREND_DISCLOSURE,
    unavailable,
  };
}
