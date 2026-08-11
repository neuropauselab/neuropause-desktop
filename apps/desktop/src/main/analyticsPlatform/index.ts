/**
 * Phase 6 Stage 12 — the Enterprise Analytics Platform composition root.
 *
 * ONE new subsystem that COMPOSES the analytics the repository already
 * computes — it owns no engine, no store, no scheduler, no executor, and no
 * mutation surface:
 *
 *   - the unified KPI catalog (every reachable feed, source-attributed,
 *     producers authoritative),
 *   - deterministic trends over RECORDED windows (the 90-day history + the
 *     Stage 10 decision windows; point-in-time series declared untrendable),
 *   - the forecast inventory (registers existing predictive capability with
 *     what it can and cannot predict; adds zero forecasting),
 *   - the decision-intelligence rollup (store × outcome loop × Stage 10
 *     value verdicts × the sync recommendation inventories),
 *   - the cross-domain executive analytics dashboard + report (stage
 *     dashboards composed as pre-built slices; P18 benchmarks as ONE input),
 *   - SIX read-only `eana:*` IPC channels (RBAC `intelligence:read` — the
 *     existing S6 read scope; fail-closed; zero mutation),
 *   - ONE `analytics-watch` delivery source (governed recommendation ITEMS —
 *     never actions),
 *   - the assistant's ten analytics questions (in-process port; answers ride
 *     the existing 'intelligence' report kind).
 *
 * Electron-free by construction: every read is an injected port; a failing
 * port becomes an explicit unavailable entry, never a fabricated value.
 */
