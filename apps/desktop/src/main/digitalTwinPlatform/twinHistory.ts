/**
 * Phase 6 Stage 13 — the recorded-history view (G-4, temporal half).
 *
 * A twin that cannot say what changed is a snapshot. This view answers "what
 * changed?" WITHOUT re-deriving anything: Stage 12 already owns delta
 * computation over the recorded series, so Stage 13 takes the Stage 12 trend
 * report as an input and composes its recorded rows VERBATIM. Re-deriving them
 * here would duplicate logic another system owns.
 *
 * Stage 13 adds exactly two things Stage 12 has no reason to carry: the twin's
 * own untrendable declarations (P15 recomputes its domains and health per read,
 * and both runtime logs are in-memory), and the recorded-evidence footprint —
 * how many days of health history and how many decisions actually exist.
 *
 * Stage 12's own point-in-time rows are deliberately dropped: they declare
 * Stage 12's registry, not the twin's, and restating them here would double-
 * count the same honesty. Pure; reads injected.
 */
import type {
  EanaTrendReport,
  EtwinHistoryRow,
  EtwinHistoryView,
  EtwinUnavailable,
} from '@neuropause/shared';
import { SERIES_REGISTRY } from './twinRegistry';

export const HISTORY_DISCLOSURE =
  'Every delta here is Stage 12’s, composed verbatim — Stage 13 computes no trend and applies no smoothing, extrapolation or prediction. Only two series are recorded platform-wide (the daily health history and the governed decision windows); everything the twin composes per read is declared untrendable rather than turned into a fabricated series. A missing input is reported as unavailable, never as stability.';

export interface HistoryInput {
  nowIso: string;
  /** The Stage 12 trend report, composed verbatim; null when unreadable. */
  trends: EanaTrendReport | null;
  /** Recorded days in the health history store; null when unreadable. */
  recordedDays: number | null;
  /** Recorded decisions in the decision store; null when unreadable. */
  recordedDecisions: number | null;
  failures: Record<string, string>;
}

/**
 * The twin's own trendable series. Every one must appear in Stage 12's report —
 * `twinHistoryIssues()` asserts exactly that, so a Stage 12 registry change can
 * never silently drop a series out of the twin's history view.
 */
export const TRENDABLE_SERIES_IDS: readonly string[] = SERIES_REGISTRY.filter(
  (s) => s.trendable,
).map((s) => s.id);

/**
 * Integrity between the two stages: every series Stage 13 declares trendable
 * must be present in the Stage 12 report it composes. Returns [] when the
 * report is null (unreadable is not a mismatch) and when everything lines up.
 */
export function twinHistoryIssues(trends: EanaTrendReport | null): string[] {
  if (trends === null) return [];
  const issues: string[] = [];
  const seen = new Set(trends.rows.map((r) => r.seriesId));
  for (const id of TRENDABLE_SERIES_IDS) {
    // Decision-window rows are emitted per decision (`decision:<id>:<label>`)
    // when any exist, and under the bare series id when the input is
    // unreadable. Either form satisfies the series being represented.
    const present = id === 'decision-window-deltas' ? seen.has(id) || trends.rows.some((r) => r.kind === 'decision-window') : seen.has(id);
    if (!present) issues.push(`trendable series ${id} is absent from the Stage 12 trend report`);
  }
  return issues;
}

export function buildHistoryView(input: HistoryInput): EtwinHistoryView {
  const unavailable: EtwinUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));

  // Stage 12's recorded rows, carried through unchanged. The direction and kind
  // value sets are identical across the two stages, so nothing is remapped.
  const rows: EtwinHistoryRow[] =
    input.trends === null
      ? []
      : input.trends.rows
          .filter((r) => r.kind === 'daily-history' || r.kind === 'decision-window')
          .map((r) => ({
            seriesId: r.seriesId,
            label: r.label,
            kind: r.kind,
            windowLabel: r.windowLabel,
            from: r.from,
            to: r.to,
            delta: r.delta,
            direction: r.direction,
            detail: r.detail,
          }));

  return {
    generatedAt: input.nowIso,
    rows,
    totals: {
      improving: rows.filter((r) => r.direction === 'improving').length,
      stable: rows.filter((r) => r.direction === 'stable').length,
      regressing: rows.filter((r) => r.direction === 'regressing').length,
      unavailable: rows.filter((r) => r.direction === 'unavailable').length,
    },
    untrendable: SERIES_REGISTRY.filter((s) => !s.trendable).map((s) => ({
      seriesId: s.id,
      label: s.label,
      reason: `${s.detail} A snapshot is not a trend — declared, never inferred.`,
    })),
    recordedDays: input.recordedDays,
    recordedDecisions: input.recordedDecisions,
    disclosure: HISTORY_DISCLOSURE,
    unavailable,
  };
}
