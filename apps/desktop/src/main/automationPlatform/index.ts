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
import { onWorkspaceSwitch } from '../tenancy/workspaceSwitchHub';
import { principalForOwnedWork } from '../tenancy/backgroundFanOut';
import { runAsPrincipal } from '../tenancy/backgroundPrincipal';
import {
  answerAutomationQuestion,
  composeAutomationDashboard,
  composeExplainability,
  composePoliciesView,
  resolveAutomationQuestion,
  type AutomationQuestionContext,
} from './automationModel';
import { TenantMemo } from '../tenancy/tenantMemo';
import type { TenantScope } from '@neuropause/shared';
import { TenantDedupe } from '../tenancy/tenantDedupe';

const log = createLogger('automation-platform');

const BUILD_TTL_MS = 3_000;
const TICK_ID = 'automation-platform:schedule-tick';
/** The job identity every principal this tick mints carries. */
const TICK_JOB_ID = 'automation-platform:schedule-tick';
const TICK_MS = 60_000;

/* ── deps (every read injected; sync reads only) ──────────────────────────── */

export interface AutomationPlatformDeps {
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
  /**
   * P13C ROUND 24 — O-8. PERSIST THE OCCURRENCE CLAIM.
   *
   * `firedOccurrences` below is the once-per-occurrence guard and it is a plain
   * `Map` in this closure, so it dies with the process. `interval` schedules
   * report `due: true` on EVERY tick — suppression is the whole mechanism — so a
   * relaunch inside the bucket re-fired every interval rule immediately, once
   * per restart. The actions those rules execute are webhooks, notifications and
   * connector writes.
   *
   * REQUIRED, so a composition root that forgets it fails to compile. An
   * optional dep would have left the shipping application with the defect and
   * the test suite without it, which is the arrangement that hides bugs.
   */
  recordScheduledOccurrence: (ruleId: string, occurrenceKey: string) => Promise<unknown>;
  /** The EXISTING taskScheduler surface (no new scheduler class). */
  schedule: { every: (id: string, ms: number, fn: () => void) => void; cancel: (id: string) => void };
  /**
   * P13C ROUND 10 — NEW-M9. WHICH TENANTS THE SCHEDULE TICK IS OWED TO.
   *
   * The tick was `schedule.every(..., () => void tick(now()))` — one timer, no
   * principal. `deps.rules()` is `automationStore.all()`, which is correctly
   * scoped, so with no principal it fell through to THE SESSION: the signed-in
   * organization's schedule rules fired and EVERY OTHER TENANT'S NEVER RAN AT
   * ALL. Fail-closed, and a functional gap nobody would report as a security
   * bug — which is precisely why it survived.
   *
   * This is the same dep `services/deliveryEngine.ts` takes, wired to the same
   * `forEachTenantBackground`, and injected rather than imported for the reason
   * stated on `scope` above: `enterprise/index` reaches `app.getPath`.
   *
   * REQUIRED, so a composition root that forgets it fails to compile.
   */
  forEachTenant: (
    jobId: string,
    fn: (run: { scope: TenantScope }) => Promise<void> | void,
  ) => Promise<unknown>;
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
  /**
   * The schedule tick for the CALLER'S OWN tenant, exposed for deterministic
   * tests. Each due rule still fires under ITS OWN stored owner's principal.
   */
  tick: (nowMs: number) => Promise<{ fired: string[] }>;
  /**
   * The schedule tick for EVERY tenant owed one — what the taskScheduler drives
   * live. Exposed so a test can assert the fan-out happened by counting runs.
   */
  tickAllTenants: (nowMs: number) => Promise<{ fired: string[]; tenants: string[] }>;
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
  const projectionCache = new TenantMemo<BuildArtifacts>('automation-platform-projections', { ttlMs: BUILD_TTL_MS, now })
    .bindScope(deps.scope);
  /**
   * P13C ROUND 6 — THE PLAN CACHE, TWO LINES BELOW THE TenantMemo THAT FIXED ITS
   * NEIGHBOUR.
   *
   * Keyed on `playbookId`, which comes from the STATIC `PLAYBOOK_REGISTRY` — the
   * same handful of constants for every install. So the key is tenant-independent
   * by construction and two tenants collide on every entry, while the cached
   * value is thoroughly tenant-derived: the compiled plan carries the caller's
   * approval chain and, through `deps.orgRoles`, that organization's ROLE NAMES.
   * Inside the 3s TTL, tenant B's `ap:plan` returned tenant A's.
   *
   * Not a `TenantMemo`, because that primitive holds ONE composed snapshot per
   * tenant and this is a keyed collection. Same discipline, applied by hand: the
   * tenant is part of the key, and it is read at lookup time rather than captured.
   * An unresolved caller gets its own `''` partition, which cannot collide with a
   * real tenant.
   */
  const planCache = new Map<string, { at: number; plan: AutomationPlan | null }>();
  const planKey = (playbookId: string): string => `${deps.scope()?.tenantId ?? ''}::${playbookId}`;