import {
  EmptyRequest,
  IpcChannel,
  type AssistantStructuredReport,
  type EanaDashboard,
  type EanaDecisionReport,
  type EanaDomainRollup,
  type EanaForecastInventory,
  type EanaKpiCatalog,
  type EanaReport,
  type EanaTrendReport,
  type IntelligenceItem,
  type IntelligenceSource,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { buildDecisionReport } from './decisionAnalytics';
import { composeAnalyticsDashboard, composeAnalyticsReport, type EanaDashboardInputs } from './executiveAnalytics';
import { buildForecastInventory } from './forecastInventory';
import { buildKpiCatalog } from './kpiCatalog';
import { answerAnalyticsQuestion, resolveAnalyticsQuestion, type AnalyticsQuestionContext } from './analyticsModel';
import { buildTrendReport } from './trendAnalytics';
import { onWorkspaceSwitch } from '../tenancy/workspaceSwitchHub';
import { TenantMemo } from '../tenancy/tenantMemo';
import type { TenantScope } from '@neuropause/shared';

const log = createLogger('analytics-platform');

const BUILD_TTL_MS = 3_000;

/* ── deps (every read injected; all sync — Stage 12 composes, never computes) ─ */

export interface AnalyticsPlatformDeps {
  /**
   * P13C ROUND 5 — the tenant boundary for this subsystem's composed cache.
   *
   * INJECTED, not imported. `enterprise/index` reaches `app.getPath`, so
   * importing `activeTenantScope` here drags Electron into a pure-model node
   * test — a trap this program has now fallen into FOUR times, once per round.
   * Worth stating as a rule rather than a note: a subsystem that unit-tests
   * without Electron takes its resolver as a dep.
   *
   * Required, so a composition root that forgets it fails to compile.
   */
  scope: () => TenantScope | null;
  /** The KPI feeds (producers authoritative; the snapshot already aggregates). */
  executiveKpis: () => { key: string; label: string; display: string; value: number | null; band?: string }[];
  processKpis: () => { key: string; label: string; display: string; value: number | null; band?: string }[] | null;
  p14Kpis: () => { key: string; label: string; display: string; value: number | null; band?: string }[] | null;
  p18Kpis: () => { key: string; label: string; display: string; value: number | null; band?: string }[] | null;
  /** The recorded series. */
  healthHistory: () => { day: string; overall: number; engineering: number }[];
  valueDeltas: () => { decisionId: string; title: string; deltas: { label: string; before: number | null; after: number | null }[] }[];
  valueTotals: () => { delivered: number; partial: number; notYetObserved: number; unmeasurable: number };
  /** Existing predictive capability (joined, never extended). */
  insightPredictions: () => { kind: string; likelihood: number }[];
  p14Simulation: () => { scenarios: number } | null;
  capacityPressure: () => string;
  /** Decision intelligence sources. */
  decisions: () => { id: string; status: string; fromRecommendationId: string | null }[];
  insightOutcomes: () => { id: string; stage: string }[];
  strategyRecs: () => { count: number; criticalOrHigh: number } | null;
  federationRecs: () => { count: number; criticalOrHigh: number } | null;
  /** The four stage-dashboard rollup slices (pre-composed; no logic duplicated). */
  s8Monitor: () => { findings: number; criticalOrHigh: number } | null;
  s9Slices: () => { slaTargets: number; slaMet: number; slaBreached: number; readinessReady: number; readinessNotReady: number } | null;
  s10Totals: () => { offTrack: number; atRisk: number; blocked: number } | null;
  s11Totals: () => { partners: number; declaredAboveEvidence: number } | null;
  /** The P18 sanitized benchmark posture, composed as ONE input. */
  p18Benchmark: () => { position: string; healthBand: string } | null;
  registerSource: (source: IntelligenceSource) => void;
  now?: () => number;
}

export interface AnalyticsPlatformSubsystem {
  handlers: SecureHandlerDef[];
  kpis: () => EanaKpiCatalog;
  trends: () => EanaTrendReport;
  forecasts: () => EanaForecastInventory;
  decisions: () => EanaDecisionReport;
  dashboard: () => EanaDashboard;
  report: () => EanaReport;
  /** Assistant port: answer one of the ten analytics questions, or null. */
  answerQuestion: (text: string, nowIso: string) => AssistantStructuredReport | null;
  dispose: () => void;
}

interface BuildArtifacts {
  at: number;
  nowIso: string;
  kpis: EanaKpiCatalog;
  trends: EanaTrendReport;
  forecasts: EanaForecastInventory;
  decisions: EanaDecisionReport;
  dashboard: EanaDashboard;
  report: EanaReport;
}

function safeRead<T>(system: string, fn: () => T, failures: Record<string, string>): T | null {
  try {
    return fn();
  } catch (err) {
    failures[system] = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/** The subset of recorded failures relevant to one view (the dashboard dedups). */
function pick(failures: Record<string, string>, systems: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of systems) {
    const v = failures[s];
    if (v !== undefined) out[s] = v;
  }
  return out;
}

export function initAnalyticsPlatform(deps: AnalyticsPlatformDeps): AnalyticsPlatformSubsystem {
  const now = deps.now ?? ((): number => Date.now());
  /**
   * P13C ROUND 5 — KEYED BY TENANT.
   *
   * `let cache: BuildArtifacts | null` behind a short TTL, flushed on
   * `onWorkspaceSwitch`. That listener cannot see the case this program has
   * documented twice already: `deliveryEngine.tick()` runs `forEachTenant`, so
   * each tenant's `produce()` fills the cache back to back with NO SWITCH
   * ANNOUNCED, and an interactive read from another tenant inside the TTL is
   * served the composed dashboard of whoever ran last.
   *
   * Round 3 fixed eleven services of this shape by name and Round 4 fixed a
   * twelfth; these seven were the remainder. Keying rather than adding a second
   * listener, because the key covers the fan-out and the listener does not.
   */
  const projectionCache = new TenantMemo<BuildArtifacts>('analytics-platform-projections', { ttlMs: BUILD_TTL_MS, now })
    .bindScope(deps.scope);

  const build = (): BuildArtifacts => projectionCache.state(compose);

  const compose = (): BuildArtifacts => {
    const nowMs = now();
    const nowIso = new Date(nowMs).toISOString();
    const failures: Record<string, string> = {};

    const executive = safeRead('executive-kpis', deps.executiveKpis, failures);
    const process = safeRead('process-kpis', () => deps.processKpis(), failures);
    const p14 = safeRead('p14-kpis', () => deps.p14Kpis(), failures);
    const p18 = safeRead('p18-kpis', () => deps.p18Kpis(), failures);
    const history = safeRead('health-history', deps.healthHistory, failures);
    const valueDeltas = safeRead('s10-value', deps.valueDeltas, failures);
    const valueTotals = safeRead('s10-value-totals', deps.valueTotals, failures);
    const predictions = safeRead('insight-predictions', deps.insightPredictions, failures);
    const simulation = safeRead('p14-simulation', () => deps.p14Simulation(), failures);
    const capacityPressure = safeRead('capacity', deps.capacityPressure, failures);
    const decisionRecords = safeRead('decisions', deps.decisions, failures);
    const outcomes = safeRead('insight-outcomes', deps.insightOutcomes, failures);
    const strategyRecs = safeRead('s10-recommendations', () => deps.strategyRecs(), failures);
    const federationRecs = safeRead('s11-recommendations', () => deps.federationRecs(), failures);
    const s8 = safeRead('s8-monitor', () => deps.s8Monitor(), failures);
    const s9 = safeRead('s9-slices', () => deps.s9Slices(), failures);
    const s10 = safeRead('s10-totals', () => deps.s10Totals(), failures);
    const s11 = safeRead('s11-totals', () => deps.s11Totals(), failures);
    const benchmarks = safeRead('p18-benchmarks', () => deps.p18Benchmark(), failures);

    const kpis = buildKpiCatalog({
      nowIso,
      executive,
      process,
      p14,
      p18,
      failures: pick(failures, ['executive-kpis', 'process-kpis', 'p14-kpis', 'p18-kpis']),
    });

    const trends = buildTrendReport({
      nowIso,
      history,
      valueDeltas,
      failures: pick(failures, ['health-history', 's10-value']),
    });

    const forecasts = buildForecastInventory({
      nowIso,
      predictions,
      simulation,
      capacityPressure,
      failures: pick(failures, ['insight-predictions', 'p14-simulation', 'capacity']),
    });

    const decisions = buildDecisionReport({
      nowIso,
      decisions: decisionRecords,
      outcomes,
      valueTotals,
      strategyRecs,
      federationRecs,
      failures: pick(failures, ['decisions', 'insight-outcomes', 's10-value-totals', 's10-recommendations', 's11-recommendations']),
    });

    // Domain rollups from the PRE-COMPOSED slices — one line each, no
    // dashboard logic duplicated, unreadable slices declared unknown.
    const domains: EanaDomainRollup[] = [
      {
        stage: 's8',
        label: 'Automation (Stage 8)',
        state: s8 === null ? 'unknown' : s8.criticalOrHigh > 0 ? 'attention' : 'steady',
        summary: s8 === null ? 'monitor unreadable this pass' : `${s8.criticalOrHigh} critical/high of ${s8.findings} monitor finding(s)`,
      },
      {
        stage: 's9',
        label: 'Operations (Stage 9)',
        state: s9 === null ? 'unknown' : s9.slaBreached > 0 || s9.readinessNotReady > 0 ? 'attention' : 'steady',
        summary:
          s9 === null
            ? 'operations slices unreadable this pass'
            : `SLA ${s9.slaMet}/${s9.slaTargets} met (${s9.slaBreached} breached) · readiness ${s9.readinessReady} ready / ${s9.readinessNotReady} not-ready`,
      },
      {
        stage: 's10',
        label: 'Strategy (Stage 10)',
        state: s10 === null ? 'unknown' : s10.offTrack + s10.blocked > 0 ? 'attention' : s10.atRisk > 0 ? 'attention' : 'steady',
        summary: s10 === null ? 'strategy dashboard unreadable this pass' : `${s10.offTrack} objective(s) off-track · ${s10.atRisk} at-risk · ${s10.blocked} initiative(s) blocked`,
      },
      {
        stage: 's11',
        label: 'Federation (Stage 11)',
        state: s11 === null ? 'unknown' : s11.declaredAboveEvidence > 0 ? 'attention' : 'steady',
        summary: s11 === null ? 'federation dashboard unreadable this pass' : `${s11.partners} partner(s) · ${s11.declaredAboveEvidence} trust divergence(s) (declared above evidence)`,
      },
    ];

    const dashInputs: EanaDashboardInputs = { nowIso, kpis, trends, forecasts, decisions, domains, benchmarks };
    const dashboard = composeAnalyticsDashboard(dashInputs);
    // Root-level reads no component picks still declare their misses here.
    for (const [system, reason] of Object.entries(pick(failures, ['p18-benchmarks', 's8-monitor', 's9-slices', 's10-totals', 's11-totals']))) {
      if (!dashboard.unavailable.some((u) => u.system === system)) dashboard.unavailable.push({ system, reason });
    }
    const reportView = composeAnalyticsReport(dashInputs);

    return { at: nowMs, nowIso, kpis, trends, forecasts, decisions, dashboard, report: reportView };
  };

  /* ── the assistant port (ten questions; sync; same composed pass) ────────── */
  const answerQuestion = (text: string, nowIso: string): AssistantStructuredReport | null => {
    const key = resolveAnalyticsQuestion(text);
    if (!key) return null;
    const b = build();
    const ctx: AnalyticsQuestionContext = {
      kpis: b.kpis,
      trends: b.trends,
      forecasts: b.forecasts,
      decisions: b.decisions,
      dashboard: b.dashboard,
      report: b.report,
      nowIso,
    };
    return answerAnalyticsQuestion(key, ctx);
  };

  /* ── monitoring: ONE governed watch source (items only, never actions) ──── */
  const deliveredWatch = new Set<string>();
  const watchSource: IntelligenceSource = {
    key: 'analytics-watch',
    label: 'Analytics Watch',
    cadence: { kind: 'daily', atMinutes: 9 * 60 + 30 },
    produce: async (): Promise<IntelligenceItem[]> => {
      const b = build();
      const items: IntelligenceItem[] = [];
      for (const r of b.dashboard.recommendations) {
        if (r.priority !== 'critical' && r.priority !== 'high') continue;
        if (deliveredWatch.has(r.id)) continue;
        deliveredWatch.add(r.id);
        items.push({
          id: `eana:${r.id}`,
          title: r.title,
          body: `${r.detail} Suggested: ${r.suggestedAction}`,
          priority: r.priority === 'critical' ? 'critical' : 'high',
          impact: { business: 0.6, urgency: r.priority === 'critical' ? 0.8 : 0.6, confidence: r.confidence },
          deepLink: 'intelligence',
          producedAt: new Date(now()).toISOString(),
          governance: {
            evidence: r.evidence.slice(0, 8),
            sourceSystems: r.affectedSystems.length > 0 ? r.affectedSystems : ['analytics-platform'],
            confidence: r.confidence,
            reasoning: r.reasoning,
            recommendedAction: r.suggestedAction,
          },
        });
      }
      return items;
    },
  };
  deps.registerSource(watchSource);

  /* ── the six read-only IPC channels (D-9; intelligence:read, fail-closed) ── */
  /**
   * P13C Round 2 — H7. DROP THE TENANT-DERIVED SNAPSHOT ON A TENANT SWITCH.
   *
   * This cache holds a fully composed, tenant-derived read model behind a short
   * TTL, and it was cleared only in `dispose()`. Switching organization changes
   * none of the backing stores this subsystem watches, so the memo survived the
   * switch — and the renderer's reload after a switch lands INSIDE the TTL.
   * Opening a dashboard right after switching is the single most common
   * multi-tenant action there is, so the window was not theoretical.
   *
   * Registered on the same residue seam every other subsystem uses, rather than
   * a second invalidation mechanism.
   */
  onWorkspaceSwitch(() => {
    projectionCache.invalidate();
  });

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.EanaKpis,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: () => build().kpis,
    },
    {
      channel: IpcChannel.EanaTrends,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: () => build().trends,
    },
    {
      channel: IpcChannel.EanaForecasts,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: () => build().forecasts,
    },
    {
      channel: IpcChannel.EanaDecisions,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: () => build().decisions,
    },
    {
      channel: IpcChannel.EanaDashboard,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: () => build().dashboard,
    },
    {
      channel: IpcChannel.EanaReport,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: () => build().report,
    },
  ];

  log.info('Enterprise Analytics Platform ready', { channels: handlers.length, sources: 1 });

  return {
    handlers,
    kpis: () => build().kpis,
    trends: () => build().trends,
    forecasts: () => build().forecasts,
    decisions: () => build().decisions,
    dashboard: () => build().dashboard,
    report: () => build().report,
    answerQuestion,
    dispose: () => {
      projectionCache.invalidate();
    },
  };
}
