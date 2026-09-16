/**
 * P13C ROUND 39 — GATE 26. THE SPLIT-BRAIN SWITCHER, UNSPLIT.
 *
 * Pinned here:
 *  1. The sidebar popover leads with the ORGANIZATION workspaces read from the
 *     real tenant channel, and switching one goes through the membership-gated
 *     `enterprise:workspace.switch` — the sidebar no longer fronts only the
 *     local tab-set store under the name "Workspaces".
 *  2. A refused switch shows the gate's message verbatim (role=alert); a
 *     failed list shows its error instead of pretending the section away —
 *     and the local views stay usable either way.
 *  3. The ⌘1–9 hints rendered since Stage 1 now actually switch views.
 *  4. "Manage … in Settings" navigates to Settings — the real management
 *     surface is one click from the shell, not buried.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';

const switchView = vi.fn().mockResolvedValue(undefined);
const setSection = vi.fn();

vi.mock('@renderer/state/WorkspaceContextProvider', () => ({
  useWorkspaceContexts: () => ({
    workspaces: [
      { id: 'wsc_1', name: 'Default', color: '#8888ff' },
      { id: 'wsc_2', name: 'Research', color: '#88ff88' },
    ],
    activeId: 'wsc_1',
    switchWorkspace: switchView,
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
  }),
}));

vi.mock('@renderer/state/ShellProvider', () => ({
  useShell: () => ({ setSection }),
}));

import { WorkspaceSwitcher } from '@renderer/shell/WorkspaceSwitcher';

const orgRows = [
  {
    id: 'workspace-default',
    name: 'Default Workspace',
    organizationId: 'org-default',
    orgName: 'NeuroPause',
    userCount: 1,
    unitCount: 13,
    active: true,
  },
  {
    id: 'ws-ops',
    name: 'Operations',
    organizationId: 'org-default',
    orgName: 'NeuroPause',
    userCount: 1,
    unitCount: 13,
    active: false,
  },
];

beforeEach(() => {
  cleanup();
  clearRoutes();
  switchView.mockClear();
  setSection.mockClear();
});

const openPopover = async (): Promise<void> => {
  render(<WorkspaceSwitcher collapsed={false} />);
  await userEvent.click(screen.getByRole('button', { name: /View: Default/ }));
};

describe('WorkspaceSwitcher (round 39 — Gate 26)', () => {
  it('leads with the organization workspaces from the real tenant channel', async () => {
    route(IpcChannel.EnterpriseWorkspaceList, () => orgRows);
    await openPopover();
    expect(screen.getByText('Organization workspace')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Default Workspace')).toBeTruthy();
      expect(screen.getByText('Operations')).toBeTruthy();
    });
    // The tab-set list is labeled what it is — not "Workspaces".
    expect(screen.getByText('Views on this device')).toBeTruthy();
    expect(screen.queryByText(/^Workspaces$/)).toBeNull();
  });

  it('switching an organization workspace invokes the membership-gated channel', async () => {
    route(IpcChannel.EnterpriseWorkspaceList, () => orgRows);
    const switched: unknown[] = [];
    route(IpcChannel.EnterpriseWorkspaceSwitch, (payload) => {
      switched.push(payload);
      return { ...orgRows[1], active: true };
    });
    await openPopover();
    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    await userEvent.click(screen.getByRole('menuitem', { name: /Operations/ }));
    await waitFor(() => expect(switched).toEqual([{ id: 'ws-ops' }]));
    // The views switcher was NOT involved — the two systems stay distinct.
    expect(switchView).not.toHaveBeenCalled();
  });

  it('a REFUSED switch shows the gate’s message verbatim and keeps the popover open', async () => {
    route(IpcChannel.EnterpriseWorkspaceList, () => orgRows);
    route(IpcChannel.EnterpriseWorkspaceSwitch, () => {
      throw new Error('You are not a member of this workspace.');
    });
    await openPopover();
    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    await userEvent.click(screen.getByRole('menuitem', { name: /Operations/ }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'You are not a member of this workspace.',
      );
    });
  });

  it('a failed list shows its error — and the local views stay usable', async () => {
    route(IpcChannel.EnterpriseWorkspaceList, () => {
      throw new Error('Sign in to see your organization.');
    });
    await openPopover();
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Sign in to see your organization.');
    });
    expect(screen.getByRole('menuitem', { name: /Research/ })).toBeTruthy();
  });

  it('⌘2 switches to the second view — the rendered hint finally has a handler', async () => {
    route(IpcChannel.EnterpriseWorkspaceList, () => orgRows);
    render(<WorkspaceSwitcher collapsed={false} />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', metaKey: true }));
    await waitFor(() => expect(switchView).toHaveBeenCalledWith('wsc_2'));
    // ⌘1 targets the ACTIVE view — a no-op, not a redundant switch.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(switchView).toHaveBeenCalledTimes(1);
  });

  it('"Manage … in Settings" navigates to Settings', async () => {
    route(IpcChannel.EnterpriseWorkspaceList, () => orgRows);
    await openPopover();
    await userEvent.click(screen.getByRole('menuitem', { name: /Manage members and workspaces/ }));
    expect(setSection).toHaveBeenCalledWith('settings');
  });
});
