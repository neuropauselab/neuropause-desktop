/**
 * AI Workforce composition root.
 *
 * Loads the workforce stores (registry, audit, jobs), builds the Governance
 * Runtime over the default policies, registers the nine built-in workers, and
 * wires the Worker Runtime to the **live** intelligence layer: each job runs
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
} from '@neuropause/shared';
import {
  EmptyRequest,
  IpcChannel,
  WorkforceAuditRequest,
  WorkforceJobGetRequest,
  WorkforceJobRunRequest,
  WorkforceJobsRequest,
  WorkforceProposalDecideRequest,
  WorkforceWorkerGetRequest,
  WorkforceWorkflowRunRequest,
  WorkforceWorkflowResumeRequest,
  WorkforceWorkflowCheckpointRequest,
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
import { builtInSkills, registerBuiltInWorkers } from './workers';
import type { WorkforceData, WorkforceNeighbor } from './sdk';

const log = createLogger('workforce');

export interface WorkforceSubsystemDeps {
  broadcast: (channel: string, payload: unknown) => void;
}

export interface WorkforceSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
  /** V5.7: run a worker's default skill as a job (Execute Engine dispatch). */
  runWorker: (workerId: string, input?: Record<string, unknown>) => Job | null;
}

export async function initWorkforce(deps: WorkforceSubsystemDeps): Promise<WorkforceSubsystem> {
  await Promise.all([workerRegistry.load(), auditLog.load(), jobStore.load()]);

  const governance = new GovernanceRuntime(auditLog);
  const defs = registerBuiltInWorkers(workerRegistry);
  const skills = builtInSkills(defs);

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
    skillsFor: (workerId) => skills.get(workerId) ?? null,
  });
  const scheduler = new Scheduler(runtime);
  scheduler.start();
  const orchestrator = new Orchestrator({ runtime });

  // Workflow runs are ephemeral this stage (jobs are the durable record). We keep
  // the spec alongside each run so it can be resumed and its checkpoints resolved.
  const workflowRuns = new Map<string, { run: WorkflowRun; spec: WorkflowSpec }>();

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
        return run;
      },
    },
    {
      channel: IpcChannel.WorkforceWorkflowRuns,
      schema: EmptyRequest,
      handler: () => [...workflowRuns.values()].map((x) => x.run),
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
        entry.run =
          entry.run.status === 'failed'
            ? orchestrator.recover(entry.run, entry.spec)
            : orchestrator.resume(entry.run, entry.spec);
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
    const workerSkills = skills.get(workerId);
    if (!workerSkills || workerSkills.size === 0) return null;
    const skillId = [...workerSkills.keys()][0];
    return runtime.runJob({ workerId, skillId, input: input ?? {}, requestedBy: 'user' });
  };

  return { handlers, dispose, runWorker };
}
