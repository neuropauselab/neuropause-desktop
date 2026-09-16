/**
 * ERP Session 47 — the in-app pilot fence for issued-invoice economic edits.
 *
 * Editing an ISSUED-family invoice books real GL ADJUSTMENT entries (deliberate glPosting
 * drift-correction; reversal policy memo OPEN). S46 fenced this procedurally; S47 makes the
 * defined behavior VISIBLE in the product: the edit form shows a caution for issued-family
 * invoices and stays silent for drafts and for other modules. Visibility, not invented policy —
 * the save is NOT blocked.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { FINANCE_MODULE_ID, IpcChannel, type EnterpriseEntity, type EnterpriseModuleSummary } from '@neuropause/shared';
import { EnterpriseModuleScreen } from '@renderer/enterprise/modules/EnterpriseModuleScreen';

const INVOICES: EnterpriseModuleSummary = {
  id: FINANCE_MODULE_ID,
  title: 'Finance',
  singular: 'Invoice',
  plural: 'Invoices',
  icon: 'doc',
  description: 'test',
  titleField: 'number',
  group: 'Finance',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [{ key: 'number', label: 'Invoice #', type: 'text', required: true }],
  recordCount: 1,
  activeCount: 1,
  aiSummary: false,
  actions: [],
};

const rec = (status: string): EnterpriseEntity =>
  ({
    id: 'inv_1',
    title: 'INV-1',
    status: 'active',
    fields: { number: 'INV-1', status },
    tags: [],
    metadata: {},
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'op',
    updatedBy: 'op',
    revision: 1,
  }) as unknown as EnterpriseEntity;

const NOTICE = /books general-ledger adjustment entries/i;

async function openEdit(record: EnterpriseEntity) {
  route(IpcChannel.EnterpriseModuleList, () => [record]);
  render(<EnterpriseModuleScreen module={INVOICES} />);
  const user = userEvent.setup();
  await user.click(await screen.findByText('INV-1'));
  await user.click(await screen.findByRole('button', { name: 'Edit', exact: true }));
}

beforeEach(() => {
  clearRoutes();
  cleanup();
});

describe('S47 · issued-invoice edit fence (visible defined behavior, not invented policy)', () => {
  it('shows the GL-adjustment caution when editing an ISSUED invoice', async () => {
    await openEdit(rec('issued'));
    expect(await screen.findByText(NOTICE)).toBeTruthy();
    // the fence blocks nothing — Save is still offered.
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('stays silent for a DRAFT invoice (no fence where no GL books)', async () => {
    await openEdit(rec('draft'));
    expect(await screen.findByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});
