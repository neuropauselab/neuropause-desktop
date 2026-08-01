/**
 * Phase 6 Stage 13 — the recorded-history view (G-4, temporal half).
 *
 * The single thing this file exists to prove is that Stage 13 computes no
 * trend. Every delta rendered here is Stage 12's, carried across field for
 * field; the tests below compare emitted rows against their source rows rather
 * than against expected numbers, so a smoothing, rounding or re-derivation step
 * introduced later cannot pass.
 *
 * The second lock is the null discipline that runs through the whole stage. A
 * decision window with a missing edge arrives with `from`/`to`/`delta` null and
 * must leave with them null — never zero, and never quietly re-labelled
 * `stable`. The same applies to the recorded-evidence footprint: an unreadable
 * history store reports null days, while a store that genuinely holds nothing
 * reports zero, because an observed zero is a reading and an absent one is not.
 *
 * Fixtures mirror the shapes `analyticsPlatform/trendAnalytics.ts` actually
 * emits, so the handoff being locked is the real one. Everything is literal and
 * no clock is read, so the file is deterministic.
 */
import { describe, expect, it } from 'vitest';
import type { EanaTrendReport, EanaTrendRow } from '@neuropause/shared';
import {
  buildHistoryView,
  HISTORY_DISCLOSURE,
  TRENDABLE_SERIES_IDS,
  twinHistoryIssues,
  type HistoryInput,
} from './twinHistory';
import { SERIES_REGISTRY } from './twinRegistry';

const NOW = '2026-08-01T09:00:00.000Z';
const WINDOW = '2026-05-03 → 2026-08-01 (91 recorded day(s))';

/* ── fixtures: the row shapes Stage 12 emits ──────────────────────────────── */

/** The two daily-history rows, in the shape `histRow()` composes them. */
const ORG_ROW: EanaTrendRow = {
  seriesId: 'org-health-history',
  label: 'Org health (90-day daily history)',
  kind: 'daily-history',
  windowLabel: WINDOW,
  from: 62,
  to: 71,
  delta: 9,
  direction: 'improving',
  detail: '62 → 71 (+9) over the recorded window (stable within ±2)',
};

const ENG_ROW: EanaTrendRow = {
  seriesId: 'engineering-health-history',
  label: 'Engineering health (90-day daily history)',
  kind: 'daily-history',
  windowLabel: WINDOW,
  from: 80,
  to: 74,
  delta: -6,
  direction: 'regressing',
  detail: '80 → 74 (-6) over the recorded window (stable within ±2)',
};

/** A measured decision window, per `decision:<id>:<label>`. */
const DECISION_MEASURED: EanaTrendRow = {
  seriesId: 'decision:dec-1:Support load',
  label: 'Consolidate vendors — Support load',
  kind: 'decision-window',
  windowLabel: 'the decision window (Stage 10, measured)',
  from: 55,
  to: 55,
  delta: 0,
  direction: 'stable',
  detail: '55 → 55 over the decision window',
};

/**
 * A decision window Stage 10 could only half-measure. Its three numeric fields
 * are null on arrival and every assertion below insists they stay null.
 */
const DECISION_HALF_MEASURED: EanaTrendRow = {
  seriesId: 'decision:dec-2:Delivery throughput',
  label: 'Freeze hiring — Delivery throughput',
  kind: 'decision-window',
  windowLabel: 'the decision window (Stage 10, measured)',
  from: null,
  to: null,
  delta: null,
  direction: 'unavailable',
  detail: 'a window edge is missing from the recorded history — declared, not interpolated',
};

/**
 * The bare-id row Stage 12 emits in place of the per-decision rows when the
 * Stage 10 value report is unreadable (trendAnalytics.ts:71-73), copied field
 * for field so the alternate satisfaction path is locked against the real
 * producer rather than an approximation of it.
 */
const DECISION_UNREADABLE: EanaTrendRow = {
  seriesId: 'decision-window-deltas',
  label: 'Decision-window value deltas (Stage 10)',
  kind: 'decision-window',
  windowLabel: 'unreadable',
  from: null,
  to: null,
  delta: null,
  direction: 'unavailable',
  detail: 'the Stage 10 value report was unreadable this pass',
};

/**
 * Stage 12 appends one point-in-time row per untrendable series, always with
 * `direction: 'unavailable'`. The second row here deliberately carries a
 * healthy direction — a shape Stage 12 does not currently produce — so that a
 * filter written against `direction` instead of `kind` would fail loudly.
 */
