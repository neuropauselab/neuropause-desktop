/**
 * Task Scheduler — a generic in-memory scheduler the runtime and later the
 * Reminder Engine (Phase 6) build on. Supports repeating intervals and one-shot
 * timers, each addressable by id so it can be cancelled or replaced.
 */
import { createLogger } from '../logger';

const log = createLogger('scheduler');

interface Task {
  id: string;
  kind: 'interval' | 'timeout';
  timer: NodeJS.Timeout;
  scheduledFor: string | null;
}

class TaskScheduler {
  readonly name = 'task-scheduler';
  private tasks = new Map<string, Task>();

  start(): void {
    log.info('Task scheduler started');
  }
  stop(): void {
    for (const t of this.tasks.values()) clearTimers(t);
    this.tasks.clear();
  }

  /** Repeats `fn` every `intervalMs`. Replaces any existing task with this id. */
  every(id: string, intervalMs: number, fn: () => void): void {
    this.cancel(id);
    const timer = setInterval(() => {
      try {
        fn();
      } catch (err) {
        log.warn('Scheduled task threw', { id, message: (err as Error).message });
      }
    }, intervalMs);
    timer.unref?.();
    this.tasks.set(id, { id, kind: 'interval', timer, scheduledFor: null });
  }

  /** Runs `fn` once at `when`. Past times run on the next tick. */
  at(id: string, when: Date, fn: () => void): void {
    this.cancel(id);
    const delay = Math.max(0, when.getTime() - Date.now());
    const timer = setTimeout(() => {
      this.tasks.delete(id);
      try {
        fn();
      } catch (err) {
        log.warn('Scheduled task threw', { id, message: (err as Error).message });
      }
    }, delay);
    timer.unref?.();
    this.tasks.set(id, { id, kind: 'timeout', timer, scheduledFor: when.toISOString() });
  }

  cancel(id: string): boolean {
    const t = this.tasks.get(id);
    if (!t) return false;
    clearTimers(t);
    this.tasks.delete(id);
    return true;
  }

  list(): { id: string; kind: string; scheduledFor: string | null }[] {
    return [...this.tasks.values()].map((t) => ({ id: t.id, kind: t.kind, scheduledFor: t.scheduledFor }));
  }
}

function clearTimers(t: Task): void {
  if (t.kind === 'interval') clearInterval(t.timer);
  else clearTimeout(t.timer);
}

export const taskScheduler = new TaskScheduler();
