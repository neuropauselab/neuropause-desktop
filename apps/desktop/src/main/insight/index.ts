/**
 * Phase 6 Stage 6 — the Enterprise Intelligence Layer composition root.
 *
 * ONE new subsystem that COMPOSES what already exists — it owns no engine, no
 * store, no scheduler, and no executor:
 *
 *   - projects the operational signals (jobs / executions / automation runs /
 *     connectors / conversations / projects) into the EXISTING P7 pure engines
 *     via `composeEnterpriseIntelligence` (`extraNodes`/`extraEdges`/`events`),
 *   - composes the eight-domain health framework, deterministic predictions,
 *     the Intelligence Dependency Graph, the Confidence Breakdown, and the
 *     outcome lifecycle (all pure modules in this folder),
 *   - exposes FIVE read-only `insight:*` IPC channels (RBAC `intelligence:read`,
 *     the P7 precedent) with a 3 s TTL cache,
 *   - registers two delivery-engine sources (`insight-monitor`,
 *     `insight-risk-trend`) that produce governed recommendation ITEMS through
 *     the existing gates — they never dispatch anything,
 *   - publishes the additive `insight.*` timeline events, edge-triggered, one
 *     `ins_…` correlation id per chain,
 *   - answers the ten enterprise questions for the assistant (in-process port —
 *     execution stays behind the assistant's existing approval flow).
 *
 * Electron-free by construction: every read is an injected port; a failing
 * port becomes an explicit unavailable entry, never a fabricated value.
 */
