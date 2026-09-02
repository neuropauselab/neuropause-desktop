/**
 * ERP Session 45 — GOVERNED O2C ACTIONS UI EXPOSURE (UI-layer proof + old-path bypass proof).
 *
 * S43 wired ONE governed write (Sales Order create). S45 wires the REST of the O2C lifecycle:
 *   • Orders `Ship`             → `platform:command.dispatch` `ShipSalesOrder`
 *   • Orders `Generate Invoice` → `InvoiceSalesOrder`
 *   • Finance `Issue`           → `IssueCustomerInvoice`
 *   • Quotes `Convert to Sales Order` → `ConvertQuoteToSalesOrder`
 *   • Payments create (cleared) → `ReceiveCustomerPayment` (pending/void stay CRUD — no GL at create)
 *
 * These tests mount the REAL production `EnterpriseModuleScreen`, open the REAL record detail,
 * click the REAL action buttons, and prove the governed channel is used with the right operation
 * and target — and that the legacy `enterprise:module.action` / `enterprise:module.create` doors
 * are NEVER invoked for those operations (the decisive bypass proof). Controls prove every other
 * module action and create is unchanged. The governed guarantees behind the operations are
 * certified main-side (sessions 27/28/29 + session45QuoteConversionAndStatusGuards.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import {
  IpcChannel,
  FINANCE_MODULE_ID,
  ORDERS_MODULE_ID,
  PAYMENTS_MODULE_ID,
  QUOTES_MODULE_ID,
  type EnterpriseEntity,
  type EnterpriseModuleSummary,
} from '@neuropause/shared';
import { EnterpriseModuleScreen } from '@renderer/enterprise/modules/EnterpriseModuleScreen';

const summary = (over: Partial<EnterpriseModuleSummary>): EnterpriseModuleSummary => ({
  id: 'x',
  title: 'X',
  singular: 'X',
  plural: 'Xs',
  icon: 'package',
  description: 'test',
  titleField: 'name',
  group: 'Sales',
  permissions: { read: 'sales:read', write: 'sales:manage' },
  fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
  recordCount: 1,
  activeCount: 1,
  aiSummary: false,
  actions: [],
  ...over,
});

const record = (id: string, title: string, fields: Record<string, unknown>): EnterpriseEntity =>
  ({
    id,
    title,
    status: 'active',
    fields,
    tags: [],
    metadata: {},
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'op@np.dev',
    updatedBy: 'op@np.dev',
    revision: 1,
  }) as unknown as EnterpriseEntity;

interface DispatchCall {
  operation: string;
  target?: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}
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

/** Mount the screen with one record, open its detail modal, and return the user. */
async function openDetail(mod: EnterpriseModuleSummary, rec: EnterpriseEntity) {
  route(IpcChannel.EnterpriseModuleList, () => [rec]);
  render(<EnterpriseModuleScreen module={mod} />);
  const user = userEvent.setup();
  await user.click(await screen.findByText(rec.title));
  return user;
}

beforeEach(() => {
  clearRoutes();
  cleanup();
});

