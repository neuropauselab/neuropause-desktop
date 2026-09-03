/**
 * ERP Session 57 — the reversal/settlement promotion set drives the GOVERNED command path
 * from the UI (the S45/S49 routing-table pattern): invoice Cancel, credit/debit-note
 * Issue/Cancel, payment Clear (both sides), shipment Ship. Each pin proves the governed
 * channel receives the right operation with the record as target and the legacy action door
 * NEVER fires for that key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import {
  IpcChannel,
  CREDIT_NOTES_MODULE_ID,
  DEBIT_NOTES_MODULE_ID,
  FINANCE_MODULE_ID,
  PAYMENTS_MODULE_ID,
  SHIPPING_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
  type EnterpriseEntity,
  type EnterpriseModuleSummary,
} from '@neuropause/shared';
import { EnterpriseModuleScreen } from '@renderer/enterprise/modules/EnterpriseModuleScreen';

const summary = (over: Partial<EnterpriseModuleSummary>): EnterpriseModuleSummary => ({
  id: 'x', title: 'X', singular: 'X', plural: 'Xs', icon: 'package', description: 'test',
  titleField: 'name', group: 'Finance',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
  recordCount: 1, activeCount: 1, aiSummary: false, actions: [], ...over,
});
const record = (id: string, title: string, fields: Record<string, unknown>): EnterpriseEntity =>
  ({ id, title, status: 'active', fields, tags: [], metadata: {},
     createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
     createdBy: 'op', updatedBy: 'op', revision: 1 }) as unknown as EnterpriseEntity;

interface DispatchCall { operation: string; target?: string }
function captureDispatch(op: string): { calls: DispatchCall[] } {
  const calls: DispatchCall[] = [];
  route(IpcChannel.PlatformCommandDispatch, (p) => {
    const env = p as Record<string, unknown>;
    calls.push({ operation: String(env.operation), target: env.target === undefined ? undefined : String(env.target) });
    return { ok: true, data: { id: 'r1' }, requestId: 'r', correlationId: 'c', operation: op };
  });
  return { calls };
}

beforeEach(() => { clearRoutes(); cleanup(); });

const CASES = [
  { name: 'Invoice Cancel → CancelCustomerInvoice', modId: FINANCE_MODULE_ID, title: 'Finance', tf: 'number', field: 'number', action: { key: 'cancel', label: 'Cancel' }, rec: { number: 'INV-1', status: 'issued' }, op: 'CancelCustomerInvoice', done: /cancelled/i },
  { name: 'Credit note Issue → IssueCreditNote', modId: CREDIT_NOTES_MODULE_ID, title: 'Credit Notes', tf: 'noteNumber', field: 'noteNumber', action: { key: 'issue', label: 'Issue' }, rec: { noteNumber: 'CN-1', status: 'draft' }, op: 'IssueCreditNote', done: /issued/i },
  { name: 'Credit note Cancel → CancelCreditNote', modId: CREDIT_NOTES_MODULE_ID, title: 'Credit Notes', tf: 'noteNumber', field: 'noteNumber', action: { key: 'cancel', label: 'Cancel' }, rec: { noteNumber: 'CN-2', status: 'issued' }, op: 'CancelCreditNote', done: /cancelled/i },
  { name: 'Debit note Issue → IssueDebitNote', modId: DEBIT_NOTES_MODULE_ID, title: 'Debit Notes', tf: 'noteNumber', field: 'noteNumber', action: { key: 'issue', label: 'Issue' }, rec: { noteNumber: 'DN-1', status: 'draft' }, op: 'IssueDebitNote', done: /issued/i },
  { name: 'Customer payment Clear → ClearCustomerPayment', modId: PAYMENTS_MODULE_ID, title: 'Payments', tf: 'paymentNumber', field: 'paymentNumber', action: { key: 'clear', label: 'Clear' }, rec: { paymentNumber: 'PAY-1', status: 'pending' }, op: 'ClearCustomerPayment', done: /cleared/i },
  { name: 'Vendor payment Clear → ClearVendorPayment', modId: VENDOR_PAYMENTS_MODULE_ID, title: 'Vendor Payments', tf: 'paymentNumber', field: 'paymentNumber', action: { key: 'clear', label: 'Clear' }, rec: { paymentNumber: 'VPAY-1', status: 'pending' }, op: 'ClearVendorPayment', done: /cleared/i },
  { name: 'Shipment Ship → ShipShipmentDocument', modId: SHIPPING_MODULE_ID, title: 'Shipping', tf: 'shipmentNumber', field: 'shipmentNumber', action: { key: 'ship', label: 'Ship' }, rec: { shipmentNumber: 'SH-1', status: 'pending' }, op: 'ShipShipmentDocument', done: /shipped/i },
] as const;

describe('S57 · reversal/settlement actions drive the GOVERNED command path', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const legacy = vi.fn(() => ({ ok: true }));
      route(IpcChannel.EnterpriseModuleAction, legacy);
      route(IpcChannel.EnterpriseModuleList, () => [record('r1', String(c.rec[c.field as keyof typeof c.rec]), c.rec)]);
      const { calls } = captureDispatch(c.op);
      const mod = summary({ id: c.modId, title: c.title, singular: c.title, plural: c.title, titleField: c.tf, fields: [{ key: c.field, label: 'Number', type: 'text', required: true }] as never, actions: [{ ...c.action, icon: 'check' }] });
      render(<EnterpriseModuleScreen module={mod} />);
      const user = userEvent.setup();
      await user.click(await screen.findByText(String(c.rec[c.field as keyof typeof c.rec])));
      await user.click(await screen.findByRole('button', { name: c.action.label }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].operation).toBe(c.op);
      expect(calls[0].target).toBe('r1');
      expect(legacy).not.toHaveBeenCalled();
      expect(await screen.findByText(c.done)).toBeTruthy();
    });
  }
});