const POINT_IN_TIME: EanaTrendRow[] = [
  {
    seriesId: 'twin-overall-health',
    label: 'Twin overall health',
    kind: 'point-in-time',
    windowLabel: 'no recorded series',
    from: null,
    to: null,
    delta: null,
    direction: 'unavailable',
    detail: 'P15 computes overall health per read. A snapshot is not a trend.',
  },
  {
    seriesId: 'twin-domain-entities',
    label: 'Twin domain entity counts',
    kind: 'point-in-time',
    windowLabel: 'no recorded series',
    from: 40,
    to: 44,
    delta: 4,
    direction: 'improving',
    detail: 'a point-in-time row carrying a healthy direction — must be dropped on kind alone',
  },
];

const BASE_ROWS: EanaTrendRow[] = [
  ORG_ROW,
  ENG_ROW,
  DECISION_MEASURED,
  DECISION_HALF_MEASURED,
  ...POINT_IN_TIME,
];

function mkReport(rows: EanaTrendRow[] = BASE_ROWS): EanaTrendReport {
  return {
    generatedAt: '2026-08-01T08:59:00.000Z',
    rows,
    totals: {
      improving: rows.filter((r) => r.direction === 'improving').length,
      stable: rows.filter((r) => r.direction === 'stable').length,
      regressing: rows.filter((r) => r.direction === 'regressing').length,
      unavailable: rows.filter((r) => r.direction === 'unavailable').length,
    },
    disclosure: 'Stage 12 trend disclosure.',
    unavailable: [],
  };
}

function mkInput(over: Partial<HistoryInput> = {}): HistoryInput {
  return {
    nowIso: NOW,
    trends: mkReport(),
    recordedDays: 91,
    recordedDecisions: 4,
    failures: {},
    ...over,
  };
}

const RECORDED_KINDS = new Set(['daily-history', 'decision-window']);

/* ── the Stage 12 handoff ─────────────────────────────────────────────────── */

describe('every trendable series must survive the Stage 12 handoff', () => {
  it('takes its trendable list from the registry rather than a second hard-coded copy', () => {
    expect(TRENDABLE_SERIES_IDS).toEqual(SERIES_REGISTRY.filter((s) => s.trendable).map((s) => s.id));
    expect(TRENDABLE_SERIES_IDS).toEqual([
      'org-health-history',
      'engineering-health-history',
      'decision-window-deltas',
    ]);
  });

  it('reports no issue when the report could not be read — unreadable is not a mismatch', () => {
    expect(twinHistoryIssues(null)).toEqual([]);
  });

  it('reports no issue when all three series are represented', () => {
    expect(twinHistoryIssues(mkReport())).toEqual([]);
  });

  it('accepts per-decision rows as representing the decision series, without the bare id present', () => {
    const report = mkReport([ORG_ROW, ENG_ROW, DECISION_MEASURED, DECISION_HALF_MEASURED]);
    // The satisfaction is by kind: the literal series id appears nowhere.
    expect(report.rows.some((r) => r.seriesId === 'decision-window-deltas')).toBe(false);
    expect(twinHistoryIssues(report)).toEqual([]);
  });

  it('accepts the bare-id row Stage 12 emits when the Stage 10 value report is unreadable', () => {
    const report = mkReport([ORG_ROW, ENG_ROW, DECISION_UNREADABLE]);
    expect(twinHistoryIssues(report)).toEqual([]);
  });

  it('names exactly the series that went missing, and only that one', () => {
    const report = mkReport(BASE_ROWS.filter((r) => r.seriesId !== 'org-health-history'));
    expect(twinHistoryIssues(report)).toEqual([
      'trendable series org-health-history is absent from the Stage 12 trend report',
    ]);
  });

  it('names all three, in registry order, when the report carries no rows at all', () => {
    expect(twinHistoryIssues(mkReport([]))).toEqual(
      TRENDABLE_SERIES_IDS.map((id) => `trendable series ${id} is absent from the Stage 12 trend report`),
    );
  });

  it('does not let point-in-time rows stand in for a recorded series', () => {
    expect(twinHistoryIssues(mkReport(POINT_IN_TIME))).toHaveLength(3);
  });

  /**
   * FINDING — documented, and left strict on purpose.
   *
   * Stage 12 emits one decision-window row per recorded window, and a single
   * bare-id row when the Stage 10 value report is unreadable
   * (trendAnalytics.ts:71-73). It emits NOTHING when that report reads back an
   * empty list, so a system that has not yet governed a decision produces a
   * trend report with no decision-window row and `twinHistoryIssues()` reports
   * the series as absent.
   *
   * The report carries no marker separating "no window has been recorded yet"
   * from "Stage 12 stopped emitting this series", so Stage 13 cannot tell the
   * two apart from the input it is handed. Exempting the empty case would hide
   * a genuine Stage 12 regression whenever the decision store happened to be
   * empty, so the check stays strict and its behaviour is locked here rather
   * than quietly relaxed.
   */
  it('reports the decision series as absent when Stage 12 recorded no decision window at all', () => {
    expect(twinHistoryIssues(mkReport([ORG_ROW, ENG_ROW]))).toEqual([
      'trendable series decision-window-deltas is absent from the Stage 12 trend report',
    ]);
  });
});

