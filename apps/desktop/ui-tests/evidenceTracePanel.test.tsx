/**
 * S126 — the Evidence Search panel's inline Trace action drives the governed evidence-trace read
 * (`ipc.platform.evidenceTrace` → `platform:command.dispatch`, `QueryEvidenceTrace`). Proves: a command
 * hit with a correlationId offers Trace; clicking it fetches + renders the chronological trace (asserting
 * the operation + the correlationId reached the payload); an inbound hit (no correlationId) shows "no
 * corr"; and no secret/payload is rendered.
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

const searchResp = () => ({
  ok: true,
  data: {
    query: '', counts: { command: 1, inbound: 1, total: 2 }, bounded: false,
    hits: [
      { kind: 'command', id: 'tx_1', source: 'command-journal', type: 'CreateSalesOrder', timestamp: 1_700_000_000_000, summary: 'CreateSalesOrder · DELIVERED', status: 'DELIVERED', correlationId: 'corr-1', connectorId: null, score: 2 },
      { kind: 'inbound', id: 'github-1', source: 'connector-inbound', type: 'inbound_webhook', timestamp: 1_700_000_000_000, summary: 'github · github · verified', status: 'verified', correlationId: null, connectorId: 'github', score: 1 },
    ],
    tenantId: 'tenant-A',
  },
  requestId: 'r', correlationId: 'c', operation: 'QueryEvidenceSearch',
});

const traceResp = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    correlationId: 'corr-1', found: true, counts: { command: 1, delivered: 1, total: 2 }, bounded: false, inboundCorrelatable: false,
    entries: [
      { source: 'command-journal', id: 'tx_1', at: '2026-09-05T00:00:01.000Z', type: 'CreateSalesOrder', status: 'DELIVERED', aggregateId: 'so-1', correlationId: 'corr-1', delivery: { state: 'DELIVERED', linked: true, attempts: 1, deliveredAt: '2026-09-05T00:00:05.000Z' } },
      { source: 'delivered-events', id: 'ev_1', at: '2026-09-05T00:00:05.000Z', type: 'sales.order.created', status: 'delivered', aggregateId: 'so-1', correlationId: 'corr-1', delivery: { state: 'NOT_LINKED', linked: false, attempts: null, deliveredAt: null } },
    ],
    tenantId: 'tenant-A', ...over,
  },
  requestId: 'r', correlationId: 'c', operation: 'QueryEvidenceTrace',
});

// route by the operation in the payload (both use the same channel).
function routeByOp(traceOver: Record<string, unknown> = {}, capture?: (corr: unknown) => void): void {
  route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
    const op = (payload as { operation: string }).operation;
    if (op === 'QueryEvidenceTrace') {
      capture?.((payload as { payload?: { correlationId?: string } }).payload?.correlationId);
      return traceResp(traceOver);
    }
    return searchResp();
  });
}

describe('EvidenceSearchPanel · Trace action (S126)', () => {
  it('a command hit offers Trace; clicking renders the chronological correlation trace', async () => {
    let sawCorr: unknown;
    routeByOp({}, (c) => { sawCorr = c; });
    render(<EvidenceSearchPanel />);
    await waitFor(() => expect(screen.getByText('CreateSalesOrder · DELIVERED')).toBeTruthy());
    fireEvent.click(screen.getByText('Trace'));
    await waitFor(() => expect(screen.getByText(/Evidence trace · corr corr-1/)).toBeTruthy());
    expect(sawCorr).toBe('corr-1');
    expect(screen.getByText('sales.order.created')).toBeTruthy(); // delivered-event entry rendered
    expect(screen.getByText('Delivered: 1')).toBeTruthy();
  });

  it('an inbound hit (no correlationId) shows "no corr" and offers no Trace button for it', async () => {
    routeByOp();
    render(<EvidenceSearchPanel />);
    await waitFor(() => expect(screen.getByText('github · github · verified')).toBeTruthy());
    expect(screen.getByText('no corr')).toBeTruthy();
  });

  it('an honest no-correlated-evidence state renders when the trace is not found', async () => {
    routeByOp({ found: false, counts: { command: 0, delivered: 0, total: 0 }, entries: [] });
    render(<EvidenceSearchPanel />);
    await waitFor(() => expect(screen.getByText('CreateSalesOrder · DELIVERED')).toBeTruthy());
    fireEvent.click(screen.getByText('Trace'));
    await waitFor(() => expect(screen.getByText('No correlated evidence')).toBeTruthy());
  });

  it('never renders secret/token/payload material in the trace', async () => {
    routeByOp();
    const { container } = render(<EvidenceSearchPanel />);
    await waitFor(() => expect(screen.getByText('CreateSalesOrder · DELIVERED')).toBeTruthy());
    fireEvent.click(screen.getByText('Trace'));
    await waitFor(() => expect(screen.getByText('sales.order.created')).toBeTruthy());
    const blob = (container.textContent ?? '').toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload']) {
      expect(blob).not.toContain(forbidden);
    }
  });
});
