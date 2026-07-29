/**
 * Module 3 — Synchronization Engine. A governed job orchestrator over the five sync
 * modes (full / incremental / webhook / scheduled / manual). Each enqueued job runs
 * through a registered handler; failures are retried up to a bound, then dead-lettered.
 * Every run — success or failure — is recorded through governance (audit + event) and
 * updates the connector lifecycle. Handlers own the actual pull (an incremental handler
 * can drive the reused integrations SyncEngine for checkpointed, conflict-aware sync).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { SyncMode } from './constants';
import type { ConnectivityGovernance } from './governance';
import type { ConnectorLifecycle } from './lifecycle';

export interface SyncJob {
  id: string;
  tenantId: string;
  connectorId: string;
  mode: SyncMode;
  attempts: number;
  enqueuedAt: number;
  correlationId: string;
}

export interface SyncResult {
  synced: number;
  conflicts: number;
}

export type SyncHandler = (job: SyncJob) => Promise<SyncResult>;

export interface SyncOutcome {
  jobId: string;
  tenantId: string;
  connectorId: string;
  mode: SyncMode;
  ok: boolean;
  synced: number;
  conflicts: number;
  attempts: number;
  durationMs: number;
  correlationId: string;
  replayId: string;
  error?: string;
  at: number;
}

export interface DeadLetterEntry {
  job: SyncJob;
  reason: string;
  at: number;
}

export interface SyncOrchestratorOptions {
  maxAttempts?: number;
}

export class SyncOrchestrator {
  private readonly handlers = new Map<string, SyncHandler>();
  private readonly queue: SyncJob[] = [];
  private readonly dlq: DeadLetterEntry[] = [];
  private readonly outcomes: SyncOutcome[] = [];
  private readonly maxAttempts: number;

  constructor(
    private readonly clock: Clock,
    private readonly governance: ConnectivityGovernance,
    private readonly lifecycle: ConnectorLifecycle,
    options: SyncOrchestratorOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  register(connectorId: string, handler: SyncHandler): void {
    this.handlers.set(connectorId, handler);
  }

  enqueue(tenantId: string, connectorId: string, mode: SyncMode = 'incremental'): SyncJob {
    const job: SyncJob = { id: randomId('job'), tenantId, connectorId, mode, attempts: 0, enqueuedAt: this.clock.now(), correlationId: randomId('corr') };
    this.queue.push(job);
    return job;
  }

  /** A webhook delivery becomes a webhook-mode sync job. */
  onWebhook(tenantId: string, connectorId: string): SyncJob {
    return this.enqueue(tenantId, connectorId, 'webhook');
  }

  queueDepth(): number {
    return this.queue.length;
  }
  retryQueue(): SyncJob[] {
    return [...this.queue];
  }
  deadLetters(): DeadLetterEntry[] {
    return [...this.dlq];
  }
  history(tenantId?: string): SyncOutcome[] {
    return tenantId ? this.outcomes.filter((o) => o.tenantId === tenantId) : [...this.outcomes];
  }

  /** Run the next queued job (a single background-worker tick). */
  async runNext(): Promise<SyncOutcome | null> {
    const job = this.queue.shift();
    if (!job) return null;
    return this.execute(job);
  }

  /** Drain the whole queue (a background worker sweeping to completion). */
  async drain(): Promise<SyncOutcome[]> {
    const out: SyncOutcome[] = [];
    let o: SyncOutcome | null;
    // Bounded by (jobs * maxAttempts); requeued retries are handled in-loop.
    while ((o = await this.runNext()) !== null) out.push(o);
    return out;
  }

  /** Re-drive a dead-lettered job (fresh attempt counter). */
  replay(jobId: string): SyncJob | undefined {
    const idx = this.dlq.findIndex((d) => d.job.id === jobId);
    if (idx === -1) return undefined;
    const [entry] = this.dlq.splice(idx, 1);
    const job: SyncJob = { ...entry.job, attempts: 0, enqueuedAt: this.clock.now() };
    this.queue.push(job);
    return job;
  }

  private async execute(job: SyncJob): Promise<SyncOutcome> {
    const handler = this.handlers.get(job.connectorId);
    const start = this.clock.now();
    if (!handler) return this.fail(job, start, `no sync handler registered for '${job.connectorId}'`, true);
    job.attempts += 1;
    try {
      const result = await handler(job);
      const durationMs = Math.max(0, this.clock.now() - start);
      const ref = await this.governance.recordSync({ tenantId: job.tenantId, connectorId: job.connectorId, mode: job.mode, ok: true, synced: result.synced, conflicts: result.conflicts, latencyMs: durationMs, correlationId: job.correlationId });
      this.safeLifecycle(() => this.lifecycle.markHealthy(job.tenantId, job.connectorId));
      const outcome: SyncOutcome = { jobId: job.id, tenantId: job.tenantId, connectorId: job.connectorId, mode: job.mode, ok: true, synced: result.synced, conflicts: result.conflicts, attempts: job.attempts, durationMs, correlationId: job.correlationId, replayId: ref.replayId, at: ref.at };
      this.outcomes.push(outcome);
      return outcome;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (job.attempts >= this.maxAttempts) return this.fail(job, start, reason, true);
      this.queue.push(job); // retry on a later tick
      return this.fail(job, start, reason, false);
    }
  }

  private async fail(job: SyncJob, start: number, reason: string, terminal: boolean): Promise<SyncOutcome> {
    const durationMs = Math.max(0, this.clock.now() - start);
    const ref = await this.governance.recordSync({ tenantId: job.tenantId, connectorId: job.connectorId, mode: job.mode, ok: false, synced: 0, conflicts: 0, latencyMs: durationMs, correlationId: job.correlationId, detail: reason });
    if (terminal) {
      this.dlq.push({ job, reason, at: this.clock.now() });
      this.safeLifecycle(() => this.lifecycle.markError(job.tenantId, job.connectorId, reason));
    }
    const outcome: SyncOutcome = { jobId: job.id, tenantId: job.tenantId, connectorId: job.connectorId, mode: job.mode, ok: false, synced: 0, conflicts: 0, attempts: job.attempts, durationMs, correlationId: job.correlationId, replayId: ref.replayId, error: reason, at: ref.at };
    this.outcomes.push(outcome);
    return outcome;
  }

  /** Lifecycle updates are best-effort — a raw job may target a not-yet-installed connection. */
  private safeLifecycle(fn: () => void): void {
    try {
      fn();
    } catch {
      /* connection not installed for this tenant — skip lifecycle update */
    }
  }
}