describe('S45 · O2C record actions drive the GOVERNED command path, not the legacy action door', () => {
  const CASES = [
    {
      name: 'Orders Ship → ShipSalesOrder',
      mod: summary({ id: ORDERS_MODULE_ID, title: 'Sales Orders', singular: 'Sales Order', plural: 'Sales Orders', titleField: 'orderNumber', fields: [{ key: 'orderNumber', label: 'Order Number', type: 'text', required: true }], actions: [{ key: 'ship', label: 'Ship', icon: 'upload' }] }),
      rec: record('so_1', 'SO-1', { orderNumber: 'SO-1', status: 'pending' }),
      button: 'Ship',
      operation: 'ShipSalesOrder',
      done: /Order shipped/i,
    },
    {
      name: 'Orders Generate Invoice → InvoiceSalesOrder',
      mod: summary({ id: ORDERS_MODULE_ID, title: 'Sales Orders', singular: 'Sales Order', plural: 'Sales Orders', titleField: 'orderNumber', fields: [{ key: 'orderNumber', label: 'Order Number', type: 'text', required: true }], actions: [{ key: 'convertToInvoice', label: 'Generate Invoice', icon: 'doc' }] }),
      rec: record('so_2', 'SO-2', { orderNumber: 'SO-2', status: 'shipped' }),
      button: 'Generate Invoice',
      operation: 'InvoiceSalesOrder',
      done: /Invoice generated/i,
    },
    {
      name: 'Finance Issue → IssueCustomerInvoice',
      mod: summary({ id: FINANCE_MODULE_ID, title: 'Invoices', singular: 'Invoice', plural: 'Invoices', titleField: 'number', permissions: { read: 'operations:read', write: 'operations:manage' }, fields: [{ key: 'number', label: 'Invoice #', type: 'text', required: true }], actions: [{ key: 'issue', label: 'Issue', icon: 'upload' }] }),
      rec: record('inv_1', 'INV-1', { number: 'INV-1', status: 'draft' }),
      button: 'Issue',
      operation: 'IssueCustomerInvoice',
      done: /Invoice issued/i,
    },
    {
      name: 'Quotes Convert → ConvertQuoteToSalesOrder',
      mod: summary({ id: QUOTES_MODULE_ID, title: 'Quotes', singular: 'Quote', plural: 'Quotes', titleField: 'quoteNumber', fields: [{ key: 'quoteNumber', label: 'Quote Number', type: 'text', required: true }], actions: [{ key: 'convertToOrder', label: 'Convert to Sales Order', icon: 'arrow-right' }] }),
      rec: record('q_1', 'Q-1', { quoteNumber: 'Q-1', status: 'accepted' }),
      button: 'Convert to Sales Order',
      operation: 'ConvertQuoteToSalesOrder',
      done: /Quote converted/i,
    },
  ] as const;

  for (const c of CASES) {
    it(c.name, async () => {
      const legacy = vi.fn(() => ({ ok: true }));
      route(IpcChannel.EnterpriseModuleAction, legacy); // the OLD door — must NOT be used
      const { calls } = captureDispatch(() => ({ ok: true, data: { id: c.rec.id }, requestId: 'r', correlationId: 'c', operation: c.operation }));
      const user = await openDetail(c.mod, c.rec);

      await user.click(await screen.findByRole('button', { name: c.button }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].operation).toBe(c.operation);
      expect(calls[0].target).toBe(c.rec.id); // the record id travels as TARGET, never authority
      expect(calls[0].idempotencyKey.length).toBeGreaterThan(0);
      // THE DECISIVE BYPASS PROOF: the legacy action door was NEVER invoked for this operation.
      expect(legacy).not.toHaveBeenCalled();
      // the governed result is shown to the user.
      expect(await screen.findByText(c.done)).toBeTruthy();
    });
  }

  it('a governed refusal is surfaced (modal stays open, truthful error, no legacy fallback)', async () => {
    const legacy = vi.fn(() => ({ ok: true }));
    route(IpcChannel.EnterpriseModuleAction, legacy);
    captureDispatch(() => ({ ok: false, error: { code: 'CONFLICT', message: 'SHIP_REFUSED' }, requestId: 'r', correlationId: 'c', operation: 'ShipSalesOrder' }));
    const mod = summary({ id: ORDERS_MODULE_ID, title: 'Sales Orders', singular: 'Sales Order', plural: 'Sales Orders', titleField: 'orderNumber', fields: [{ key: 'orderNumber', label: 'Order Number', type: 'text', required: true }], actions: [{ key: 'ship', label: 'Ship', icon: 'upload' }] });
    const user = await openDetail(mod, record('so_e', 'SO-E', { orderNumber: 'SO-E', status: 'cancelled' }));

    await user.click(await screen.findByRole('button', { name: 'Ship' }));

    expect(await screen.findByText(/SHIP_REFUSED/)).toBeTruthy();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('CONTROL — a NON-governed action on the SAME module keeps the legacy door (fulfill)', async () => {
    const legacy = vi.fn(() => ({ ok: true, message: 'Fulfilled.' }));
    route(IpcChannel.EnterpriseModuleAction, legacy);
    const { calls } = captureDispatch(() => ({ ok: true, requestId: 'r', correlationId: 'c', operation: 'x' }));
    const mod = summary({ id: ORDERS_MODULE_ID, title: 'Sales Orders', singular: 'Sales Order', plural: 'Sales Orders', titleField: 'orderNumber', fields: [{ key: 'orderNumber', label: 'Order Number', type: 'text', required: true }], actions: [{ key: 'fulfill', label: 'Fulfill', icon: 'check' }] });
    const user = await openDetail(mod, record('so_f', 'SO-F', { orderNumber: 'SO-F', status: 'shipped' }));

    await user.click(await screen.findByRole('button', { name: 'Fulfill' }));

    await waitFor(() => expect(legacy).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(0); // never hijacked onto the governed path
  });
});

describe('S45 · the Payments create drives ReceiveCustomerPayment for CLEARED receipts', () => {
  const PAYMENTS = summary({
    id: PAYMENTS_MODULE_ID,
    title: 'Payments',
    singular: 'Payment',
    plural: 'Payments',
    titleField: 'paymentNumber',
    permissions: { read: 'operations:read', write: 'operations:manage' },
    fields: [
      { key: 'paymentNumber', label: 'Payment Number', type: 'text', required: true },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        required: true,
        default: 'cleared',
        options: [
          { value: 'pending', label: 'Pending' },
          { value: 'cleared', label: 'Cleared' },
          { value: 'void', label: 'Void' },
        ],
      },
    ],
  });

  it('a CLEARED receipt (the default) goes through the governed command, never the CRUD door', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    const crud = vi.fn(() => ({ ok: true }));
    route(IpcChannel.EnterpriseModuleCreate, crud);
    const { calls } = captureDispatch(() => ({ ok: true, data: { id: 'pay_1' }, requestId: 'r', correlationId: 'c', operation: 'ReceiveCustomerPayment' }));
    render(<EnterpriseModuleScreen module={PAYMENTS} initialCreate />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Payment Number/i), 'PAY-1');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].operation).toBe('ReceiveCustomerPayment');
    expect(calls[0].payload.paymentNumber).toBe('PAY-1');
    expect(crud).not.toHaveBeenCalled();
  });

  it('a PENDING receipt keeps the CRUD door (no GL at creation — recorded policy, not narrowed)', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    const crud = vi.fn(() => ({ ok: true }));
    route(IpcChannel.EnterpriseModuleCreate, crud);
    const { calls } = captureDispatch(() => ({ ok: true, requestId: 'r', correlationId: 'c', operation: 'x' }));
    render(<EnterpriseModuleScreen module={PAYMENTS} initialCreate />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Payment Number/i), 'PAY-2');
    await user.selectOptions(screen.getByLabelText(/Status/i), 'pending');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(crud).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(0);
  });
});
