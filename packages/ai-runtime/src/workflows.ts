/**
 * AI workflow engine (NCEA 10.3, Phase 4). Executes declarative workflows with
 * sequential or parallel steps, conditional execution, per-step retry + timeout,
 * approval checkpoints, cancellation, and compensating ROLLBACK on failure. The
 * whole run is governed (audit + event + timeline via the recorder).
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { GovernanceRecorder } from './governance';
import type { ExecutionContext } from './context';
import { withTimeout } from './util';

export interface WorkflowStep {
  name: string;
  run: (ctx: ExecutionContext) => Promise<unknown>;
  /** conditional — skipped when this returns false. */
  when?: (ctx: ExecutionContext) => boolean;
  retries?: number;
  timeoutMs?: number;
  /** compensating action run in reverse order on failure (rollback). */
  compensate?: (ctx: ExecutionContext) => Promise<void>;
  /** requires an approval checkpoint before running. */
  approval?: boolean;
}

export interface Workflow {
  name: string;
  mode: 'sequential' | 'parallel';
  steps: WorkflowStep[];
}

export type Approver = (step: WorkflowStep, ctx: ExecutionContext) => boolean | Promise<boolean>;

export interface CancellationSignal {
  aborted: boolean;
}

export interface WorkflowRunOptions {
  actor?: string;
  approver?: Approver;
  signal?: CancellationSignal;
}

export interface WorkflowResult {
  ok: boolean;
  completed: string[];
  skipped: string[];
  rolledBack: string[];
  failed?: string;
  reason?: string;
}

class WorkflowAbort extends Error {
  constructor(
    readonly step: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkflowAbort';
  }
}

export class WorkflowEngine {
  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly governance: GovernanceRecorder,
  ) {}

  async run(workflow: Workflow, options: WorkflowRunOptions = {}): Promise<WorkflowResult> {
    const actor = options.actor ?? 'system';
    const traceId = this.runtime.observability().newTraceId();
    const ctx: ExecutionContext = { traceId, actor, context: { runtime: { mode: this.runtime.context().mode } } };
    const completed: WorkflowStep[] = [];
    const completedNames: string[] = [];
    const skipped: string[] = [];
    const timer = this.runtime.observability().startTimer(`ai.workflow.${workflow.name}`);

    const runStep = async (step: WorkflowStep): Promise<void> => {
      if (step.when && !step.when(ctx)) {
        skipped.push(step.name);
        return;
      }
      if (step.approval) {
        const approved = options.approver ? await options.approver(step, ctx) : false;
        if (!approved) throw new WorkflowAbort(step.name, 'approval rejected');
      }
      const attempts = (step.retries ?? 0) + 1;
      let lastError = '';
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          await withTimeout(step.run(ctx), step.timeoutMs, `step '${step.name}'`);
          completed.push(step);
          completedNames.push(step.name);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      throw new WorkflowAbort(step.name, lastError);
    };

    const rollback = async (): Promise<string[]> => {
      const rolled: string[] = [];
      for (const step of [...completed].reverse()) {
        if (step.compensate) {
          try {
            await step.compensate(ctx);
            rolled.push(step.name);
          } catch {
            /* swallow compensation errors so rollback always completes */
          }
        }
      }
      return rolled;
    };

    try {
      if (workflow.mode === 'parallel') {
        if (options.signal?.aborted) throw new WorkflowAbort('(start)', 'cancelled');
        const results = await Promise.allSettled(workflow.steps.map((s) => runStep(s)));
        const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
        if (rejected) throw rejected.reason;
      } else {
        for (const step of workflow.steps) {
          if (options.signal?.aborted) throw new WorkflowAbort(step.name, 'cancelled');
          await runStep(step);
        }
      }
      await this.governance.record({
        traceId,
        kind: 'workflow',
        target: workflow.name,
        actor,
        durationMs: timer.end(),
        approval: 'not-required',
        ok: true,
      });
      return { ok: true, completed: completedNames, skipped, rolledBack: [] };
    } catch (error) {
      const rolledBack = await rollback();
      const reason = error instanceof Error ? error.message : String(error);
      const failed = error instanceof WorkflowAbort ? error.step : undefined;
      await this.governance.record({
        traceId,
        kind: 'workflow',
        target: workflow.name,
        actor,
        durationMs: timer.end(),
        approval: reason.includes('approval') ? 'rejected' : 'not-required',
        ok: false,
        detail: reason,
      });
      return { ok: false, completed: completedNames, skipped, rolledBack, ...(failed ? { failed } : {}), reason };
    }
  }
}
