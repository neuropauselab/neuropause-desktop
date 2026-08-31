/**
 * D-7b · SITE 2 — A REFUSED SYNC ACTION SPEAKS, AND A PAUSE DOES NOT LIE.
 *
 * `ConnectionProvider` exposes `resumeSync` / `pauseSync` / `syncNow`, each of
 * which drove `ipc.cloud.liveSyncSetOnline` / `liveSyncNow` and swallowed every
 * failure with `.catch(() => undefined)`. Because the permission gate
 * (`cloud:manage`) throws at the secure-bridge boundary, a signed-in user
 * without that permission — or anyone hitting a dead/timed-out channel — clicked
 * Resume / Pause / Sync-now and got NOTHING: no state change, no message. Worse,
 * `pauseSync`'s "Sync paused" toast sat INSIDE `.then`, so a failed pause
 * produced neither the toast nor an error.
 *
 * FOUR things are pinned here:
 *  1. every refused action now raises an `error` toast that is ANNOUNCED
 *     (role="alert", aria-live="assertive"), carrying the boundary message
 *     VERBATIM (the D-6 wrapper already restored the clean text);
 *  2. a failed pause does NOT emit the "Sync paused" success toast;
 *  3. a pause that resolves a no-op (EMPTY_SYNC_STATUS, online:true — the
 *     no-active-org case) does NOT claim "Sync paused" it did not achieve;
 *  4. each action uses its OWN dedupe key, so a pause failure and a resume
 *     failure coexist instead of overwriting one another.
 *
 * The failure assertions are themselves the negative control against the old
 * code: `.catch(() => undefined)` swallows the rejection, so no alert ever
 * appears and (2)/(3)/(4) cannot hold. The success controls assert the real
 * channel was reached (call counters + `unroutedChannels()`), which excludes the
 * D-7 trap where a mistyped `IpcChannel` constant makes a refusal test pass on an
 * UNROUTED throw.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels } from './setup';
import { IpcChannel } from '@neuropause/shared';

import { ToastProvider } from '@renderer/state/ToastProvider';
import { ConnectionProvider, useConnection } from '@renderer/state/ConnectionProvider';

// The real LiveSyncStatus shape (types.ts:53). Only state/online/pendingCount
// are read by the provider; the rest keep the fixture honest.
const OK_ONLINE = { state: 'idle', online: true, pendingCount: 0, failures: 0, lastError: null, lastSyncedAt: null, cursor: 0 };
const OK_PAUSED = { ...OK_ONLINE, online: false };
// The verbatim boundary refusal for a `cloud:manage` channel.
const REFUSAL = 'Not authorized: missing permission "cloud:manage".';

/**
 * A consumer of the REAL context, so the write paths run as production runs them.
 * Three plain buttons reach all three actions from one render — the real
 * `ConnectionIndicator` hides them behind a menu and renders Resume/Pause
 * conditionally, which cannot exercise every failure path from a single mount.
 */
function Probe(): JSX.Element {
  const { pauseSync, resumeSync, syncNow } = useConnection();
  return (
    <div>
      <button type="button" onClick={() => void pauseSync()}>probe-pause</button>
      <button type="button" onClick={() => void resumeSync()}>probe-resume</button>
      <button type="button" onClick={() => void syncNow()}>probe-syncnow</button>
    </div>
  );
}

function mount(): void {
  render(
    <ToastProvider>
      <ConnectionProvider>
        <Probe />
      </ConnectionProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  cleanup();
  clearRoutes();
  // A CLEAN MOUNT: the heartbeat resolves (→ 'online') and the sync poll returns
  // a real status, so the connection-transition effect raises no 'connection'
  // toast (it skips the first resolved reading). The ONLY alerts a test sees are
  // the ones the action under test raises.
  route(IpcChannel.AppGetInfo, () => ({}));
  route(IpcChannel.LiveSyncStatus, () => OK_ONLINE);
});

describe('ConnectionProvider — a refused sync action speaks (D-7b Site 2)', () => {
  it('a refused PAUSE announces the reason and shows no "Sync paused"', async () => {
    let calls = 0;
    route(IpcChannel.LiveSyncSetOnline, () => { calls++; throw new Error(REFUSAL); });
    mount();

    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-pause' }));

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive'); // announced, not merely present
    expect(alert.textContent).toContain('cloud:manage');     // boundary message, verbatim
    expect(screen.queryByText('Sync paused')).toBeNull();     // the success toast did NOT fire
    expect(calls).toBe(1);                                    // the channel really was reached
  });

  it('a refused RESUME announces the reason', async () => {
    let calls = 0;
    route(IpcChannel.LiveSyncSetOnline, () => { calls++; throw new Error(REFUSAL); });
    mount();

    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-resume' }));

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent).toContain('cloud:manage');
    expect(calls).toBe(1);
  });

  it('a refused SYNC NOW announces the reason', async () => {
    let calls = 0;
    route(IpcChannel.LiveSyncNow, () => { calls++; throw new Error(REFUSAL); });
    mount();

    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-syncnow' }));

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent).toContain('cloud:manage');
    expect(calls).toBe(1);
  });

  it('a bare-string rejection still announces something — never an empty alert', async () => {
    // D-6 fallback: a non-Error rejection must not collapse to a blank banner.
    route(IpcChannel.LiveSyncNow, () => { throw 'a bare string'; });
    mount();

    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-syncnow' }));

    const alert = await screen.findByRole('alert');
    expect((alert.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('a pause failure and a resume failure COEXIST (per-action dedupe keys)', async () => {
    // A single shared key would replace-in-place, erasing the pause failure the
    // instant the resume failure lands. Distinct keys keep both readable.
    route(IpcChannel.LiveSyncSetOnline, () => { throw new Error(REFUSAL); });
    mount();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'probe-pause' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'probe-resume' }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBe(2));
    const text = screen.getAllByRole('alert').map((a) => a.textContent ?? '').join(' | ');
    expect(text).toContain('resume');
    expect(text).toContain('pause');
  });
});

describe('ConnectionProvider — success is preserved and not accidental (D-7b Site 2)', () => {
  it('a successful PAUSE shows the "Sync paused" info toast and NO alert', async () => {
    let calls = 0;
    route(IpcChannel.LiveSyncSetOnline, () => { calls++; return OK_PAUSED; });
    mount();

    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-pause' }));

    await screen.findByText('Sync paused');                  // success behaviour preserved
    expect(screen.queryByRole('alert')).toBeNull();          // info is role="status", not alert
    expect(calls).toBe(1);
  });

  it('a pause that resolves a NO-OP (no active org) does NOT claim "Sync paused"', async () => {
    // EMPTY_SYNC_STATUS resolves with online:true — nothing was paused, so the
    // provider must not assert that it was.
    route(IpcChannel.LiveSyncSetOnline, () => OK_ONLINE);
    mount();

    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-pause' }));

    // Give the microtask + any toast a chance to land, then assert neither did.
    await waitFor(() => undefined);
    expect(screen.queryByText('Sync paused')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a successful SYNC NOW reaches the channel and raises no alert', async () => {
    let calls = 0;
    route(IpcChannel.LiveSyncNow, () => { calls++; return OK_ONLINE; });
    mount();

    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-syncnow' }));

    await waitFor(() => expect(calls).toBe(1));              // catches a wrong IpcChannel constant
    expect(screen.queryByRole('alert')).toBeNull();
    expect(unroutedChannels()).toEqual([]);                 // nothing silently unrouted
  });
});
