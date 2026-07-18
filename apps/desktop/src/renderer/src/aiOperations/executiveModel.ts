/**
 * Executive AI — pure derivation for the AI Operating Platform "Executive AI" tab.
 *
 * The CEO-facing operating view: org health, KPIs, the daily briefing, and
 * strategic (evidence-backed) recommendations. Like every tab in this workspace it
 * adds NO runtime, IPC channel, engine, or store — `summarizeExecutive` is a PURE
 * function over data the renderer already fetched from EXISTING `ipc.*` methods:
 *
 *   - ipc.intelligence.executiveCenterSnapshot() → ExecutiveCenterSnapshot
 *       (org-health scores, KPI strip, ranked recommendations, executive summary)
 *   - ipc.intelligence.briefing(period)          → Briefing
 *       (daily briefing; carries a `grounded` flag — false ⇒ no data to brief on)
 *   - ipc.enterprise.dashboard()                 → ExecutiveSnapshot
 *       (executive aggregation: workforce / risk / recommendation counts)
 *
 * Authenticity is the dominant contract:
 *   • Every stat/row is read from a REAL field; empty sources surface an honest
 *     empty state, never a fabricated number.
 *   • The briefing's `grounded` flag is HONORED: when false we show an honest
 *     "insufficient data" state and read NONE of the briefing's content.
 *   • Capabilities the platform does not genuinely have (ML forecasting, calibrated
 *     confidence) are surfaced as labeled OpGaps, not invented values.
 *
 * The input shapes below mirror @neuropause/shared (executiveCenter / intelligence /
 * enterprise types) and `lib/ipc.ts`, but are a minimal, defensively-optional
 * subset so partial or absent payloads degrade gracefully rather than throwing.
 */
import {
  type OpStat,
  type OpRow,
  type OpGroup,
  type OpGap,
  type OpLink,
  type OpLens,
  type OpsTone,
  healthTone,
  riskTone,
  count,
  pctText,
} from './aiOperationsModel';

/* ─────────────────────────── Input shapes (minimal, optional) ─────────────────────────── */

/**
 * Subset of `ExecutiveCenterSnapshot` (ipc.intelligence.executiveCenterSnapshot()).
 * Empty until the executive module stores are populated.
 */
export interface ExecutiveCenterLike {
  /** `OrgHealthScores.overall` — a weighted **0..100** score (not a 0..1 ratio). */
  orgHealth?: { overall?: number | null } | null;
  /** `ExecutiveKpi[]` — counted only (KPI strip). */
  kpis?: readonly unknown[] | null;
  /** `ExecutiveRecommendation[]` — ranked, evidence-backed recommendations. */
  recommendations?: readonly unknown[] | null;
  /** `ExecutiveCard` of founder-produced items. */
  founderRecommendations?: { items?: readonly unknown[] | null } | null;
  /** `ExecutiveSummary` — one-glance highlights + composite 0..100 score. */
  executiveSummary?: {
    topOpportunity?: string | null;
    topRisk?: string | null;
    topRecommendation?: string | null;
    /** 0..100 composite executive score. */
    executiveScore?: number | null;
  } | null;
  /** Item counts by priority — the "what requires attention" glance. */
  attentionCounts?: { critical?: number; high?: number; normal?: number } | null;
}

/**
 * Subset of `Briefing` (ipc.intelligence.briefing()). The `grounded` flag is the
 * load-bearing field: `false` ⇒ there is no connected data to brief on.
 */
export interface BriefingLike {
  /** Honest empty flag — false/undefined ⇒ insufficient data for a grounded briefing. */
  grounded?: boolean;
  period?: string | null;
  /** Deterministic one-line summary. Only surfaced when `grounded === true`. */
  headline?: string | null;
  /** Total evidence references cited. Only surfaced when `grounded === true`. */
  evidenceCount?: number | null;
  /** Sections; each carries `empty` (true ⇒ no evidence in the period). */
  sections?: ReadonlyArray<{ empty?: boolean } | null | undefined> | null;
}

/**
 * Subset of `ExecutiveSnapshot` (ipc.enterprise.dashboard()) — the executive
 * aggregation. All counts are zero-until-real.
 */
export interface EnterpriseDashboardLike {
  workforce?: { total?: number; jobsRun?: number } | null;
  intelligence?: {
    recommendationCount?: number;
    grounded?: boolean;
    headline?: string | null;
  } | null;
  risk?: {
    level?: 'low' | 'elevated' | 'high';
    openFindings?: number;
    criticalFindings?: number;
  } | null;
}

