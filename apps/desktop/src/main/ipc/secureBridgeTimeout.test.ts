/**
 * SEAM-B.15 / GATE-R.9 · TARGET B — the secure-bridge withTimeout path, pinned.
 *
 * B.14 measured (§34 class 15): transport-level timeout/lost-response is pinned
 * (UNKNOWN, never retried — the flagship H-J pin), but nothing drove the
 * BRIDGE-level timeout (`withTimeout`, secureBridge.ts:119-134;
 * `def.timeoutMs ?? DEFAULT_TIMEOUT_MS` at :164). This file closes that gap.
 *
 * §2 #17 — the REAL path: `runSecureHandler` from the production bridge (the
 * channelAuthorityTenancy harness precedent), with a plain def object and a
 * manually-settled handler promise. MEASURED semantics (from source, then
 * asserted here): the timeout REJECTS THE CALLER while the handler promise
 * keeps running — TIMEOUT_IS_NOT_CANCELLATION (no AbortController, no signal;
 * a late settle resolves an already-settled wrapper, a silent no-op per the
 * Promise spec). Auth, RBAC and schema validation run BEFORE and OUTSIDE the
 * timeout wrap, so a timeout can never bypass authorization.
 *
 * Constitutional property (B.15 §48): TIMEOUT ≠ SUCCESS · TIMEOUT ≠ CANCELLATION.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getAppPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getName: () => 'neuropause-test',
    isPackaged: false,
    on: () => undefined,
    once: () => undefined,
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: () => undefined, on: () => undefined, removeHandler: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
}));

import { runSecureHandler, type AnySecureHandlerDef } from './secureBridge';
import type { IpcChannelName } from '@neuropause/shared';

const CHANNEL = 'b15:timeout-probe' as IpcChannelName;
const DEPS = { isAuthenticated: () => true };

function probeDef(handler: (payload: unknown) => unknown | Promise<unknown>, timeoutMs?: number): AnySecureHandlerDef {
  return {
    channel: CHANNEL,
    schema: z.object({}).strict(),
    handler,
    requireAuth: true,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  } as AnySecureHandlerDef;
}

describe('SEAM-B.15 · Target B — the secure-bridge timeout path', () => {
  it('CONTROL: a handler that completes before the timeout resolves normally (one invocation)', async () => {
    let ran = 0;
    const def = probeDef(() => {
      ran += 1;
      return { ok: true };
    }, 1_000);
    await expect(runSecureHandler(def, {}, DEPS)).resolves.toEqual({ ok: true });
    expect(ran).toBe(1);
  });

  it('THE PIN: a handler exceeding def.timeoutMs rejects the CALLER with the named IpcError — one invocation, no fabricated success', async () => {
    let ran = 0;
    const def = probeDef(() => {
      ran += 1;
      return new Promise(() => undefined); // never settles within the window
    }, 20);
    const attempt = runSecureHandler(def, {}, DEPS);
    await expect(attempt).rejects.toThrow(`Request timed out: ${CHANNEL}`);
    await expect(attempt).rejects.toMatchObject({ name: 'IpcError' });
    expect(ran).toBe(1); // invoked exactly once — a timeout never re-invokes
  });

  it('LATE COMPLETION (measured): the handler KEEPS RUNNING after the timeout — its side effect lands, the settled rejection is unchanged, no second invocation', async () => {
    let ran = 0;
    let lateEffects = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const def = probeDef(async () => {
      ran += 1;
      await gate; // held open past the timeout
      lateEffects += 1; // the handler's own side effect, AFTER the caller already timed out
      return { ok: true };
    }, 20);

    const attempt = runSecureHandler(def, {}, DEPS);
    await expect(attempt).rejects.toThrow(/Request timed out/);
    expect(lateEffects).toBe(0); // not yet — the handler is still parked

    release(); // the executor completes AFTER the caller's rejection settled
    await new Promise((r) => setTimeout(r, 10));

    // TIMEOUT_IS_NOT_CANCELLATION — the late side effect DID run (measured
    // semantics, recorded, not silently "fixed"); the wrapper was already
    // settled, so the late resolve is a spec-level no-op: the caller's
    // rejection stands, and the handler was never invoked a second time.
    expect(lateEffects).toBe(1);
    expect(ran).toBe(1);
    await expect(attempt).rejects.toThrow(/Request timed out/); // still the same settled rejection
  });

  it('LATE REJECTION is equally discarded — no unhandled rejection escapes the settled wrapper', async () => {
    let release!: (e: Error) => void;
    const gate = new Promise<never>((_r, rej) => {
      release = rej;
    });
    const def = probeDef(() => gate, 20);
    const attempt = runSecureHandler(def, {}, DEPS);
    await expect(attempt).rejects.toThrow(/Request timed out/);
    release(new Error('late failure after timeout'));
    await new Promise((r) => setTimeout(r, 10));
    await expect(attempt).rejects.toThrow(/Request timed out/); // the late rejection never replaces it
    // (an escaped unhandled rejection would fail this vitest run — the wrapper's
    // attached callbacks absorb the late settle)
  });

  it('SAFETY: the timeout wraps ONLY the handler — auth and RBAC precede it, so a timeout can never bypass authorization', async () => {
    let ran = 0;
    const def = probeDef(() => {
      ran += 1;
      return new Promise(() => undefined);
    }, 5);
    // Unauthenticated: refused BEFORE the timeout wrap is ever entered.
    await expect(runSecureHandler(def, {}, { isAuthenticated: () => false })).rejects.toThrow(/sign in/i);
    expect(ran).toBe(0);
    // A permissioned def with no authorize dep: fails closed pre-timeout.
    const permDef = { ...def, permission: 'operations:manage' } as AnySecureHandlerDef;
    await expect(runSecureHandler(permDef, {}, { isAuthenticated: () => true })).rejects.toThrow(
      /Authorization is not available/,
    );
    expect(ran).toBe(0);
  });

  it('§24 row 4: a second attempt after a timeout is a FULL new pass through the gate — no unauthorized duplicate path exists', async () => {
    let ran = 0;
    const def = probeDef(() => {
      ran += 1;
      return ran === 1 ? new Promise(() => undefined) : { ok: true, attempt: ran };
    }, 20);
    await expect(runSecureHandler(def, {}, DEPS)).rejects.toThrow(/Request timed out/);
    expect(ran).toBe(1);
    // The retry is a NEW invocation through auth + schema + handler — nothing
    // reuses the timed-out attempt, and nothing retried it implicitly.
    await expect(runSecureHandler(def, {}, DEPS)).resolves.toEqual({ ok: true, attempt: 2 });
    expect(ran).toBe(2);
  });
});
