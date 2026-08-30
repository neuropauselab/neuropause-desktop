/**
 * P13C ROUND 37 — GATE 16. THE SHUTDOWN FLUSH BARRIER.
 *
 * THE DEFECT: 37 stores define `async flush()`; exactly ONE had a shutdown
 * hook (`workspaceContexts` on `before-quit`), `platform.dispose()` — the
 * timeline drain — was exported and never called, and every other store's
 * coalesced background write raced app exit. Up to one debounce/interval of
 * user state (org edits, governance toggles, module records, audit lines)
 * was lost on every quit, silently.
 *
 * THE SHAPE: a dependency-free registry, same reasoning as
 * `workspaceSwitchHub` — subsystems register their own flush at composition
 * instead of the entry point importing half the app. `index.ts` holds the
 * single `will-quit` barrier that runs them all.
 *
 * FAILURE ISOLATION: `Promise.allSettled` + a per-entry time box. One hung or
 * throwing flush must neither block the quit forever nor starve the others;
 * a failure is logged with its name and the quit proceeds — shutdown is not
 * the moment to refuse.
 */

export interface ShutdownFlushSummary {
  ran: number;
  failed: string[];
  timedOut: string[];
  durationMs: number;
  /** Set when the barrier was one-shot suppressed (restore relaunch). */
  suppressed?: string;
}

type FlushFn = () => void | Promise<void>;

const registry = new Map<string, FlushFn>();

/** Register a named flush. Last registration for a name wins (idempotent re-init). */
export function registerShutdownFlush(name: string, fn: FlushFn): void {
  registry.set(name, fn);
}

/** Test seam. Never called in production. */
export function __resetShutdownFlushForTests(): void {
  registry.clear();
}

/** Registered names, for diagnostics/tests. */
export function shutdownFlushNames(): string[] {
  return [...registry.keys()].sort();
}

/**
 * ONE-SHOT SUPPRESSION — for the restore relaunch, and only that.
 *
 * After an install-wide restore, every loaded store still holds PRE-restore
 * state in memory; the flush barrier draining them at quit would persist that
 * stale state over the freshly restored files — the barrier and the restore
 * would undo each other. A restore-triggered relaunch suppresses the barrier
 * once: losing an interval of pre-restore edits is the entire POINT of a
 * restore. The flag self-clears so the next (normal) quit flushes again.
 */
let suppressedReason: string | null = null;

export function suppressShutdownFlushOnce(reason: string): void {
  suppressedReason = reason;
}

export async function runShutdownFlush(perEntryTimeoutMs = 3000): Promise<ShutdownFlushSummary> {
  if (suppressedReason !== null) {
    const reason = suppressedReason;
    suppressedReason = null;
    return { ran: 0, failed: [], timedOut: [], durationMs: 0, suppressed: reason };
  }
  return drain(perEntryTimeoutMs);
}

/**
 * GATE 16 (round 46) — the SUSPEND flush. A lid close or OS sleep never fires
 * `will-quit`, so before this every coalesced write raced the freeze (and a
 * battery death while asleep lost it outright). Same drain, one difference:
 * a pending restore-relaunch suppression is RESPECTED but NOT consumed — the
 * one-shot flag belongs to the quit it was armed for, and a suspend racing
 * that window must neither flush stale pre-restore state nor eat the flag
 * (which would let the relaunch-quit flush it instead).
 */
export async function runSuspendFlush(perEntryTimeoutMs = 3000): Promise<ShutdownFlushSummary> {
  if (suppressedReason !== null) {
    return { ran: 0, failed: [], timedOut: [], durationMs: 0, suppressed: suppressedReason };
  }
  return drain(perEntryTimeoutMs);
}

async function drain(perEntryTimeoutMs: number): Promise<ShutdownFlushSummary> {
  const started = Date.now();
  const failed: string[] = [];
  const timedOut: string[] = [];
  await Promise.allSettled(
    [...registry.entries()].map(async ([name, fn]) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), perEntryTimeoutMs);
      });
      try {
        const outcome = await Promise.race([Promise.resolve().then(fn).then(() => 'done' as const), timeout]);
        if (outcome === 'timeout') timedOut.push(name);
      } catch {
        failed.push(name);
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return { ran: registry.size, failed, timedOut, durationMs: Date.now() - started };
}
