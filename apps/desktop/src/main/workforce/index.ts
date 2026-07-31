/**
 * AI Workforce composition root.
 *
 * Loads the workforce stores (registry, audit, jobs), builds the Governance
 * Runtime over the default policies, registers the built-in workers + restores any
 * installed worker packages (P8.5), and wires the Worker Runtime to the **live**
 * intelligence layer: each job runs
 * against a fresh, permission-scoped snapshot of the UDM, Enterprise Timeline,
 * AI Memory, and knowledge graph. A cooperative scheduler provides background
 * execution and the orchestrator runs multi-step workflows. Every capability is
 * exposed over the secure IPC bridge, and a compact snapshot is broadcast
 * whenever the workforce changes.
 *
 * Reads only derived state (the intelligence layer) — never a connector.
 */
import type {
  WorkflowRun,
  WorkflowSpec,
  PlatformEventInput,
  ExecutionRequest,
  ExecutionSession,
  JobProposal,
  WorkforceAuditRequest as TWorkforceAuditRequest,
  WorkforceJobGetRequest as TWorkforceJobGetRequest,
  WorkforceJobRunRequest as TWorkforceJobRunRequest,
  Job,
  WorkforceJobsRequest as TWorkforceJobsRequest,
  WorkforceProposalDecideRequest as TWorkforceProposalDecideRequest,
  WorkforceWorkerGetRequest as TWorkforceWorkerGetRequest,
  WorkforceWorkflowRunRequest as TWorkforceWorkflowRunRequest,
  WorkforceWorkflowResumeRequest as TWorkforceWorkflowResumeRequest,
  WorkforceWorkflowCheckpointRequest as TWorkforceWorkflowCheckpointRequest,
  WorkforceDelegateRequest as TWorkforceDelegateRequest,
  WorkforceInstallRequest as TWorkforceInstallRequest,
  WorkforceInstallActionRequest as TWorkforceInstallActionRequest,
  WorkerPackage,
  WorkerInstallResult,
} from '@neuropause/shared';
import {
  EmptyRequest,
  IpcChannel,
  WorkforceAuditRequest,
  WorkforceDelegateRequest,
  WorkforceJobGetRequest,
  WorkforceJobRunRequest,
  WorkforceJobsRequest,
  WorkforceProposalDecideRequest,
  WorkforceWorkerGetRequest,
  WorkforceWorkflowRunRequest,
  WorkforceWorkflowResumeRequest,
  WorkforceWorkflowCheckpointRequest,
  WorkforceInstallRequest,
  WorkforceInstallActionRequest,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { unifiedStore } from '../unified/storeInstance';
import { graphStore } from '../graph/graphInstance';
import { memoryStore } from '../memory/memoryInstance';
import { getEnterpriseTimeline } from '../timeline';
import { workerRegistry } from './registry/registryInstance';
import { auditLog } from './governance/auditInstance';
import { jobStore } from './runtime/jobInstance';
import { GovernanceRuntime } from './governance';
import { Scheduler, WorkerRuntime } from './runtime';
import { Orchestrator } from './orchestrator';
import { analyzeWorkflowHealth, criticalPath } from './planning/workflowAnalysis';
import { planDelegation } from './planning/delegation';
import { withWorkforceAuthz } from './authzGate';
import { aggregateOutcome, bindingToRequest } from './execution/router';
import { builtInSkills, registerBuiltInWorkers } from './workers';
import { WorkerInstallService } from './install/installService';
import { workerInstallStore, workerSigningKey } from './install/installInstance';
import type { SkillImpl, WorkforceData, WorkforceNeighbor } from './sdk';

const log = createLogger('workforce');

export interface WorkforceSubsystemDeps {
  broadcast: (channel: string, payload: unknown) => void;
  /**
   * V7.3.2: publish platform events (workflow lifecycle → timeline). Optional so
   * the subsystem still runs standalone/in tests; the composition root passes
   * `platform.api.publish`, exactly as connectors/sync/automations already do.
   */
  publish?: (event: PlatformEventInput) => void;
  /** P8.5 — the running app/engine version, for worker-package compatibility checks. */
  appVersion: string;
}

export interface WorkforceSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
  /** V5.7: run a worker's default skill as a job (Execute Engine dispatch). */
  runWorker: (workerId: string, input?: Record<string, unknown>) => Job | null;
  /**
   * P8.3 — late-bind the ExecuteEngine so approved binding-carrying proposals run.
   * The engine is constructed after the workforce; the composition root calls this
   * with `(req) => executeEngine.execute(req)` once it exists.
   */
  setExecutionSubmit: (submit: (req: ExecutionRequest) => Promise<ExecutionSession>) => void;
  /**
   * P9 — route a marketplace worker install to the EXISTING P8.5 install service. A thin
   * passthrough (same authority as a direct worker install); the marketplace governs first.
   */
  installWorkerPackage: (pkg: WorkerPackage) => WorkerInstallResult;
  /**
   * Phase 6 Stage 8 — a READ-ONLY snapshot of the in-memory workflow-run map
   * ({run, spec} pairs) for the Automation Platform's computed catalog/monitor.
   * Additive and side-effect-free: no channel, no mutation, no new state — the
   * platform documents (rather than changes) the map's restart semantics.
   */
  workflowRunEntries: () => { run: WorkflowRun; spec: WorkflowSpec }[];
}

