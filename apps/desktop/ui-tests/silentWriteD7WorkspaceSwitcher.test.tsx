/**
 * D-7 — A REFUSED VIEW WRITE IN THE WORKSPACE SWITCHER IS VISIBLE.
 *
 * The register named `WorkspaceContextProvider:90` as a remaining silent write
 * path. Reading it showed that site is `flushSnapshot` — a 400ms-debounced layout
 * save driven by a `useEffect` and a `beforeunload` listener. No button means
 * "save my layout", so by the gate's own test — *a click is refused and the screen
 * says nothing* — it is not a silent write path at all. Worse, the provider sits
 * ABOVE `ToastProvider` in `App.tsx` and renders nothing but its children, so any
 * error state added there would render nowhere: a fake fix.
 *
 * The real defect of that class, in the surface the user actually drives, is here:
 * `WorkspaceSwitcher`'s shared `run` helper — which every consequential view write
 * funnels through (create / rename / delete / switch) — had NO catch at all. A
 * rejection escaped as an unhandled promise, `finally` un-greyed the popover, and
 * the view list simply did not change.
 *
 * One catch on the shared helper covers all four writes, which is why the fix is
 * a helper and not four call sites.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';

const switchWorkspace = vi.fn();
const createWorkspace = vi.fn();
const renameWorkspace = vi.fn();
const deleteWorkspace = vi.fn();

vi.mock('@renderer/state/WorkspaceContextProvider', () => ({
  useWorkspaceContexts: () => ({
    workspaces: [
      { id: 'wsc_1', name: 'Default', color: '#8888ff' },
      { id: 'wsc_2', name: 'Research', color: '#88ff88' },
    ],
    activeId: 'wsc_1',
    switchWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
  }),
}));

vi.mock('@renderer/state/ShellProvider', () => ({
  useShell: () => ({ setSection: vi.fn() }),
}));

import { WorkspaceSwitcher } from '@renderer/shell/WorkspaceSwitcher';

/** The message a real refusal carries out of the secure bridge. */
const REFUSAL = 'Not authorized: missing permission "workspace:manage".';

beforeEach(() => {
  cleanup();
  clearRoutes();
  switchWorkspace.mockReset().mockResolvedValue(undefined);
  createWorkspace.mockReset().mockResolvedValue(undefined);
  renameWorkspace.mockReset().mockResolvedValue(undefined);
  deleteWorkspace.mockReset().mockResolvedValue(undefined);
  route(IpcChannel.EnterpriseWorkspaceList, () => []);
});

const openPopover = async (): Promise<void> => {
  render(<WorkspaceSwitcher collapsed={false} />);
  await userEvent.click(screen.getByRole('button', { name: /View: Default/ }));
};

describe('WorkspaceSwitcher — a refused view write speaks (D-7)', () => {
  it('a failed DELETE says so, verbatim, instead of the row silently surviving', async () => {
    deleteWorkspace.mockRejectedValue(new Error(REFUSAL));
    await openPopover();

    const user = userEvent.setup();
    // Delete is two-step: the first click arms, the second confirms.
    await user.click(screen.getByRole('button', { name: 'Delete Research' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete Research' }));

    const alert = await screen.findByRole('alert');
    // Verbatim, not re-worded: classifying a refusal by regex on English prose is
    // exactly what D-6 exists to stop.
    expect(alert.textContent).toContain('workspace:manage');
    expect(deleteWorkspace).toHaveBeenCalledTimes(1);
  });

  it('a failed SWITCH says so — the same helper, a different write', async () => {
    switchWorkspace.mockRejectedValue(new Error(REFUSAL));
    await openPopover();

    // The view row is a `menuitem`; `Rename Research` / `Delete Research` are the
    // sibling BUTTONS in the same row, which is why the role matters here.
    await userEvent.setup().click(screen.getByRole('menuitem', { name: /Research/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('workspace:manage');
  });

  it('a rejection with no message still says something, never an empty banner', async () => {
    deleteWorkspace.mockRejectedValue('a bare string, not an Error');
    await openPopover();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Research' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete Research' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent?.trim().length).toBeGreaterThan(0);
    expect(alert.textContent).toMatch(/request failed/i);
  });

  it('a write that SUCCEEDS shows no alert (the control)', async () => {
    await openPopover();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Research' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete Research' }));

    await waitFor(() => expect(deleteWorkspace).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
