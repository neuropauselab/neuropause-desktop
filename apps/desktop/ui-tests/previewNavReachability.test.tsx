/**
 * P13C GATE 12 — the OTHER half of the round-57 decision: reachability.
 *
 * Demoting `enterprise` + `marketplace` to the Advanced disclosure was justified
 * as "placement only — nothing hidden; both stay reachable via the command
 * palette and universal search." `previewNavPlacement.test.tsx` proves the
 * PLACEMENT (hidden from the default sidebar, shown under Advanced). This proves
 * the REACHABILITY the same claim rests on, through the REAL command palette:
 * both demoted surfaces appear as "Go to" commands and navigate, while a HIDDEN
 * section never does. Before this, the "still reachable" half was asserted only
 * by a data proxy (`advanced ⇒ !hidden`) — a future `tier` filter on the palette
 * would have silently broken it with every test still green.
 *
 * The palette always shows two query-ECHO commands ("Search everywhere for …",
 * "Ask Assistant: …") that repeat whatever you type; those are not navigation to
 * a section, so the assertions filter them out and reason only about real
 * "Go to" section commands.
 *
 * Only `useAuth` (→ local) is mocked; the shell/Sidebar/CommandPalette/providers
 * are real. The palette is opened exactly as the app opens it — the `menu:command`
 * broadcast the native menu / ⌘K accelerator fires (`AppShell.tsx` onCommand).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthStatus } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { route, clearRoutes, emitBroadcast } from './setup';

vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
}));

const LOCAL: AuthStatus = {
  state: 'local',
  principal: { id: 'device-1', displayName: 'Local User', createdAt: '2026-08-18T00:00:00.000Z' },
};

vi.mock('@renderer/providers/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({
    status: LOCAL,
    initializing: false,
    loginOAuth: vi.fn(),
    loginEmail: vi.fn(),
    registerEmail: vi.fn(),
    logout: vi.fn(),
  }),
}));

import App from '@renderer/App';
import { ThemeProvider } from '@renderer/providers/ThemeProvider';

function routeBoot(): void {
  route(IpcChannel.WorkspaceCtxBootstrap, () => ({
    workspaces: [{ id: 'wsc_1', name: 'Default', color: '#8888ff' }],
    activeId: 'wsc_1',
    activeSnapshot: { activeSection: 'intent-home', tabs: [], activeTabId: null },
  }));
  route(IpcChannel.ExperienceProfileGet, () => ({
    state: 'completed', workspaceType: null, aiModeChosen: true, attributes: [],
    completedAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
  }));
  route(IpcChannel.OnboardingStatus, () => ({ firstRun: false, startedAt: null, completedAt: null, steps: [], nextStep: null }));
  route(IpcChannel.AppGetThemeSource, () => 'system');
  route(IpcChannel.AppGetInfo, () => ({ version: '0.0.0-test', platform: 'darwin', arch: 'arm64' }));
  route(IpcChannel.LiveSyncStatus, () => null);
  route(IpcChannel.IntentBoard, () => ({ intents: [], roleViews: [] }));
  route(IpcChannel.IntentWorkspaces, () => ({ workspaces: [] }));
  route(IpcChannel.IntentGovernance, () => ({}));
}

async function mountShell(): Promise<void> {
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
  await screen.findByRole('button', { name: 'Business' }, { timeout: 5000 });
}

async function openPalette(): Promise<HTMLElement> {
  // Exactly how the shell opens it: the menu/⌘K accelerator fires `menu:command`.
  emitBroadcast(IpcChannel.MenuCommand, { action: 'command-palette' });
  return screen.findByRole('dialog', { name: 'Command palette' });
}

/** The two commands that merely echo the typed query — not a section destination. */
const isQueryEcho = (el: Element): boolean => /Search everywhere|Ask Assistant/i.test(el.textContent ?? '');

beforeEach(() => {
  cleanup();
  clearRoutes();
});
afterEach(() => cleanup());

describe('P13C Gate 12 — demoted preview surfaces stay reachable via the command palette', () => {
  it('Enterprise Marketplace is reachable via the palette and navigates on select', async () => {
    routeBoot();
    const user = userEvent.setup();
    await mountShell();

    const dialog = await openPalette();
    await user.type(within(dialog).getByPlaceholderText(/Search everything/i), 'Enterprise Marketplace');

    // A real "Go to" section command (not the query-echo hand-offs) for the demoted surface.
    const hits = (await within(dialog).findAllByRole('button', { name: /Enterprise Marketplace/ })).filter(
      (b) => !isQueryEcho(b),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);

    // Selecting it acts (exec → setSection → the palette closes).
    await user.click(hits[0]);
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('Enterprise (the demoted command center) is reachable via the palette', async () => {
    routeBoot();
    const user = userEvent.setup();
    await mountShell();

    const dialog = await openPalette();
    await user.type(within(dialog).getByPlaceholderText(/Search everything/i), 'Enterprise');

    // Matched by its unique description subtitle so it can't be a query-echo or the Marketplace row.
    const hits = await within(dialog).findAllByRole('button', { name: /executive command center/i });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('a HIDDEN section never appears as a palette "Go to" command (negative control)', async () => {
    routeBoot();
    const user = userEvent.setup();
    await mountShell();

    const dialog = await openPalette();
    // `control-plane` is hidden:true → superseded by Cloud; it must never be navigable here.
    await user.type(within(dialog).getByPlaceholderText(/Search everything/i), 'Control Plane');

    // The only /Control Plane/ buttons are the two query-echo hand-offs; there is NO
    // section "Go to" for the hidden control-plane. (The advanced surfaces above DID
    // resolve — so the palette filters on `hidden`, not on `tier`/`preview`.)
    const sectionHits = within(dialog)
      .queryAllByRole('button', { name: /Control Plane/ })
      .filter((b) => !isQueryEcho(b));
    expect(sectionHits).toEqual([]);
  });
});
