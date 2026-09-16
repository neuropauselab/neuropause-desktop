/**
 * ERP Session 32 — the operator-facing Operational History panel renders governed platform command
 * history + outbox/delivery status fetched through the governed operational READ IPC
 * (`ipc.platform.operationalHistory` → `platform:command.dispatch`, read branch). Proves the real
 * UI → preload/bridge → governed IPC path, and that a refusal surfaces as an unavailable state.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { OperationalHistoryPanel } from '@renderer/operationsPlatform/OperationalHistoryPanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

describe('OperationalHistoryPanel', () => {
  it('renders command history + counts from the governed read IPC', async () => {
    let sawOperation = '';
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      sawOperation = (payload as { operation: string }).operation;
      return {
        ok: true,
        data: {
          counts: { commands: 2, pendingOutbox: 1, delivered: 1 },
          commands: [
            { txId: 't1', commandType: 'CreateSalesOrder', actor: 'op@np.dev', committedAt: '2026-09-02', outbox: { status: 'DELIVERED', attempts: 0 } },
          ],
        },
        requestId: 'r', correlationId: 'c', operation: 'QueryOperationalHistory',
      };
    });
    render(<OperationalHistoryPanel />);
    await waitFor(() => expect(screen.getByText('CreateSalesOrder')).toBeTruthy());
    expect(sawOperation).toBe('QueryOperationalHistory'); // the read operation, not a write
    expect(screen.getByText(/Commands: 2/)).toBeTruthy();
    expect(screen.getByText(/Pending delivery: 1/)).toBeTruthy();
    expect(screen.getByText('DELIVERED')).toBeTruthy();
  });

  it('shows an unavailable state when the governed read is refused (e.g. unauthorized)', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => ({
      ok: false, error: { code: 'UNAUTHORIZED', message: 'Operational read is not permitted for this role.' },
      requestId: 'r', correlationId: 'c', operation: 'QueryOperationalHistory',
    }));
    render(<OperationalHistoryPanel />);
    await waitFor(() => expect(screen.getByText('Unavailable')).toBeTruthy());
  });

  it('renders an empty state when there are no governed commands yet', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => ({
      ok: true, data: { counts: { commands: 0, pendingOutbox: 0, delivered: 0 }, commands: [] },
      requestId: 'r', correlationId: 'c', operation: 'QueryOperationalHistory',
    }));
    render(<OperationalHistoryPanel />);
    await waitFor(() => expect(screen.getByText('No commands yet')).toBeTruthy());
  });
});
