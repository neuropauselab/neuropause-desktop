/**
 * D-7b · SITE 6 — A REFUSED FAVORITE REMOVAL ON THE PERSONALIZATION PANEL SPEAKS.
 *
 * PersonalizationPanel's shared `run` helper had NO catch: `onMutate(await op())`
 * in a bare try/finally. When the RBAC-gated `ipc.enterprise.personalization.*`
 * (dashboard:read + requireAuth) rejects at the secure-bridge boundary, `await
 * op()` threw, `onMutate` never ran, `finally` cleared the spinner, and the
 * rejection escaped UNHANDLED — the "Remove" click did nothing and said nothing.
 * The fix wraps the awaited op in try/catch and raises an ANNOUNCED `error` toast
 * (role="alert", aria-live="assertive") with the verbatim boundary message,
 * keyed per action+item; `onMutate(next)` runs only after a successful op.
 *
 * Fixing the SHARED helper closes all four writes (Remove / Clear / Rename /
 * Delete), the WorkspaceSwitcher precedent; Remove-favorite is the named Site 6.
 *
 * The failure test is the NEGATIVE CONTROL: restore the no-catch `run` → no alert
 * is raised → findByRole('alert') times out → red. (Verified by mutation below.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels } from './setup';
import { IpcChannel, emptyPersonalizationState, type PersonalizationState } from '@neuropause/shared';
import { ToastProvider } from '@renderer/state/ToastProvider';
import { PersonalizationPanel } from '@renderer/enterprise/PersonalizationPanel';

/** One pinned favorite → exactly one "Remove" button renders. */
const STATE: PersonalizationState = {
  ...emptyPersonalizationState(),
  favorites: [
    { id: 'fav-analytics', kind: 'surface', label: 'Pinned Analytics', tab: 'analytics', addedAt: '2026-01-01T00:00:00.000Z' },
  ],
};

// The verbatim boundary refusal for a `dashboard:read` channel.
const REFUSAL = 'Not authorized: missing permission "dashboard:read".';

function mount(onMutate: (s: PersonalizationState) => void): void {
  render(
    <ToastProvider>
      <PersonalizationPanel state={STATE} onNavigate={vi.fn()} onMutate={onMutate} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  cleanup();
  clearRoutes();
  // Presentational panel — it fires NO IPC on mount; the only channel that ever
  // needs routing is the click, routed per test.
});

describe('PersonalizationPanel — a refused favorite removal speaks (D-7b Site 6)', () => {
  it('a refused REMOVE announces the reason and does not mutate', async () => {
    let mutateCalls = 0;
    let channelCalls = 0;
    route(IpcChannel.EnterprisePersonalizationFavorite, () => { channelCalls++; throw new Error(REFUSAL); });

    mount(() => { mutateCalls++; });
    expect(screen.queryByRole('alert')).toBeNull(); // no alert at mount

    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove' }));

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive'); // announced, not merely present
    expect(alert.textContent).toContain('dashboard:read');      // boundary message, verbatim
    expect(channelCalls).toBe(1);                               // the channel really was reached
    expect(mutateCalls).toBe(0);                               // removal did NOT happen
    expect(screen.getByText('Pinned Analytics')).toBeTruthy();  // favorite row still shown
  });

  it('a bare-string rejection still announces something — never an empty alert', async () => {
    route(IpcChannel.EnterprisePersonalizationFavorite, () => { throw 'a bare string'; });
    mount(() => undefined);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove' }));

    const alert = await screen.findByRole('alert');
    expect((alert.textContent ?? '').trim().length).toBeGreaterThan(0);
  });
});

describe('PersonalizationPanel — success is preserved and not accidental (D-7b Site 6)', () => {
  it('a successful REMOVE lifts the new (favorite-free) state up and raises no alert', async () => {
    let mutateCalls = 0;
    let last: PersonalizationState | null = null;
    let channelCalls = 0;
    const REMOVED: PersonalizationState = { ...STATE, favorites: [] };
    route(IpcChannel.EnterprisePersonalizationFavorite, () => { channelCalls++; return REMOVED; });

    mount((s) => { mutateCalls++; last = s; });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(mutateCalls).toBe(1)); // run() floats the promise; wait for it
    expect(last?.favorites).toEqual([]);              // lifted the removed-favorite state up
    expect(screen.queryByRole('alert')).toBeNull();
    expect(channelCalls).toBe(1);                     // catches a wrong IpcChannel constant
    expect(unroutedChannels()).toEqual([]);          // nothing silently unrouted
  });
});
