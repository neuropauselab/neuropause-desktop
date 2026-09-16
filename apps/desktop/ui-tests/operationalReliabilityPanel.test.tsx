/**
 * S122 — the Operational Reliability panel renders REAL delivery-reliability posture fetched through
 * the governed read IPC (`ipc.platform.reliabilitySummary` → `platform:command.dispatch`,
 * `QueryReliabilitySummary`). Proves the real UI → bridge → governed read path, the posture badges +
 * per-command-type rollup + recurring error signatures, the empty state, and — critically — that the
 * panel shows NO secret/token/payload material.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { OperationalReliabilityPanel } from '@renderer/operationsPlatform/OperationalReliabilityPanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

const resp = (over: Record<string, unknown>) => ({
  ok: true,
  data: {
    totals: { commands: 0, delivered: 0, pending: 0, processing: 0, retryable: 0, attempts: 0, retried: 0, everErrored: 0 },
    successRatio: 0, deliveryFailureRatio: 0, byCommandType: [], topErrors: [], tenantId: 'tenant-A', ...over,
  },
  requestId: 'r', correlationId: 'c', operation: 'QueryReliabilitySummary',
});

describe('OperationalReliabilityPanel', () => {
  it('renders posture badges, per-command-type rollup, and recurring errors', async () => {
    let sawOperation = '';
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      sawOperation = (payload as { operation: string }).operation;
      return resp({
        totals: { commands: 5, delivered: 3, pending: 1, processing: 0, retryable: 1, attempts: 7, retried: 1, everErrored: 1 },
        successRatio: 0.6, deliveryFailureRatio: 0.2,
        byCommandType: [{ commandType: 'CreateSalesOrder', total: 5, delivered: 3, pending: 1, processing: 0, retryable: 1, attempts: 7, retried: 1, everErrored: 1 }],
        topErrors: [{ signature: 'ECONNRESET', count: 2 }],
      });
    });
    render(<OperationalReliabilityPanel />);
    await waitFor(() => expect(screen.getByText('Commands: 5')).toBeTruthy());
    expect(sawOperation).toBe('QueryReliabilitySummary');
    expect(screen.getByText(/Delivered: 3/)).toBeTruthy();
    expect(screen.getByText('CreateSalesOrder')).toBeTruthy();
    expect(screen.getByText('ECONNRESET')).toBeTruthy();
    expect(screen.getByText('×2')).toBeTruthy();
  });

  it('shows an empty state when there are no governed commands', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => resp({}));
    render(<OperationalReliabilityPanel />);
    await waitFor(() => expect(screen.getByText('No governed commands yet')).toBeTruthy());
  });

  it('renders the reliability TREND section when comparable', async () => {
    route(IpcChannel.PlatformCommandDispatch, () =>
      resp({
        totals: { commands: 4, delivered: 2, pending: 0, processing: 0, retryable: 2, attempts: 6, retried: 2, everErrored: 2 },
        successRatio: 0.5, deliveryFailureRatio: 0.5,
        byCommandType: [{ commandType: 'CreateSalesOrder', total: 4, delivered: 2, pending: 0, processing: 0, retryable: 2, attempts: 6, retried: 2, everErrored: 2 }],
        topErrors: [{ signature: 'boom', count: 2 }],
        trend: {
          comparable: true,
          window: { previous: 2, recent: 2 },
          deliveryFailureRate: { previous: 0, recent: 1, delta: 1, direction: 'INCREASE' },
          retryPressure: { previous: 0, recent: 1, delta: 1, direction: 'INCREASE' },
          successRatio: { previous: 1, recent: 0, delta: -1, direction: 'DECREASE' },
          totalFailures: { previous: 0, recent: 2, delta: 2, direction: 'INCREASE' },
          posture: 'DEGRADING',
          newSignatures: ['boom'],
          persistingSignatures: [],
          resolvedSignatures: [],
          byCommandType: [{ commandType: 'CreateSalesOrder', delta: -1, trend: 'DEGRADING' }],
        },
      }),
    );
    render(<OperationalReliabilityPanel />);
    await waitFor(() => expect(screen.getByText('Posture: degrading')).toBeTruthy());
    expect(screen.getByText(/Trend · 2 → 2 commands/)).toBeTruthy();
    expect(screen.getByText(/Failure rate/)).toBeTruthy();
    expect(screen.getByText(/New errors:/)).toBeTruthy();
  });

  it('never renders secret/token/payload material', async () => {
    route(IpcChannel.PlatformCommandDispatch, () =>
      resp({
        totals: { commands: 1, delivered: 0, pending: 0, processing: 0, retryable: 1, attempts: 1, retried: 0, everErrored: 1 },
        successRatio: 0, deliveryFailureRatio: 1,
        byCommandType: [{ commandType: 'PostGoodsReceipt', total: 1, delivered: 0, pending: 0, processing: 0, retryable: 1, attempts: 1, retried: 0, everErrored: 1 }],
        topErrors: [{ signature: '429 rate limited', count: 1 }],
      }),
    );
    const { container } = render(<OperationalReliabilityPanel />);
    await waitFor(() => expect(screen.getByText('PostGoodsReceipt')).toBeTruthy());
    const blob = (container.textContent ?? '').toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload']) {
      expect(blob).not.toContain(forbidden);
    }
  });
});
