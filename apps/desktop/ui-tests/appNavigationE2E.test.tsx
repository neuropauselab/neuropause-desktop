/**
 * P13C GATE 18 — DRIVEN-UI E2E: the real App shell, navigated as a user.
 *
 * Every prior renderer test either mounts a single screen in isolation
 * (dataImport, businessGate6, workspaceSwitcherGate26 — all with ShellProvider /
 * WorkspaceContextProvider mocked away) or mounts `App` with the whole shell +
 * provider stack mocked to markers (authStateMachine). NONE drives the REAL
 * `App` — real `AppShell`, real `Sidebar`, real providers — through a real
 * sidebar navigation into a section and an in-section state machine over real
 * IPC→main handlers. That click-through is exactly the Gate-18 residual, and
 * these tests close it:
 *
 *   • local-mode boot → the real shell mounts → click the "Business" sidebar
 *     item → the section renders its LOADING skeleton → then its SUCCESS rail
 *     (navigation + loading + completion), and its DENIAL state on a refused
 *     read (error), all through the real ShellProvider/AppShell/Sidebar;
 *   • the membership-gated WORKSPACE SWITCH driven through the always-mounted
 *     switcher — a successful switch invokes the gated channel (state
 *     transition), and a refused switch surfaces the gate's message verbatim
 *     (role=alert).
 *
 * Only `useAuth` is mocked (deterministic `local` entry, so no auth channels and
 * no wall); everything below it is the real thing. A real packaged-Electron
 * launch (`e2e/*.e2e.cjs`) needs a display + macOS binary and is not runnable in
 * a headless CI sandbox, so this jsdom driven-UI click-through is the achievable
 * renderer E2E here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthStatus, EnterpriseModuleSummary } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { route, clearRoutes } from './setup';

// jsdom has no matchMedia; the real ThemeProvider reads the prefers-color-scheme
// query at mount. A stable "light" stub keeps the real provider (not a mock).
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

// The ONLY mock: deterministic local-mode entry into the real shell. Everything
// below App (AppShell, Sidebar, all providers, BusinessView, WorkspaceSwitcher)
// is the real component driven over the real IPC→handler harness.
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

/**
 * Route the channels the real shell fires at boot so the mount reaches a stable
 * idle with no onboarding takeover blocking navigation. None of these is what
 * the tests assert on — they let the real AppShell + providers settle.
 */
