/**
 * GATE 6 / 15 — EnterpriseModuleScreen must NAME a failed read, never show it
 * as "No … yet".
 *
 * The list load and the create/update submit were `try/finally` with no catch:
 * a denied `records()` read rendered the "No customers yet" empty state with a
 * "Create your first…" CTA — telling a user whose data they simply cannot see
 * that their records are gone and inviting them to recreate them — and a thrown
 * create (a permission denial that rejects, or an IPC failure) left the modal
 * open with no reason shown. Both now surface the error; a genuinely empty
 * module still shows the honest empty state.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { IpcChannel, type EnterpriseModuleSummary } from '@neuropause/shared';
import { EnterpriseModuleScreen } from '@renderer/enterprise/modules/EnterpriseModuleScreen';

const MODULE: EnterpriseModuleSummary = {
  id: 'crm-customers',
  title: 'Customers',
  singular: 'Customer',
  plural: 'Customers',
  icon: 'user',
  description: 'test',
  titleField: 'name',
  group: 'CRM',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
  recordCount: 0,
  activeCount: 0,
  aiSummary: false,
  actions: [],
};

beforeEach(() => {
  clearRoutes();
  cleanup();
});

describe('EnterpriseModuleScreen — a failed read is named, not shown as empty', () => {
  it('a denied records read renders a role=alert with the reason — never "No customers yet"', async () => {
    route(IpcChannel.EnterpriseModuleList, () => {
      throw new Error('Not authorized: missing permission "crm:read".');
    });
    render(<EnterpriseModuleScreen module={MODULE} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Customers could not be loaded');
    expect(alert.textContent).toContain('crm:read');
    // The lie the matrix targets must be gone: the "No customers yet" empty
    // state (with its "Create your first…" invitation) is not shown over a
    // failed read.
    expect(screen.queryByText(/No customers yet/i)).toBeNull();
    expect(screen.queryByText(/Create your first/i)).toBeNull();
  });

  it('a genuinely empty module still shows the honest empty state, no alert', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    render(<EnterpriseModuleScreen module={MODULE} />);

    expect(await screen.findByText(/No customers yet/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Retry re-reads and clears the error when the backend recovers', async () => {
    let calls = 0;
    route(IpcChannel.EnterpriseModuleList, () => {
      calls += 1;
      if (calls === 1) throw new Error('backend unavailable');
      return [];
    });
    render(<EnterpriseModuleScreen module={MODULE} />);

    await screen.findByRole('alert');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await screen.findByText(/No customers yet/i)).toBeTruthy();
    expect(calls).toBeGreaterThan(1);
  });

  it('a thrown create is surfaced in the form, not swallowed', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    route(IpcChannel.EnterpriseModuleCreate, () => {
      throw new Error('Not authorized: missing permission "crm:manage".');
    });
    render(<EnterpriseModuleScreen module={MODULE} initialCreate />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Name/i), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    // The denial is shown; the modal did not silently close on a rejection.
    expect(await screen.findByText(/crm:manage/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
  });
});
