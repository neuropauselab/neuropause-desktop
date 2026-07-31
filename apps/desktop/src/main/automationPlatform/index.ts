/**
 * Phase 6 Stage 8 — the Enterprise Automation Platform composition root.
 *
 * ONE new subsystem that ORCHESTRATES what already exists — it owns no
 * runtime, no store, no scheduler class, no executor, and no mutation surface:
 *
 *   - the Automation Catalog, plan compilation (playbook → EXISTING
 *     WorkflowSpec), policy resolution (chains win; the P19 invariant reused),
 *     approval preview, honest rollback, the execution monitor, and the
 *     dashboard — all computed per read (3 s TTL),
 *   - SIX read-only `ap:*` IPC channels (RBAC `autonomousops:read`, the P19
 *     read scope) — nothing accepts an action (D-6/D-9),
 *   - the schedule tick (D-3): a 1-minute cadence registered on the EXISTING
 *     taskScheduler that fires DUE schedule-triggered rules through the
 *     EXISTING automation runner path (condition checks included), with
 *     in-memory occurrence dedupe — the first emitter the Builder's `schedule`
 *     trigger has ever had,
 *   - ONE delivery-engine source (`automation-watch`, daily) producing governed
 *     recommendation ITEMS from monitor findings — never actions,
 *   - the assistant's six automation questions (in-process port; answers ride
 *     the existing 'intelligence' report kind per the approved D-8).
 *
 * Electron-free by construction: every read is an injected port; a failing
 * port becomes an explicit unavailable entry, never a fabricated value.
 */
