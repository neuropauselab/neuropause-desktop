/**
 * S125 — the Evidence Search panel drives the governed read (`ipc.platform.evidenceSearch` →
 * `platform:command.dispatch`, `QueryEvidenceSearch`). Proves the real UI→bridge path (asserts the
 * operation + that the typed query reaches the payload), rendered hits, honest empty state, and that no
 * secret/token/payload is rendered.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { EvidenceSearchPanel } from '@renderer/operationsPlatform/EvidenceSearchPanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

const resp = (over: Record<string, unknown>) => ({
  ok: true,
  data: { query: '', counts: { command: 0, inbound: 0, total: 0 }, bounded: false, hits: [], tenantId: 'tenant-A', ...over },
  requestId: 'r', correlationId: 'c', operation: 'QueryEvidenceSearch',
});

describe('EvidenceSearchPanel', () => {
  it('renders searched evidence hits from the governed read', async () => {
    let sawOperation = '';
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      sawOperation = (payload as { operation: string }).operation;
      return resp({
        counts: { command: 1, inbound: 1, total: 2 },
        hits: [
          { kind: 'command', id: 'tx_1', source: 'command-journal', type: 'CreateSalesOrder', timestamp: 1_700_000_000_000, summary: 'CreateSalesOrder · DELIVERED', status: 'DELIVERED', correlationId: 'corr-1', connectorId: null, score: 2 },
          { kind: 'inbound', id: 'github-1', source: 'connector-inbound', type: 'inbound_webhook', timestamp: 1_700_000_000_000, summary: 'github · github · verified', status: 'verified', correlationId: null, connectorId: 'github', score: 1 },
        ],
      });
    });
    render(<EvidenceSearchPanel />);
    await waitFor(() => expect(screen.getByText('CreateSalesOrder · DELIVERED')).toBeTruthy());
    expect(sawOperation).toBe('QueryEvidenceSearch');
    expect(screen.getByText('github · github · verified')).toBeTruthy();
    expect(screen.getByText('Commands: 1')).toBeTruthy();
  });

  it('passes the typed query into the governed read payload', async () => {
    let sawQuery: unknown = undefined;
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      sawQuery = (payload as { payload?: { query?: string } }).payload?.query;
      return resp({});
    });
    render(<EvidenceSearchPanel />);
    await waitFor(() => expect(screen.getByText('No matching evidence')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Search operational evidence'), { target: { value: 'github' } });
    await waitFor(() => expect(sawQuery).toBe('github'));
  });

  it('shows an honest empty state', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => resp({}));
    render(<EvidenceSearchPanel />);
    await waitFor(() => expect(screen.getByText('No matching evidence')).toBeTruthy());
  });

  it('never renders secret/token/payload material', async () => {
    route(IpcChannel.PlatformCommandDispatch, () =>
      resp({
        counts: { command: 1, inbound: 0, total: 1 },
        hits: [{ kind: 'command', id: 'tx_1', source: 'command-journal', type: 'PaySupplierInvoice', timestamp: 1_700_000_000_000, summary: 'PaySupplierInvoice · RETRYABLE', status: 'RETRYABLE', correlationId: null, connectorId: null, score: 1 }],
      }),
    );
    const { container } = render(<EvidenceSearchPanel />);
    await waitFor(() => expect(screen.getByText('PaySupplierInvoice · RETRYABLE')).toBeTruthy());
    const blob = (container.textContent ?? '').toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload']) {
      expect(blob).not.toContain(forbidden);
    }
  });
});