export async function initWorkforce(deps: WorkforceSubsystemDeps): Promise<WorkforceSubsystem> {
  await Promise.all([workerRegistry.load(), auditLog.load(), jobStore.load()]);

  const governance = new GovernanceRuntime(auditLog);
  const defs = registerBuiltInWorkers(workerRegistry);
  const skills = builtInSkills(defs);

  // P8.5 — Installable workers. Register the first-party trust root, then restore any
  // previously-installed worker packages (compose signed manifests → register into the
  // SAME registry). Installed workers' skills merge into the single `skillsFor` seam
  // below, so a disabled/uninstalled worker simply has no resolvable skills.
  await workerSigningKey.ensure();
  const installService = new WorkerInstallService({
    store: workerInstallStore,
    registry: workerRegistry,
    appVersion: deps.appVersion,
    publish: deps.publish,
  });
  await installService.load();
  const resolveSkills = (workerId: string): Map<string, SkillImpl> | null =>
    skills.get(workerId) ?? installService.skillsFor(workerId);

  // A live, permission-scoped snapshot of the intelligence layer for each run.
  const neighbors = (nodeId: string): WorkforceNeighbor[] => {
    const n = graphStore.neighbors({ id: nodeId, limit: 50 });
    if (!n) return [];
    return n.neighbors.map((x) => ({
      id: x.node.id,
      type: x.node.type,
      label: x.node.label,
      rel: x.edge.type,
      direction: x.direction,
    }));
  };
  const dataProvider = (now: string): WorkforceData => {
    const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
    const tl = getEnterpriseTimeline();
    const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
    const memories = memoryStore.recall({ limit: 2000 }).hits.map((h) => h.item);
    return { entities, events, memories, neighbors, now };
  };

  const runtime = new WorkerRuntime({
    registry: workerRegistry,
    governance,
    jobs: jobStore,
    dataProvider,
    skillsFor: resolveSkills,
    // P8.2 — worker/job lifecycle events flow onto the platform bus → timeline.
    publish: deps.publish,
  });

  // P8.3 — approved binding-carrying proposals execute through the ExecuteEngine.
  // `submitExecution` is late-bound (the engine is built after the workforce); until
  // it is set, approved actions stay advisory (job completes 'succeeded').
  let submitExecution: ((req: ExecutionRequest) => Promise<ExecutionSession>) | null = null;
  runtime.setDispatchApproved((job, proposals) => {
    const bindings = proposals.filter((p: JobProposal) => p.execution);
    if (bindings.length === 0) return;
    const executor = bindings[0].execution!.executor;
    const submit = submitExecution;
    if (!submit) {
      // The engine is not wired yet — settle failed so a 'running' job is NEVER
      // stranded (makes "running ⇒ settled" a local guarantee, not an init-order accident).
      runtime.settleExecution(job.id, { ok: false, summary: null, error: 'Execution engine not ready', executionId: '', executor });
      return;
    }
    void Promise.all(bindings.map((p) => submit(bindingToRequest(job, p)!)))
      .then((sessions) => runtime.settleExecution(job.id, aggregateOutcome(sessions, executor)))
      .catch((err) =>
        runtime.settleExecution(job.id, {
          ok: false,
          summary: null,
          error: err instanceof Error ? err.message : String(err),
          executionId: '',
          executor,
        }),
      );
  });
  const setExecutionSubmit = (submit: (req: ExecutionRequest) => Promise<ExecutionSession>): void => {
    submitExecution = submit;
  };

  const scheduler = new Scheduler(runtime);
  scheduler.start();
  const orchestrator = new Orchestrator({ runtime });

  // Workflow runs are ephemeral this stage (jobs are the durable record). We keep
  // the spec alongside each run so it can be resumed and its checkpoints resolved.
  const workflowRuns = new Map<string, { run: WorkflowRun; spec: WorkflowSpec }>();
  // V7.3.2: emit a workflow lifecycle event so it flows onto the platform bus →
  // timeline → Executive Center. `recovered` marks a run that came back via
  // recover(); otherwise the type is derived from the run's terminal status.
  const publishWorkflow = (run: WorkflowRun, spec: WorkflowSpec, recovered = false): void => {
    if (!deps.publish) return;
    const type: PlatformEventInput['type'] = recovered
      ? 'workflow.recovered'
      : run.status === 'succeeded'
        ? 'workflow.completed'
        : run.status === 'failed'
          ? 'workflow.failed'
          : 'workflow.started';
    deps.publish({
      type,
      category: 'automation',
      source: 'workforce',
      resource: { type: 'workflow', id: run.id, name: spec.id },
      metadata: { workflowId: spec.id, status: run.status, steps: spec.steps.length },
    });
  };

  const emitSnapshot = (): void => {
    deps.broadcast(IpcChannel.WorkforceEventBroadcast, {
      workers: workerRegistry.summaries().length,
      jobs: jobStore.size(),
      audit: auditLog.size(),
    });
  };
  const onChange = (): void => emitSnapshot();
  workerRegistry.on('changed', onChange);
  jobStore.on('changed', onChange);

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.WorkforceWorkers,
      schema: EmptyRequest,
      handler: () => workerRegistry.summaries(),
    },
    {
      channel: IpcChannel.WorkforceWorkerGet,
      schema: WorkforceWorkerGetRequest,
      handler: (p) => workerRegistry.get((p as TWorkforceWorkerGetRequest).workerId),
    },
    // ── P8.5 — Installable Workers (install/uninstall gated by workforce:manage) ──
    {
      channel: IpcChannel.WorkforceInstalls,
      schema: EmptyRequest,
      handler: () => installService.listInstalls(),
    },
    {
      channel: IpcChannel.WorkforceInstallGet,
      schema: WorkforceInstallActionRequest,
      handler: (p) => installService.installDetail((p as TWorkforceInstallActionRequest).workerId),
    },
    {
      channel: IpcChannel.WorkforceInstall,
      schema: WorkforceInstallRequest,
      handler: (p) => installService.install((p as TWorkforceInstallRequest).package),
    },
    {
      channel: IpcChannel.WorkforceInstallUpdate,
      schema: WorkforceInstallRequest,
      handler: (p) => installService.update((p as TWorkforceInstallRequest).package),
    },
    {
      channel: IpcChannel.WorkforceInstallEnable,
      schema: WorkforceInstallActionRequest,
      handler: (p) => installService.enable((p as TWorkforceInstallActionRequest).workerId),
    },
    {
      channel: IpcChannel.WorkforceInstallDisable,
      schema: WorkforceInstallActionRequest,
      handler: (p) => installService.disable((p as TWorkforceInstallActionRequest).workerId),
    },
    {
      channel: IpcChannel.WorkforceInstallRollback,
      schema: WorkforceInstallActionRequest,
      handler: (p) => installService.rollback((p as TWorkforceInstallActionRequest).workerId),
    },
    {
      channel: IpcChannel.WorkforceUninstall,
      schema: WorkforceInstallActionRequest,
      handler: (p) => installService.uninstall((p as TWorkforceInstallActionRequest).workerId),
    },
    {
      channel: IpcChannel.WorkforceJobRun,
      schema: WorkforceJobRunRequest,
      handler: (p) => {
        const r = p as TWorkforceJobRunRequest;
        return runtime.runJob({
          workerId: r.workerId,
          skillId: r.skillId,
          input: r.input,
          requestedBy: r.requestedBy ?? 'user',
          now: r.now,
        });
      },
    },
    {
      channel: IpcChannel.WorkforceJobs,
      schema: WorkforceJobsRequest,
      handler: (p) => {
        const r = p as TWorkforceJobsRequest;
        return runtime.listJobs({
          workerId: r.workerId,
          status: r.status,
          limit: r.limit,
          offset: r.offset,
        });
      },
    },
    {
      channel: IpcChannel.WorkforceJobGet,
      schema: WorkforceJobGetRequest,
      handler: (p) => runtime.getJob((p as TWorkforceJobGetRequest).jobId),
    },
    {
      channel: IpcChannel.WorkforceProposalApprove,
      schema: WorkforceProposalDecideRequest,
      handler: (p) => {
        const r = p as TWorkforceProposalDecideRequest;
        return runtime.approveProposal(r.jobId, r.proposalId, 'user', r.note ?? null, r.now);
      },
    },
    {
      channel: IpcChannel.WorkforceProposalReject,
      schema: WorkforceProposalDecideRequest,
      handler: (p) => {
        const r = p as TWorkforceProposalDecideRequest;
        return runtime.rejectProposal(r.jobId, r.proposalId, 'user', r.note ?? null, r.now);
      },
    },
    {
      channel: IpcChannel.WorkforceWorkflowRun,
      schema: WorkforceWorkflowRunRequest,
      handler: (p) => {
        const r = p as TWorkforceWorkflowRunRequest;
        const spec = r.spec as WorkflowSpec;
        const run = orchestrator.start(spec, r.now);
        workflowRuns.set(run.id, { run, spec });
        publishWorkflow(run, spec);
        return run;
      },
    },
    {
      channel: IpcChannel.WorkforceWorkflowRuns,
      schema: EmptyRequest,
      handler: () =>
        // V7.3.1: attach live workflow intelligence to each run — a health score +
        // issues (analyzeWorkflowHealth) and the critical path (bottlenecks, slack,
        // estimated duration), both from the tested analyzers. Backward-compatible:
        // these are extra fields; existing consumers reading WorkflowRun ignore them.
        [...workflowRuns.values()].map((x) => ({
          ...x.run,
          health: analyzeWorkflowHealth(x.spec),
          criticalPath: criticalPath(x.spec),
        })),
    },
    {
      channel: IpcChannel.WorkforceWorkflowResume,
      schema: WorkforceWorkflowResumeRequest,
      handler: (p) => {
        const { runId } = p as TWorkforceWorkflowResumeRequest;
        const entry = workflowRuns.get(runId);
        if (!entry) return null;
        // V7.3.1: resuming a FAILED run RECOVERS it — replay only the unfinished
        // branches (planRecovery), preserving completed work — instead of the prior
        // no-op (a failed run has nothing pending for resume() to advance). An
        // awaiting-approval run resumes exactly as before.
        const wasFailed = entry.run.status === 'failed';
        entry.run = wasFailed
          ? orchestrator.recover(entry.run, entry.spec)
          : orchestrator.resume(entry.run, entry.spec);
        publishWorkflow(entry.run, entry.spec, wasFailed);
        return entry.run;
      },
    },
    {
      channel: IpcChannel.WorkforceWorkflowCheckpoint,
      schema: WorkforceWorkflowCheckpointRequest,
      handler: (p) => {
        const r = p as TWorkforceWorkflowCheckpointRequest;
        const entry = workflowRuns.get(r.runId);
        if (!entry) return null;
        entry.run = orchestrator.approveCheckpoint(
          entry.run,
          entry.spec,
          r.stepId,
          r.approved,
          r.now,
        );
        return entry.run;
      },
    },
    {
      channel: IpcChannel.WorkforceAudit,
      schema: WorkforceAuditRequest,
      handler: (p) => {
        const r = p as TWorkforceAuditRequest;
        return governance.auditPage({
          workerId: r.workerId,
          decision: r.decision,
          limit: r.limit,
          offset: r.offset,
        });
      },
    },
    {
      channel: IpcChannel.WorkforcePolicies,
      schema: EmptyRequest,
      handler: () => governance.listPolicies(),
    },
    {
      // P8 — plan the delegation of a goal's task graph across the live roster.
      // Read-only (computes a plan; runs nothing). Gated to `workforce:read` by
      // withWorkforceAuthz below, alongside every other workforce handler.
      channel: IpcChannel.WorkforceDelegatePlan,
      schema: WorkforceDelegateRequest,
      handler: (p) => planDelegation(p as TWorkforceDelegateRequest, workerRegistry.list(), Date.now()),
    },
  ];

  log.info('AI Workforce initialized', {
    workers: defs.length,
    skills: [...skills.values()].reduce((n, m) => n + m.size, 0),
    policies: governance.listPolicies().length,
    audit: auditLog.size(),
    jobs: jobStore.size(),
  });

  const dispose = (): void => {
    scheduler.stop();
    workerRegistry.off('changed', onChange);
    jobStore.off('changed', onChange);
  };

  // V5.7: dispatch a worker's default (first) skill as a job. Skill resolution
  // lives here (not in the Execute Engine); the engine only orchestrates.
  const runWorker = (workerId: string, input?: Record<string, unknown>): Job | null => {
    const workerSkills = resolveSkills(workerId);
    if (!workerSkills || workerSkills.size === 0) return null;
    const skillId = [...workerSkills.keys()][0];
    return runtime.runJob({ workerId, skillId, input: input ?? {}, requestedBy: 'user' });
  };

  // P8.2 — RBAC-gate every workforce handler (authn + authz + audit) via the
  // classification map; throws at startup if any workforce channel is unclassified.
  return {
    handlers: withWorkforceAuthz(handlers),
    dispose,
    runWorker,
    setExecutionSubmit,
    installWorkerPackage: (pkg) => installService.install(pkg),
    workflowRunEntries: () => [...workflowRuns.values()].map((x) => ({ run: x.run, spec: x.spec })),
  };
}