/** The structural input `summarizeExecutive` derives from. Every field is optional. */
export interface ExecutiveInput {
  /** ipc.intelligence.executiveCenterSnapshot() */
  center?: ExecutiveCenterLike | null;
  /** ipc.intelligence.briefing(period) */
  briefing?: BriefingLike | null;
  /** ipc.enterprise.dashboard() */
  dashboard?: EnterpriseDashboardLike | null;
}

/* ─────────────────────────── Local helpers (pure) ─────────────────────────── */

/** Length of an array-ish value, guarding non-arrays (null/undefined ⇒ 0). */
function len(a: readonly unknown[] | null | undefined): number {
  return Array.isArray(a) ? a.length : 0;
}

/** True only for a real, finite number (rejects null/undefined/NaN/Infinity). */
function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Non-empty trimmed string, or null. Guards against surfacing blank real fields. */
function text(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  return t.length > 0 ? t : null;
}

/**
 * Tone for the enterprise risk band (a REAL discrete field, not a ratio):
 * high ⇒ red, elevated ⇒ orange, low ⇒ green, unknown ⇒ gray.
 */
function riskLevelTone(level: 'low' | 'elevated' | 'high' | undefined): OpsTone {
  if (level === 'high') return 'red';
  if (level === 'elevated') return 'orange';
  if (level === 'low') return 'green';
  return 'gray';
}

/** Qualitative band label for a 0..100 org-health score (mirrors shared `orgHealthBand`). */
function healthBandLabel(overall: number): string {
  if (overall >= 80) return 'healthy';
  if (overall >= 60) return 'watch';
  if (overall >= 40) return 'at-risk';
  return 'critical';
}

/* ─────────────────────────── Derivation ─────────────────────────── */

/**
 * Derive the view-ready Executive AI lens from already-fetched IPC data. Pure and
 * total: any subset of inputs (including none) yields a valid `OpLens` whose stats
 * and groups reflect only real fields, with honest gaps and deep-links always present.
 */