import {
  ApPlanRequest,
  ApPlaybooksRequest,
  EmptyRequest,
  IpcChannel,
  type ApprovalChain,
  type AssistantStructuredReport,
  type AutomationCatalog,
  type AutomationMonitorReport,
  type AutomationPlan,
  type AutomationPlatformDashboard,
  type AutomationRule,
  type AutomationRunRecord,
  type ExecutionSession,
  type IntelligenceItem,
  type IntelligenceSource,
  type PlaybookDefinition,
  type WorkflowRun,
  type WorkflowSpec,
  type ApPlanRequest as TApPlanRequest,
  type ApPlaybooksRequest as TApPlaybooksRequest,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
// The P19 derivation, reused verbatim (D-4): allows come ONLY from explicit
// global-governance policies; an empty list means nothing auto-executes.
import { deriveAutoAllowedTriggers } from '../autonomousOps/autoOpsModel';
import {
  ASSISTANT_CAPABILITY_ROWS,
  PLAYBOOK_BY_ID,
  PLAYBOOK_REGISTRY,
  POLICY_DEFAULTS_BY_ID,
  POLICY_DEFAULTS_REGISTRY,
} from './automationRegistry';
import { buildCatalog } from './automationCatalog';
import { compilePlaybook, compileSimulation, simulationScenarioKey, type KnownWorker } from './playbookComposer';
import { resolvePolicy, previewApprovals } from './policyResolver';
import { planRollback, type InstalledWorkerInfo } from './rollbackPlanner';
import { buildMonitorReport } from './executionMonitor';
import { parseScheduleLabel, scheduleDue } from './scheduleParser';
import {
  answerAutomationQuestion,
  composeAutomationDashboard,
  composeExplainability,
  composePoliciesView,
  resolveAutomationQuestion,
  type AutomationQuestionContext,
} from './automationModel';

const log = createLogger('automation-platform');

const BUILD_TTL_MS = 3_000;
const TICK_ID = 'automation-platform:schedule-tick';
const TICK_MS = 60_000;

/* ── deps (every read injected; sync reads only) ──────────────────────────── */

export interface AutomationPlatformDeps {
  rules: () => AutomationRule[];
  runRecords: () => AutomationRunRecord[];
  workflowRuns: () => { run: WorkflowRun; spec: WorkflowSpec }[] | null;
  sessions: () => Pick<ExecutionSession, 'id' | 'kind' | 'label' | 'state' | 'startedAt'>[];
  jobsAwaiting: () => { id: string; createdAt: string }[];
  chains: () => ApprovalChain[];
  orgRoles: () => { id: string; name: string }[] | null;
  /** The EXISTING global-governance policies (P19's autonomous-allow source). */
  globalPolicies: () => { effect: string; enabled: boolean; action: string }[];
  knownWorkers: () => KnownWorker[] | null;
  installedWorkers: () => InstalledWorkerInfo[] | null;
  deliverySources: () => { key: string }[] | null;
  scheduledValidations: () => { pipelines: number; scheduled: number } | null;
  autoOpsPlans: () => number | null;
  /** Sandbox execution history for the simulation join (label-matched; null-safe). */
  sandboxHistory: () => { id: string; status: string; startedAt: string; label: string }[] | null;
  /** Stage 7 knowledge lookup (does an asset topic/record back this ref?); null-safe. */
  knowledgeMatch: ((refs: string[]) => { ref: string; matched: boolean }[]) | null;
  /**
   * D-3 — fire ONE due schedule rule through the EXISTING runner path
   * (trigger+condition checks via selectRulesForEvent, then runRule).
   * Wired by the composition root; the platform never touches the runner class.
   */
  fireScheduledRule: (ruleId: string, scheduledForIso: string) => Promise<{ ok: boolean } | null>;
  /** The EXISTING taskScheduler surface (no new scheduler class). */
  schedule: { every: (id: string, ms: number, fn: () => void) => void; cancel: (id: string) => void };
  /** Register a delivery-engine source (the EXISTING engine). */
  registerSource: (source: IntelligenceSource) => void;
  now?: () => number;
}

export interface AutomationPlatformSubsystem {
  handlers: SecureHandlerDef[];
  catalog: () => AutomationCatalog;
  monitor: () => AutomationMonitorReport;
  plan: (playbookId: string) => AutomationPlan | null;
  dashboard: () => AutomationPlatformDashboard;
  /** The schedule tick, exposed for deterministic tests; the taskScheduler drives it live. */
  tick: (nowMs: number) => Promise<{ fired: string[] }>;
  /** Assistant port: answer one of the six automation questions, or null. */
  answerQuestion: (text: string, nowIso: string) => AssistantStructuredReport | null;
  dispose: () => void;
}

interface BuildArtifacts {
  at: number;
  nowIso: string;
  catalog: AutomationCatalog;
  monitorReport: AutomationMonitorReport;
  policiesView: ReturnType<typeof composePoliciesView>;
  dashboard: AutomationPlatformDashboard;
  chains: ApprovalChain[];
  autoAllowed: string[];
}

function safeRead<T>(system: string, fn: () => T, failures: Record<string, string>): T | null {
  try {
    return fn();
  } catch (err) {
    failures[system] = err instanceof Error ? err.message : String(err);
    return null;
  }
}

export function initAutomationPlatform(deps: AutomationPlatformDeps): AutomationPlatformSubsystem {
  const now = deps.now ?? ((): number => Date.now());
  let cache: BuildArtifacts | null = null;
  const planCache = new Map<string, { at: number; plan: AutomationPlan | null }>();

  const build = (): BuildArtifacts => {
    const nowMs = now();
    if (cache && nowMs - cache.at < BUILD_TTL_MS) return cache;
    const nowIso = new Date(nowMs).toISOString();
    const failures: Record<string, string> = {};

    const rules = safeRead('automation-rules', deps.rules, failures);
    const runRecords = safeRead('automation-runs', deps.runRecords, failures);
    const workflowRuns = safeRead('workflow-runs', deps.workflowRuns, failures);
    const sessions = safeRead('executions', deps.sessions, failures);
    const jobsAwaiting = safeRead('workforce-jobs', deps.jobsAwaiting, failures);
    const chains = safeRead('governance', deps.chains, failures) ?? [];
    const globalPolicies = safeRead('global-governance', deps.globalPolicies, failures) ?? [];
    const deliverySources = safeRead('delivery-sources', deps.deliverySources, failures);
    const scheduledValidations = safeRead('validation', deps.scheduledValidations, failures);
    const autoOpsPlans = safeRead('autonomous-ops', deps.autoOpsPlans, failures);

    const autoAllowed = deriveAutoAllowedTriggers(globalPolicies);

    const catalog = buildCatalog({
      nowMs,
      rules,
      workflowRuns,
      playbooks: PLAYBOOK_REGISTRY,
      deliverySources,
      scheduledValidations,
      autoOpsPlans,
      assistantRows: ASSISTANT_CAPABILITY_ROWS,
      failures,
    });

    const monitorReport = buildMonitorReport({
      nowMs,
      sessions,
      runRecords,
      rules,
      workflowRuns: workflowRuns?.map((w) => w.run) ?? null,
      jobsAwaiting,
      failures,
    });

    const policiesView = composePoliciesView(POLICY_DEFAULTS_REGISTRY, autoAllowed, chains, nowIso);

    const dashboard = composeAutomationDashboard({
      catalog,
      monitor: monitorReport,
      playbooks: PLAYBOOK_REGISTRY,
      policies: policiesView,
      nowIso,
    });

    cache = { at: nowMs, nowIso, catalog, monitorReport, policiesView, dashboard, chains, autoAllowed };
    return cache;
  };

  /* ── plan compilation (per playbook, TTL-cached) ───────────────────────── */
  const plan = (playbookId: string): AutomationPlan | null => {
    const nowMs = now();
    const cached = planCache.get(playbookId);
    if (cached && nowMs - cached.at < BUILD_TTL_MS) return cached.plan;
    const playbook: PlaybookDefinition | undefined = PLAYBOOK_BY_ID.get(playbookId);
    if (!playbook) {
      planCache.set(playbookId, { at: nowMs, plan: null });
      return null;
    }
    const b = build();
    const known = safeRead('workforce-registry', deps.knownWorkers, {});
    const installed = safeRead('worker-installs', deps.installedWorkers, {});
    const compiled = compilePlaybook(playbook, known ?? null);
    const defaults = POLICY_DEFAULTS_BY_ID.get(playbook.policyDefaultsId) ?? POLICY_DEFAULTS_REGISTRY[0];
    const rollback = planRollback(playbook, installed ?? null);
    const policy = resolvePolicy({
      playbook,
      trigger: playbook.approvalTrigger,
      defaults,
      chains: b.chains,
      autoAllowedTriggers: b.autoAllowed,
      rollback,
      nowMs,
    });
    const approvals = previewApprovals(
      playbook.approvalTrigger,
      b.chains,
      safeRead('organization', deps.orgRoles, {}) ?? null,
      policy.autoExecutable,
    );
    const knowledge =
      (deps.knowledgeMatch ? safeRead('knowledge', () => deps.knowledgeMatch?.(playbook.knowledgeRefs) ?? [], {}) : null) ??
      playbook.knowledgeRefs.map((ref) => ({ ref, matched: false }));
    const scenario = compileSimulation(playbook);
    const scenarioKey = simulationScenarioKey(playbook);
    const sandboxRuns = safeRead('sandbox', deps.sandboxHistory, {}) ?? null;
    const lastRun =
      sandboxRuns
        ?.filter((r) => r.label.includes(scenarioKey) || r.label.includes(playbook.id))
        .sort((a, b2) => (a.startedAt < b2.startedAt ? 1 : -1))[0] ?? null;

    const result: AutomationPlan = {
      playbookId: playbook.id,
      version: playbook.version,
      name: playbook.name,
      workflow: compiled.workflow,
      issues: compiled.issues,
      explainability: composeExplainability(playbook, compiled, { policy }, knowledge.filter((k) => k.matched).length),
      policy,
      approvals,
      simulation: {
        scenario,
        scenarioKey,
        lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt } : null,
        note: 'Sandbox fidelity is the fake-platform fidelity; the run itself goes through the existing sandbox:manage surface.',
      },
      knowledge,
    };
    planCache.set(playbookId, { at: nowMs, plan: result });
    return result;
  };

  /* ── D-3: the schedule tick (the Builder's first-ever schedule emitter) ─── */
  const firedOccurrences = new Map<string, string>(); // ruleId → occurrenceKey (in-memory, delivery-engine style)
  const tick = async (nowMs: number): Promise<{ fired: string[] }> => {
    const fired: string[] = [];
    const rules = safeRead('automation-rules', deps.rules, {});
    for (const rule of rules ?? []) {
      if (rule.status !== 'active' || rule.trigger.type !== 'schedule') continue;
      const parsed = parseScheduleLabel(rule.trigger.schedule);
      if (!parsed.spec) continue; // unparseable → the monitor carries the finding; never a silent guess
      const due = scheduleDue(parsed.spec, nowMs);
      if (!due.due) continue;
      if (firedOccurrences.get(rule.id) === due.occurrenceKey) continue; // once per occurrence
      firedOccurrences.set(rule.id, due.occurrenceKey);
      try {
        const res = await deps.fireScheduledRule(rule.id, new Date(nowMs).toISOString());
        if (res) fired.push(rule.id);
      } catch (err) {
        log.warn('Scheduled rule fire failed', { ruleId: rule.id, message: (err as Error).message });
      }
    }
    return { fired };
  };
  deps.schedule.every(TICK_ID, TICK_MS, () => {
    void tick(now());
  });

  /* ── monitoring: ONE governed watch source (items only, never actions) ──── */
  const deliveredWatch = new Set<string>();
  const watchSource: IntelligenceSource = {
    key: 'automation-watch',
    label: 'Automation Watch',
    cadence: { kind: 'daily', atMinutes: 9 * 60 + 15 },
    produce: (): IntelligenceItem[] => {
      const b = build();
      const items: IntelligenceItem[] = [];
      for (const f of b.monitorReport.findings) {
        if (f.severity !== 'critical' && f.severity !== 'high') continue;
        if (deliveredWatch.has(f.id)) continue;
        deliveredWatch.add(f.id);
        items.push({
          id: `ap:${f.id}`,
          title: f.title,
          body: `${f.detail} Suggested: ${f.suggestedAction}`,
          priority: f.severity === 'critical' ? 'critical' : 'high',
          impact: { business: 0.5, urgency: f.severity === 'critical' ? 0.8 : 0.6, confidence: f.confidence },
          deepLink: 'automations',
          producedAt: new Date(now()).toISOString(),
          governance: {
            evidence: f.evidence.slice(0, 8),
            sourceSystems: f.affectedSystems.length > 0 ? f.affectedSystems : ['automation-platform'],
            confidence: f.confidence,
            reasoning: f.detail,
            recommendedAction: f.suggestedAction,
          },
        });
      }
      return items;
    },
  };
  deps.registerSource(watchSource);

  /* ── the assistant port (six questions; read-only) ─────────────────────── */
  const answerQuestion = (text: string, nowIso: string): AssistantStructuredReport | null => {
    const key = resolveAutomationQuestion(text);
    if (!key) return null;
    const b = build();
    const ctx: AutomationQuestionContext = {
      catalog: b.catalog,
      monitor: b.monitorReport,
      playbooks: PLAYBOOK_REGISTRY,
      planFor: plan,
      policies: b.policiesView,
      nowIso,
    };
    return answerAutomationQuestion(key, text, ctx);
  };

  /* ── the six read-only IPC channels (D-9; autonomousops:read, P19 scope) ── */
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.ApCatalog,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'autonomousops:read',
      handler: () => build().catalog,
    },
    {
      channel: IpcChannel.ApPlaybooks,
      schema: ApPlaybooksRequest,
      requireAuth: true,
      permission: 'autonomousops:read',
      handler: (p) => {
        const req = p as TApPlaybooksRequest;
        if (req.id) {
          const found = PLAYBOOK_BY_ID.get(req.id) ?? null;
          return { playbooks: found ? [found] : [] };
        }
        return { playbooks: [...PLAYBOOK_REGISTRY] };
      },
    },
    {
      channel: IpcChannel.ApPlan,
      schema: ApPlanRequest,
      requireAuth: true,
      permission: 'autonomousops:read',
      handler: (p) => {
        const req = p as TApPlanRequest;
        const compiled = plan(req.playbookId);
        return compiled ?? { playbookId: req.playbookId, found: false };
      },
    },
    {
      channel: IpcChannel.ApPolicies,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'autonomousops:read',
      handler: () => build().policiesView,
    },
    {
      channel: IpcChannel.ApMonitor,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'autonomousops:read',
      handler: () => build().monitorReport,
    },
    {
      channel: IpcChannel.ApDashboard,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'autonomousops:read',
      handler: () => build().dashboard,
    },
  ];

  log.info('Enterprise Automation Platform ready', { channels: handlers.length, sources: 1, playbooks: PLAYBOOK_REGISTRY.length });

  return {
    handlers,
    catalog: () => build().catalog,
    monitor: () => build().monitorReport,
    plan,
    dashboard: () => build().dashboard,
    tick,
    answerQuestion,
    dispose: () => {
      deps.schedule.cancel(TICK_ID);
      cache = null;
      planCache.clear();
    },
  };
}
