/**
 * Phase 6 Stage 10 — the Enterprise Strategy Platform composition root.
 *
 * ONE new subsystem that COMPOSES what already exists — it owns no runtime, no
 * store, no scheduler, no executor, and no mutation surface:
 *
 *   - objectives (registry × live measures: KPIs, S9 SLAs, S6 domains),
 *   - the initiative portfolio (UDM projects, S8 playbooks, S9 services,
 *     governed decisions, mined processes — milestones are observable
 *     CONDITIONS, never dates),
 *   - business value (decision × outcome loop × measured health deltas —
 *     computed, never estimated; the platform records no currency),
 *   - executive planning (relative horizons; every focus item is the Stage 9
 *     Principle-C recommendation built through the SAME throwing guard),
 *   - the Enterprise Capability Map (the approved enhancement: twelve BUSINESS
 *     capabilities threaded through objectives, initiatives, KPIs, risks, and
 *     decision categories),
 *   - strategy health (themes + the five composed layers S6/S7/S8/S9/P14 —
 *     P14 is ONE injected input, never a duplicate) with the risk register
 *     (substantiated ONLY by live signals) and unit alignment,
 *   - the executive dashboard + the board report — everything computed per
 *     read (3 s TTL),
 *   - SIX read-only `estrat:*` IPC channels (RBAC `strategy:read` — the
 *     existing P14 read scope; fail-closed; zero mutation),
 *   - ONE `strategy-watch` delivery source (governed recommendation ITEMS —
 *     never actions),
 *   - the assistant's eleven strategy questions (in-process port; answers ride
 *     the existing 'intelligence' report kind).
 *
 * Electron-free by construction: every read is an injected port; a failing
 * port becomes an explicit unavailable entry, never a fabricated value.
 */
