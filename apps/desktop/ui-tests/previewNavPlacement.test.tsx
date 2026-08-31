/**
 * P13C GATE 12 — preview-tier nav placement, verified in the real rendered shell.
 *
 * The decision (round 57): the two preview surfaces that used to sit in the
 * PRIMARY sidebar — "Enterprise" and "Enterprise Marketplace" — are demoted to
 * the Advanced disclosure, uniform with every other preview section. This drives
 * the REAL App/AppShell/Sidebar and proves the placement a user actually sees:
 * neither appears in the default sidebar; both appear once "Advanced" is
 * expanded (still Preview-badged and reachable); a production business surface
 * ("Business") stays in the default nav. `sections.test.ts` pins the registry
 * data; this pins the rendered behavior.
 *
 * Only `useAuth` (→ local) is mocked; the shell/Sidebar/providers are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthStatus } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { route, clearRoutes } from './setup';

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
    state: 'completed',
    workspaceType: null,
    aiModeChosen: true,
    attributes: [],
    completedAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  }));
  route(IpcChannel.OnboardingStatus, () => ({
    firstRun: false,
    startedAt: null,
    completedAt: null,
    steps: [],
    nextStep: null,
  }));
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

beforeEach(() => {
  cleanup();
  clearRoutes();
});
afterEach(() => cleanup());

describe('P13C Gate 12 — preview-tier nav placement (rendered shell)', () => {
  it('the default sidebar hides Enterprise + Enterprise Marketplace, keeps the production Business surface', () => {
    routeBoot();
    return mountShell().then(() => {
      // Production business surface stays in the default nav.
      expect(screen.getByRole('button', { name: 'Business' })).toBeTruthy();
      // The two preview surfaces are NOT in the default sidebar (Advanced closed).
      expect(screen.queryByRole('button', { name: /^Enterprise — Preview$/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Enterprise Marketplace — Preview/ })).toBeNull();
    });
  });

  it('expanding "Advanced" reveals both, still Preview-badged and reachable', async () => {
    routeBoot();
    const user = userEvent.setup();
    await mountShell();

    await user.click(screen.getByRole('button', { name: 'Advanced' }));

    const enterprise = await screen.findByRole('button', { name: /^Enterprise — Preview$/ });
    const marketplace = await screen.findByRole('button', { name: /Enterprise Marketplace — Preview/ });
    // The aria-label "— Preview" reflects the visible Preview badge; both are real,
    // clickable nav buttons (reachable), just relocated under Advanced.
    expect(enterprise.getAttribute('aria-current')).not.toBe('page');
    expect(marketplace).toBeTruthy();
  });

  it('the Advanced disclosure is collapsed by default (preview surfaces are opt-in)', async () => {
    routeBoot();
    await mountShell();
    const advanced = screen.getByRole('button', { name: 'Advanced' });
    expect(advanced.getAttribute('aria-expanded')).toBe('false');
  });
});
