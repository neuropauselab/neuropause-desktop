/**
 * Module 1 — Workflow Engine. Versioned workflow definitions in a registry, plus a
 * runtime that executes them with sequential / parallel / conditional / loop / approval /
 * timeout / retry / compensation semantics — threading a mutable state (inputs → outputs →
 * evidence) through the run. Every run is audited (via governance) and replayable from the
 * stored definition. High-risk AI-initiated steps are blocked unless gated by an approval
 * (the HITL rule, enforced at execution time). Retry/timeout reuse the integrations
 * reliability primitives.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import { withRetry, withTimeout } from '@neuropause/integrations';
import type { AutomationGovernance } from './governance';
import type { ApprovalPlatform, ApprovalRequest } from './approvals';
import type { WorkflowDefinition, WorkflowStepDef, WorkflowExecution, WorkflowState, StepResult, StepContext, ExecutionStatus } from './types';

export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

export class WorkflowRegistry {
  private readonly defs = new Map<string, WorkflowDefinition[]>(); // id → versions

  register(def: WorkflowDefinition): WorkflowDefinition {
    const v = this.validate(def);
    if (!v.ok) throw new Error(`invalid workflow '${def.id}': ${v.issues.join('; ')}`);
    const versions = this.defs.get(def.id) ?? [];
    if (versions.some((d) => d.version === def.version)) throw new Error(`workflow '${def.id}' version ${def.version} already registered`);
    versions.push(def);
    versions.sort((a, b) => a.version - b.version);
    this.defs.set(def.id, versions);
    return def;
  }
  get(id: string, version?: number): WorkflowDefinition | undefined {
    const versions = this.defs.get(id);
    if (!versions) return undefined;
    return version === undefined ? versions[versions.length - 1] : versions.find((d) => d.version === version);
  }
  latest(id: string): WorkflowDefinition | undefined {
    return this.get(id);
  }
  versions(id: string): number[] {
    return (this.defs.get(id) ?? []).map((d) => d.version);
  }
  list(): WorkflowDefinition[] {
    return [...this.defs.values()].map((vs) => vs[vs.length - 1]);
  }

  validate(def: WorkflowDefinition): ValidationResult {
    const issues: string[] = [];
    if (!def.id) issues.push('missing id');
    if (def.version < 1) issues.push('version must be >= 1');
    const names = new Set<string>();
    const check = (steps: WorkflowStepDef[]): void => {
      for (const s of steps) {
        if (names.has(s.name)) issues.push(`duplicate step name '${s.name}'`);
        names.add(s.name);
        if ((s.kind === 'approval' || s.approval) && !s.approval?.policyId) issues.push(`approval step '${s.name}' missing policyId`);
        if (s.kind === 'loop' && !s.loop) issues.push(`loop step '${s.name}' missing loop spec`);
        if ((s.riskTier === 'high' || s.riskTier === 'restricted') && !s.approval) issues.push(`${s.riskTier}-risk step '${s.name}' must have an approval gate`);
        if (s.parallel) check(s.parallel);
        if (s.loop) check([s.loop.body]);
      }
    };
    check(def.steps);
    return { ok: issues.length === 0, issues };
  }
}

export interface RunOptions {
  tenantId: string;
  actor: string;
  trigger: string;
  inputs?: Record<string, unknown>;
  aiInitiated?: boolean;
  approver?: (req: ApprovalRequest) => boolean | Promise<boolean>;
  replayOf?: string;
}

export class WorkflowRuntime {
  private readonly history: WorkflowExecution[] = [];

  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly governance: AutomationGovernance,
    private readonly approvals: ApprovalPlatform,
    private readonly clock: Clock,
  ) {}

  async run(def: WorkflowDefinition, opts: RunOptions): Promise<WorkflowExecution> {
    const v = this.registry.validate(def);
    if (!v.ok) throw new Error(`cannot run invalid workflow '${def.id}': ${v.issues.join('; ')}`);

    const startedAt = this.clock.now();
    const state: WorkflowState = { inputs: opts.inputs ?? {}, outputs: {}, evidence: [] };
    const ctxBase: StepContext = { tenantId: opts.tenantId, actor: opts.actor, traceId: randomId('trace'), aiInitiated: opts.aiInitiated ?? false, state };
    const stepResults: StepResult[] = [];
    const approvals: string[] = [];
    const completed: WorkflowStepDef[] = [];
    let status: ExecutionStatus = 'completed';
    let error: string | undefined;
    let rollbackId: string | undefined;

    const runStep = async (sdef: WorkflowStepDef): Promise<StepResult> => {
      const start = this.clock.now();
      const done = (r: Omit<StepResult, 'durationMs'>): StepResult => ({ ...r, durationMs: Math.max(0, this.clock.now() - start) });

      if (sdef.when && !sdef.when(state)) return done({ name: sdef.name, ok: true, skipped: true, attempts: 0 });

      // HITL enforcement: an AI-initiated high-risk step needs an approval gate.
      if ((sdef.riskTier === 'high' || sdef.riskTier === 'restricted') && ctxBase.aiInitiated && !sdef.approval) {
        return done({ name: sdef.name, ok: false, attempts: 0, error: `HITL: AI-initiated ${sdef.riskTier}-risk step '${sdef.name}' blocked (no human approval)` });
      }

      if (sdef.kind === 'approval' || sdef.approval) {
        const policyId = sdef.approval?.policyId;
        if (!policyId) return done({ name: sdef.name, ok: false, attempts: 1, error: 'approval step missing policyId' });
        const req = this.approvals.request({ tenantId: opts.tenantId, policyId, requester: opts.actor });
        approvals.push(req.id);
        const approved = opts.approver ? await opts.approver(req) : false;
        if (!approved && !this.approvals.isApproved(req.id)) {
          return done({ name: sdef.name, ok: false, attempts: 1, approvalId: req.id, error: `awaiting approval (request ${req.id})` });
        }
        return done({ name: sdef.name, ok: true, attempts: 1, approvalId: req.id });
      }

      if (sdef.kind === 'loop' && sdef.loop) {
        const arr = (state.inputs[sdef.loop.over] as unknown[] | undefined) ?? [];
        const prev = state.inputs.item;
        let ok = true;
        let err: string | undefined;
        for (const item of arr) {
          state.inputs.item = item;
          const r = await runStep(sdef.loop.body);
          if (!r.ok && !r.skipped) {
            ok = false;
            err = r.error;
            break;
          }
        }
        state.inputs.item = prev;
        return done({ name: sdef.name, ok, attempts: arr.length, ...(err ? { error: err } : {}) });
      }

      if (sdef.kind === 'parallel' && sdef.parallel) {
        const rs = await Promise.all(sdef.parallel.map((s) => runStep(s)));
        stepResults.push(...rs);
        const bad = rs.find((r) => !r.ok && !r.skipped);
        return done({ name: sdef.name, ok: !bad, attempts: rs.length, ...(bad ? { error: bad.error ?? 'sub-step failed' } : {}) });
      }

      if (sdef.action) {
        let attempts = 0;
        try {
          const output = await withRetry(
            async (attempt) => {
              attempts = attempt;
              const work = Promise.resolve(sdef.action!(ctxBase));
              return sdef.timeoutMs ? withTimeout(work, sdef.timeoutMs) : work;
            },
            { policy: { maxAttempts: (sdef.retries ?? 0) + 1, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 }, sleep: async () => {} },
          );
          state.outputs[sdef.name] = output;
          return done({ name: sdef.name, ok: true, output, attempts, ...(sdef.external ? { external: true } : {}) });
        } catch (e) {
          return done({ name: sdef.name, ok: false, attempts, error: e instanceof Error ? e.message : String(e), ...(sdef.external ? { external: true } : {}) });
        }
      }

      return done({ name: sdef.name, ok: true, attempts: 0 });
    };

    try {
      if (def.mode === 'parallel') {
        const rs = await Promise.all(def.steps.map(runStep));
        stepResults.push(...rs);
        const bad = rs.find((r) => !r.ok && !r.skipped);
        if (bad) {
          status = bad.error?.includes('approval') ? 'awaiting-approval' : 'failed';
          error = bad.error;
        }
        for (const s of def.steps) completed.push(s);
      } else {
        for (const sdef of def.steps) {
          const r = await runStep(sdef);
          if (sdef.kind !== 'parallel') stepResults.push(r);
          if (!r.ok && !r.skipped) {
            status = r.error?.includes('approval') ? 'awaiting-approval' : 'failed';
            error = r.error;
            break;
          }
          if (!r.skipped) completed.push(sdef);
        }
      }
    } catch (e) {
      status = 'failed';
      error = e instanceof Error ? e.message : String(e);
    }

    if (status === 'failed') {
      const compensable = completed.filter((s) => s.compensate);
      if (compensable.length) {
        rollbackId = randomId('rollback');
        for (const s of [...compensable].reverse()) {
          try {
            await s.compensate!(ctxBase);
          } catch {
            /* compensation is best-effort */
          }
        }
        status = 'compensated';
      }
    }

    const finishedAt = this.clock.now();
    const ref = await this.governance.recordExecution({
      tenantId: opts.tenantId,
      actor: opts.actor,
      workflowId: def.id,
      version: def.version,
      trigger: opts.trigger,
      inputs: state.inputs,
      outputs: state.outputs,
      evidence: state.evidence,
      approvals,
      durationMs: finishedAt - startedAt,
      status,
      ...(error ? { error } : {}),
      ...(rollbackId ? { rollbackId } : {}),
      aiInitiated: ctxBase.aiInitiated,
    });

    const execution: WorkflowExecution = {
      id: randomId('exec'),
      workflowId: def.id,
      version: def.version,
      tenantId: opts.tenantId,
      actor: opts.actor,
      trigger: opts.trigger,
      aiInitiated: ctxBase.aiInitiated,
      inputs: state.inputs,
      status,
      steps: stepResults,
      outputs: state.outputs,
      evidence: state.evidence,
      approvals,
      durationMs: finishedAt - startedAt,
      ...(error ? { error } : {}),
      auditId: ref.auditId,
      replayId: ref.replayId,
      ...(rollbackId ? { rollbackId } : {}),
      ...(opts.replayOf ? { replayOf: opts.replayOf } : {}),
      startedAt,
      finishedAt,
    };
    this.history.push(execution);
    return execution;
  }

  /** Replay a recorded execution from its stored definition + inputs. */
  async replay(executionId: string, approver?: RunOptions['approver']): Promise<WorkflowExecution> {
    const orig = this.history.find((e) => e.id === executionId);
    if (!orig) throw new Error(`unknown execution '${executionId}'`);
    const def = this.registry.get(orig.workflowId, orig.version);
    if (!def) throw new Error(`definition for '${orig.workflowId}' v${orig.version} not found`);
    return this.run(def, { tenantId: orig.tenantId, actor: orig.actor, trigger: `replay:${executionId}`, inputs: orig.inputs, aiInitiated: orig.aiInitiated, replayOf: executionId, ...(approver ? { approver } : {}) });
  }

  executions(tenantId?: string): WorkflowExecution[] {
    return tenantId ? this.history.filter((e) => e.tenantId === tenantId) : [...this.history];
  }
  execution(id: string): WorkflowExecution | undefined {
    return this.history.find((e) => e.id === id);
  }
}