import {
  EmptyRequest,
  IpcChannel,
  type AssistantStructuredReport,
  type BoardReport,
  type BusinessValueReport,
  type CapabilityMapView,
  type InsightOutcomeStage,
  type IntelligenceItem,
  type IntelligenceSource,
  type ObjectivesReport,
  type PlanningReport,
  type PortfolioReport,
  type StrategyDashboard,
  type StrategyHealthView,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { buildBusinessValue, type OutcomeDecision } from './businessOutcome';
import { buildCapabilityMap } from './capabilityMap';
import { composeBoardReport, composeStrategyDashboard, type DashboardInputs } from './executiveDashboard';
import { buildPlanningReport } from './executivePlanning';
import { buildPortfolio } from './initiativePortfolio';
import { buildObjectivesReport } from './objectiveModel';
import { buildStrategyHealth } from './strategyHealth';
import { answerStrategyQuestion, resolveStrategyQuestion, type StrategyQuestionContext } from './strategyModel';
import { onWorkspaceSwitch } from '../tenancy/workspaceSwitchHub';
import { TenantMemo } from '../tenancy/tenantMemo';
import type { TenantScope } from '@neuropause/shared';

const log = createLogger('strategy-platform');

const BUILD_TTL_MS = 3_000;

/* ── deps (every read injected; all sync — Stage 10 composes, never fetches) ─ */

export interface StrategyPlatformDeps {
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
  /** Stage 6 slices: domain bands, the overall band, the outcome loop. */
  insightDomains: () => { key: string; band: string; score: number | null }[] | null;
  insightOverallBand: () => string | null;
  /** Open incidents WITH domain attribution — wired from the Stage 9 incident
   *  lifecycle view (which composes the Stage 6 incidents verbatim). */
  insightIncidents: () => { domain: string | null; severity: string }[] | null;
  insightOutcomes: () => { id: string; stage: InsightOutcomeStage }[] | null;
  /** The six live executive KPI producers. */
  executiveKpis: () => { key: string; label: string; display: string; band?: string }[];
  /** Stage 9 slices (the operations platform's own composed views). */
  slaStatuses: () => { targetId: string; status: 'met' | 'breached' | 'unmeasurable'; detail: string }[];
  readiness: () => { key: string; state: string; detail: string; missing: string[] }[];
  s9Services: () => { serviceId: string; state: string; stateDetail: string }[];
  capacityPressure: () => 'low' | 'elevated' | 'high' | 'unknown';
  /** Stage 8 slices. */
  playbooks: () => { id: string; version: number }[];
  apFindings: () => { kind: string; severity: string }[] | null;
  /** Stage 7 slices. */
  knowledgeTotals: () => { assets: number; findings: number } | null;
  knowledgeMatch: ((refs: string[]) => { ref: string; matched: boolean }[]) | null;
  /** P14 — the platform Strategy Center composed as ONE input (D-5). */
  p14Overview: () => { goalsOnTrack: number; goalsTotal: number; healthBand: string } | null;
  /** Governed records + live org. */
  decisions: () => OutcomeDecision[];
  projects: () => { id: string; title: string; syncState: string; status: string | null }[];
  minedTypes: () => string[] | null;
  compliance: () => { status: string }[] | null;
  units: () => { id: string; name: string; leadUserId: string | null }[];
  users: () => { id: string; name: string }[];
  /** The EXISTING 90-day daily history (value windows read it; never written). */
  healthHistory: () => { day: string; overall: number; engineering: number }[];
  registerSource: (source: IntelligenceSource) => void;
  now?: () => number;
}

export interface StrategyPlatformSubsystem {
  handlers: SecureHandlerDef[];
  objectives: () => ObjectivesReport;
  portfolio: () => PortfolioReport;
  value: () => BusinessValueReport;
  planning: () => PlanningReport;
  capabilityMap: () => CapabilityMapView;
  health: () => StrategyHealthView;
  dashboard: () => StrategyDashboard;
  boardReport: () => BoardReport;
  /** Assistant port: answer one of the eleven strategy questions, or null. */
  answerQuestion: (text: string, nowIso: string) => AssistantStructuredReport | null;
  dispose: () => void;
}

interface BuildArtifacts {
  at: number;
  nowIso: string;
  objectives: ObjectivesReport;
  portfolio: PortfolioReport;
  value: BusinessValueReport;
  planning: PlanningReport;
  capabilities: CapabilityMapView;
  health: StrategyHealthView;
  dashboard: StrategyDashboard;
  board: BoardReport;
}

function safeRead<T>(system: string, fn: () => T, failures: Record<string, string>): T | null {
  try {
    return fn();
  } catch (err) {
    failures[system] = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/** The subset of recorded failures relevant to one view (dashboard dedups). */
function pick(failures: Record<string, string>, systems: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of systems) {
    const v = failures[s];
    if (v !== undefined) out[s] = v;
  }
  return out;
}

export function initStrategyPlatform(deps: StrategyPlatformDeps): StrategyPlatformSubsystem {
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
  const projectionCache = new TenantMemo<BuildArtifacts>('strategy-platform-projections', { ttlMs: BUILD_TTL_MS, now })
    .bindScope(deps.scope);

  const build = (): BuildArtifacts => projectionCache.state(compose);

  const compose = (): BuildArtifacts => {
    const nowMs = now();
    const nowIso = new Date(nowMs).toISOString();
    const failures: Record<string, string> = {};

    const domains = safeRead('insight-domains', deps.insightDomains, failures);
    const overallBand = safeRead('insight-overall', deps.insightOverallBand, failures);
    const incidents = safeRead('insight-incidents', deps.insightIncidents, failures);
    const outcomes = safeRead('insight-outcomes', deps.insightOutcomes, failures);
    const kpisRaw = safeRead('executive-kpis', deps.executiveKpis, failures);
    const slaStatuses = safeRead('sla-framework', deps.slaStatuses, failures);
    const readiness = safeRead('readiness', deps.readiness, failures);
    const s9Services = safeRead('service-catalog', deps.s9Services, failures);
    const capacityPressure = safeRead('capacity', deps.capacityPressure, failures);
    const playbooks = safeRead('automation-playbooks', deps.playbooks, failures);
    const apFindings = safeRead('automation-monitor', () => deps.apFindings(), failures);
    const knowledge = safeRead('knowledge', () => deps.knowledgeTotals(), failures);
    const p14 = safeRead('p14-strategy', () => deps.p14Overview(), failures);
    const decisions = safeRead('decisions', deps.decisions, failures);
    const projects = safeRead('udm-projects', deps.projects, failures);
    const minedTypes = safeRead('process-mining', () => deps.minedTypes(), failures);
    const compliance = safeRead('governance-compliance', () => deps.compliance(), failures);
    const units = safeRead('organization', deps.units, failures);
    const users = safeRead('org-users', deps.users, failures);
    const history = safeRead('health-history', deps.healthHistory, failures);
    // Probe the Stage 7 standards join once so a broken join is declared
    // UP FRONT (in this pass's failure map), not discovered mid-view.
    safeRead('knowledge-standards', () => (deps.knowledgeMatch ? deps.knowledgeMatch(['sop']) : null), failures);

    const kpis = kpisRaw ? kpisRaw.map((k) => ({ key: k.key, band: k.band ?? null, display: k.display })) : null;
    const kpiCards = kpisRaw ? kpisRaw.map((k) => ({ key: k.key, label: k.label, display: k.display, band: k.band ?? null })) : [];
    const decisionSlices = decisions ? decisions.map((d) => ({ id: d.id, category: d.category, status: d.status })) : null;

    const objectives = buildObjectivesReport({
      nowIso,
      signals: { kpis, slaStatuses, domains },
      units,
      users,
      failures: pick(failures, ['executive-kpis', 'sla-framework', 'insight-domains', 'organization', 'org-users']),
    });

    const portfolio = buildPortfolio({
      nowIso,
      signals: {
        slaStatuses,
        readiness,
        kpis,
        apFindings,
        playbooks,
        s9Services,
        projects,
        decisions: decisionSlices,
        minedTypes,
      },
      units,
      users,
      failures: pick(failures, [
        'sla-framework',
        'readiness',
        'automation-monitor',
        'automation-playbooks',
        'service-catalog',
        'udm-projects',
        'decisions',
        'process-mining',
      ]),
    });

    const value = buildBusinessValue({
      nowIso,
      decisions,
      outcomes,
      history,
      failures: pick(failures, ['decisions', 'insight-outcomes', 'health-history']),
    });

    // The Stage 7 join stays defensive per call: a mid-pass throw records the
    // failure (surfacing in health + dashboard) and reads as unmatched.
    const knowledgeMatch =
      deps.knowledgeMatch === null
        ? null
        : (refs: string[]): { ref: string; matched: boolean }[] => {
            try {
              return deps.knowledgeMatch!(refs);
            } catch (err) {
              failures['knowledge-standards'] = err instanceof Error ? err.message : String(err);
              return refs.map((ref) => ({ ref, matched: false }));
            }
          };

    const capabilities = buildCapabilityMap({
      nowIso,
      signals: {
        domains,
        kpis,
        s9Services,
        readiness,
        minedTypes,
        compliance,
        slaStatuses,
        apFindings,
        decisions: decisions ? decisions.map((d) => ({ category: d.category, status: d.status })) : null,
      },
      objectives: [...objectives.company, ...objectives.departments].map((o) => ({
        id: o.id,
        capabilityKeys: o.capabilityKeys,
        health: o.health,
      })),
      initiatives: portfolio.initiatives.map((i) => ({ id: i.id, capabilityKeys: i.capabilityKeys, state: i.state })),
      units,
      users,
      knowledgeMatch,
      failures: pick(failures, [
        'insight-domains',
        'executive-kpis',
        'service-catalog',
        'readiness',
        'process-mining',
        'governance-compliance',
        'sla-framework',
        'automation-monitor',
        'decisions',
        'knowledge-standards',
      ]),
    });

    const readinessMisses = readiness
      ? readiness.filter((d) => d.state !== 'ready').map((d) => ({ key: d.key, state: d.state, missing: d.missing }))
      : null;
    const planning = buildPlanningReport({
      nowMs,
      nowIso,
      objectives,
      portfolio,
      signals: { capacityPressure, readinessMisses },
      failures: pick(failures, ['capacity', 'readiness']),
    });

    const operationsTotals = readiness
      ? {
          ready: readiness.filter((d) => d.state === 'ready').length,
          notReady: readiness.filter((d) => d.state === 'not-ready' || d.state === 'degraded').length,
          unknown: readiness.filter((d) => d.state === 'unknown').length,
        }
      : null;
    const automationTotals = apFindings
      ? {
          criticalFindings: apFindings.filter((f) => f.severity === 'critical' || f.severity === 'high').length,
          totalFindings: apFindings.length,
        }
      : null;
    const health = buildStrategyHealth({
      nowIso,
      objectives,
      capabilities,
      layers: { insightBand: overallBand, knowledge, automation: automationTotals, operations: operationsTotals, p14 },
      risks: { slaStatuses, readiness, apFindings, incidentDomains: incidents },
      units,
      failures: pick(failures, [
        'insight-overall',
        'insight-incidents',
        'knowledge',
        'knowledge-standards',
        'automation-monitor',
        'readiness',
        'sla-framework',
        'p14-strategy',
        'organization',
      ]),
    });

    const dashInputs: DashboardInputs = { nowIso, objectives, portfolio, value, planning, capabilities, health, kpis: kpiCards };
    const dashboard = composeStrategyDashboard(dashInputs);
    const board = composeBoardReport(dashInputs);

    return { at: nowMs, nowIso, objectives, portfolio, value, planning, capabilities, health, dashboard, board };
  };

  /* ── the assistant port (eleven questions; sync; same composed views) ────── */
  const answerQuestion = (text: string, nowIso: string): AssistantStructuredReport | null => {
    const key = resolveStrategyQuestion(text);
    if (!key) return null;
    const b = build();
    const ctx: StrategyQuestionContext = {
      objectives: b.objectives,
      portfolio: b.portfolio,
      value: b.value,
      planning: b.planning,
      capabilities: b.capabilities,
      health: b.health,
      dashboard: b.dashboard,
      board: b.board,
      nowIso,
    };
    return answerStrategyQuestion(key, ctx);
  };

  /* ── monitoring: ONE governed watch source (items only, never actions) ──── */
  const deliveredWatch = new Set<string>();
  const watchSource: IntelligenceSource = {
    key: 'strategy-watch',
    label: 'Strategy Watch',
    cadence: { kind: 'daily', atMinutes: 9 * 60 },
    produce: async (): Promise<IntelligenceItem[]> => {
      const b = build();
      const items: IntelligenceItem[] = [];
      for (const r of b.dashboard.recommendations) {
        if (r.priority !== 'critical' && r.priority !== 'high') continue;
        if (deliveredWatch.has(r.id)) continue;
        deliveredWatch.add(r.id);
        items.push({
          id: `estrat:${r.id}`,
          title: r.title,
          body: `${r.detail} Suggested: ${r.suggestedAction}`,
          priority: r.priority === 'critical' ? 'critical' : 'high',
          impact: { business: 0.7, urgency: r.priority === 'critical' ? 0.8 : 0.6, confidence: r.confidence },
          deepLink: 'strategy',
          producedAt: new Date(now()).toISOString(),
          governance: {
            evidence: r.evidence.slice(0, 8),
            sourceSystems: r.affectedSystems.length > 0 ? r.affectedSystems : ['strategy-platform'],
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

  /* ── the six read-only IPC channels (D-9; strategy:read, fail-closed) ────── */
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
      channel: IpcChannel.EstratObjectives,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'strategy:read',
      handler: () => build().objectives,
    },
    {
      channel: IpcChannel.EstratPortfolio,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'strategy:read',
      handler: () => ({ portfolio: build().portfolio, value: build().value }),
    },
    {
      channel: IpcChannel.EstratPlanning,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'strategy:read',
      handler: () => build().planning,
    },
    {
      channel: IpcChannel.EstratHealth,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'strategy:read',
      handler: () => build().health,
    },
    {
      channel: IpcChannel.EstratDashboard,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'strategy:read',
      handler: () => build().dashboard,
    },
    {
      channel: IpcChannel.EstratReport,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'strategy:read',
      handler: () => build().board,
    },
  ];

  log.info('Enterprise Strategy Platform ready', { channels: handlers.length, sources: 1 });

  return {
    handlers,
    objectives: () => build().objectives,
    portfolio: () => build().portfolio,
    value: () => build().value,
    planning: () => build().planning,
    capabilityMap: () => build().capabilities,
    health: () => build().health,
    dashboard: () => build().dashboard,
    boardReport: () => build().board,
    answerQuestion,
    dispose: () => {
      projectionCache.invalidate();
    },
  };
}
