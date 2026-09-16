/**
 * ERP Session 49 — GOVERNED PROCUREMENT UI EXPOSURE (buy-side twin of session45).
 *
 * The six procurement record actions and two creates now drive the governed command spine:
 *   PR Submit/Approve/Reject → Submit/Approve/RejectPurchaseRequest
 *   PR Create Purchase Order → ConvertPurchaseRequestToPO
 *   GR Post Receipt          → PostGoodsReceipt
 *   Bill Approve             → ApproveSupplierInvoice
 *   PR create                → CreatePurchaseRequest (draft forced server-side)
 *   Vendor payment (cleared) → PaySupplierInvoice   (pending/void stay CRUD — no GL at create)
 * Each test proves the governed channel is used with the right operation/target and the legacy
 * door is NEVER invoked for that operation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import {
  IpcChannel,
  GOODS_RECEIPTS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
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

interface DispatchCall { operation: string; target?: string; payload: Record<string, unknown>; idempotencyKey: string }
function captureDispatch(result: () => unknown): { calls: DispatchCall[] } {
  const calls: DispatchCall[] = [];
  route(IpcChannel.PlatformCommandDispatch, (p) => {
    const env = p as Record<string, unknown>;
    calls.push({
      operation: String(env.operation),
      target: env.target === undefined ? undefined : String(env.target),
      payload: (env.payload ?? {}) as Record<string, unknown>,
      idempotencyKey: String(env.idempotencyKey ?? ''),
    });
    return result();
  });
  return { calls };
}
async function openDetail(mod: EnterpriseModuleSummary, rec: EnterpriseEntity) {
  route(IpcChannel.EnterpriseModuleList, () => [rec]);
  render(<EnterpriseModuleScreen module={mod} />);
  const user = userEvent.setup();
  await user.click(await screen.findByText(rec.title));
  return user;
}

beforeEach(() => { clearRoutes(); cleanup(); });

const PR_FIELDS = [{ key: 'requestNumber', label: 'Request #', type: 'text' as const, required: true }];

describe('S49 · procurement record actions drive the GOVERNED command path', () => {
  const CASES = [
    { name: 'PR Submit → SubmitPurchaseRequest', modId: PURCHASE_REQUESTS_MODULE_ID, title: 'Purchase Requests', singular: 'Purchase Request', tf: 'requestNumber', fields: PR_FIELDS, action: { key: 'submit', label: 'Submit' }, rec: { requestNumber: 'PR-1', status: 'draft' }, op: 'SubmitPurchaseRequest', done: /Request submitted/i },
    { name: 'PR Approve → ApprovePurchaseRequest', modId: PURCHASE_REQUESTS_MODULE_ID, title: 'Purchase Requests', singular: 'Purchase Request', tf: 'requestNumber', fields: PR_FIELDS, action: { key: 'approve', label: 'Approve' }, rec: { requestNumber: 'PR-2', status: 'pending' }, op: 'ApprovePurchaseRequest', done: /Request approved/i },
    { name: 'PR Reject → RejectPurchaseRequest', modId: PURCHASE_REQUESTS_MODULE_ID, title: 'Purchase Requests', singular: 'Purchase Request', tf: 'requestNumber', fields: PR_FIELDS, action: { key: 'reject', label: 'Reject' }, rec: { requestNumber: 'PR-3', status: 'pending' }, op: 'RejectPurchaseRequest', done: /Request rejected/i },
    { name: 'PR Create Purchase Order → ConvertPurchaseRequestToPO', modId: PURCHASE_REQUESTS_MODULE_ID, title: 'Purchase Requests', singular: 'Purchase Request', tf: 'requestNumber', fields: PR_FIELDS, action: { key: 'createPurchaseOrder', label: 'Create Purchase Order' }, rec: { requestNumber: 'PR-4', status: 'approved' }, op: 'ConvertPurchaseRequestToPO', done: /Purchase order created/i },
    { name: 'GR Post Receipt → PostGoodsReceipt', modId: GOODS_RECEIPTS_MODULE_ID, title: 'Goods Receipts', singular: 'Goods Receipt', tf: 'grNumber', fields: [{ key: 'grNumber', label: 'Receipt #', type: 'text' as const, required: true }], action: { key: 'post', label: 'Post Receipt' }, rec: { grNumber: 'GR-1', status: 'pending' }, op: 'PostGoodsReceipt', done: /Receipt posted/i },
    { name: 'Bill Approve → ApproveSupplierInvoice', modId: VENDOR_BILLS_MODULE_ID, title: 'Vendor Bills', singular: 'Vendor Bill', tf: 'billNumber', fields: [{ key: 'billNumber', label: 'Bill #', type: 'text' as const, required: true }], action: { key: 'approve', label: 'Approve' }, rec: { billNumber: 'VB-1', status: 'draft' }, op: 'ApproveSupplierInvoice', done: /Supplier invoice approved/i },
  ] as const;

  for (const c of CASES) {
    it(c.name, async () => {
      const legacy = vi.fn(() => ({ ok: true }));
      route(IpcChannel.EnterpriseModuleAction, legacy);
      const { calls } = captureDispatch(() => ({ ok: true, data: { id: 'r1' }, requestId: 'r', correlationId: 'c', operation: c.op }));
      const mod = summary({ id: c.modId, title: c.title, singular: c.singular, plural: c.title, titleField: c.tf, fields: c.fields as never, actions: [{ ...c.action, icon: 'check' }] });
      const rec = record('r1', String(Object.values(c.rec)[0]), c.rec);
      const user = await openDetail(mod, rec);

      await user.click(await screen.findByRole('button', { name: c.action.label }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].operation).toBe(c.op);
      expect(calls[0].target).toBe('r1');
      expect(legacy).not.toHaveBeenCalled();
      expect(await screen.findByText(c.done)).toBeTruthy();
    });
  }
});

describe('S49 · governed procurement creates', () => {
  it('a Purchase Request create goes through CreatePurchaseRequest, never the CRUD door', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    const crud = vi.fn(() => ({ ok: true }));
    route(IpcChannel.EnterpriseModuleCreate, crud);
    const { calls } = captureDispatch(() => ({ ok: true, data: { id: 'pr_1' }, requestId: 'r', correlationId: 'c', operation: 'CreatePurchaseRequest' }));
    const mod = summary({ id: PURCHASE_REQUESTS_MODULE_ID, title: 'Purchase Requests', singular: 'Purchase Request', plural: 'Purchase Requests', titleField: 'requestNumber', fields: PR_FIELDS as never });
    render(<EnterpriseModuleScreen module={mod} initialCreate />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Request #/i), 'PR-NEW');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].operation).toBe('CreatePurchaseRequest');
    expect(calls[0].payload.requestNumber).toBe('PR-NEW');
    expect(crud).not.toHaveBeenCalled();
  });

  const VP = summary({
    id: VENDOR_PAYMENTS_MODULE_ID, title: 'Vendor Payments', singular: 'Vendor Payment', plural: 'Vendor Payments',
    titleField: 'paymentNumber', permissions: { read: 'operations:read', write: 'operations:manage' },
    fields: [
      { key: 'paymentNumber', label: 'Payment #', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', required: true, default: 'cleared',
        options: [{ value: 'pending', label: 'Pending' }, { value: 'cleared', label: 'Cleared' }, { value: 'void', label: 'Void' }] },
    ],
  });

  it('a CLEARED vendor payment goes through PaySupplierInvoice', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    const crud = vi.fn(() => ({ ok: true }));
    route(IpcChannel.EnterpriseModuleCreate, crud);
    const { calls } = captureDispatch(() => ({ ok: true, data: { id: 'vp_1' }, requestId: 'r', correlationId: 'c', operation: 'PaySupplierInvoice' }));
    render(<EnterpriseModuleScreen module={VP} initialCreate />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Payment #/i), 'VPAY-1');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].operation).toBe('PaySupplierInvoice');
    expect(crud).not.toHaveBeenCalled();
  });

  it('a PENDING vendor payment keeps the CRUD door (no GL at creation)', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    const crud = vi.fn(() => ({ ok: true }));
    route(IpcChannel.EnterpriseModuleCreate, crud);
    const { calls } = captureDispatch(() => ({ ok: true, requestId: 'r', correlationId: 'c', operation: 'x' }));
    render(<EnterpriseModuleScreen module={VP} initialCreate />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Payment #/i), 'VPAY-2');
    await user.selectOptions(screen.getByLabelText(/Status/i), 'pending');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(crud).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(0);
  });
});
