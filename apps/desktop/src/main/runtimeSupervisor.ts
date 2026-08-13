/**
 * RuntimeSupervisor (V5.3) — autonomous recovery.
 *
 * Observes NeuroCore's composed health on a loop and, when a subsystem is
 * failing, attempts recovery through INJECTED executors that reuse existing
 * subsystem capabilities (e.g. the telemetry backend re-probe). The decision of
 * what to recover is the pure evaluateSupervisor core; this class owns the loop,
 * the bounded history, the policies, and event emission. No restart logic is
 * duplicated — every executor delegates to the subsystem that owns it.
 */
import {
  defaultRecoveryPolicies,
  evaluateSupervisor,
  type RecoveryPolicy,
  type RecoveryRecord,
  type SupervisedSubsystem,
  type SupervisorStatus,
  type SystemHealthSnapshot,
} from '@neuropause/shared';
import { createLogger } from './logger';
import { runAsPrincipal, systemPrincipal } from './tenancy/backgroundPrincipal';

const log = createLogger('runtime-supervisor');

/** A recovery executor delegates to the subsystem that owns the restart. */
export type RecoveryExecutor = () => Promise<{ ok: boolean; detail?: string }>;

export interface RuntimeSupervisorDeps {
  snapshot: () => Promise<SystemHealthSnapshot>;
  executors: Partial<Record<SupervisedSubsystem, RecoveryExecutor>>;
  publish?: (input: {
    type: string;
    category: string;
    source: string;
    priority?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }) => void;
  now?: () => number;
}

const MAX_HISTORY = 100;

export class RuntimeSupervisor {
  private policies = defaultRecoveryPolicies();
  private readonly history: RecoveryRecord[] = [];
  private readonly recovering = new Set<SupervisedSubsystem>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private readonly now: () => number;

  constructor(private readonly deps: RuntimeSupervisorDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * P13C PART 3 — CLASSIFIED SYSTEM_GLOBAL.
   *
   * The supervisor observes SUBSYSTEMS of this process — the event bus, the
   * connector runtime, the window — none of which belong to a customer. It
   * carries no tenant, and running it under an explicit SYSTEM principal is
   * what stops it inheriting one: without a principal, `activeTenantScope()`
   * falls through to the session, and a global health alert would be published
   * into whichever organization the user happened to have open, appearing in
   * that customer's timeline as their own activity.
   *
   * The alerts are not lost by being system-owned. `scopeKind: 'system'` is
   * stamped from this principal, and the notification subsystem fans a system
   * alert out to every operable tenant under that tenant's own principal — so
   * the CRITICAL signal reaches every operator without the log becoming global.
   */
  start(intervalMs = 20_000): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => void runAsPrincipal(systemPrincipal('runtime-supervisor'), () => this.tick()),
      intervalMs,
    );
    if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref?.();
    log.info('Runtime supervisor started', { intervalMs });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One observe → decide → recover pass. */
  async tick(): Promise<void> {
    let snap: SystemHealthSnapshot;
    try {
      snap = await this.deps.snapshot();
    } catch (err) {
      log.warn('supervisor snapshot failed', { err: String(err) });
      return;
    }

    const decision = evaluateSupervisor({
      subsystems: snap.subsystems ?? [],
      policies: this.policies,
      recentAttempts: this.history.map((r) => ({
        subsystem: r.subsystem,
        at: Date.parse(r.startedAt),
        ok: r.ok,
      })),
      nowMs: this.now(),
    });

    for (const sub of decision.escalate) {
      this.emit('runtime.supervisor.critical', 'high', {
        subsystem: sub,
        reason: 'recovery repeatedly failed',
      });
    }
    for (const sub of decision.needsManual) {
      this.emit('runtime.supervisor.warning', 'normal', {
        subsystem: sub,
        reason: 'manual recovery required',
      });
    }
    for (const action of decision.actions) {
      await this.recover(action.subsystem, action.reason);
    }
  }

  /** Attempt recovery of one subsystem now (manual trigger or from a tick). */
  async recover(subsystem: SupervisedSubsystem, reason = 'manual'): Promise<RecoveryRecord> {
    const executor = this.deps.executors[subsystem];
    const startedAt = new Date(this.now()).toISOString();
    const started = this.now();
    this.recovering.add(subsystem);
    this.emit('runtime.recovery.started', 'normal', { subsystem, reason });

    let ok = false;
    let detail: string | null = null;
    try {
      if (!executor) {
        detail = 'no recovery executor registered';
      } else {
        const res = await executor();
        ok = res.ok;
        detail = res.detail ?? null;
      }
    } catch (err) {
      ok = false;
      detail = String(err);
    } finally {
      this.recovering.delete(subsystem);
    }

    const record: RecoveryRecord = {
      id: `rec_${this.now()}_${this.seq++}`,
      subsystem,
      reason,
      startedAt,
      durationMs: this.now() - started,
      ok,
      detail,
    };
    this.history.unshift(record);
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;

    this.emit(
      ok ? 'runtime.recovery.completed' : 'runtime.recovery.failed',
      ok ? 'normal' : 'high',
      {
        subsystem,
        reason,
        durationMs: record.durationMs,
        ok,
      },
    );
    log.info('recovery attempt', { subsystem, ok, durationMs: record.durationMs });
    return record;
  }

  setPolicy(subsystem: SupervisedSubsystem, policy: RecoveryPolicy): void {
    this.policies[subsystem] = policy;
  }

  status(): SupervisorStatus {
    const failures = this.history.filter(
      (r) => !r.ok && this.now() - Date.parse(r.startedAt) < 5 * 60_000,
    ).length;
    return {
      policies: { ...this.policies },
      recovering: [...this.recovering],
      lastRecovery: this.history[0] ?? null,
      recoveryCount: this.history.length,
      recentFailures: failures,
    };
  }

  getHistory(): RecoveryRecord[] {
    return [...this.history];
  }

  private emit(
    type: string,
    priority: string,
    metadata: Record<string, string | number | boolean | null>,
  ): void {
    this.deps.publish?.({
      type,
      category: 'runtime',
      source: 'runtime-supervisor',
      priority,
      metadata,
    });
  }
}