/* ── the recorded rows ────────────────────────────────────────────────────── */

describe('the recorded rows are Stage 12’s, composed verbatim', () => {
  it('carries the daily-history and decision-window rows through in Stage 12’s order', () => {
    const view = buildHistoryView(mkInput());
    expect(view.rows.map((r) => r.seriesId)).toEqual([
      'org-health-history',
      'engineering-health-history',
      'decision:dec-1:Support load',
      'decision:dec-2:Delivery throughput',
    ]);
  });

  it('reproduces all nine fields of every carried row, field for field', () => {
    const view = buildHistoryView(mkInput());
    const source = BASE_ROWS.filter((r) => RECORDED_KINDS.has(r.kind));
    expect(view.rows).toHaveLength(source.length);
    view.rows.forEach((row, i) => {
      const from = source[i];
      expect(row.seriesId, `row#${i}`).toBe(from.seriesId);
      expect(row.label, `row#${i}`).toBe(from.label);
      expect(row.kind, `row#${i}`).toBe(from.kind);
      expect(row.windowLabel, `row#${i}`).toBe(from.windowLabel);
      expect(row.from, `row#${i}`).toBe(from.from);
      expect(row.to, `row#${i}`).toBe(from.to);
      expect(row.delta, `row#${i}`).toBe(from.delta);
      expect(row.direction, `row#${i}`).toBe(from.direction);
      expect(row.detail, `row#${i}`).toBe(from.detail);
    });
  });

  it('leaves a half-measured window null on all three numbers — never zero, never stable', () => {
    const row = buildHistoryView(mkInput()).rows.find(
      (r) => r.seriesId === 'decision:dec-2:Delivery throughput',
    )!;
    expect(row.from).toBeNull();
    expect(row.to).toBeNull();
    expect(row.delta).toBeNull();
    expect(row.direction).toBe('unavailable');
    expect(row.direction).not.toBe('stable');
  });

  it('keeps a measured zero delta as zero — an unchanged window is a reading', () => {
    const row = buildHistoryView(mkInput()).rows.find(
      (r) => r.seriesId === 'decision:dec-1:Support load',
    )!;
    expect(row.delta).toBe(0);
    expect(row.delta).not.toBeNull();
    expect(row.direction).toBe('stable');
  });

  it('drops Stage 12’s point-in-time rows on kind alone, whatever direction they carry', () => {
    const view = buildHistoryView(mkInput());
    for (const dropped of POINT_IN_TIME) {
      expect(view.rows.some((r) => r.seriesId === dropped.seriesId), dropped.seriesId).toBe(false);
    }
    // Including the one carrying a healthy direction — the filter is on kind.
    expect(view.rows.every((r) => RECORDED_KINDS.has(r.kind))).toBe(true);
  });

  it('counts directions over the rows it emitted, not over the report it was handed', () => {
    const view = buildHistoryView(mkInput());
    // Were the point-in-time rows counted, improving would be 2 and unavailable 2.
    expect(view.totals).toEqual({ improving: 1, stable: 1, regressing: 1, unavailable: 1 });
    const sum =
      view.totals.improving + view.totals.stable + view.totals.regressing + view.totals.unavailable;
    expect(sum).toBe(view.rows.length);
  });

  it('emits no rows and no fabricated stability when the trend report was unreadable', () => {
    const view = buildHistoryView(mkInput({ trends: null }));
    expect(view.rows).toEqual([]);
    expect(view.totals).toEqual({ improving: 0, stable: 0, regressing: 0, unavailable: 0 });
  });

  it('emits no rows when Stage 12 read cleanly but had only point-in-time rows to give', () => {
    const view = buildHistoryView(mkInput({ trends: mkReport(POINT_IN_TIME) }));
    expect(view.rows).toEqual([]);
    expect(view.totals.stable).toBe(0);
  });
});

/* ── what the platform does not record ────────────────────────────────────── */

