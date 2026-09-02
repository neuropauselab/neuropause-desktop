/**
 * ERP Session 50 — structured Lines editor + reference pickers (renderer-only retirement).
 *
 * The canonical line model stays `fields.lines` JSON (census: conversion carries it verbatim
 * PR→PO; PO subtotal, GR post and the three-way match all parse it) — these pins prove the
 * editor SERIALIZES byte-compatible JSON into the SAME submitted payload shape, preserves
 * unknown row keys, and falls back to the raw textarea on malformed input instead of
 * destroying operator data. Reference pickers prove: choices come from the EXISTING
 * tenant-scoped list door, the canonical id is what gets submitted, an unresolved stored
 * value survives an edit, and a refused/failed list degrades to a plain text input.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import {
  IpcChannel,
  PURCHASE_ORDERS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  SUPPLIERS_MODULE_ID,
  type EnterpriseEntity,
  type EnterpriseModuleSummary,
} from '@neuropause/shared';
import { EnterpriseModuleScreen } from '@renderer/enterprise/modules/EnterpriseModuleScreen';

const summary = (over: Partial<EnterpriseModuleSummary>): EnterpriseModuleSummary => ({
  id: 'x', title: 'X', singular: 'X', plural: 'Xs', icon: 'package', description: 'test',
  titleField: 'name', group: 'Procurement',
  permissions: { read: 'procurement:read', write: 'procurement:manage' },
  fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
  recordCount: 1, activeCount: 1, aiSummary: false, actions: [], ...over,
});
const record = (id: string, title: string, fields: Record<string, unknown>): EnterpriseEntity =>
  ({ id, title, status: 'active', fields, tags: [], metadata: {},
     createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
     createdBy: 'op', updatedBy: 'op', revision: 1 }) as unknown as EnterpriseEntity;

const PR_MOD = summary({
  id: PURCHASE_REQUESTS_MODULE_ID, title: 'Purchase Requests', singular: 'Purchase Request',
  plural: 'Purchase Requests', titleField: 'requestNumber',
  fields: [
    { key: 'requestNumber', label: 'Request #', type: 'text', required: true },
    { key: 'lines', label: 'Lines (JSON)', type: 'textarea' },
  ],
});
const PO_MOD = summary({
  id: PURCHASE_ORDERS_MODULE_ID, title: 'Purchase Orders', singular: 'Purchase Order',
  plural: 'Purchase Orders', titleField: 'poNumber',
  fields: [
    { key: 'poNumber', label: 'PO Number', type: 'text', required: true },
    { key: 'supplier', label: 'Supplier', type: 'text' },
    { key: 'supplierRef', label: 'Supplier (ref)', type: 'text' },
    { key: 'lines', label: 'Lines (JSON)', type: 'textarea' },
  ],
});

beforeEach(() => { clearRoutes(); cleanup(); });

/** Route the list door per moduleId (the screen lists its own module; pickers list targets). */
function routeLists(perModule: Record<string, EnterpriseEntity[] | (() => never)>): void {
  route(IpcChannel.EnterpriseModuleList, (p) => {
    const { moduleId } = p as { moduleId: string };
    const entry = perModule[moduleId];
    if (typeof entry === 'function') return entry();
    return entry ?? [];
  });
}

