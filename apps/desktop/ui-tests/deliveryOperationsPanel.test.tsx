/**
 * ERP Session 35 — the operator-facing Delivery Operations panel renders REAL outbox/delivery state
 * (delivered, pending, and — critically — retrying/failed) fetched through the governed delivery IPC
 * (`ipc.platform.deliveryOperations` → `platform:command.dispatch`, delivery read branch). Proves the
 * real UI → bridge → governed IPC path and that the panel reflects ACTUAL backend state — a failed
 * delivery visibly stays RETRYING, never hardcoded to success.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { DeliveryOperationsPanel } from '@renderer/operationsPlatform/DeliveryOperationsPanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

const resp = (over: Record<string, unknown>) => ({
  ok: true,
  data: {
    counts: { total: 0, pending: 0, inFlight: 0, retryable: 0, delivered: 0 },
    deliveries: [],
    ...over,
  },
  requestId: 'r', correlationId: 'c', operation: 'QueryDeliveryOperations',
});

describe('DeliveryOperationsPanel', () => {
  it('renders a DELIVERED event from the governed delivery read', async () => {
    let sawOperation = '';
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      sawOperation = (payload as { operation: string }).operation;
      return resp({
        counts: { total: 1, pending: 0, inFlight: 0, retryable: 0, delivered: 1 },
        deliveries: [{ txId: 't1', eventType: 'SalesOrderCreated', aggregateId: 'SO-1', deliveryState: 'DELIVERED', status: 'DELIVERED', attempts: 1, queuedAt: '2026-09-02T12:00:00.000Z', deliveredAt: '2026-09-02T12:00:01.000Z' }],
      });
    });
    render(<DeliveryOperationsPanel />);
    await waitFor(() => expect(screen.getByText('Delivered: 1')).toBeTruthy());
    expect(sawOperation).toBe('QueryDeliveryOperations');
    expect(screen.getByText('DELIVERED')).toBeTruthy();
    expect(screen.getByText(/SalesOrderCreated/)).toBeTruthy();
  });

  it('a FAILED delivery visibly stays RETRYING (not hardcoded success)', async () => {
    route(IpcChannel.PlatformCommandDispatch, () =>
      resp({
        counts: { total: 1, pending: 0, inFlight: 0, retryable: 1, delivered: 0 },
        deliveries: [{ txId: 't2', eventType: 'SalesOrderCreated', aggregateId: 'SO-2', deliveryState: 'RETRYING', status: 'RETRYABLE', attempts: 3, queuedAt: '2026-09-02T12:00:00.000Z', lastError: 'downstream sink unreachable' }],
      }),
    );
    render(<DeliveryOperationsPanel />);
    await waitFor(() => expect(screen.getByText('Retrying: 1')).toBeTruthy());
    expect(screen.getByText('RETRYING')).toBeTruthy();
    expect(screen.getByText(/downstream sink unreachable/)).toBeTruthy();
  });

  it('a PENDING (never-attempted) delivery is visible as PENDING', async () => {
    route(IpcChannel.PlatformCommandDispatch, () =>
      resp({
        counts: { total: 1, pending: 1, inFlight: 0, retryable: 0, delivered: 0 },
        deliveries: [{ txId: 't3', eventType: 'SalesOrderCreated', aggregateId: 'SO-3', deliveryState: 'PENDING', status: 'PENDING', attempts: 0, queuedAt: '2026-09-02T12:00:00.000Z' }],
      }),
    );
    render(<DeliveryOperationsPanel />);
    await waitFor(() => expect(screen.getByText('Pending: 1')).toBeTruthy());
    expect(screen.getByText('PENDING')).toBeTruthy();
  });
});
