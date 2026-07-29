/**
 * Runtime scheduler (NCEA 10.2C, Phase 9). Orchestration only — background
 * workers, retry scheduler, cleanup tasks, replay/projection workers register
 * here. Tick-driven for determinism (the host calls `tick()`, or wires a real
 * timer to it); no business logic lives in the scheduler.
 */
import type { Clock } from '@neuropause/cloud-core';

export interface ScheduledTask {
  name: string;
  intervalMs: number;
  handler: () => void | Promise<void>;
  /** Retry on next tick up to this many consecutive failures before backing off. */
  maxRetries?: number;
}

interface TaskState {
  def: ScheduledTask;
  nextRun: number;
  failures: number;
}

export class Scheduler {
  private readonly tasks = new Map<string, TaskState>();

  constructor(private readonly clock: Clock) {}

  register(task: ScheduledTask): void {
    if (this.tasks.has(task.name)) throw new Error(`scheduled task '${task.name}' already registered`);
    this.tasks.set(task.name, {
      def: task,
      nextRun: this.clock.now() + task.intervalMs,
      failures: 0,
    });
  }

  unregister(name: string): void {
    this.tasks.delete(name);
  }

  names(): string[] {
    return [...this.tasks.keys()];
  }

  failures(name: string): number {
    return this.tasks.get(name)?.failures ?? 0;
  }

  /** Run every task whose nextRun <= now. Returns the names that ran this tick. */
  async tick(): Promise<string[]> {
    const now = this.clock.now();
    const ran: string[] = [];
    for (const state of this.tasks.values()) {
      if (state.nextRun > now) continue;
      ran.push(state.def.name);
      try {
        await state.def.handler();
        state.failures = 0;
        state.nextRun = now + state.def.intervalMs;
      } catch {
        state.failures += 1;
        const canRetry = state.def.maxRetries !== undefined && state.failures <= state.def.maxRetries;
        // Retry on the next tick, else back off by the normal interval.
        state.nextRun = canRetry ? now : now + state.def.intervalMs;
      }
    }
    return ran;
  }
}
