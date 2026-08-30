/**
 * P13C GATE 19 — macOS driven-UI journey: the real App shell, on macOS.
 *
 * Gate 18 proved driven-UI navigation over the real shell, but with jsdom's
 * default `navigator.platform` (non-Mac), so the macOS chrome — the inset
 * traffic-light gutter the shell renders ONLY on macOS — was never exercised.
 * This forces macOS (`@renderer/lib/platform` → IS_MAC true) and proves the real
 * `AppShell` renders that gutter, then drives the full workflow under it:
 * navigation into a section (loading → success) and the membership-gated
 * workspace switch — the "full macOS workflow click-through" Gate 19's residual
 * names. A real packaged-Electron macOS launch (`e2e/*.e2e.cjs`) stays the
 * documented machine-blocked item; this is the achievable automated proof.
 *
 * Only `useAuth` (→ local) and `@renderer/lib/platform` (→ macOS) are mocked;
 * the shell, AppShell, Sidebar, Toolbar and every provider are the real thing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthStatus, EnterpriseModuleSummary } from '@neuropause/shared';
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

// FORCE macOS: IS_MAC is a module-load const, so a module mock is the reliable
// lever. This makes the real Toolbar render its macOS traffic-light gutter.
vi.mock('@renderer/lib/platform', () => ({ IS_MAC: true, isMacPlatform: () => true }));

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

function financeModule(): EnterpriseModuleSummary {
  return {
    id: 'finance',
    title: 'Finance',
    singular: 'Invoice',
    plural: 'Invoices',
    icon: 'database',
    description: 'test',
    titleField: 'number',
    group: 'Finance',
    permissions: { read: 'operations:read', write: 'operations:manage' },
    fields: [{ key: 'number', label: 'Number', type: 'text', required: true }],
    recordCount: 3,
    activeCount: 3,
    aiSummary: false,
    actions: [],
  } as unknown as EnterpriseModuleSummary;
}

const orgRows = [
  { id: 'workspace-default', name: 'Default Workspace', organizationId: 'org-default', orgName: 'NeuroPause', userCount: 1, unitCount: 13, active: true },
  { id: 'ws-ops', name: 'Operations', organizationId: 'org-default', orgName: 'NeuroPause', userCount: 1, unitCount: 13, active: false },
];

async function mountShell(): Promise<ReturnType<typeof render>> {
  const utils = render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
  await screen.findByRole('button', { name: 'Business' }, { timeout: 5000 });
  return utils;
}

beforeEach(() => {
  cleanup();
  clearRoutes();
});
afterEach(() => cleanup());

describe('P13C Gate 19 — macOS shell chrome + driven workflow', () => {
  it('the real shell renders the macOS traffic-light gutter, then navigates into a section (loading → success)', async () => {
    routeBoot();
    let resolveModules!: (m: EnterpriseModuleSummary[]) => void;
    route(
      IpcChannel.EnterpriseModulesList,
      () => new Promise<EnterpriseModuleSummary[]>((r) => { resolveModules = r; }),
    );
    const user = userEvent.setup();
    await mountShell();

    // macOS CHROME: the toolbar (banner landmark) clears the inset traffic
    // lights with the 80px gutter (pl-20), never the Windows/Linux frame (pl-3).
    const banner = screen.getByRole('banner');
    expect(banner.className).toContain('pl-20');
    expect(banner.className).not.toContain('pl-3');

    // Full workflow under the macOS chrome: navigate to Business → loading → success.
    expect(screen.queryByText('Finance')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Business' }));
    await waitFor(() => expect(document.querySelector('.np-skeleton')).toBeTruthy());
    resolveModules([financeModule()]);
    await waitFor(() => expect(screen.getAllByText(/Finance/).length).toBeGreaterThan(0));
  });

  it('the membership-gated workspace switch works through the macOS shell', async () => {
    routeBoot();
    route(IpcChannel.EnterpriseModulesList, () => [financeModule()]);
    route(IpcChannel.EnterpriseWorkspaceList, () => orgRows);
    const switched: unknown[] = [];
    route(IpcChannel.EnterpriseWorkspaceSwitch, (payload) => {
      switched.push(payload);
      return { ...orgRows[1], active: true };
    });
    const user = userEvent.setup();
    await mountShell();

    // macOS chrome present, then drive the gated switch.
    expect(screen.getByRole('banner').className).toContain('pl-20');
    await user.click(screen.getByRole('button', { name: /View: Default/ }));
    await screen.findByText('Organization workspace');
    const opsItem = await screen.findByRole('menuitem', { name: /Operations/ });
    await user.click(opsItem);
    await waitFor(() => expect(switched).toEqual([{ id: 'ws-ops' }]));
  });
});
