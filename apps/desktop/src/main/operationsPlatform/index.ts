/**
 * Phase 6 Stage 9 — the Enterprise Operations Platform composition root.
 *
 * ONE new subsystem that COMPOSES what already exists — it owns no runtime, no
 * store, no scheduler, no executor, and no mutation surface:
 *
 *   - the Service Catalog (registry × live signals), operational health
 *     (the Stage 6 framework verbatim + adjuncts), the SLA report (existing
 *     aggregates only), the seven-dimension readiness assessment, the incident
 *     lifecycle view (`transient: true`), capacity, business processes, the
 *     KPI catalog, and the dashboard — computed per read (3 s TTL),
 *   - continuity is the ONE async composition (the local backup list is an
 *     async read); its latest snapshot backs the sync assistant port honestly,
 *   - SIX read-only `eops:*` IPC channels (RBAC `autonomousops:read` — the
 *     existing P19 operations-read scope; fail-closed; zero mutation),
 *   - ONE `operations-watch` delivery source (governed recommendation ITEMS
 *     from SLA breaches / readiness regressions / critical incidents — never
 *     actions),
 *   - the assistant's ten operations questions (in-process port; answers ride
 *     the existing 'intelligence' report kind).
 *
 * Electron-free by construction: every read is an injected port; a failing
 * port becomes an explicit unavailable entry, never a fabricated value.
 */