describe('S50 · structured Lines editor serializes the canonical JSON', () => {
  it('PR create: rows typed into the editor land as canonical {sku,quantity,unitPrice} JSON in the governed payload', async () => {
    routeLists({ [PURCHASE_REQUESTS_MODULE_ID]: [] });
    const calls: Record<string, unknown>[] = [];
    route(IpcChannel.PlatformCommandDispatch, (p) => {
      calls.push(p as Record<string, unknown>);
      return { ok: true, data: { id: 'pr_1' }, requestId: 'r', correlationId: 'c', operation: 'CreatePurchaseRequest' };
    });
    render(<EnterpriseModuleScreen module={PR_MOD} initialCreate />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Request #/i), 'PR-L1');
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    await user.type(screen.getByLabelText('Line 1 SKU'), 'SKU-A');
    await user.type(screen.getByLabelText('Line 1 quantity'), '10');
    await user.type(screen.getByLabelText('Line 1 unit price'), '5');
    // the derived preview is shown (main stays authoritative)
    expect(screen.getByText(/Subtotal \(derived\)/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    const payload = (calls[0].payload ?? {}) as Record<string, unknown>;
    expect(JSON.parse(String(payload.lines))).toEqual([{ sku: 'SKU-A', quantity: 10, unitPrice: 5 }]);
  });

  it('legacy alias rows render correctly and UNKNOWN row keys survive an edit untouched', async () => {
    const rec = record('po1', 'PO-9', {
      poNumber: 'PO-9', supplier: '', supplierRef: '',
      lines: JSON.stringify([{ productId: 'SKU-X', qty: 3, price: 2, note: 'keep-me' }]),
    });
    routeLists({ [PURCHASE_ORDERS_MODULE_ID]: [rec], [SUPPLIERS_MODULE_ID]: [] });
    const updates: Record<string, unknown>[] = [];
    route(IpcChannel.EnterpriseModuleUpdate, (p) => { updates.push(p as Record<string, unknown>); return { ok: true, record: rec }; });
    render(<EnterpriseModuleScreen module={PO_MOD} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('PO-9'));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const qty = await screen.findByLabelText('Line 1 quantity');
    expect((screen.getByLabelText('Line 1 SKU') as HTMLInputElement).value).toBe('SKU-X');
    expect((qty as HTMLInputElement).value).toBe('3');
    await user.clear(qty);
    await user.type(qty, '4');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updates).toHaveLength(1));
    const sent = JSON.parse(String((updates[0].fields as Record<string, unknown>).lines)) as Record<string, unknown>[];
    expect(sent).toHaveLength(1);
    expect(sent[0].quantity).toBe(4);          // edited cell → canonical key
    expect(sent[0].qty).toBeUndefined();       // replaced alias removed
    expect(sent[0].productId).toBe('SKU-X');   // untouched cell keeps its alias
    expect(sent[0].note).toBe('keep-me');      // unknown key preserved verbatim
  });

  it('malformed lines fall back to the raw textarea with the original text intact', async () => {
    const rec = record('po2', 'PO-10', { poNumber: 'PO-10', supplier: '', supplierRef: '', lines: '[broken' });
    routeLists({ [PURCHASE_ORDERS_MODULE_ID]: [rec], [SUPPLIERS_MODULE_ID]: [] });
    render(<EnterpriseModuleScreen module={PO_MOD} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('PO-10'));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(await screen.findByText(/could not be read as a table/i)).toBeTruthy();
    const area = screen.getByDisplayValue('[broken');
    expect((area as HTMLTextAreaElement).tagName).toBe('TEXTAREA');
  });

  it('removing a line serializes without it', async () => {
    routeLists({ [PURCHASE_REQUESTS_MODULE_ID]: [] });
    const calls: Record<string, unknown>[] = [];
    route(IpcChannel.PlatformCommandDispatch, (p) => {
      calls.push(p as Record<string, unknown>);
      return { ok: true, data: { id: 'pr_2' }, requestId: 'r', correlationId: 'c', operation: 'CreatePurchaseRequest' };
    });
    render(<EnterpriseModuleScreen module={PR_MOD} initialCreate />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Request #/i), 'PR-L2');
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    await user.type(screen.getByLabelText('Line 1 SKU'), 'SKU-A');
    await user.type(screen.getByLabelText('Line 1 quantity'), '2');
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    await user.type(screen.getByLabelText('Line 2 SKU'), 'SKU-B');
    await user.type(screen.getByLabelText('Line 2 quantity'), '7');
    await user.click(screen.getByRole('button', { name: 'Remove line 1' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    const sent = JSON.parse(String((calls[0].payload as Record<string, unknown>).lines)) as Record<string, unknown>[];
    expect(sent).toHaveLength(1);
    expect(sent[0].sku).toBe('SKU-B');
  });
});

describe('S50 · reference pickers use the tenant-scoped list door and submit canonical ids', () => {
  it('supplierRef renders choices from the suppliers list door and submits the record ID', async () => {
    const rec = record('po3', 'PO-11', { poNumber: 'PO-11', supplier: '', supplierRef: '', lines: '' });
    routeLists({
      [PURCHASE_ORDERS_MODULE_ID]: [rec],
      [SUPPLIERS_MODULE_ID]: [record('sup_1', 'Acme Supply', { name: 'Acme Supply' })],
    });
    const updates: Record<string, unknown>[] = [];
    route(IpcChannel.EnterpriseModuleUpdate, (p) => { updates.push(p as Record<string, unknown>); return { ok: true, record: rec }; });
    render(<EnterpriseModuleScreen module={PO_MOD} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('PO-11'));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const select = await screen.findByLabelText(/Supplier \(ref\)/i);
    await waitFor(() => expect(screen.getByRole('option', { name: /Acme Supply/ })).toBeTruthy());
    await user.selectOptions(select, 'sup_1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updates).toHaveLength(1));
    expect((updates[0].fields as Record<string, unknown>).supplierRef).toBe('sup_1');
  });

  it('a stored value that resolves to no live choice is preserved, not destroyed', async () => {
    const rec = record('po4', 'PO-12', { poNumber: 'PO-12', supplier: '', supplierRef: 'sup_gone', lines: '' });
    routeLists({
      [PURCHASE_ORDERS_MODULE_ID]: [rec],
      [SUPPLIERS_MODULE_ID]: [record('sup_1', 'Acme Supply', { name: 'Acme Supply' })],
    });
    const updates: Record<string, unknown>[] = [];
    route(IpcChannel.EnterpriseModuleUpdate, (p) => { updates.push(p as Record<string, unknown>); return { ok: true, record: rec }; });
    render(<EnterpriseModuleScreen module={PO_MOD} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('PO-12'));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    await screen.findByRole('option', { name: /sup_gone \(unresolved\)/ });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect((updates[0].fields as Record<string, unknown>).supplierRef).toBe('sup_gone');
  });

  it('a refused/failed target list degrades to a plain text input (fail-safe, main still validates)', async () => {
    const rec = record('po5', 'PO-13', { poNumber: 'PO-13', supplier: '', supplierRef: '', lines: '' });
    routeLists({
      [PURCHASE_ORDERS_MODULE_ID]: [rec],
      [SUPPLIERS_MODULE_ID]: (() => { throw new Error('Permission denied: procurement:read'); }) as () => never,
    });
    render(<EnterpriseModuleScreen module={PO_MOD} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('PO-13'));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    await waitFor(() => {
      const el = screen.getByLabelText(/Supplier \(ref\)/i) as HTMLElement;
      expect(el.tagName).toBe('INPUT');
    });
  });

  it('the name-keyed supplier field stays FREE TEXT with master suggestions (no invented membership policy)', async () => {
    const rec = record('po6', 'PO-14', { poNumber: 'PO-14', supplier: '', supplierRef: '', lines: '' });
    routeLists({
      [PURCHASE_ORDERS_MODULE_ID]: [rec],
      [SUPPLIERS_MODULE_ID]: [record('sup_1', 'Acme Supply', { name: 'Acme Supply' })],
    });
    const updates: Record<string, unknown>[] = [];
    route(IpcChannel.EnterpriseModuleUpdate, (p) => { updates.push(p as Record<string, unknown>); return { ok: true, record: rec }; });
    render(<EnterpriseModuleScreen module={PO_MOD} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('PO-14'));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const input = (await screen.findByLabelText(/^Supplier$/i)) as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    await waitFor(() => expect(input.getAttribute('list')).toBeTruthy());
    await user.type(input, 'Someone Not In The Master');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updates).toHaveLength(1));
    expect((updates[0].fields as Record<string, unknown>).supplier).toBe('Someone Not In The Master');
  });
});
