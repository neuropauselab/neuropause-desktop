/**
 * Task Scheduler — a generic in-memory scheduler the runtime and later the
 * Reminder Engine (Phase 6) build on. Supports repeating intervals and one-shot
 * timers, each addressable by id so it can be cancelled or replaced.
 *
 * P13C ROUND 10 — NEW-M9. A SCHEDULER THAT CANNOT NAME AN OWNER MAKES EVERY
 * CALLER GUESS ONE.
 *
 * This is described throughout the codebase as "the ONLY recurring scheduler",
 * and it took a bare `fn: () => void`. Its two corrected siblings do not:
 * `workforce/runtime/scheduler.ts` captures a principal at ENQUEUE and runs each
 * queued job under its own, and `unified/sync/retryQueue.ts` captures one per
 * ITEM for exactly the same reason. This file was the last scheduler with no
 * opinion about who its work belongs to, so every job registered on it resolved
 * its tenant from `activeTenantScope()` at fire time — which is the signed-in
 * session, not the work's owner.
 *
 * TWO SEPARATE DEFECTS, AND THEY NEED DIFFERENT ANSWERS:
 *
 *   `at()`  — a ONE-SHOT scheduled from a request or a fanned-out pass. The
 *             right owner is the one in scope WHEN IT WAS SCHEDULED, so the
 *             principal is captured here, exactly as `retryQueue.enqueue` does.
 *             Relying on `AsyncLocalStorage` to carry it through `setTimeout`
 *             is not a boundary: `cancel(id)` + re-arm means the surviving
 *             timer belongs to whoever armed it LAST, which is the precise
 *             contamination `retryQueue` documents. Capturing makes it explicit
 *             and reviewable rather than incidental.
 *
 *   `every()` — a RECURRING job registered once at boot, when there is no
 *             principal and no single correct one. There is no owner to
 *             capture; there is a SET of owners that changes over time, so the
 *             caller supplies a resolver and the job runs once per principal,
 *             per fire. A caller that supplies none runs with NO principal AT
 *             ALL — `runOutsidePrincipal`, so the answer is "this job named no
 *             tenant" rather than "whatever context the registration happened
 *             to inherit".
 */
import { createLogger } from '../logger';
import type { BackgroundPrincipal } from '../tenancy/backgroundPrincipal';
import {
  currentPrincipal,
  runAsPrincipal,
  runOutsidePrincipal,
} from '../tenancy/backgroundPrincipal';

const log = createLogger('scheduler');

interface Task {
  id: string;
  kind: 'interval' | 'timeout';
  timer: NodeJS.Timeout;
  scheduledFor: string | null;
}

export interface RecurringTaskOptions {
  /**
   * WHO THIS RECURRING JOB IS FOR, resolved AT EACH FIRE.
   *
   * Not captured at registration, because registration happens once at boot and
   * the answer is a list that changes: an organization created after boot is
   * owed its scheduled work too, and a suspended one must stop receiving it.
   * `tenantRuns`/`forEachTenant` is the canonical source of this list.
   *
   * `fn` runs ONCE PER PRINCIPAL, each under `runAsPrincipal`, so two
   * organizations' scheduled work executes as its own tenant even though one
   * timer drives both. An empty list means no tenant is owed this work and
   * nothing runs — which is the fail-closed answer, not a reason to fall back.
   */
  principals?: () => readonly BackgroundPrincipal[];
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

  /**
   * Repeats `fn` every `intervalMs`. Replaces any existing task with this id.
   *
   * With `opts.principals`, `fn` runs once per resolved principal on every fire,
   * each under that principal. Without it, `fn` runs exactly once with NO
   * principal — see the file header for why that is stated rather than inherited.
   */
  every(id: string, intervalMs: number, fn: () => void, opts: RecurringTaskOptions = {}): void {
    this.cancel(id);
    const resolvePrincipals = opts.principals ?? null;
    const timer = setInterval(() => {
      if (resolvePrincipals === null) {
        try {
          runOutsidePrincipal(fn);
        } catch (err) {
          log.warn('Scheduled task threw', { id, message: (err as Error).message });
        }
        return;
      }
      let principals: readonly BackgroundPrincipal[];
      try {
        principals = resolvePrincipals();
      } catch (err) {
        log.warn('Scheduled task could not resolve its principals', {
          id,
          message: (err as Error).message,
        });
        return;
      }
      for (const principal of principals) {
        /**
         * ONE TENANT'S FAILURE DOES NOT CANCEL THE NEXT TENANT'S RUN — the same
         * rule `forEachTenant` applies, for the same reason: otherwise tenant
         * A's broken rule silently stops tenant B's scheduled work and B has no
         * way to see that it happened.
         */
        try {
          runAsPrincipal(principal, fn);
        } catch (err) {
          log.warn('Scheduled task threw', {
            id,
            tenantId: principal.tenantId,
            message: (err as Error).message,
          });
        }
      }
    }, intervalMs);
    timer.unref?.();
    this.tasks.set(id, { id, kind: 'interval', timer, scheduledFor: null });
  }

  /**
   * Runs `fn` once at `when`. Past times run on the next tick.
   *
   * THE PRINCIPAL IS CAPTURED HERE, at the moment the task is scheduled — the
   * contract `tenancy/backgroundPrincipal.ts` states and the shape
   * `retryQueue.enqueue` already uses. A reminder scheduled while tenant A was
   * acting fires as A even if the user has switched to B, and even if some other
   * tenant re-armed a task in between.
   */
  at(id: string, when: Date, fn: () => void): void {
    this.cancel(id);
    const principal = currentPrincipal();
    const delay = Math.max(0, when.getTime() - Date.now());
    const timer = setTimeout(() => {
      this.tasks.delete(id);
      try {
        // Null means the schedule call itself had no principal — an interactive
        // request or boot. Falling back to the session is what that caller
        // already gets everywhere else; it is never a substituted tenant.
        if (principal === null) runOutsidePrincipal(fn);
        else runAsPrincipal(principal, fn);
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