import {
  EmptyRequest,
  IpcChannel,
  type AssistantStructuredReport,
  type CapacityBottleneck,
  type ContinuityView,
  type InsightReport,
  type IntelligenceItem,
  type IntelligenceSource,
  type OperationsDashboard,
  type ReadinessAssessment,
  type ServiceCatalog,
  type SlaReport,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { buildServiceCatalog, type CatalogSignals } from './serviceCatalog';
import { buildSlaReport } from './slaFramework';
import { buildOperationalHealth } from './operationalHealth';
import { buildIncidentReport } from './incidentModel';
import { buildCapacityView } from './capacityPlanner';
import { buildContinuityView } from './continuityPlanner';
import { buildProcessReport, type MinedProcessMetrics } from './businessProcesses';
import {
  answerOperationsQuestion,
  buildKpiCatalog,
  buildReadiness,
  composeOperationsDashboard,
  resolveOperationsQuestion,
  type OperationsQuestionContext,
  type ReadinessSignals,
} from './operationsModel';

const log = createLogger('operations-platform');

const BUILD_TTL_MS = 3_000;

/* ── deps (every read injected; continuity's backup list is the one async) ── */

export interface OperationsPlatformDeps {
  /** The Stage 6 subsystem's composed report (incidents/health/predictions). */
  insightReport: () => InsightReport | null;
  executionStats: () => {
    active: number;
    queued: number;
    completed: number;
    failed: number;
    successRate: number | null;
    averageRuntimeMs: number | null;
  };
  queuedJobsTotal: () => number;
  awaitingApprovals: () => { id: string; createdAt: string }[];
  /** Pre-composed by the root via the EXISTING detectBottlenecks over real jobs. */
  bottlenecks: () => CapacityBottleneck[];
  automationMonitor: () => { running: number; completed: number; failed: number; paused: number } | null;
  automationErrorRules: () => number;
  connectors: () => { id: string; name: string; configured: boolean; health: string }[];
  aiState: () => string;
  executiveKpis: () => { key: string; label: string; display: string; value: number | null; band?: string }[];
  processKpis: () => { key: string; label: string; display: string; value: number | null; band?: string }[] | null;
  minedProcesses: () => MinedProcessMetrics[] | null;
  units: () => { id: string; name: string; leadUserId: string | null }[];
  users: () => { id: string; name: string }[];
  /** The EXISTING compliance evaluation (via the enterprise subsystem accessor). */
  compliance: () => { ruleId: string; ruleName: string; severity: string; status: string }[] | null;
  enabledChains: () => number;
  workforceHealth: () => { healthy: number; degraded: number; unhealthy: number; unknown: number } | null;
  systemHealth: () => { score: number; level: string } | null;
  healthHistory: () => { day: string; overall: number }[];
  validationSummary: () => { totalRuns: number; certifies: number; latestCertification: string | null } | null;
  drPosture: () => ContinuityView['posture'];
  drReplicas: () => { status: string }[] | null;
  drValidations: () => { status: 'pass' | 'fail'; rpoSeconds: number; validatedAt: string }[] | null;
  /** The ONE async read (backup list hits disk via the release-ops accessor). */
  localBackups: () => Promise<{ createdAt: string; valid: boolean | null }[] | null>;
  supervisor: () => { recoveryCount: number; recentFailures: number } | null;
  /** Stage 7 knowledge lookup; null-safe. */
  knowledgeMatch: ((refs: string[]) => { ref: string; matched: boolean }[]) | null;
  /** Stage 8 seam (D-2): the automation platform's catalog totals, when built. */
  automationPlatform: (() => { entries: number; findings: number } | null) | null;
  registerSource: (source: IntelligenceSource) => void;
  now?: () => number;
}

export interface OperationsPlatformSubsystem {
  handlers: SecureHandlerDef[];
  catalog: () => ServiceCatalog;
  readiness: () => ReadinessAssessment;
  sla: () => SlaReport;
  continuity: () => Promise<ContinuityView>;
  dashboard: () => Promise<OperationsDashboard>;
  /** Assistant port: answer one of the ten operations questions, or null. */
  answerQuestion: (text: string, nowIso: string) => AssistantStructuredReport | null;
  dispose: () => void;
}

interface BuildArtifacts {
  at: number;
  nowIso: string;
  catalog: ServiceCatalog;
  health: ReturnType<typeof buildOperationalHealth>;
  sla: SlaReport;
  readiness: ReadinessAssessment;
  incidents: ReturnType<typeof buildIncidentReport>;
  capacity: ReturnType<typeof buildCapacityView>;
  processes: ReturnType<typeof buildProcessReport>;
  kpis: ReturnType<typeof buildKpiCatalog>;
  units: { id: string; name: string; leadUserId: string | null }[] | null;
  users: { id: string; name: string }[] | null;
}

function safeRead<T>(system: string, fn: () => T, failures: Record<string, string>): T | null {
  try {
    return fn();
  } catch (err) {
    failures[system] = err instanceof Error ? err.message : String(err);
    return null;
  }
}

export function initOperationsPlatform(deps: OperationsPlatformDeps): OperationsPlatformSubsystem {
  const now = deps.now ?? ((): number => Date.now());
  let cache: BuildArtifacts | null = null;
  let continuityCache: { at: number; view: ContinuityView } | null = null;

  const build = (): BuildArtifacts => {
    const nowMs = now();
    if (cache && nowMs - cache.at < BUILD_TTL_MS) return cache;
    const nowIso = new Date(nowMs).toISOString();
    const failures: Record<string, string> = {};

    const insight = safeRead('insight', deps.insightReport, failures);
    const exec = safeRead('executions', deps.executionStats, failures);
    const queued = safeRead('workforce-queue', deps.queuedJobsTotal, failures);
    const awaiting = safeRead('workforce-approvals', deps.awaitingApprovals, failures) ?? [];
    const bottlenecks = safeRead('workforce-bottlenecks', deps.bottlenecks, failures);
    const autoMonitor = safeRead('automation-monitor', deps.automationMonitor, failures);
    const autoErrorRules = safeRead('automation-rules', deps.automationErrorRules, failures) ?? 0;
    const connectors = safeRead('connectors', deps.connectors, failures);
    const aiState = safeRead('ai-engine', deps.aiState, failures);
    const execKpis = safeRead('executive-center', deps.executiveKpis, failures);
    const processKpis = safeRead('process-kpis', () => deps.processKpis(), failures);
    const mined = safeRead('process-mining', () => deps.minedProcesses(), failures);
    const units = safeRead('organization', deps.units, failures);
    const users = safeRead('org-users', deps.users, failures);
    const compliance = safeRead('governance-compliance', () => deps.compliance(), failures);
    const enabledChains = safeRead('governance', deps.enabledChains, failures);
    const wfHealth = safeRead('worker-health', () => deps.workforceHealth(), failures);
    const sysHealth = safeRead('system-health', () => deps.systemHealth(), failures);
    const history = safeRead('health-history', deps.healthHistory, failures);
    const validation = safeRead('continuous-validation', () => deps.validationSummary(), failures);
    const automationPlatform = deps.automationPlatform ? safeRead('automation-platform', () => deps.automationPlatform!(), failures) : null;

    const oldestApprovalHours =
      awaiting.length > 0
        ? Math.max(...awaiting.map((j) => (nowMs - Date.parse(j.createdAt)) / 3_600_000).filter((h) => Number.isFinite(h)))
        : null;
    const configured = (connectors ?? []).filter((c) => c.configured);
    const connectorCounts = connectors
      ? { total: connectors.length, configured: configured.length, healthy: configured.filter((c) => c.health === 'healthy').length }
      : null;

    const signals: CatalogSignals = {
      executions: exec
        ? { active: exec.active, queued: exec.queued, successRate: exec.successRate, averageRuntimeMs: exec.averageRuntimeMs }
        : null,
      workforce:
        queued === null
          ? null
          : { queueDepth: queued, awaitingApproval: awaiting.length, oldestApprovalHours },
      automation: autoMonitor,
      connectors,
      aiState,
      kpiKeys: execKpis ? execKpis.map((k) => k.key) : null,
      units,
      users,
    };
    const catalog = buildServiceCatalog({ nowIso, signals, failures: { ...failures } });
    // The Stage 8 seam (D-2): when the automation platform is live, its catalog
    // size rides the automation-rules row's evidence trail (composition only).
    if (automationPlatform) {
      const row = catalog.entries.find((e) => e.serviceId === 'automation-rules');
      if (row) row.evidence = [...row.evidence, `automation-platform-catalog:${automationPlatform.entries}`];
    }

    const health = buildOperationalHealth({
      nowIso,
      framework: insight?.health ?? null,
      system: sysHealth,
      workforce: wfHealth,
      connectors: connectorCounts,
      history,
      failures: {},
    });

    const sla = buildSlaReport({
      nowIso,
      measurements: {
        executions: exec ? { successRate: exec.successRate, averageRuntimeMs: exec.averageRuntimeMs } : null,
        workforce: queued === null ? null : { queueDepth: queued, oldestApprovalHours },
        automation: autoMonitor ? { completed: autoMonitor.completed, failed: autoMonitor.failed } : null,
        connectors: connectorCounts ? { configured: connectorCounts.configured, healthy: connectorCounts.healthy } : null,
        aiState,
      },
      failures: {},
    });

    const readinessSignals: ReadinessSignals = {
      validation,
      compliance,
      connectors: connectorCounts ? { configured: connectorCounts.configured, healthy: connectorCounts.healthy } : null,
      automation: autoMonitor ? { completed: autoMonitor.completed, failed: autoMonitor.failed, errorRules: autoErrorRules } : null,
      workforce: wfHealth && queued !== null ? { ...wfHealth, queueDepth: queued } : null,
      aiState,
      governance: enabledChains === null ? null : { enabledChains },
    };
    const readiness = buildReadiness(nowIso, readinessSignals, {});

    const incidents = buildIncidentReport({
      nowIso,
      nowMs,
      incidents: insight?.incidents ?? null,
      units,
      users,
      knowledgeMatch: deps.knowledgeMatch,
      failures: {},
    });

    const capacity = buildCapacityView({
      nowIso,
      executions: exec ? { active: exec.active, queued: exec.queued, successRate: exec.successRate } : null,
      workforce: queued === null ? null : { queueDepth: queued, awaitingApproval: awaiting.length },
      automation: autoMonitor ? { running: autoMonitor.running, failed: autoMonitor.failed, paused: autoMonitor.paused } : null,
      bottlenecks,
      predictions: insight?.predictions ?? null,
      failures: {},
    });

    const processes = buildProcessReport({ nowIso, mined, failures: {} });
    const kpis = buildKpiCatalog(execKpis, processKpis);

    cache = { at: nowMs, nowIso, catalog, health, sla, readiness, incidents, capacity, processes, kpis, units, users };
    return cache;
  };

  /* ── continuity (the one async composition; snapshot backs the sync port) ─ */
  const continuity = async (): Promise<ContinuityView> => {
    const nowMs = now();
    if (continuityCache && nowMs - continuityCache.at < BUILD_TTL_MS) return continuityCache.view;
    const failures: Record<string, string> = {};
    const posture = safeRead('dr-store', deps.drPosture, failures);
    const replicas = safeRead('dr-replicas', () => deps.drReplicas(), failures);
    const validations = safeRead('dr-validations', () => deps.drValidations(), failures);
    const supervisor = safeRead('runtime-supervisor', () => deps.supervisor(), failures);
    let localBackups: { createdAt: string; valid: boolean | null }[] | null = null;
    try {
      localBackups = await deps.localBackups();
    } catch (err) {
      failures['local-backups'] = err instanceof Error ? err.message : String(err);
    }
    const view = buildContinuityView({
      nowIso: new Date(nowMs).toISOString(),
      posture: posture ?? null,
      replicas,
      validations,
      localBackups,
      supervisor,
      failures,
    });
    continuityCache = { at: nowMs, view };
    return view;
  };
  // Prime the snapshot once at init (fire-and-forget; failures are contained).
  void continuity().catch((err) => log.warn('initial continuity read failed', { message: (err as Error).message }));

  /** The latest continuity snapshot, or an HONEST view declaring the miss. */
  const continuitySnapshot = (): ContinuityView => {
    if (continuityCache) return continuityCache.view;
    return buildContinuityView({
      nowIso: new Date(now()).toISOString(),
      posture: null,
      replicas: null,
      validations: null,
      localBackups: null,
      supervisor: null,
      failures: { continuity: 'no continuity snapshot composed yet this session' },
    });
  };

  const dashboard = async (): Promise<OperationsDashboard> => {
    const b = build();
    const cont = await continuity();
    return composeOperationsDashboard({
      nowIso: b.nowIso,
      catalog: b.catalog,
      health: b.health,
      sla: b.sla,
      readiness: b.readiness,
      incidents: b.incidents,
      capacity: b.capacity,
      continuity: cont,
      kpis: b.kpis,
      units: b.units,
      users: b.users,
    });
  };

  /* ── the assistant port (ten questions; sync; snapshot-backed) ───────────── */
  const answerQuestion = (text: string, nowIso: string): AssistantStructuredReport | null => {
    const key = resolveOperationsQuestion(text);
    if (!key) return null;
    const b = build();
    const cont = continuitySnapshot();
    const ctx: OperationsQuestionContext = {
      catalog: b.catalog,
      health: b.health,
      sla: b.sla,
      readiness: b.readiness,
      incidents: b.incidents,
      capacity: b.capacity,
      continuity: cont,
      processes: b.processes,
      dashboard: composeOperationsDashboard({
        nowIso,
        catalog: b.catalog,
        health: b.health,
        sla: b.sla,
        readiness: b.readiness,
        incidents: b.incidents,
        capacity: b.capacity,
        continuity: cont,
        kpis: b.kpis,
        units: b.units,
        users: b.users,
      }),
      nowIso,
    };
    return answerOperationsQuestion(key, ctx);
  };

  /* ── monitoring: ONE governed watch source (items only, never actions) ──── */
  const deliveredWatch = new Set<string>();
  const watchSource: IntelligenceSource = {
    key: 'operations-watch',
    label: 'Operations Watch',
    cadence: { kind: 'daily', atMinutes: 8 * 60 + 45 },
    produce: async (): Promise<IntelligenceItem[]> => {
      const b = build();
      const cont = await continuity();
      const d = composeOperationsDashboard({
        nowIso: b.nowIso,
        catalog: b.catalog,
        health: b.health,
        sla: b.sla,
        readiness: b.readiness,
        incidents: b.incidents,
        capacity: b.capacity,
        continuity: cont,
        kpis: b.kpis,
        units: b.units,
        users: b.users,
      });
      const items: IntelligenceItem[] = [];
      for (const r of d.recommendations) {
        if (r.priority !== 'critical' && r.priority !== 'high') continue;
        if (deliveredWatch.has(r.id)) continue;
        deliveredWatch.add(r.id);
        items.push({
          id: `eops:${r.id}`,
          title: r.title,
          body: `${r.detail} Suggested: ${r.suggestedAction}`,
          priority: r.priority === 'critical' ? 'critical' : 'high',
          impact: { business: 0.6, urgency: r.priority === 'critical' ? 0.8 : 0.6, confidence: r.confidence },
          deepLink: 'operations',
          producedAt: new Date(now()).toISOString(),
          governance: {
            evidence: r.evidence.slice(0, 8),
            sourceSystems: r.affectedSystems.length > 0 ? r.affectedSystems : ['operations-platform'],
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

  /* ── the six read-only IPC channels (D-9; autonomousops:read, fail-closed) ─ */
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.EopsCatalog,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'autonomousops:read',
      handler: () => build().catalog,
    },
    {
      channel: IpcChannel.EopsHealth,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'autonomousops:read',
      handler: () => build().health,
    },
    {
      channel: IpcChannel.EopsReadiness,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'autonomousops:read',
      handler: () => ({ readiness: build().readiness, sla: build().sla, processes: build().processes }),
    },
    {
      channel: IpcChannel.EopsIncidents,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'autonomousops:read',
      handler: () => build().incidents,
    },
    {
      channel: IpcChannel.EopsContinuity,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'autonomousops:read',
      handler: () => continuity(),
    },
    {
      channel: IpcChannel.EopsDashboard,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'autonomousops:read',
      handler: () => dashboard(),
    },
  ];

  log.info('Enterprise Operations Platform ready', { channels: handlers.length, sources: 1 });

  return {
    handlers,
    catalog: () => build().catalog,
    readiness: () => build().readiness,
    sla: () => build().sla,
    continuity,
    dashboard,
    answerQuestion,
    dispose: () => {
      cache = null;
      continuityCache = null;
    },
  };
}