import {
  analyzeRootCause,
  buildEnterpriseGraph,
  composeEnterpriseIntelligence,
  EmptyRequest,
  EnterpriseIntelRootCauseRequest,
  IpcChannel,
  type AssistantStructuredReport,
  type AutomationRule,
  type AutomationRunRecord,
  type ConnectorDto,
  type CorrelationEvent,
  type EnterpriseIntelligenceReport,
  type ExecutionSession,
  type InsightDashboard,
  type InsightReport,
  type InsightUnavailable,
  type IntelligenceItem,
  type IntelligenceSource,
  type Job,
  type OrgHealthScores,
  type RelationshipGraphModel,
  type ResourceGraphModel,
  type RootCauseReport,
  type UnifiedEntity,
  type WorkforceHealthSummary,
  type EnterpriseIntelRootCauseRequest as TRootCauseReq,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { toCorrelationEvent, type RawTimelineEvent } from '../enterprise/intelligence/enterpriseIntelligenceSubsystem';
import { projectSignals, type ProjectionInput } from './signalProjection';
import { composeHealthFramework } from './healthFramework';
import { buildPredictions } from './predictions';
import { onWorkspaceSwitch } from '../tenancy/workspaceSwitchHub';
import {
  answerInsightQuestion,
  buildDependencyGraph,
  composeDashboard,
  composeRecommendations,
  reportConfidence,
  resolveInsightQuestion,
  toIncidentView,
  type OutcomeJoins,
  type QuestionContext,
} from './insightModel';
import { TenantMemo } from '../tenancy/tenantMemo';
import type { TenantScope } from '@neuropause/shared';

const log = createLogger('insight');

const REPORT_TTL_MS = 3_000;
const EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const TIMELINE_READ_LIMIT = 5_000;
const MONITOR_INTERVAL_MS = 15 * 60 * 1000;
const MAX_VERIFIED_LOG = 50;

/* ── deps (every read injected; sync reads only) ──────────────────────────── */

export interface InsightSubsystemDeps {
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
  /** Same graph ports P7 uses (passed through from the composition root). */
  getResourceModel: () => ResourceGraphModel | null;
  getRelationshipModel: () => RelationshipGraphModel | null;
  /** Timeline read (same port shape P7 uses). */
  getEvents: (sinceIso: string, limit: number) => RawTimelineEvent[];
  /* — operational signal reads — */
  entities: () => UnifiedEntity[];
  jobs: () => Job[];
  executions: () => ExecutionSession[];
  automationRuns: () => AutomationRunRecord[];
  automationRules: () => Pick<AutomationRule, 'id' | 'name' | 'status' | 'trigger' | 'actions'>[];
  connectors: () => ConnectorDto[];
  workers: () => { id: string; name: string; role: string }[];
  /** Late-bound (assistant initializes after insight); null until wired. */
  conversations: () => { id: string; title: string; updatedAt: string; waitingSteps: number }[] | null;
  /** Late-bound (notifications initialize after insight); null until wired. */
  inbox: () => { id: string; sourceKey: string; at: string; read: boolean }[] | null;
  /* — health framework reads (existing computations, composed not recomputed) — */
  orgHealth: () => OrgHealthScores | null;
  orgUnits: () => { units: number; leadershipCoverage: number | null } | null;
  workforceHealth: () => WorkforceHealthSummary | null;
  systemHealth: () => { score: number; level: string } | null;
  automationMonitor: () => { completed: number; failed: number; paused: number; running: number } | null;
  /** The EXISTING 90-day daily health history (oldest first). */
  healthHistory: () => { day: string; overall: number; engineering: number }[];
  /* — outcome joins — */
  decisions: () => { id: string; fromRecommendationId: string | null; status: string; updatedAt: string }[];
  /* — platform — */
  publish: (event: {
    type: string;
    category: string;
    source: string;
    priority?: string;
    metadata?: Record<string, string | number | boolean | null>;
    correlationId?: string;
  }) => void;
  /** Register a delivery-engine source (the EXISTING engine; idempotent by key). */
  registerSource: (source: IntelligenceSource) => void;
  now?: () => number;
}

export interface InsightSubsystem {
  handlers: SecureHandlerDef[];
  /** The composed Stage 6 report (cached ~3 s). */
  report: () => InsightReport;
  /** The executive dashboard composition (6.11). */
  dashboard: () => InsightDashboard;
  /** Assistant port: answer one of the ten questions, or null if unmatched. */
  answerQuestion: (text: string, nowIso: string) => AssistantStructuredReport | null;
  dispose: () => void;
}

interface BuildArtifacts {
  at: number;
  report: InsightReport;
  engine: EnterpriseIntelligenceReport;
  /** Inputs to rebuild the graph for targeted root-cause runs (P7 pattern). */
  graphInput: {
    resource: ResourceGraphModel | null;
    relationship: RelationshipGraphModel | null;
    extraNodes: ReturnType<typeof projectSignals>['extraNodes'];
    extraEdges: ReturnType<typeof projectSignals>['extraEdges'];
  };
  events: CorrelationEvent[];
  rawTimeline: RawTimelineEvent[];
}

function safeRead<T>(
  system: string,
  fn: () => T,
  failures: Record<string, string>,
): T | null {
  try {
    return fn();
  } catch (err) {
    failures[system] = err instanceof Error ? err.message : String(err);
    return null;
  }
}

export function initInsight(deps: InsightSubsystemDeps): InsightSubsystem {
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
  const projectionCache = new TenantMemo<BuildArtifacts>('insight-projections', { ttlMs: REPORT_TTL_MS, now })
    .bindScope(deps.scope);
  /* edge-trigger state for insight.* events + the verification loop */
  const seenIncidents = new Set<string>();
  const seenRecommendations = new Map<string, string>(); // id → title
  const approvalRequested = new Set<string>();
  const verifiedLog: { id: string; title: string; at: string }[] = [];
  let firstBuild = true;

  const build = (): BuildArtifacts => projectionCache.state(compose);

  const compose = (): BuildArtifacts => {
    const nowMs = now();
    const nowIso = new Date(nowMs).toISOString();
    const failures: Record<string, string> = {};
    const unavailable: InsightUnavailable[] = [];

    /* ── 1. raw reads (isolated per source) ─────────────────────────────── */
    const resource = safeRead('resource-graph', deps.getResourceModel, failures);
    const relationship = safeRead('relationship-graph', deps.getRelationshipModel, failures);
    const rawTimeline =
      safeRead('timeline-events', () => deps.getEvents(new Date(nowMs - 7 * 86_400_000).toISOString(), TIMELINE_READ_LIMIT), failures) ?? [];
    const entities = safeRead('work-entities', deps.entities, failures);
    const jobs = safeRead('workforce-jobs', deps.jobs, failures);
    const executions = safeRead('executions', deps.executions, failures);
    const automationRuns = safeRead('automation-runs', deps.automationRuns, failures);
    const automationRules = safeRead('automation-runs', deps.automationRules, failures);
    const connectors = safeRead('connector-health', deps.connectors, failures);
    const workers = safeRead('workforce-jobs', deps.workers, failures) ?? [];
    const conversations = safeRead('assistant-conversations', deps.conversations, failures);
    const inbox = safeRead('notification-inbox', deps.inbox, failures);

    if (failures['timeline-events']) unavailable.push({ system: 'timeline-events', reason: failures['timeline-events'] });

    /* ── 2. projection into the P7 engine shapes ────────────────────────── */
    const projectionInput: ProjectionInput = {
      nowMs,
      entities,
      jobs,
      executions,
      automationRuns,
      automationRules,
      connectors,
      conversations,
      inbox,
      workers,
      failures,
    };
    const projection = projectSignals(projectionInput);
    unavailable.push(...projection.unavailable);

    /* ── 3. the EXISTING engines over base + projected inputs ───────────── */
    const windowStart = nowMs - EVENT_WINDOW_MS;
    const baseEvents = rawTimeline
      .map(toCorrelationEvent)
      .filter((e) => e.ts >= windowStart);
    const events = [...baseEvents, ...projection.events];
    const engine = composeEnterpriseIntelligence(
      {
        resource,
        relationship,
        extraNodes: projection.extraNodes,
        extraEdges: projection.extraEdges,
        events,
      },
      nowMs,
    );

    /* ── 4. composed intelligence (all pure) ────────────────────────────── */
    const healthHistory = safeRead('org-health', deps.healthHistory, failures) ?? [];
    const historyDays = healthHistory.length;

    const weekAgo = nowMs - 7 * 86_400_000;
    const workflowEvents = rawTimeline.filter((e) => {
      const t = Date.parse(e.timestamp);
      return Number.isFinite(t) && t >= weekAgo && (e.type === 'workflow.completed' || e.type === 'workflow.failed');
    });
    const recentEventCount = rawTimeline.filter((e) => {
      const t = Date.parse(e.timestamp);
      return Number.isFinite(t) && t >= weekAgo;
    }).length;

    const projectStats = entities
      ? (() => {
          const projects = entities.filter((e) => e.kind === 'project' && e.syncState === 'active');
          const tasks = entities.filter((e) => e.kind === 'task' && e.syncState === 'active');
          const open = tasks.filter((t) => (t.status ?? '').toLowerCase() !== 'completed' && (t.status ?? '').toLowerCase() !== 'done');
          const overdue = open.filter((t) => {
            const due = t.endTimestamp ?? t.timestamp;
            const ms = due ? Date.parse(due) : NaN;
            return Number.isFinite(ms) && ms < nowMs;
          });
          return { projects: projects.length, openTasks: open.length, overdueTasks: overdue.length };
        })()
      : null;

    const awaiting = jobs ? jobs.filter((j) => j.status === 'awaiting_approval') : null;
    const health = composeHealthFramework({
      nowMs,
      org: safeRead('organization', deps.orgHealth, failures),
      orgUnits: safeRead('departments', deps.orgUnits, failures),
      projects: projectStats,
      workflows: failures['timeline-events']
        ? null
        : {
            completed: workflowEvents.filter((e) => e.type === 'workflow.completed').length,
            failed: workflowEvents.filter((e) => e.type === 'workflow.failed').length,
          },
      automation: safeRead('automations', deps.automationMonitor, failures),
      workforce: safeRead('ai', deps.workforceHealth, failures),
      system: safeRead('ai', deps.systemHealth, failures),
      connectors,
      approvals: awaiting
        ? {
            pending: awaiting.length,
            oldestCreatedAt: awaiting.length
              ? awaiting.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b)).createdAt
              : null,
          }
        : null,
      historyDays,
      failures,
    });

    const predictions = buildPredictions({
      nowMs,
      healthHistory,
      jobs,
      automationRuns,
      connectors,
      projects: projectStats,
      recentEventCount: failures['timeline-events'] ? null : recentEventCount,
    });

    const incidents = engine.incidents.incidents.map(toIncidentView);
    const baseConfidence = reportConfidence({
      signals: projection.signals,
      historyDays,
      incidentConfidences: engine.incidents.incidents.map((i) => i.confidence),
      crossDomainEdges: engine.graph.crossDomainEdges,
      totalEdges: engine.graph.edges,
    });

    /* ── 5. verification loop (deterministic re-observation) ────────────── */
    const currentRecoIdsPre = new Set<string>([
      ...engine.recommendations.map((r) => r.id),
      ...predictions.map((p) => `reco:${p.id}`),
    ]);
    const cleared = new Set<string>();
    if (!firstBuild) {
      for (const [id, title] of seenRecommendations) {
        if (!currentRecoIdsPre.has(id)) {
          cleared.add(id);
          verifiedLog.unshift({ id, title, at: nowIso });
          if (verifiedLog.length > MAX_VERIFIED_LOG) verifiedLog.length = MAX_VERIFIED_LOG;
          deps.publish({
            type: 'insight.outcome_verified',
            category: 'enterprise',
            source: 'insight',
            metadata: { recommendationId: id, title },
            correlationId: `ins_${id.replace(/[^a-zA-Z0-9_-]+/g, '_')}`,
          });
          seenRecommendations.delete(id);
        }
      }
    }

    const approvalEvents = rawTimeline
      .filter((e) => e.type === 'approval.granted')
      .map((e) => ({ id: e.id, correlationId: e.correlationId ?? null, at: e.timestamp }));
    const joins: OutcomeJoins = {
      decisions: safeRead('decisions', deps.decisions, failures) ?? [],
      approvalEvents,
      executions: executions ?? [],
      clearedRecommendationIds: cleared,
      nowIso,
    };

    const recommendations = composeRecommendations({
      engine: engine.recommendations,
      predictions,
      base: baseConfidence,
      joins,
    });

    const dependencies = buildDependencyGraph({ recommendations, incidents, predictions, health });

    const report: InsightReport = {
      generatedAt: nowIso,
      signals: projection.signals,
      graph: {
        nodes: engine.graph.nodes,
        edges: engine.graph.edges,
        byDomain: engine.graph.byDomain,
        crossDomainEdges: engine.graph.crossDomainEdges,
        projectedNodes: projection.extraNodes.length,
        projectedEdges: projection.extraEdges.length,
        projectedEvents: projection.events.length,
      },
      incidents,
      health,
      predictions,
      recommendations,
      dependencies,
      confidence: baseConfidence,
      unavailable,
    };

    /* ── 6. edge-triggered insight.* chain events ───────────────────────── */
    for (const inc of engine.incidents.incidents) {
      if (inc.severity === 'info' || seenIncidents.has(inc.id)) continue;
      seenIncidents.add(inc.id);
      deps.publish({
        type: 'insight.detected',
        category: 'enterprise',
        source: 'insight',
        priority: inc.severity === 'critical' ? 'high' : 'normal',
        metadata: { incidentId: inc.id, title: inc.title, severity: inc.severity, blastRadius: inc.impact.blastRadius },
        correlationId: `ins_${inc.id.replace(/[^a-zA-Z0-9_-]+/g, '_')}`,
      });
    }
    for (const r of recommendations) {
      if (seenRecommendations.has(r.id)) continue;
      seenRecommendations.set(r.id, r.title);
      deps.publish({
        type: 'insight.recommended',
        category: 'enterprise',
        source: 'insight',
        metadata: { recommendationId: r.id, title: r.title, priority: r.priority, confidence: r.confidence.overall },
        correlationId: r.correlationId,
      });
      if ((r.priority === 'critical' || r.priority === 'high') && !approvalRequested.has(r.id)) {
        approvalRequested.add(r.id);
        deps.publish({
          type: 'insight.approval_requested',
          category: 'enterprise',
          source: 'insight',
          metadata: { recommendationId: r.id, suggestedAction: r.suggestedAction },
          correlationId: r.correlationId,
        });
      }
    }
    firstBuild = false;

    return {
      at: nowMs,
      report,
      engine,
      graphInput: { resource, relationship, extraNodes: projection.extraNodes, extraEdges: projection.extraEdges },
      events,
      rawTimeline,
    };
  };

  /* ── targeted root cause over the SAME projected inputs (P7 pattern) ───── */
  const rootCause = (targetResourceId: string | null, windowMs: number): RootCauseReport => {
    const b = build();
    const model = buildEnterpriseGraph(
      {
        resource: b.graphInput.resource,
        relationship: b.graphInput.relationship,
        extraNodes: b.graphInput.extraNodes,
        extraEdges: b.graphInput.extraEdges,
      },
      now(),
    );
    return analyzeRootCause({ events: b.events, model, targetResourceId, windowMs }, now());
  };

  const dashboard = (): InsightDashboard => {
    const b = build();
    const history = (() => {
      try {
        return deps.healthHistory();
      } catch {
        return [];
      }
    })();
    return composeDashboard({
      report: b.report,
      trend: history.slice(-30).map((p) => ({ day: p.day, overall: p.overall })),
      recentlyVerified: [...verifiedLog],
      nowIso: new Date(now()).toISOString(),
    });
  };

  /* ── the ten questions (assistant port) ────────────────────────────────── */
  const answerQuestion = (text: string, nowIso: string): AssistantStructuredReport | null => {
    const key = resolveInsightQuestion(text);
    if (!key) return null;
    const b = build();
    const today = nowIso.slice(0, 10);
    const yesterday = new Date(Date.parse(`${today}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
    const changedToday = b.rawTimeline
      .filter((e) => e.timestamp.slice(0, 10) === today)
      .sort((a, b2) => (a.timestamp < b2.timestamp ? 1 : -1))
      .map((e) => ({ type: e.type, label: e.resource?.name ?? e.type, at: e.timestamp }));
    const yesterdayFailures = b.rawTimeline
      .filter((e) => e.timestamp.slice(0, 10) === yesterday)
      .filter((e) => /failed|error|critical|down/.test(e.type.toLowerCase()) || (e.priority ?? '') === 'critical')
      .map((e) => ({ id: e.id, type: e.type, label: e.resource?.name ?? e.type, at: e.timestamp }));
    const byDomain = b.report.graph.byDomain;
    const revenueNodes = (byDomain['finance'] ?? 0) + (byDomain['sales'] ?? 0) + (byDomain['crm'] ?? 0);
    const ctx: QuestionContext = {
      report: b.report,
      engine: b.engine,
      rootCause,
      changedToday,
      yesterdayFailures,
      revenueSignal: { connected: revenueNodes > 0, nodes: revenueNodes },
      nowIso,
    };
    return answerInsightQuestion(key, ctx);
  };

  /* ── monitoring sources (D-6): governed items only, never actions ──────── */
  const deliveredByMonitor = new Set<string>();
  const monitorSource: IntelligenceSource = {
    key: 'insight-monitor',
    label: 'Intelligence Monitor',
    cadence: { kind: 'interval', everyMs: MONITOR_INTERVAL_MS },
    produce: (): IntelligenceItem[] => {
      const b = build();
      const items: IntelligenceItem[] = [];
      for (const r of b.report.recommendations) {
        if (r.priority !== 'critical' && r.priority !== 'high') continue;
        if (deliveredByMonitor.has(r.id)) continue;
        deliveredByMonitor.add(r.id);
        items.push({
          id: `insight:${r.id}`,
          title: r.title,
          body: `${r.detail} Suggested: ${r.suggestedAction}`,
          priority: r.priority === 'critical' ? 'critical' : 'high',
          impact: { business: 0.6, urgency: r.priority === 'critical' ? 0.9 : 0.7, confidence: r.confidence.overall },
          deepLink: 'intelligence',
          producedAt: new Date(now()).toISOString(),
          correlationId: r.correlationId,
          governance: {
            // Health-derived engine recommendations carry no node ids — the
            // composed signal sources ARE their evidence references then.
            evidence: r.evidence.length ? r.evidence.slice(0, 8) : r.signals,
            sourceSystems: r.signals,
            confidence: r.confidence.overall,
            reasoning: r.detail,
            recommendedAction: r.suggestedAction,
          },
        });
      }
      return items;
    },
  };
  let lastTrendBand: string | null = null;
  const riskTrendSource: IntelligenceSource = {
    key: 'insight-risk-trend',
    label: 'Risk Trend Watch',
    cadence: { kind: 'daily', atMinutes: 8 * 60 + 30 },
    produce: (): IntelligenceItem[] => {
      const b = build();
      const trendPreds = b.report.predictions.filter((p) => p.kind === 'risk-trend' || p.kind === 'operational-drift');
      const band = b.report.health.band;
      const worsened = band === 'at-risk' || band === 'critical';
      if (trendPreds.length === 0 && !worsened) {
        lastTrendBand = band;
        return [];
      }
      if (trendPreds.length === 0 && band === lastTrendBand) return [];
      lastTrendBand = band;
      const top = trendPreds[0];
      return [
        {
          id: 'insight:risk-trend',
          title: top ? top.title : `Enterprise health is ${band}`,
          body: top
            ? `${top.detail} Suggested: ${top.suggestedAction}`
            : `Overall enterprise health is ${b.report.health.overall ?? '—'}/100 (${band}). Open the Intelligence Center for the domain breakdown.`,
          priority: band === 'critical' ? 'critical' : 'high',
          impact: { business: 0.7, urgency: 0.6, confidence: b.report.health.confidence.overall },
          deepLink: 'intelligence',
          producedAt: new Date(now()).toISOString(),
          governance: {
            evidence: top ? top.evidence.slice(0, 8) : b.report.health.domains.filter((d) => d.score != null).map((d) => `${d.key}=${d.score}`),
            sourceSystems: top ? top.signals : ['org-health'],
            confidence: top ? top.confidence.overall : b.report.health.confidence.overall,
            reasoning: top ? top.basis : 'Daily health-band watch over the composed framework.',
            recommendedAction: top ? top.suggestedAction : 'Review the weakest health domain.',
          },
        },
      ];
    },
  };
  deps.registerSource(monitorSource);
  deps.registerSource(riskTrendSource);

  /* ── the five read-only IPC channels (D-9) ─────────────────────────────── */
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
      channel: IpcChannel.InsightReport,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: () => build().report,
    },
    {
      channel: IpcChannel.InsightRootCause,
      schema: EnterpriseIntelRootCauseRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: (p) => {
        const req = p as TRootCauseReq;
        return rootCause(req.targetResourceId ?? null, req.windowMs ?? EVENT_WINDOW_MS);
      },
    },
    {
      channel: IpcChannel.InsightHealth,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: () => build().report.health,
    },
    {
      channel: IpcChannel.InsightPredictions,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: () => ({ predictions: build().report.predictions }),
    },
    {
      channel: IpcChannel.InsightDashboard,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: () => dashboard(),
    },
  ];

  log.info('Enterprise Intelligence Layer ready', { channels: handlers.length, sources: 2 });

  return {
    handlers,
    report: () => build().report,
    dashboard,
    answerQuestion,
    dispose: () => {
      projectionCache.invalidate();
    },
  };
}
