/**
 * P13C ROUND 61 — GATE 26. THE SHELL REFETCHES ON A TENANT SWITCH.
 *
 * THE DEFECT: `ScopedShell` keyed the shell on the workspace-ctx VIEW id only.
 * Switching a local view remounted and refetched everything; switching the ORG
 * WORKSPACE remounted nothing, so every already-mounted surface kept rendering
 * the PREVIOUS tenant's data — BusinessView's per-tenant `recordCount`, the Data
 * import history, module screens — until the user happened to navigate. The
 * Gate-26 driven run recorded this as "after a tenant switch other mounted
 * surfaces still refetch only on navigation".
 *
 * CLASSIFICATION, deliberate: this is a UI-TRUTH / FRESHNESS defect (§4), NOT a
 * tenancy breach. The enterprise record store re-resolves scope on every call
 * and fails closed, and the switch itself is membership-gated — the user was
 * authorized for the data still on screen. Filing it as a security finding would
 * misdirect the fix at the authorization layer, which behaves correctly.
 *
 * THE SIGNAL ALREADY EXISTED: `enterprise:event` kind `workspace` fires on every
 * switch. The fix subscribes the shell to it; no new channel, no new hub.
 *
 * These pins hold the BEHAVIOUR, not the implementation: a real tenant change
 * must cause a mounted surface to refetch, and a non-change must not.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  useAuth: () => ({ status: LOCAL, initializing: false }),
}));

const { default: App } = await import('@renderer/App');
const { ThemeProvider } = await import('@renderer/providers/ThemeProvider');

/** The active org workspace the main process would report. Mutable per test. */
let activeWorkspaceId: string | null = 'workspace-default';
/** Every EnterpriseModulesList invocation — the refetch observable. */
let moduleListCalls = 0;

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

  // The mechanism the fix reads.
  route(IpcChannel.EnterpriseWorkspaceActive, () =>
    activeWorkspaceId === null
      ? null
      : { id: activeWorkspaceId, name: 'W', organizationId: 'org-default' },
  );
  // The refetch observable.
  route(IpcChannel.EnterpriseModulesList, () => {
    moduleListCalls += 1;
    return [];
  });
}

async function mountShell(): Promise<void> {
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
  await screen.findByRole('button', { name: 'Business' }, { timeout: 5000 });
}

/** Navigate to Business so a tenant-scoped surface is actually mounted. */
async function openBusiness(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Business' }));
  await waitFor(() => expect(moduleListCalls).toBeGreaterThan(0), { timeout: 5000 });
}

beforeEach(() => {
  cleanup();
  clearRoutes();
  activeWorkspaceId = 'workspace-default';
  moduleListCalls = 0;
  routeBoot();
});

describe('shell refetches on a tenant switch (Gate 26)', () => {
  it('REFETCHES a mounted surface when the active org workspace actually changes', async () => {
    const user = userEvent.setup();
    await mountShell();
    await openBusiness(user);

    const before = moduleListCalls;
    expect(before).toBeGreaterThan(0);

    // The main process switched the tenant and announced it, exactly as
    // `workspaceStore.switch()` → `enterprise:event` does in production.
    activeWorkspaceId = 'ws-ops';
    emitBroadcast(IpcChannel.EnterpriseEventBroadcast, { kind: 'workspace', at: 1 });

    // THE PIN: the surface must load again under the new tenant. Before the fix
    // this stayed flat, leaving tenant A's numbers on screen under tenant B.
    await waitFor(() => expect(moduleListCalls).toBeGreaterThan(before), { timeout: 5000 });
  });

  it('does NOT refetch when a workspace event carries no tenant change', async () => {
    const user = userEvent.setup();
    await mountShell();
    await openBusiness(user);

    // Let the first active-workspace read settle so the epoch has adopted it.
    await new Promise((r) => setTimeout(r, 50));
    const before = moduleListCalls;

    // A rename/create emits the same event kind with the SAME active id. A
    // remount here would throw away scroll, open panels and in-progress work
    // for a non-event.
    emitBroadcast(IpcChannel.EnterpriseEventBroadcast, { kind: 'workspace', at: 2 });
    await new Promise((r) => setTimeout(r, 120));

    expect(moduleListCalls).toBe(before);
  });

  it('does not remount at boot, when the first read resolves from unknown', async () => {
    const user = userEvent.setup();
    await mountShell();
    await openBusiness(user);
    const settled = moduleListCalls;

    // The initial null → 'workspace-default' resolution is an adoption, not a
    // change; a remount here would cost the user their first paint for nothing.
    await new Promise((r) => setTimeout(r, 150));
    expect(moduleListCalls).toBe(settled);
  });

  it('survives a refused active-workspace read without blowing the shell away', async () => {
    const user = userEvent.setup();
    await mountShell();
    await openBusiness(user);
    await new Promise((r) => setTimeout(r, 50));
    const before = moduleListCalls;

    // A transient refusal (boot-window miss, membership check in flight) must
    // keep the previous value rather than being read as "tenant became none".
    route(IpcChannel.EnterpriseWorkspaceActive, () => {
      throw new Error('Tenant refused');
    });
    emitBroadcast(IpcChannel.EnterpriseEventBroadcast, { kind: 'workspace', at: 3 });
    await new Promise((r) => setTimeout(r, 120));

    expect(moduleListCalls).toBe(before);
    // The shell is still there — a refusal is not a reason to unmount the product.
    expect(screen.getByRole('button', { name: 'Business' })).toBeTruthy();
  });

  it('ignores unrelated enterprise events', async () => {
    const user = userEvent.setup();
    await mountShell();
    await openBusiness(user);
    await new Promise((r) => setTimeout(r, 50));
    const before = moduleListCalls;

    activeWorkspaceId = 'ws-ops'; // would be a change IF the kind were read loosely
    emitBroadcast(IpcChannel.EnterpriseEventBroadcast, { kind: 'people', at: 4 });
    await new Promise((r) => setTimeout(r, 120));

    expect(moduleListCalls).toBe(before);
  });
});
