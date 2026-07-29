/**
 * Module 2 — Automation Engine. A priority + delayed job queue over the workflow runtime,
 * with scheduled/recurring, manual, and conditional triggers. Time is driven by the
 * injected clock (deterministic); scheduled triggers can also be bound to the real runtime
 * scheduler. Automation NEVER auto-approves: a queued workflow with an approval step lands
 * in 'awaiting-approval' until a human decides (no autonomous execution outside policy).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkflowRuntime, WorkflowRegistry } from './workflow';
import type { WorkflowExecution } from './types';

const PRIORITY: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };

export interface AutomationJob {
  id: string;
  workflowId: string;
  version?: number;
  tenantId: string;
  actor: string;
  trigger: string;
  inputs: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  readyAt: number;
  enqueuedAt: number;
  aiInitiated: boolean;
}

export interface ScheduleSpec {
  id: string;
  workflowId: string;
  tenantId: string;
  actor: string;
  everyMs: number;
  nextAt: number;
  inputs: Record<string, unknown>;
}

export interface EnqueueInput {
  workflowId: string;
  tenantId: string;
  actor: string;
  trigger?: string;
  inputs?: Record<string, unknown>;
  priority?: AutomationJob['priority'];
  delayMs?: number;
  version?: number;
  aiInitiated?: boolean;
}

export class AutomationEngine {
  private readonly queue: AutomationJob[] = [];
  private readonly schedules: ScheduleSpec[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly runtime: WorkflowRuntime,
    private readonly registry: WorkflowRegistry,
  ) {}

  enqueue(input: EnqueueInput): AutomationJob {
    const now = this.clock.now();
    const job: AutomationJob = {
      id: randomId('job'),
      workflowId: input.workflowId,
      ...(input.version !== undefined ? { version: input.version } : {}),
      tenantId: input.tenantId,
      actor: input.actor,
      trigger: input.trigger ?? 'manual',
      inputs: input.inputs ?? {},
      priority: input.priority ?? 'normal',
      readyAt: now + (input.delayMs ?? 0),
      enqueuedAt: now,
      aiInitiated: input.aiInitiated ?? false,
    };
    this.queue.push(job);
    return job;
  }

  manualTrigger(workflowId: string, opts: { tenantId: string; actor: string; inputs?: Record<string, unknown> }): AutomationJob {
    return this.enqueue({ workflowId, tenantId: opts.tenantId, actor: opts.actor, trigger: 'manual', ...(opts.inputs ? { inputs: opts.inputs } : {}) });
  }

  conditionalTrigger(workflowId: string, condition: () => boolean, opts: { tenantId: string; actor: string; inputs?: Record<string, unknown> }): AutomationJob | null {
    if (!condition()) return null;
    return this.enqueue({ workflowId, tenantId: opts.tenantId, actor: opts.actor, trigger: 'conditional', ...(opts.inputs ? { inputs: opts.inputs } : {}) });
  }

  /** Register a recurring/scheduled workflow. */
  schedule(input: { workflowId: string; tenantId: string; actor: string; everyMs: number; inputs?: Record<string, unknown>; startAt?: number }): ScheduleSpec {
    const spec: ScheduleSpec = { id: randomId('sched'), workflowId: input.workflowId, tenantId: input.tenantId, actor: input.actor, everyMs: input.everyMs, nextAt: input.startAt ?? this.clock.now(), inputs: input.inputs ?? {} };
    this.schedules.push(spec);
    return spec;
  }

  /** Fire any due schedules into the queue (a scheduler tick). */
  tick(now = this.clock.now()): AutomationJob[] {
    const fired: AutomationJob[] = [];
    for (const s of this.schedules) {
      while (s.nextAt <= now) {
        fired.push(this.enqueue({ workflowId: s.workflowId, tenantId: s.tenantId, actor: s.actor, trigger: 'scheduled', inputs: s.inputs }));
        s.nextAt += s.everyMs;
      }
    }
    return fired;
  }

  /** Run all jobs that are ready, highest priority first. */
  async runDue(now = this.clock.now()): Promise<WorkflowExecution[]> {
    const ready = this.queue
      .filter((j) => j.readyAt <= now)
      .sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority] || a.readyAt - b.readyAt);
    const out: WorkflowExecution[] = [];
    for (const job of ready) {
      this.queue.splice(this.queue.indexOf(job), 1);
      const def = this.registry.get(job.workflowId, job.version);
      if (!def) continue;
      out.push(await this.runtime.run(def, { tenantId: job.tenantId, actor: job.actor, trigger: job.trigger, inputs: job.inputs, aiInitiated: job.aiInitiated }));
    }
    return out;
  }

  async drain(): Promise<WorkflowExecution[]> {
    return this.runDue(Number.MAX_SAFE_INTEGER);
  }

  queued(): AutomationJob[] {
    return [...this.queue].sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority] || a.readyAt - b.readyAt);
  }
  queueDepth(): number {
    return this.queue.length;
  }
  schedulesList(): ScheduleSpec[] {
    return [...this.schedules];
  }
}
