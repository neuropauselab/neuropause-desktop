/**
 * P13C ROUND 48 — GATE 1. THE BOOT-WINDOW RETRY AT THE INVOKE CHOKEPOINT.
 *
 * The window deliberately opens before the runtime core (round 36), so any
 * surface that invokes on mount could fail once with "No handler registered".
 * Rounds 36/39 taught exactly two consumers to retry; a live fresh-profile
 * boot still showed ELEVEN other channels failing at first paint. The general
 * fix is one retry at the single place every call passes (`invoke` in
 * lib/ipc.ts): a no-handler rejection waits for the runtime-ready signal and
 * retries once. These tests drive the REAL `ipc` namespace through the harness
 * bridge and pin every race: happy retry, already-ready (missed event),
 * runtime FAILED, timeout, genuinely-missing channel, and non-boot errors.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { route, clearRoutes, emitBroadcast } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { ipc, __setBootRetryTimeoutForTests } from '@renderer/lib/ipc';

const NO_HANDLER = "No handler registered for 'onboarding:status'";

beforeEach(() => {
  cleanupState();
});

function cleanupState(): void {
  clearRoutes();
  // Reset the cached ready-wait AND keep the timeout short enough to test.
  __setBootRetryTimeoutForTests(400);
}

describe('the boot-window retry (Gate 1, round 48)', () => {
  it('a boot-raced call resolves after the ready broadcast — one retry, right answer', async () => {
    let calls = 0;
    route(IpcChannel.OnboardingStatus, () => {
      calls += 1;
      if (calls === 1) throw new Error(NO_HANDLER);
      return { steps: [], completed: 1, total: 3 };
    });

    const pending = ipc.onboarding.status();
    await new Promise((r) => setTimeout(r, 10));
    emitBroadcast(IpcChannel.RuntimeStateChanged, { state: 'ready', message: null });

    const result = (await pending) as { completed: number };
    expect(result.completed).toBe(1);
    expect(calls).toBe(2);
  });

  it('the MISSED-EVENT race: ready happened before the failure — the state query answers, no broadcast needed', async () => {
    // The base-router state channel already says ready (the transition fired
    // before this call ever subscribed).
    route(IpcChannel.RuntimeState, () => ({ state: 'ready', message: null }));
    let calls = 0;
    route(IpcChannel.OnboardingStatus, () => {
      calls += 1;
      if (calls === 1) throw new Error(NO_HANDLER);
      return { steps: [], completed: 2, total: 3 };
    });

    const result = (await ipc.onboarding.status()) as { completed: number };
    expect(result.completed).toBe(2);
    expect(calls).toBe(2);
  });

  it('a FAILED runtime gives up honestly — the original failure surfaces, no retry', async () => {
    let calls = 0;
    route(IpcChannel.OnboardingStatus, () => {
      calls += 1;
      throw new Error(NO_HANDLER);
    });

    const pending = ipc.onboarding.status();
    await new Promise((r) => setTimeout(r, 10));
    emitBroadcast(IpcChannel.RuntimeStateChanged, { state: 'failed', message: 'init exploded' });

    await expect(pending).rejects.toThrow(/No handler registered/);
    expect(calls).toBe(1); // dead channels are not poked again on a failed runtime
  });

  it('a TIMEOUT gives up honestly — nothing ever says ready, the original failure surfaces', async () => {
    __setBootRetryTimeoutForTests(60);
    let calls = 0;
    route(IpcChannel.OnboardingStatus, () => {
      calls += 1;
      throw new Error(NO_HANDLER);
    });

    await expect(ipc.onboarding.status()).rejects.toThrow(/No handler registered/);
    expect(calls).toBe(1);
  });

  it('a GENUINELY missing channel does not loop: one retry after ready, then the failure surfaces', async () => {
    let calls = 0;
    route(IpcChannel.OnboardingStatus, () => {
      calls += 1;
      throw new Error(NO_HANDLER); // still unregistered even after ready
    });

    const pending = ipc.onboarding.status();
    await new Promise((r) => setTimeout(r, 10));
    emitBroadcast(IpcChannel.RuntimeStateChanged, { state: 'ready', message: null });

    await expect(pending).rejects.toThrow(/No handler registered/);
    expect(calls).toBe(2); // exactly one retry — never a third attempt
  });

  it('non-boot failures pass through untouched — a denial is not retried', async () => {
    let calls = 0;
    route(IpcChannel.OnboardingStatus, () => {
      calls += 1;
      throw new Error('Not authorized: missing permission "onboarding:read".');
    });

    await expect(ipc.onboarding.status()).rejects.toThrow(/Not authorized/);
    expect(calls).toBe(1); // no wait, no retry — fail-closed semantics untouched
  });

  it('after one successful ready-wait, later boot-raced calls retry immediately (cached signal)', async () => {
    route(IpcChannel.RuntimeState, () => ({ state: 'ready', message: null }));
    let aCalls = 0;
    route(IpcChannel.OnboardingStatus, () => {
      aCalls += 1;
      if (aCalls === 1) throw new Error(NO_HANDLER);
      return { steps: [], completed: 1, total: 3 };
    });
    await ipc.onboarding.status(); // resolves via the state query

    // A second raced channel now retries without any new broadcast or query.
    let bCalls = 0;
    route(IpcChannel.CrashGetStatus, () => {
      bCalls += 1;
      if (bCalls === 1) throw new Error("No handler registered for 'crash:getStatus'");
      return { optedIn: false };
    });
    const s = (await ipc.releaseOps.crashStatus()) as { optedIn: boolean };
    expect(s.optedIn).toBe(false);
    expect(bCalls).toBe(2);
  });
});
