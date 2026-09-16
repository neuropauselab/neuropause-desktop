/**
 * NeuroPause Platform — command idempotency (ERP Session 17, Track B).
 *
 * At-most-once economic effect per (tenant, idempotency key). Repeated OR
 * concurrent delivery of the same command shares ONE execution and returns the
 * same result, so a double-clicked create, a retried submit, or a replayed
 * convert never produces a duplicate record / PO / accounting transaction.
 *
 * Only a SUCCESS is memoised — a command that failed (validation, an unmet
 * precondition) may be legitimately retried, so its key is left free. This
 * mirrors the Session 15 single-flight discipline (finally-clear in-flight;
 * failure never poisons the key). In-memory + per-process, which is the whole
 * boundary for this single-process modular monolith; a durable store is a
 * recorded follow-up, not needed to prove at-most-once within a process.
 */
import type { CommandResult } from './domainCommand';

export class CommandIdempotencyStore {
  private readonly done = new Map<string, CommandResult>();
  private readonly inflight = new Map<string, Promise<CommandResult>>();

  private key(tenantId: string, idempotencyKey: string): string {
    return `${tenantId}::${idempotencyKey}`;
  }

  /**
   * Run `fn` at most once per (tenant, key). A completed success replays from
   * cache; an in-flight duplicate awaits the original; a fresh key executes.
   */
  async run(tenantId: string, idempotencyKey: string, fn: () => Promise<CommandResult>): Promise<CommandResult> {
    const k = this.key(tenantId, idempotencyKey);
    const cached = this.done.get(k);
    if (cached) return { ...cached, replayed: true };
    const existing = this.inflight.get(k);
    if (existing) {
      const r = await existing;
      return { ...r, replayed: true };
    }
    const promise = (async () => {
      const r = await fn();
      if (r.ok) this.done.set(k, r); // memoise successes only — failures stay retryable
      return r;
    })();
    this.inflight.set(k, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(k);
    }
  }

  /** Test/reset only. */
  clear(): void {
    this.done.clear();
    this.inflight.clear();
  }
}
