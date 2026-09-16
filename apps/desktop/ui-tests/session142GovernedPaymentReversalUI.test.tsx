/**
 * ERP Session 142 — GOVERNED PAYMENT REVERSAL UI EXPOSURE (UI-layer proof + old-path bypass proof).
 *
 * S61 built the immutable payment-reversal command family (`ReverseCustomerPayment` /
 * `ReverseVendorPayment`) — books the compensating GL and re-opens the settled document — but it was
 * the last DARK pair: no renderer path, so a real operator could only create a reversal through the
 * NON-governed `enterprise:module.create` CRUD door (bypassing journal / idempotency / outbox / audit,
 * and letting the client forge `originalKind`). S142 routes the `finance-payment-reversals` CREATE, and
 * only that create, through the governed command path — the exact S43/S45/S49 pattern.
 *
 * These tests mount the REAL `EnterpriseModuleScreen`, fill the REAL form, click the REAL Create button,
 * and prove: customer→`ReverseCustomerPayment`, vendor→`ReverseVendorPayment`, each with the original
 * payment as `target` and `reason` in the payload; the CRUD door is NOT used; the renderer sends NO
 * tenant; a governed error is surfaced (modal stays open); a retry reuses ONE idempotency key; and a
 * non-reversal module create is unchanged. The full governed guarantees + the reversal module's own
 * fail-closed guards are certified at the S61 handler layer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels } from './setup';
import { IpcChannel, type EnterpriseModuleSummary } from '@neuropause/shared';
import { EnterpriseModuleScreen } from '@renderer/enterprise/modules/EnterpriseModuleScreen';

const REVERSALS: EnterpriseModuleSummary = {
  id: 'finance-payment-reversals',
  title: 'Payment Reversals',
  singular: 'Payment Reversal',
  plural: 'Payment Reversals',
  icon: 'refresh',
  description: 'test',
  titleField: 'reversalNumber',
  group: 'Finance',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'originalKind', label: 'Payment Type', type: 'select', required: true, options: [
      { value: 'customer', label: 'Customer Payment' },
      { value: 'vendor', label: 'Vendor Payment' },
    ] },
    { key: 'originalPaymentId', label: 'Original Payment', type: 'text', required: true },
    { key: 'reason', label: 'Reason', type: 'textarea', required: true },
  ],
  recordCount: 0,
  activeCount: 0,
  aiSummary: false,
  actions: [],
};

const CRM: EnterpriseModuleSummary = {
  id: 'crm-customers', title: 'Customers', singular: 'Customer', plural: 'Customers', icon: 'user',
  description: 'test', titleField: 'name', group: 'CRM',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
  recordCount: 0, activeCount: 0, aiSummary: false, actions: [],
};

interface DispatchCall { operation: string; target: unknown; payload: Record<string, unknown>; idempotencyKey: string; hasTenant: boolean }
function captureDispatch(result: () => unknown): { calls: DispatchCall[] } {
  const calls: DispatchCall[] = [];
  route(IpcChannel.PlatformCommandDispatch, (p) => {
    const env = p as Record<string, unknown>;
    calls.push({
      operation: String(env.operation),
      target: env.target,
      payload: (env.payload ?? {}) as Record<string, unknown>,
      idempotencyKey: String(env.idempotencyKey ?? ''),
      hasTenant: 'tenantId' in env || 'claimedTenantId' in env,
    });
    return result();
  });
  return { calls };
}

async function fillReversal(kind: 'customer' | 'vendor', paymentId: string, reason: string): Promise<void> {
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText(/Payment Type/i), kind);
  await user.type(screen.getByLabelText(/Original Payment/i), paymentId);
  await user.type(screen.getByLabelText(/^Reason/i), reason);
  await user.click(screen.getByRole('button', { name: 'Create' }));
}

beforeEach(() => {
  clearRoutes();
  cleanup();
});

describe('S142 · the payment-reversal create UI drives the GOVERNED command path, not the CRUD door', () => {
  it('a CUSTOMER reversal calls ReverseCustomerPayment with target + reason, NOT enterprise:module.create', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    const crud = vi.fn(() => ({ ok: true }));
    route(IpcChannel.EnterpriseModuleCreate, crud);
    const { calls } = captureDispatch(() => ({ ok: true, data: { id: 'rev_1' }, requestId: 'r', correlationId: 'c', operation: 'ReverseCustomerPayment' }));
    render(<EnterpriseModuleScreen module={REVERSALS} initialCreate />);

    await fillReversal('customer', 'pay_123', 'duplicate charge');

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].operation).toBe('ReverseCustomerPayment');
    expect(calls[0].target).toBe('pay_123'); // original payment id is a TARGET, not authority
    expect(calls[0].payload.reason).toBe('duplicate charge');
    expect(calls[0].idempotencyKey.length).toBeGreaterThan(0);
    expect(crud).not.toHaveBeenCalled(); // the decisive bypass proof
    expect(unroutedChannels()).toEqual([]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Create' })).toBeNull());
  });

  it('a VENDOR reversal calls ReverseVendorPayment (command chosen by originalKind; server sets kind from type)', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    route(IpcChannel.EnterpriseModuleCreate, () => ({ ok: true }));
    const { calls } = captureDispatch(() => ({ ok: true, data: { id: 'rev_2' }, requestId: 'r', correlationId: 'c', operation: 'ReverseVendorPayment' }));
    render(<EnterpriseModuleScreen module={REVERSALS} initialCreate />);

    await fillReversal('vendor', 'vpay_9', 'wrong supplier');

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].operation).toBe('ReverseVendorPayment');
    expect(calls[0].target).toBe('vpay_9');
    expect(calls[0].payload.reason).toBe('wrong supplier');
  });

  it('the renderer sends NO tenant on the governed reversal — tenant is server-resolved', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    route(IpcChannel.EnterpriseModuleCreate, () => ({ ok: true }));
    const { calls } = captureDispatch(() => ({ ok: true, data: { id: 'rev_3' }, requestId: 'r', correlationId: 'c', operation: 'ReverseCustomerPayment' }));
    render(<EnterpriseModuleScreen module={REVERSALS} initialCreate />);
    await fillReversal('customer', 'pay_t', 'x');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].hasTenant).toBe(false);
  });

  it('a governed refusal (e.g. already reversed / bank-reconciled) is surfaced; modal stays open; CRUD unused', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    const crud = vi.fn(() => ({ ok: true }));
    route(IpcChannel.EnterpriseModuleCreate, crud);
    captureDispatch(() => ({ ok: false, error: { code: 'PAYMENT_REVERSAL_REFUSED', message: 'This payment has already been reversed.' }, requestId: 'r', correlationId: 'c', operation: 'ReverseCustomerPayment' }));
    render(<EnterpriseModuleScreen module={REVERSALS} initialCreate />);
    await fillReversal('customer', 'pay_dup', 'again');
    expect(await screen.findByText(/already been reversed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    expect(crud).not.toHaveBeenCalled();
  });

  it('a UI retry reuses ONE stable idempotency key (replay-safe → never a duplicate reversal)', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    route(IpcChannel.EnterpriseModuleCreate, () => ({ ok: true }));
    let n = 0;
    const { calls } = captureDispatch(() => {
      n += 1;
      return n === 1
        ? { ok: false, error: { code: 'TRANSIENT_FAILURE', message: 'Temporary problem. Try again.' }, requestId: 'r', correlationId: 'c', operation: 'ReverseCustomerPayment' }
        : { ok: true, data: { id: 'rev_4' }, requestId: 'r', correlationId: 'c', operation: 'ReverseCustomerPayment' };
    });
    render(<EnterpriseModuleScreen module={REVERSALS} initialCreate />);
    await fillReversal('customer', 'pay_r', 'retry');
    expect(await screen.findByText(/Temporary problem/i)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].idempotencyKey).toBe(calls[1].idempotencyKey);
  });

  it('CONTROL — a NON-reversal module create is UNCHANGED (still the CRUD door, never a reverse command)', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    const crud = vi.fn(() => ({ ok: true }));
    route(IpcChannel.EnterpriseModuleCreate, crud);
    const { calls } = captureDispatch(() => ({ ok: true, data: { id: 'x' }, requestId: 'r', correlationId: 'c', operation: 'ReverseCustomerPayment' }));
    render(<EnterpriseModuleScreen module={CRM} initialCreate />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Name/i), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(crud).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(0);
    expect(crud.mock.calls[0][0]).toMatchObject({ moduleId: 'crm-customers' });
  });
});