describe('what the platform does not record is declared, never inferred', () => {
  it('declares every untrendable series the registry carries, in registry order', () => {
    const view = buildHistoryView(mkInput());
    expect(view.untrendable.map((u) => u.seriesId)).toEqual(
      SERIES_REGISTRY.filter((s) => !s.trendable).map((s) => s.id),
    );
    expect(view.untrendable.map((u) => u.seriesId)).toEqual([
      'twin-domain-entities',
      'twin-overall-health',
      'execution-sessions',
      'supervisor-recoveries',
    ]);
  });

  it('gives each one the registry’s own reason plus the snapshot sentence', () => {
    const view = buildHistoryView(mkInput());
    for (const def of SERIES_REGISTRY.filter((s) => !s.trendable)) {
      const row = view.untrendable.find((u) => u.seriesId === def.id)!;
      expect(row.label, def.id).toBe(def.label);
      expect(row.reason, def.id).toBe(`${def.detail} A snapshot is not a trend — declared, never inferred.`);
    }
  });

  it('declares them even on a fully blind pass — a missing input removes no declaration', () => {
    const blind = buildHistoryView(mkInput({ trends: null, recordedDays: null, recordedDecisions: null }));
    expect(blind.untrendable).toEqual(buildHistoryView(mkInput()).untrendable);
    expect(blind.untrendable).toHaveLength(4);
  });

  it('never lets an untrendable series appear as a trended row', () => {
    const view = buildHistoryView(mkInput());
    const declared = new Set(view.untrendable.map((u) => u.seriesId));
    for (const row of view.rows) expect(declared.has(row.seriesId), row.seriesId).toBe(false);
  });

  it('states in the disclosure that a per-read composition is declared, not turned into a series', () => {
    expect(HISTORY_DISCLOSURE).toContain('composed verbatim');
    expect(HISTORY_DISCLOSURE).toContain('no smoothing, extrapolation or prediction');
    expect(HISTORY_DISCLOSURE).toContain('declared untrendable');
    expect(HISTORY_DISCLOSURE).toContain('unavailable, never as stability');
  });
});

/* ── the recorded-evidence footprint ──────────────────────────────────────── */

describe('the recorded-evidence footprint distinguishes empty from unreadable', () => {
  it('carries both counts through unchanged', () => {
    const view = buildHistoryView(mkInput());
    expect(view.recordedDays).toBe(91);
    expect(view.recordedDecisions).toBe(4);
  });

  it('keeps an unreadable store null rather than reporting it as empty', () => {
    const view = buildHistoryView(mkInput({ recordedDays: null, recordedDecisions: null }));
    expect(view.recordedDays).toBeNull();
    expect(view.recordedDecisions).toBeNull();
    expect(view.recordedDays).not.toBe(0);
    expect(view.recordedDecisions).not.toBe(0);
  });

  it('keeps a genuinely empty store at zero rather than reporting it as unreadable', () => {
    const view = buildHistoryView(mkInput({ recordedDays: 0, recordedDecisions: 0 }));
    expect(view.recordedDays).toBe(0);
    expect(view.recordedDecisions).toBe(0);
    expect(view.recordedDays).not.toBeNull();
    expect(view.recordedDecisions).not.toBeNull();
  });

  it('lets one store be unreadable without disturbing the other', () => {
    const noDays = buildHistoryView(mkInput({ recordedDays: null }));
    expect(noDays.recordedDays).toBeNull();
    expect(noDays.recordedDecisions).toBe(4);

    const noDecisions = buildHistoryView(mkInput({ recordedDecisions: null }));
    expect(noDecisions.recordedDays).toBe(91);
    expect(noDecisions.recordedDecisions).toBeNull();
  });

  it('keeps the footprint independent of the trend report', () => {
    const view = buildHistoryView(mkInput({ trends: null }));
    expect(view.rows).toEqual([]);
    expect(view.recordedDays).toBe(91);
    expect(view.recordedDecisions).toBe(4);
  });
});

/* ── the view's own contract ──────────────────────────────────────────────── */

describe('the view’s own contract', () => {
  it('projects every failure it was handed as a declared unavailability', () => {
    const view = buildHistoryView(
      mkInput({
        trends: null,
        failures: { 's12-analytics': 'trend report threw', 'health-history': 'store not opened' },
      }),
    );
    expect(view.unavailable).toEqual([
      { system: 's12-analytics', reason: 'trend report threw' },
      { system: 'health-history', reason: 'store not opened' },
    ]);
  });

  it('reports no unavailability when every read succeeded', () => {
    expect(buildHistoryView(mkInput()).unavailable).toEqual([]);
  });

  it('stamps the caller’s time, not Stage 12’s', () => {
    const view = buildHistoryView(mkInput());
    expect(view.generatedAt).toBe(NOW);
    expect(view.generatedAt).not.toBe(mkReport().generatedAt);
  });

  it('carries the disclosure', () => {
    expect(buildHistoryView(mkInput()).disclosure).toBe(HISTORY_DISCLOSURE);
  });

  it('is deterministic — the same input composes byte-identical output', () => {
    expect(buildHistoryView(mkInput())).toEqual(buildHistoryView(mkInput()));
  });
});