export function summarizeExecutive(input: ExecutiveInput = {}): OpLens {
  const center = input?.center ?? undefined;
  const briefing = input?.briefing ?? undefined;
  const dashboard = input?.dashboard ?? undefined;

  const stats: OpStat[] = [];
  const groups: OpGroup[] = [];

  // Org-health overall is a 0..100 score → convert to a 0..1 ratio for pctText/healthTone.
  const overall = center?.orgHealth?.overall;
  const hasHealth = isNum(overall);
  const health01 = hasHealth ? (overall as number) / 100 : Number.NaN;

  /* ── Stats (headline metrics, each backed by a real field) ── */
  if (hasHealth) {
    stats.push({
      icon: 'activity',
      label: 'Org health',
      value: pctText(health01),
      tone: healthTone(health01),
      hint: 'Weighted org-health score',
    });
  }
  if (center) {
    stats.push({ icon: 'analytics', label: 'KPIs tracked', value: count(len(center.kpis)) });
    stats.push({
      icon: 'lightbulb',
      label: 'Recommendations',
      value: count(len(center.recommendations)),
    });
  }
  if (dashboard?.workforce) {
    stats.push({
      icon: 'cpu',
      label: 'AI workers',
      value: count(dashboard.workforce.total),
      hint: 'Registered workers — zero until real',
    });
  }
  if (briefing) {
    if (briefing.grounded === true) {
      stats.push({
        icon: 'checklist',
        label: 'Briefing evidence',
        value: count(briefing.evidenceCount),
        tone: 'green',
      });
    } else {
      // Honor the grounded flag: no fabricated evidence number.
      stats.push({
        icon: 'checklist',
        label: 'Daily briefing',
        value: 'Insufficient data',
        tone: 'gray',
      });
    }
  }

  /* ── Group: Org health & KPIs (real) ── */
  const healthRows: OpRow[] = [];
  if (hasHealth) {
    healthRows.push({
      label: 'Overall org health',
      value: pctText(health01),
      tone: healthTone(health01),
      sub: healthBandLabel(overall as number),
    });
  }
  if (center) {
    healthRows.push({ label: 'KPIs tracked', value: count(len(center.kpis)) });

    const execScore = center.executiveSummary?.executiveScore;
    if (isNum(execScore)) {
      const score01 = execScore / 100;
      healthRows.push({
        label: 'Executive score',
        value: pctText(score01),
        tone: healthTone(score01),
        sub: 'composite — org health tempered by open risks',
      });
    }

    const ac = center.attentionCounts;
    if (ac) {
      const total = (ac.critical ?? 0) + (ac.high ?? 0) + (ac.normal ?? 0);
      const attnRatio = total > 0 ? ((ac.critical ?? 0) + (ac.high ?? 0)) / total : 0;
      healthRows.push({
        label: 'Needs attention',
        value: `${count(ac.critical)} critical · ${count(ac.high)} high`,
        tone: total > 0 ? riskTone(attnRatio) : 'gray',
        sub: `${count(ac.normal)} normal`,
      });
    }
  }
  if (dashboard?.workforce) {
    healthRows.push({
      label: 'AI workers',
      value: count(dashboard.workforce.total),
      sub: `${count(dashboard.workforce.jobsRun)} jobs run`,
    });
  }
  if (dashboard?.risk) {
    healthRows.push({
      label: 'Open risk findings',
      value: count(dashboard.risk.openFindings),
      tone: riskLevelTone(dashboard.risk.level),
      sub: `risk level: ${dashboard.risk.level ?? 'unknown'}`,
    });
  }
  if (healthRows.length > 0) {
    groups.push({ title: 'Org health & KPIs (real)', rows: healthRows });
  }

  /* ── Group: Daily briefing (honor the grounded flag) ── */
  if (briefing) {
    if (briefing.grounded === true) {
      const rows: OpRow[] = [];
      const headline = text(briefing.headline);
      if (headline) {
        rows.push({ label: 'Headline', value: headline, sub: text(briefing.period) ?? undefined });
      }
      rows.push({ label: 'Evidence cited', value: count(briefing.evidenceCount) });
      const sectionsWithContent = Array.isArray(briefing.sections)
        ? briefing.sections.filter((s) => s != null && s.empty === false).length
        : 0;
      rows.push({ label: 'Sections with content', value: count(sectionsWithContent) });
      groups.push({
        title: 'Daily briefing',
        rows,
        note: 'Grounded in real UDM + timeline evidence; every line cites its records.',
      });
    } else {
      // grounded === false (or missing): honest insufficient-data state.
      // Deliberately reads NONE of the briefing's headline/sections/evidence.
      groups.push({
        title: 'Daily briefing',
        rows: [
          {
            label: 'Status',
            value: 'Insufficient data',
            tone: 'gray',
            sub: 'No connected data to brief on',
          },
        ],
        note: 'Insufficient data for a grounded briefing — connect data sources to generate one.',
      });
    }
  }

  /* ── Group: Strategic recommendations (real, evidence-backed) ── */
  const recRows: OpRow[] = [];
  if (center) {
    recRows.push({ label: 'Ranked recommendations', value: count(len(center.recommendations)) });
    if (center.founderRecommendations) {
      recRows.push({
        label: 'Founder recommendations',
        value: count(len(center.founderRecommendations.items)),
      });
    }
    const topRec = text(center.executiveSummary?.topRecommendation);
    if (topRec) recRows.push({ label: 'Top recommendation', value: topRec });
    const topRisk = text(center.executiveSummary?.topRisk);
    if (topRisk) recRows.push({ label: 'Top risk', value: topRisk, tone: 'orange' });
    const topOpp = text(center.executiveSummary?.topOpportunity);
    if (topOpp) recRows.push({ label: 'Top opportunity', value: topOpp, tone: 'green' });
  }
  if (dashboard?.intelligence) {
    recRows.push({
      label: 'Enterprise recommendations',
      value: count(dashboard.intelligence.recommendationCount),
      sub: 'from executive dashboard aggregation',
    });
  }
  if (recRows.length > 0) {
    groups.push({
      title: 'Strategic recommendations (real, evidence-backed)',
      rows: recRows,
      note: 'Recommendations are evidence-backed; ranking confidence is heuristic (see gaps).',
    });
  }

  /* ── Gaps: genuine capability absences (always honest, never data-dependent) ── */
  const gaps: OpGap[] = [
    {
      capability: 'Business forecasting (ML)',
      requires:
        'a time-series/forecast model — today only deterministic trend extrapolation / fixed-coefficient what-if exists; label projections as such, never "forecast"',
    },
    {
      capability: 'Calibrated confidence',
      requires: 'a calibration model — confidence is heuristic',
    },
  ];

  /* ── Links: deep-links to the canonical existing surfaces (reuse, not duplicate) ── */
  const links: OpLink[] = [
    { label: 'Executive Center', section: 'enterprise' },
    { label: 'Intelligence', section: 'intelligence' },
    { label: 'Strategy', section: 'strategy-center' },
  ];

  return { stats, groups, gaps, links };
}
