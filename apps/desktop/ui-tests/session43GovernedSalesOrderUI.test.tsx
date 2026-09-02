/**
 * ERP Session 43 — GOVERNED SALES ORDER UI EXPOSURE (UI-layer proof + old-path bypass proof).
 *
 * S42's headline finding: the production UI created Sales Orders through the NON-governed
 * `enterprise:module.create` CRUD door, so the certified governed spine (journal / idempotency /
 * outbox / intent-first crash recovery / audit) was unreachable by a real user — "correct but dark".
 *
 * S43 routes the Sales Order CREATE, and ONLY that create, through the governed command path. These
 * tests mount the REAL production `EnterpriseModuleScreen`, fill the REAL form, click the REAL Create
 * button, and prove:
 *   • the Orders create now calls `platform:command.dispatch` with `operation: 'CreateSalesOrder'`;
 *   • it NO LONGER calls `enterprise:module.create` (the old bypass path) — the decisive proof;
 *   • the renderer sends NO tenant (tenant is server-resolved);
 *   • a governed success updates the UI, a governed error is surfaced (modal stays open);
 *   • a UI retry reuses ONE stable idempotency key (replay-safe → one durable order);
 *   • every OTHER module's create is unchanged (still the CRUD door) — no generic-path regression.
 *
 * The full governed guarantees behind that operation (durable order + event + outbox + audit,
 * unauthorized-before-effect, tenant isolation, duplicate→one, concurrency) are certified at the
 * handler layer in `src/main/ipc/handlers/session43GovernedSalesOrderCreate.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels } from './setup';
import { IpcChannel, ORDERS_MODULE_ID, type EnterpriseModuleSummary } from '@neuropause/shared';
import { EnterpriseModuleScreen } from '@renderer/enterprise/modules/EnterpriseModuleScreen';

const STATUS_FIELD = {
  key: 'status',
  label: 'Status',
  type: 'select' as const,
  required: true,
  default: 'pending',
  options: [
    { value: 'pending', label: 'Pending' },
    { value: 'shipped', label: 'Shipped' },
  ],
};

const ORDERS: EnterpriseModuleSummary = {
  id: ORDERS_MODULE_ID, // 'sales-orders'
  title: 'Sales Orders',
  singular: 'Sales Order',
  plural: 'Sales Orders',
  icon: 'package',
  description: 'test',
  titleField: 'orderNumber',
  group: 'Sales',
  permissions: { read: 'sales:read', write: 'sales:manage' },
  fields: [
    { key: 'orderNumber', label: 'Order Number', type: 'text', required: true },
    { key: 'customer', label: 'Customer', type: 'text', required: true },
    STATUS_FIELD,
  ],
  recordCount: 0,
  activeCount: 0,
  aiSummary: false,
  actions: [],
};

const CRM: EnterpriseModuleSummary = {
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

interface DispatchCall {
  operation: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  hasTenant: boolean;
}
function captureDispatch(result: () => unknown): { calls: DispatchCall[] } {
  const calls: DispatchCall[] = [];
  route(IpcChannel.PlatformCommandDispatch, (p) => {
    const env = p as Record<string, unknown>;
    calls.push({
      operation: String(env.operation),
      payload: (env.payload ?? {}) as Record<string, unknown>,
      idempotencyKey: String(env.idempotencyKey ?? ''),
      hasTenant: 'tenantId' in env || 'claimedTenantId' in env,
    });
    return result();
  });
  return { calls };
}

beforeEach(() => {
  clearRoutes();
  cleanup();
});

describe('S43 · the Sales Order create UI drives the GOVERNED command path, not the CRUD door', () => {
  it('Orders create calls platform:command.dispatch (CreateSalesOrder) and NOT enterprise:module.create', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    const crud = vi.fn(() => ({ ok: true }));
    route(IpcChannel.EnterpriseModuleCreate, crud); // the OLD path — must stay untouched
    const { calls } = captureDispatch(() => ({ ok: true, data: { id: 'ord_1' }, requestId: 'r', correlationId: 'c', operation: 'CreateSalesOrder' }));
    render(<EnterpriseModuleScreen module={ORDERS} initialCreate />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Order Number/i), 'SO-0001');
    await user.type(screen.getByLabelText(/^Customer/i), 'Acme Inc.');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    // THE GOVERNED PATH is used, with the right operation + payload + a real idempotency key.
    expect(calls[0].operation).toBe('CreateSalesOrder');
    expect(calls[0].payload.orderNumber).toBe('SO-0001');
    expect(calls[0].payload.customer).toBe('Acme Inc.');
    expect(calls[0].idempotencyKey.length).toBeGreaterThan(0);
    // THE DECISIVE BYPASS PROOF: the old non-governed CRUD create was NEVER invoked for this action.
    expect(crud).not.toHaveBeenCalled();
    // no channel the component asked for went unrouted (guards against a silently-swallowed call).
    expect(unroutedChannels()).toEqual([]);
    // a governed success closes the create modal (the UI updated from the governed response).
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Create' })).toBeNull());
  });

  it('the renderer sends NO tenant on the governed create — tenant is server-resolved', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    route(IpcChannel.EnterpriseModuleCreate, () => ({ ok: true }));
    const { calls } = captureDispatch(() => ({ ok: true, data: { id: 'ord_2' }, requestId: 'r', correlationId: 'c', operation: 'CreateSalesOrder' }));
    render(<EnterpriseModuleScreen module={ORDERS} initialCreate />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Order Number/i), 'SO-T');
    await user.type(screen.getByLabelText(/^Customer/i), 'X');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].hasTenant).toBe(false);
  });

  it('a governed error is surfaced in the form and the modal stays open (no silent close)', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    const crud = vi.fn(() => ({ ok: true }));
    route(IpcChannel.EnterpriseModuleCreate, crud);
    captureDispatch(() => ({ ok: false, error: { code: 'UNAUTHORIZED', message: 'You are not authorized to perform this operation.' }, requestId: 'r', correlationId: 'c', operation: 'CreateSalesOrder' }));
    render(<EnterpriseModuleScreen module={ORDERS} initialCreate />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Order Number/i), 'SO-E');
    await user.type(screen.getByLabelText(/^Customer/i), 'X');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText(/not authorized/i)).toBeTruthy();
    // the modal did NOT silently close on a governed refusal, and the CRUD door was still not used.
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    expect(crud).not.toHaveBeenCalled();
  });

  it('a UI retry reuses ONE stable idempotency key (replay-safe → never a duplicate order)', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    route(IpcChannel.EnterpriseModuleCreate, () => ({ ok: true }));
    let n = 0;
    const { calls } = captureDispatch(() => {
      n += 1;
      return n === 1
        ? { ok: false, error: { code: 'TRANSIENT_FAILURE', message: 'Temporary problem. Try again.' }, requestId: 'r', correlationId: 'c', operation: 'CreateSalesOrder' }
        : { ok: true, data: { id: 'ord_3' }, requestId: 'r', correlationId: 'c', operation: 'CreateSalesOrder' };
    });
    render(<EnterpriseModuleScreen module={ORDERS} initialCreate />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Order Number/i), 'SO-R');
    await user.type(screen.getByLabelText(/^Customer/i), 'X');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/Temporary problem/i)).toBeTruthy();
    // the user retries the SAME create.
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(calls).toHaveLength(2));
    // Both attempts carried the SAME key → the governed journal REPLAYS rather than double-writes.
    expect(calls[0].idempotencyKey).toBe(calls[1].idempotencyKey);
  });

  it('CONTROL — a NON-Sales-Order module create is UNCHANGED (still the CRUD door, never the governed path)', async () => {
    route(IpcChannel.EnterpriseModuleList, () => []);
    const crud = vi.fn(() => ({ ok: true }));
    route(IpcChannel.EnterpriseModuleCreate, crud);
    const { calls } = captureDispatch(() => ({ ok: true, data: { id: 'x' }, requestId: 'r', correlationId: 'c', operation: 'CreateSalesOrder' }));
    render(<EnterpriseModuleScreen module={CRM} initialCreate />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Name/i), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(crud).toHaveBeenCalledTimes(1));
    // the CRM create did NOT get hijacked onto the governed Sales Order path.
    expect(calls).toHaveLength(0);
    expect(crud.mock.calls[0][0]).toMatchObject({ moduleId: 'crm-customers' });
  });
});
