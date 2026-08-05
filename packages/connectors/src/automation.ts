/**
 * Automation Engine (NCEA 10.4, Phase 6). Triggered, queued, governed
 * automations with conditional steps, per-step retry + timeout, compensating
 * rollback, approval, cancellation — PLUS the connector-specific additions:
 * queue management and CHECKPOINT RECOVERY (resume a failed run from its
 * completed steps). Every run is recorded through the shared connector
 * governance (audit + event + timeline), so automations are replayable.
 *
 * Note: the step-orchestration pattern is intentionally the same as the AI
 * runtime's WorkflowEngine; a future increment can unify them into one core.
 */
import { randomId } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ConnectorGovernance } from './governance';
import { withTimeout } from './util';

export interface AutomationContext {
  automationId: string;
  runId: string;
  actor: string;
  traceId: string;
  state: Map<string, unknown>;
}

export interface AutomationStep {
  name: string;
  run: (ctx: AutomationContext) => Promise<unknown>;
  when?: (ctx: AutomationContext) => boolean;
  retries?: number;
  timeoutMs?: number;
  compensate?: (ctx: AutomationContext) => Promise<void>;
  approval?: boolean;
}

export interface AutomationDefinition {
  id: string;
  steps: AutomationStep[];
}

export type AutomationApprover = (step: AutomationStep, ctx: AutomationContext) => boolean | Promise<boolean>;

export interface AutomationRunOptions {
  actor?: string;
  approver?: AutomationApprover;
  signal?: { aborted: boolean };
  /** checkpoint recovery — step names already completed in a prior run. */
  resumeFrom?: string[];
}

export interface AutomationResult {
  ok: boolean;
  runId: string;
  completed: string[];
  skipped: string[];
  rolledBack: string[];
  checkpoints: string[];
  failed?: string;
  reason?: string;
}

class AutomationAbort extends Error {
  constructor(
    readonly step: string,
    message: string,
  ) {
    super(message);
    this.name = 'AutomationAbort';
  }
}

export class AutomationEngine {
  private readonly automations = new Map<string, AutomationDefinition>();
  private readonly queue: string[] = [];

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly governance: ConnectorGovernance,
  ) {}

  register(def: AutomationDefinition): void {
    if (this.automations.has(def.id)) throw new Error(`automation '${def.id}' already registered`);
    this.automations.set(def.id, def);
  }
  get(id: string): AutomationDefinition | undefined {
    return this.automations.get(id);
  }
  list(): AutomationDefinition[] {
    return [...this.automations.values()];
  }

  enqueue(automationId: string): void {
    this.queue.push(automationId);
  }
  queueDepth(): number {
    return this.queue.length;
  }
  async runNext(options: AutomationRunOptions = {}): Promise<AutomationResult | null> {
    const id = this.queue.shift();
    return id ? this.run(id, options) : null;
  }

  async run(automationId: string, options: AutomationRunOptions = {}): Promise<AutomationResult> {
    const def = this.automations.get(automationId);
    if (!def) throw new Error(`automation '${automationId}' is not registered`);
    const actor = options.actor ?? 'system';
    const runId = randomId('run');
    const traceId = this.runtime.observability().newTraceId();
    const ctx: AutomationContext = { automationId, runId, actor, traceId, state: new Map() };
    const done = new Set(options.resumeFrom ?? []);
    const completed: AutomationStep[] = [];
    const completedNames: string[] = [...done];
    const skipped: string[] = [];
    const checkpoints: string[] = [...done];
    const timer = this.runtime.observability().startTimer(`automation.${automationId}`);

    const rollback = async (): Promise<string[]> => {
      const rolled: string[] = [];
      for (const step of [...completed].reverse()) {
        if (step.compensate) {
          try {
            await step.compensate(ctx);
            rolled.push(step.name);
          } catch {
            /* swallow so rollback completes */
          }
        }
      }
      return rolled;
    };

    const recordRun = (ok: boolean, approval: 'not-required' | 'rejected', detail?: string): Promise<unknown> =>
      this.governance.record({
        connectorId: `automation:${automationId}`,
        operation: 'run',
        provider: 'automation',
        actor,
        traceId,
        durationMs: timer.end(),
        retryCount: 0,
        approval,
        ok,
        ...(detail !== undefined ? { detail } : {}),
      });

    try {
      for (const step of def.steps) {
        if (done.has(step.name)) continue; // checkpoint recovery
        if (options.signal?.aborted) throw new AutomationAbort(step.name, 'cancelled');
        if (step.when && !step.when(ctx)) {
          skipped.push(step.name);
          continue;
        }
        if (step.approval) {
          const approved = options.approver ? await options.approver(step, ctx) : false;
          if (!approved) throw new AutomationAbort(step.name, 'approval rejected');
        }
        const attempts = (step.retries ?? 0) + 1;
        let lastError = '';
        let ok = false;
        for (let attempt = 1; attempt <= attempts; attempt++) {
          try {
            await withTimeout(step.run(ctx), step.timeoutMs, `step '${step.name}'`);
            ok = true;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }
        if (!ok) throw new AutomationAbort(step.name, lastError);
        completed.push(step);
        completedNames.push(step.name);
        checkpoints.push(step.name);
      }
      await recordRun(true, 'not-required');
      return { ok: true, runId, completed: completedNames, skipped, rolledBack: [], checkpoints };
    } catch (error) {
      const rolledBack = await rollback();
      const reason = error instanceof Error ? error.message : String(error);
      const failed = error instanceof AutomationAbort ? error.step : undefined;
      await recordRun(false, reason.includes('approval') ? 'rejected' : 'not-required', reason);
      return { ok: false, runId, completed: completedNames, skipped, rolledBack, checkpoints, ...(failed ? { failed } : {}), reason };
    }
  }
}