  const build = (): BuildArtifacts => projectionCache.state(compose);

  const compose = (): BuildArtifacts => {
    const nowMs = now();
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

    return { at: nowMs, nowIso, catalog, monitorReport, policiesView, dashboard, chains, autoAllowed };
  };

  /* ── plan compilation (per playbook, TTL-cached) ───────────────────────── */
  const plan = (playbookId: string): AutomationPlan | null => {
    const nowMs = now();
    const key = planKey(playbookId);
    const cached = planCache.get(key);
    if (cached && nowMs - cached.at < BUILD_TTL_MS) return cached.plan;
    const playbook: PlaybookDefinition | undefined = PLAYBOOK_BY_ID.get(playbookId);
    if (!playbook) {
      planCache.set(key, { at: nowMs, plan: null });
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
    planCache.set(key, { at: nowMs, plan: result });
    return result;
  };

  /* ── D-3: the schedule tick (the Builder's first-ever schedule emitter) ─── */
  /**
   * P13C ROUND 6 — ruleId → occurrenceKey, PER TENANT.
   *
   * Rule ids are uuids from a tenant-scoped store, so a collision across tenants
   * is not reachable and this was never a suppression bug. It is keyed anyway
   * for two reasons worth stating: the map is tenant-derived state that grew
   * without bound, and "these ids happen not to collide" is a property of an id
   * generator somebody could change. Keying removes the reasoning burden rather
   * than documenting it.
   */
  const firedOccurrences = new Map<string, Map<string, string>>();
  /**
   * P13C ROUND 10 — NEW-M9. THE BUCKET COMES FROM THE RULE, NOT FROM THE SESSION.
   *
   * This took no argument and re-read `deps.scope()` INSIDE the loop, AFTER
   * `await deps.fireScheduledRule`. A workspace switch during that await moved
   * the whole rest of the tick into another tenant's bucket, so one tenant's
   * occurrence keys were written under another's — which both suppresses a rule
   * that never fired and re-fires one that did. The owner is now an argument
   * derived from the rule itself before any await, so there is no read left in
   * the loop that a switch could change.
   */
  const occurrenceBucket = (tenantId: string): Map<string, string> => {
    const existing = firedOccurrences.get(tenantId);
    if (existing) return existing;
    const fresh = new Map<string, string>();
    firedOccurrences.set(tenantId, fresh);
    return fresh;
  };
  /**
   * D-3, under the rule's own authority.
   *
   * SCHEDULED RULE → ITS STORED OWNER → AN EXPLICIT PRINCIPAL → EXECUTION. The
   * chain has no step where "whoever is signed in" is consulted:
   * `principalForOwnedWork` reads `rule.tenantId`, which the store stamped when
   * the rule was saved and which a payload cannot set. A rule with no stored
   * owner is UNRESOLVED — it belongs to nobody, so nobody's runner may execute
   * it, and it is skipped rather than run as the reader. (Unreachable through
   * `automationStore.all()`, which already hides unowned rows; the guard is here
   * because "the store filters it out" is a property of another file.)
   */
  const tick = async (nowMs: number): Promise<{ fired: string[] }> => {
    const fired: string[] = [];
    const rules = safeRead('automation-rules', deps.rules, {});
    for (const rule of rules ?? []) {
      if (rule.status !== 'active' || rule.trigger.type !== 'schedule') continue;
      const parsed = parseScheduleLabel(rule.trigger.schedule);
      if (!parsed.spec) continue; // unparseable → the monitor carries the finding; never a silent guess
      const due = scheduleDue(parsed.spec, nowMs);
      if (!due.due) continue;
      const principal = principalForOwnedWork({
        jobId: TICK_JOB_ID,
        tenantId: rule.tenantId,
        // A rule is TENANT-level: `AutomationRule` has no workspace field, so a
        // tenant-level principal is the honest reading, not a narrowing.
        workspaceId: null,
      });
      if (principal === null) {
        log.warn('Scheduled rule has no owner and was not fired', { ruleId: rule.id });
        continue;
      }
      const occurrences = occurrenceBucket(principal.tenantId as string);
      if (occurrences.get(rule.id) === due.occurrenceKey) continue; // once per occurrence
      /**
       * P13C ROUND 24 — O-8. THE HALF OF THE GUARD THAT SURVIVES A RESTART.
       *
       * The map above answers "did THIS PROCESS already fire it?", which is a
       * different question from the one the guard is for. The record answers
       * "was it fired at all?", and only the record is still there after an
       * update, a crash or a closed lid.
       *
       * Both are consulted because neither subsumes the other: the map catches
       * the second tick of the same minute before any write has landed, the
       * record catches the first tick of the next process. Both only ever ADD
       * suppression, so consulting them in either order gives the same answer.
       */
      if (rule.lastScheduledOccurrence === due.occurrenceKey) {
        occurrences.set(rule.id, due.occurrenceKey);
        continue;
      }
      occurrences.set(rule.id, due.occurrenceKey);
      try {
        /**
         * Claimed BEFORE the fire, under the rule owner's own principal, so the
         * store resolves the write to the rule's tenant rather than to whoever
         * is signed in. Before rather than after: a crash mid-fire then loses
         * one occurrence instead of repeating it, which is the same at-most-once
         * promise the in-process guard has always made.
         */
        const res = await runAsPrincipal(principal, async () => {
          await deps.recordScheduledOccurrence(rule.id, due.occurrenceKey);
          return deps.fireScheduledRule(rule.id, new Date(nowMs).toISOString());
        });
        if (res) fired.push(rule.id);
      } catch (err) {
        log.warn('Scheduled rule fire failed', { ruleId: rule.id, message: (err as Error).message });
      }
    }
    return { fired };
  };
  /**
   * The tick EVERY tenant is owed, once per tenant, each under its own principal.
   *
   * `tick` alone could only ever see one organization's rules, because the store
   * it reads is scoped — so running it once per install served exactly one
   * tenant. One tenant's failure does not cancel the next tenant's run;
   * `forEachTenant` captures it into that tenant's outcome and continues.
   */
  const tickAllTenants = async (nowMs: number): Promise<{ fired: string[]; tenants: string[] }> => {
    const fired: string[] = [];
    const tenants: string[] = [];
    await deps.forEachTenant(TICK_JOB_ID, async (run) => {
      tenants.push(run.scope.tenantId);
      const result = await tick(nowMs);
      fired.push(...result.fired);
    });
    return { fired, tenants };
  };
  deps.schedule.every(TICK_ID, TICK_MS, () => {
    void tickAllTenants(now());
  });

  /* ── monitoring: ONE governed watch source (items only, never actions) ──── */
  /**
   * P13C ROUND 6 — EDGE-TRIGGER STATE, KEYED BY TENANT.
   *
   * Was `new Set<string>()` holding bare recommendation ids, and `produce()`
   * runs once per tenant under the delivery fan-out. The ids are deterministic
   * constants, so the FIRST tenant in the fan-out claimed each one permanently
   * and every other tenant's identical critical alert was dropped — forever, with
   * no TTL and nothing to clear it.
   *
   * No content crossed. What crossed was the decision NOT to deliver, which is
   * quieter than a disclosure and, for a critical alert, not obviously less
   * serious: one customer stops receiving warnings because another received the
   * same category first, and nothing looks wrong.
   *
   * `claim()` is one call rather than has-then-add, because has-then-add is
   * where the bug lived in twelve places and a thirteenth would write it too.
   */
  const deliveredWatch = new TenantDedupe('automation-watch');
  const watchSource: IntelligenceSource = {
    key: 'automation-watch',
    label: 'Automation Watch',
    cadence: { kind: 'daily', atMinutes: 9 * 60 + 15 },
    produce: (): IntelligenceItem[] => {
      const b = build();
      const items: IntelligenceItem[] = [];
      for (const f of b.monitorReport.findings) {
        if (f.severity !== 'critical' && f.severity !== 'high') continue;
        if (!deliveredWatch.claim(deps.scope(), f.id)) continue;
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
    tickAllTenants,
    answerQuestion,
    dispose: () => {
      deps.schedule.cancel(TICK_ID);
      projectionCache.invalidate();
      planCache.clear();
    },
  };
}
