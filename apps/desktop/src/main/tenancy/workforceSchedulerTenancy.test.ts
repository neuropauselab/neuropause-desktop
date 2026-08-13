/**
 * P13C Part 3, Phase 4 — the workforce scheduler.
 *
 * The program states the case exactly: a schedule that belongs to A must
 * execute as A, and must not execute as B merely because B happens to be active
 * in the UI when the queue drains. A queue makes that failure certain rather
 * than merely possible — `enqueue` and `drain` are separated by up to a second,
 * and a tenant switch is a keystroke.
 */
import { describe, expect, it } from 'vitest';
import type { JobSpec, TenantScope } from '@neuropause/shared';
import { Scheduler } from '../workforce/runtime/scheduler';
import type { WorkerRuntime } from '../workforce/runtime/workerRuntime';
import { principalScope, resolveTenantScope } from './backgroundPrincipal';
import { OTHER_TENANT_SCOPE, TEST_TENANT_SCOPE } from './testScope';

const A = TEST_TENANT_SCOPE;
const B = OTHER_TENANT_SCOPE;

/**
 * A runtime that records the tenant each job RAN as.
 *
 * Standing in for the real `executeQueued`, whose every downstream store read
 * resolves through the same `resolveTenantScope` this records.
 */
function recordingRuntime(): { runtime: WorkerRuntime; ranAs: (string | undefined)[] } {
  const ranAs: (string | undefined)[] = [];
  const runtime = {
    createQueued: () => undefined,
    executeQueued: () => {
      ranAs.push(principalScope()?.tenantId);
    },
  } as unknown as WorkerRuntime;
  return { runtime, ranAs };
}

const spec = (id: string): JobSpec => ({ workerId: id, skillId: 'skill', input: {} }) as JobSpec;

describe('a queued job runs as the tenant that queued it', () => {
  it('A’s job executes as A even though B is active when it drains', () => {
    let session: TenantScope | null = A;
    const { runtime, ranAs } = recordingRuntime();
    const scheduler = new Scheduler(runtime, {
      resolveScope: () => session,
      newId: () => 'job-1',
    });

    scheduler.enqueue(spec('worker-a')); // queued while A is active
    session = B; // the user switches organizations
    scheduler.drain();

    expect(ranAs).toEqual([A.tenantId]);
    // and the session really had moved on:
    expect(resolveTenantScope(() => session)?.tenantId).toBe(B.tenantId);
  });

  it('two tenants’ jobs in ONE queue each execute as their own tenant', () => {
    let session: TenantScope | null = A;
    let n = 0;
    const { runtime, ranAs } = recordingRuntime();
    const scheduler = new Scheduler(runtime, {
      resolveScope: () => session,
      newId: () => `job-${(n += 1)}`,
    });

    scheduler.enqueue(spec('worker-a'));
    session = B;
    scheduler.enqueue(spec('worker-b'));
    session = null; // nobody signed in by the time the timer fires

    scheduler.drain();

    expect(ranAs).toEqual([A.tenantId, B.tenantId]);
  });

  it('leaves NO principal behind after draining', () => {
    const { runtime } = recordingRuntime();
    const scheduler = new Scheduler(runtime, { resolveScope: () => A, newId: () => 'j' });
    scheduler.enqueue(spec('w'));
    scheduler.drain();
    expect(principalScope()).toBeNull();
  });
});

describe('fail-closed', () => {
  it('DROPS a job enqueued with no resolvable tenant rather than running it', () => {
    const { runtime, ranAs } = recordingRuntime();
    const dropped: string[] = [];
    const scheduler = new Scheduler(runtime, { resolveScope: () => null, newId: () => 'job-x' });
    scheduler.on('dropped', (id: string) => dropped.push(id));

    scheduler.enqueue(spec('w'));
    scheduler.drain();

    expect(ranAs).toEqual([]);
    expect(dropped).toEqual(['job-x']);
  });

  it('does not fall back to whoever is active at drain time', () => {
    let session: TenantScope | null = null;
    const { runtime, ranAs } = recordingRuntime();
    const scheduler = new Scheduler(runtime, {
      resolveScope: () => session,
      newId: () => 'job-y',
    });

    scheduler.enqueue(spec('w')); // no tenant at enqueue
    session = B; // …and a tenant appears before the drain
    scheduler.drain();

    expect(ranAs).toEqual([]); // still refused — B did not queue this
  });
});

describe('backwards compatibility', () => {
  /**
   * The runtime's own suite drives `drain()` directly to assert execution
   * ordering, with no tenancy involved. Those tests construct the scheduler
   * without a resolver, and must keep passing unchanged — a security change
   * that silently disables an unrelated suite is a change nobody can review.
   */
  it('runs normally when no resolver is configured', () => {
    const { runtime, ranAs } = recordingRuntime();
    const scheduler = new Scheduler(runtime, { newId: () => 'j' });
    scheduler.enqueue(spec('w'));
    scheduler.drain();
    expect(ranAs).toEqual([undefined]); // ran, with no principal imposed
  });
});
