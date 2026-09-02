/**
 * NeuroPause Platform — health / readiness probe (ERP Session 34).
 *
 * Answers the operator's most basic question — "is NeuroPause alive, and is it actually ready to
 * safely operate?" — from REAL runtime + persistence state, read-only. It is a pure computation over
 * signals the platform already exposes: it opens no new store, runs no command, writes nothing.
 *
 * LIVENESS  = the process/runtime is alive and initialized (`runtimeReady`).
 * READINESS = every REQUIRED durable component is operational: the durable command journal's backing
 *             file is present-and-parseable (or a healthy first-run empty), and the S31 delivered-event
 *             sink likewise. A component that is present but CORRUPT is a real persistence failure
 *             (→ UNHEALTHY). A component that simply has not initialized yet is ALIVE_NOT_READY.
 *
 * The outbox PENDING count is reported as an operational METRIC, never a readiness gate: at-least-once
 * delivery is retried, so a delivery backlog is a lag to watch, not a reason the platform cannot serve
 * (a recoverable warning must not become a fatal state).
 */
import type { DurableCommandJournal } from './durableCommandJournal';
import type { DeliveredEventLog } from './deliveredEventLog';

export type HealthStatus = 'HEALTHY' | 'ALIVE_NOT_READY' | 'UNHEALTHY';
export type ComponentStatus = 'ok' | 'first-run' | 'not_ready' | 'corrupt' | 'down';

export interface PlatformHealth {
  status: HealthStatus;
  live: boolean;
  ready: boolean;
  checkedAt: string;
  components: {
    runtime: { status: 'ok' | 'not_ready' };
    journal: { status: ComponentStatus };
    delivery: { status: ComponentStatus; pendingOutbox: number | null };
  };
}

export interface PlatformHealthDeps {
  journal: DurableCommandJournal;
  deliveredLog?: DeliveredEventLog;
  /** Authoritative runtime-initialized signal (production: `runtimeIdentity.isReady()`). */
  runtimeReady: () => boolean;
}

/** A store probe result → a component status. A thrown probe means the component is DOWN. */
async function probeComponent(
  probe: () => Promise<{ ok: boolean; state: 'ok' | 'first-run' | 'corrupt' }>,
): Promise<ComponentStatus> {
  try {
    const r = await probe();
    if (r.state === 'first-run') return 'first-run';
    return r.ok ? 'ok' : 'corrupt';
  } catch {
    return 'down';
  }
}

const okOrFirstRun = (s: ComponentStatus): boolean => s === 'ok' || s === 'first-run';
const isFailed = (s: ComponentStatus): boolean => s === 'corrupt' || s === 'down';

/**
 * Compute the platform health from real state. Read-only and defensive: any single failing probe
 * degrades that component rather than throwing the whole check.
 */
export async function computePlatformHealth(deps: PlatformHealthDeps): Promise<PlatformHealth> {
  const runtimeReady = safe(() => deps.runtimeReady(), false);
  const journal = await probeComponent(() => deps.journal.probeHealth());
  const delivery = deps.deliveredLog ? await probeComponent(() => deps.deliveredLog!.probeHealth()) : ('not_ready' as ComponentStatus);
  // Pending outbox is a METRIC, not a gate. Read defensively; a throwing journal reports null.
  const pendingOutbox = safe(() => deps.journal.pendingOutbox().length, null as number | null);

  // A required durable component that is CORRUPT/DOWN is a genuine failure → UNHEALTHY.
  const failed = isFailed(journal) || isFailed(delivery);
  // Readiness needs the runtime initialized AND every required component operational.
  const ready = runtimeReady && okOrFirstRun(journal) && okOrFirstRun(delivery);

  const status: HealthStatus = failed ? 'UNHEALTHY' : ready ? 'HEALTHY' : 'ALIVE_NOT_READY';

  return {
    status,
    live: true, // the process answered — it is alive; `runtime` below distinguishes initialized
    ready,
    checkedAt: new Date().toISOString(),
    components: {
      runtime: { status: runtimeReady ? 'ok' : 'not_ready' },
      journal: { status: journal },
      delivery: { status: delivery, pendingOutbox },
    },
  };
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
