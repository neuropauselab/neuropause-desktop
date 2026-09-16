/**
 * O-3 — the reachability channel answers before runtime core exists.
 *
 * NEGATIVE CONTROL: remove the `registerEarlyReachabilityHandler()` call from
 * `index.ts` bootstrap and case 1 fails — the channel has no handler and the
 * renderer's invoke rejects, which is exactly what the 13:09 cold start logged
 * twice.
 *
 * STATED LIMIT: `ipcMain` is mocked here, including its real throw-on-duplicate
 * behaviour, because the registration ORDER is what is under test and that is a
 * property of the module graph rather than of Electron. The end-to-end ordering
 * (early handler, then window, then runtime core taking it over) is asserted by
 * the bootstrap sequence in `index.ts`, not by this file.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
  trusted: true,
}));

vi.mock('electron', () => ({
  ipcMain: {
    // Mirrors Electron: a second handler for the same channel throws.
    handle(channel: string, fn: (event: unknown, payload?: unknown) => unknown) {
      if (state.handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`);
      }
      state.handlers.set(channel, fn);
    },
    removeHandler(channel: string) {
      state.handlers.delete(channel);
    },
  },
}));
vi.mock('./router', () => ({ isTrustedSenderFrame: () => state.trusted }));

import { IpcChannel } from '@neuropause/shared';
import { NOT_YET_PROBED, registerEarlyReachabilityHandler } from './earlyReachability';

beforeEach(() => {
  state.handlers.clear();
  state.trusted = true;
});

describe('O-3 — system:backendReachability is answerable at bootstrap', () => {
  it('has no handler until it is registered — the failure this fixes', () => {
    expect(state.handlers.has(IpcChannel.BackendReachability)).toBe(false);
  });

  it('answers "not asked yet" rather than throwing, once registered', async () => {
    registerEarlyReachabilityHandler();
    const handler = state.handlers.get(IpcChannel.BackendReachability);
    expect(handler).toBeTypeOf('function');

    const result = await handler!({});

    // checkedAt === null is the signal BackendReachabilityNotice reads as
    // "still checking". Rendering this as an outage was the F-7 defect; the
    // early handler must produce the unknown shape, never a false negative.
    expect(result).toEqual({ reachable: false, checkedAt: null, lastError: null });
  });

  it('carries exactly the three F-7 fields and never widens', async () => {
    registerEarlyReachabilityHandler();
    const result = (await state.handlers.get(IpcChannel.BackendReachability)!({})) as object;

    // The payload crosses an UNAUTHENTICATED channel. A url, host, latency or
    // failure count added here would be a disclosure, not a convenience.
    expect(Object.keys(result).sort()).toEqual(['checkedAt', 'lastError', 'reachable']);
  });

  it('applies the same origin check as every other channel', () => {
    registerEarlyReachabilityHandler();
    state.trusted = false;
    expect(() => state.handlers.get(IpcChannel.BackendReachability)!({})).toThrow('Untrusted sender');
  });

  it('registration is idempotent, so runtime core can take the channel over', () => {
    registerEarlyReachabilityHandler();
    // Electron throws on a duplicate handle(); this must not, because
    // registerSecureHandlers now removes before it registers and relies on
    // exactly this being safe.
    expect(() => registerEarlyReachabilityHandler()).not.toThrow();
    expect(state.handlers.size).toBe(1);
  });

  it('the exported constant is frozen — a caller cannot mutate the shared answer', () => {
    expect(Object.isFrozen(NOT_YET_PROBED)).toBe(true);
  });
});
