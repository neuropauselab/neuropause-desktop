/**
 * D-7b · SITE 3 — A REFUSED FAVORITE / SAVE-VIEW SPEAKS.
 *
 * `EnterpriseView`'s header star (favorite) and pin (save current view) buttons
 * called `ipc.enterprise.personalization.favorite` / `saveView` and swallowed
 * every failure with `.catch(() => undefined)`. Both channels are
 * `dashboard:read` + requireAuth, so a not-signed-in, non-member, or
 * under-permissioned actor is REJECTED at the secure-bridge boundary — and the
 * click did nothing and said nothing (no state change, no message).
 *
 * The fix raises an ANNOUNCED `error` toast (role="alert", aria-live="assertive")
 * carrying the D-6-cleaned boundary message VERBATIM, with a per-action dedupe
 * key. The success arm (`setPersonalization`, which fills the star) is unchanged.
 *
 * The failure assertions are the negative control against the old code:
 * `.catch(() => undefined)` swallows the rejection, so no alert appears. The
 * success control asserts the real channel was reached (`calls === 1` +
 * `unroutedChannels()` empty), excluding the D-7 trap where a mistyped
 * `IpcChannel` constant makes a refusal test pass on an UNROUTED throw.
 *
 * Harness: the code under test is `EnterpriseInner` (the star/pin handlers), so
 * `EnterpriseProvider` and `ShellProvider` are mocked (the provider held in an
 * ERROR state — the body collapses to the light `EnterpriseUnavailable` with no
 * panel IPC, while the header and its buttons still render), and the REAL
 * `ToastProvider` supplies the alert surface under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels } from './setup';
import { IpcChannel, emptyPersonalizationState } from '@neuropause/shared';
import { ToastProvider } from '@renderer/state/ToastProvider';

// EnterpriseInner reads only { enterpriseTab, clearEnterpriseTab } from the shell.
vi.mock('@renderer/state/ShellProvider', () => ({
  useShell: () => ({ enterpriseTab: null, clearEnterpriseTab: vi.fn() }),
}));

// Mock BOTH exports EnterpriseView imports. Error state => the body is the light
// EnterpriseUnavailable (no panel IPC) while the header star/pin still render.
vi.mock('@renderer/enterprise/EnterpriseProvider', () => ({
  EnterpriseProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useEnterprise: () => ({
    ready: false,
    error: 'Enterprise is unavailable',
    denied: false,
    refreshAll: vi.fn(),
    jobs: [],
  }),
}));

import { EnterpriseRoot } from '@renderer/enterprise/EnterpriseView';

// The verbatim boundary refusal for a `dashboard:read` channel.
const REFUSAL = 'Not authorized: missing permission "dashboard:read".';

const FAVORITED = {
  ...emptyPersonalizationState(),
  favorites: [{ id: 'tab:command', kind: 'surface', label: 'Command Center', tab: 'command', addedAt: '' }],
};

function mount(): void {
  render(
    <ToastProvider>
      <EnterpriseRoot />
    </ToastProvider>,
  );
}

beforeEach(() => {
  cleanup();
  clearRoutes();
  localStorage.clear(); // loadNavPrefs reads localStorage; cleared => 'command' tab enabled, buttons shown
  route(IpcChannel.EnterprisePersonalizationGet, () => emptyPersonalizationState()); // the only mount IPC
});

describe('EnterpriseView — a refused favorite/save-view speaks (D-7b Site 3)', () => {
  it('a refused FAVORITE announces the reason', async () => {
    let calls = 0;
    route(IpcChannel.EnterprisePersonalizationFavorite, () => { calls++; throw new Error(REFUSAL); });
    mount();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add to favorites' }));

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive'); // announced, not merely present
    expect(alert.textContent).toContain('dashboard:read');      // boundary message, verbatim
    expect(calls).toBe(1);                                       // the channel really was reached
  });

  it('a refused SAVE VIEW announces the reason', async () => {
    let calls = 0;
    route(IpcChannel.EnterprisePersonalizationSaveView, () => { calls++; throw new Error(REFUSAL); });
    mount();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Save current view' }));

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent).toContain('dashboard:read');
    expect(calls).toBe(1);
  });

  it('a bare-string rejection still announces something — never an empty alert', async () => {
    route(IpcChannel.EnterprisePersonalizationFavorite, () => { throw 'a bare string'; });
    mount();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add to favorites' }));

    const alert = await screen.findByRole('alert');
    expect((alert.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('a favorite failure and a save-view failure COEXIST (per-action dedupe keys)', async () => {
    route(IpcChannel.EnterprisePersonalizationFavorite, () => { throw new Error(REFUSAL); });
    route(IpcChannel.EnterprisePersonalizationSaveView, () => { throw new Error(REFUSAL); });
    mount();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add to favorites' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Save current view' }));

    // Distinct keys => both survive; a single shared key would replace-in-place.
    await vi.waitFor(() => expect(screen.getAllByRole('alert').length).toBe(2));
  });
});

describe('EnterpriseView — success is preserved and not accidental (D-7b Site 3)', () => {
  it('a successful FAVORITE fills the star and raises no alert', async () => {
    let calls = 0;
    route(IpcChannel.EnterprisePersonalizationFavorite, () => { calls++; return FAVORITED; });
    mount();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add to favorites' }));

    // Success behaviour preserved: setPersonalization runs → the star relabels.
    expect(await screen.findByRole('button', { name: 'Remove from favorites' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(calls).toBe(1);                       // catches a wrong IpcChannel constant
    expect(unroutedChannels()).toEqual([]);      // nothing silently unrouted
  });
});