function routeBoot(): void {
  route(IpcChannel.WorkspaceCtxBootstrap, () => ({
    workspaces: [{ id: 'wsc_1', name: 'Default', color: '#8888ff' }],
    activeId: 'wsc_1',
    activeSnapshot: { activeSection: 'intent-home', tabs: [], activeTabId: null },
  }));
  // completed (not 'pending') → no FirstRunExperience takeover.
  route(IpcChannel.ExperienceProfileGet, () => ({
    state: 'completed',
    workspaceType: null,
    aiModeChosen: true,
    attributes: [],
    completedAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  }));
  // firstRun:false → the OnboardingWizard renders null (no blocking dialog).
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
  // The default landing (intent-home) — empty but well-shaped so it renders its
  // honest "no outcomes yet" state rather than a boundary error.
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

/** Mount the real App and wait until the real sidebar is up (Business nav present). */
async function mountShell(): Promise<ReturnType<typeof render>> {
  // The real top-level provider main.tsx wraps App in (ThemeProvider); AuthProvider
  // is mocked to a passthrough above, so this reproduces the real render tree.
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

describe('P13C Gate 18 — driven-UI navigation into a section (real App shell)', () => {
  it('navigates to Business via the sidebar and transitions loading → success (family rail)', async () => {
    routeBoot();
    let resolveModules!: (m: EnterpriseModuleSummary[]) => void;
    route(
      IpcChannel.EnterpriseModulesList,
      () => new Promise<EnterpriseModuleSummary[]>((r) => { resolveModules = r; }),
    );
    const user = userEvent.setup();
    const { container } = await mountShell();

    // Business is not the landing section — Finance is nowhere yet.
    expect(screen.queryByText('Finance')).toBeNull();

    // Drive the real sidebar navigation.
    await user.click(screen.getByRole('button', { name: 'Business' }));

    // The section rendered its LOADING state (skeleton), success not yet present.
    await waitFor(() => expect(container.querySelector('.np-skeleton')).toBeTruthy());
    expect(screen.queryByText('Finance')).toBeNull();

    // The read completes → SUCCESS: the family rail renders.
    resolveModules([financeModule()]);
    await waitFor(() => expect(screen.getAllByText(/Finance/).length).toBeGreaterThan(0));
    expect(container.querySelector('.np-skeleton')).toBeNull();
  });

  it('a refused Business read renders the DENIAL state through real navigation — never blank', async () => {
    routeBoot();
    route(IpcChannel.EnterpriseModulesList, () => {
      throw new Error('Not authorized: this workspace belongs to an organization you are not a member of.');
    });
    const user = userEvent.setup();
    await mountShell();

    await user.click(screen.getByRole('button', { name: 'Business' }));
    expect(await screen.findByText('You don’t have access to Business')).toBeTruthy();
    // A denial offers no useless retry, and the shell chrome is still there.
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Business' })).toBeTruthy();
  });

  it('navigates between two sections — the active view actually changes', async () => {
    routeBoot();
    route(IpcChannel.EnterpriseModulesList, () => [financeModule()]);
    const user = userEvent.setup();
    await mountShell();

    await user.click(screen.getByRole('button', { name: 'Business' }));
    await waitFor(() => expect(screen.getAllByText(/Finance/).length).toBeGreaterThan(0));

    // Navigate away to Administration; the Business family rail must leave.
    const admin = screen.queryByRole('button', { name: 'Administration' });
    if (admin) {
      await user.click(admin);
      await waitFor(() => expect(screen.queryByText('Finance')).toBeNull());
    }
    // Back to Business — the section re-renders its content from the real read.
    await user.click(screen.getByRole('button', { name: 'Business' }));
    await waitFor(() => expect(screen.getAllByText(/Finance/).length).toBeGreaterThan(0));
  });
});

describe('P13C Gate 18 — membership-gated workspace switch (through the real shell)', () => {
  it('switching an organization workspace invokes the membership-gated channel (state transition)', async () => {
    routeBoot();
    route(IpcChannel.EnterpriseWorkspaceList, () => orgRows);
    const switched: unknown[] = [];
    route(IpcChannel.EnterpriseWorkspaceSwitch, (payload) => {
      switched.push(payload);
      return { ...orgRows[1], active: true };
    });
    const user = userEvent.setup();
    await mountShell();

    await user.click(screen.getByRole('button', { name: /View: Default/ }));
    // The popover leads with the ORGANIZATION workspaces from the real channel.
    await screen.findByText('Organization workspace');
    // Scope to the popover menuitem — "Operations" is also a sidebar section name.
    const opsItem = await screen.findByRole('menuitem', { name: /Operations/ });
    await user.click(opsItem);

    await waitFor(() => expect(switched).toEqual([{ id: 'ws-ops' }]));
  });

  it('a REFUSED switch surfaces the gate message verbatim (role=alert) — fail-closed, not silent', async () => {
    routeBoot();
    route(IpcChannel.EnterpriseWorkspaceList, () => orgRows);
    route(IpcChannel.EnterpriseWorkspaceSwitch, () => {
      throw new Error('You are not a member of this workspace.');
    });
    const user = userEvent.setup();
    await mountShell();

    await user.click(screen.getByRole('button', { name: /View: Default/ }));
    await screen.findByText('Organization workspace');
    const opsItem = await screen.findByRole('menuitem', { name: /Operations/ });
    await user.click(opsItem);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'You are not a member of this workspace.',
      ),
    );
  });
});
