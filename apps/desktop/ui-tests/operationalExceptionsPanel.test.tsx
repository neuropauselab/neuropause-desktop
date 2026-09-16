/**
 * S139 — the operator-facing Operational Exceptions panel renders the unified "needs follow-up" queue
 * (retrying deliveries + held reconciliations) fetched through the governed IPC
 * (`ipc.platform.operationalExceptions` → `platform:command.dispatch`, `QueryOperationalExceptions`).
 * Proves the real UI → bridge → governed read path; that both exception kinds render and never read as
 * success; the honest empty state; and that a governed-read failure surfaces as unavailable without a leak.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { OperationalExceptionsPanel } from '@renderer/operationsPlatform/OperationalExceptionsPanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

const resp = (over: Record<string, unknown>) => ({
  ok: true,
  data: { counts: { retryingDeliveries: 0, heldReconciliations: 0, total: 0 }, exceptions: [], ...over },
  requestId: 'r', correlationId: 'c', operation: 'QueryOperationalExceptions',
});

describe('OperationalExceptionsPanel', () => {
  it('renders both exception kinds from the governed read (retrying + held), never as success', async () => {
    let sawOperation = '';
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      sawOperation = (payload as { operation: string }).operation;
      return resp({
        counts: { retryingDeliveries: 1, heldReconciliations: 1, total: 2 },
        exceptions: [
          { kind: 'held_reconciliation', id: 'tenant-A::kA', at: '2026-09-05T13:00:00.000Z', summary: 'Held for reconciliation: kA', idempotencyKey: 'kA', state: 'HOLD', reason: 'RECONCILIATION_REQUIRED' },
          { kind: 'delivery_retrying', id: 'tx1', at: '2026-09-05T10:00:00.000Z', summary: 'Delivery retrying: SalesOrderCreated', eventType: 'SalesOrderCreated', aggregateId: 'agg-tx1', attempts: 2, lastError: 'sink unreachable' },
        ],
      });
    });
    render(<OperationalExceptionsPanel />);
    await waitFor(() => expect(screen.getByText('Needs attention: 2')).toBeTruthy());
    expect(sawOperation).toBe('QueryOperationalExceptions');
    expect(screen.getByText('Retrying: 1')).toBeTruthy();
    expect(screen.getByText('Held: 1')).toBeTruthy();
    expect(screen.getByText('Delivery retrying: SalesOrderCreated')).toBeTruthy();
    expect(screen.getByText('Held for reconciliation: kA')).toBeTruthy();
    expect(screen.getByText(/sink unreachable/)).toBeTruthy();
  });

  it('honest empty state when nothing needs attention', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => resp({}));
    render(<OperationalExceptionsPanel />);
    await waitFor(() => expect(screen.getByText('Nothing needs attention')).toBeTruthy());
    expect(screen.getByText('Needs attention: 0')).toBeTruthy();
  });

  it('a governed-read failure surfaces as unavailable and leaks no secret', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => ({ ok: false, error: { code: 'UNAUTHORIZED', message: 'not permitted' }, requestId: 'r', correlationId: 'c', operation: 'QueryOperationalExceptions' }));
    const { container } = render(<OperationalExceptionsPanel />);
    await waitFor(() => expect(screen.getByText('Unavailable')).toBeTruthy());
    const blob = container.textContent!.toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'bearer']) expect(blob).not.toContain(forbidden);
  });

  // ---- S140 Evidence Trace cross-link ----

  const excWithCorr = () => ({
    ok: true,
    data: {
      counts: { retryingDeliveries: 1, heldReconciliations: 1, total: 2 },
      exceptions: [
        { kind: 'delivery_retrying', id: 'tx1', at: '2026-09-05T10:00:00.000Z', summary: 'Delivery retrying: SalesOrderCreated', eventType: 'SalesOrderCreated', aggregateId: 'agg-tx1', attempts: 2, lastError: 'sink unreachable', correlationId: 'corr-tx1' },
        { kind: 'held_reconciliation', id: 'tenant-A::kA', at: '2026-09-05T13:00:00.000Z', summary: 'Held for reconciliation: kA', idempotencyKey: 'kA', state: 'HOLD', reason: 'RECONCILIATION_REQUIRED' },
      ],
    },
    requestId: 'r', correlationId: 'c', operation: 'QueryOperationalExceptions',
  });

  it('shows "View trace" ONLY for an exception that genuinely carries a correlationId (held item has none)', async () => {
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      const op = (payload as { operation: string }).operation;
      return op === 'QueryOperationalExceptions' ? excWithCorr() : { ok: true, data: { correlationId: 'corr-tx1', found: false, counts: { total: 0 }, entries: [] }, requestId: 'r', correlationId: 'c', operation: op };
    });
    render(<OperationalExceptionsPanel />);
    await waitFor(() => expect(screen.getByText('Delivery retrying: SalesOrderCreated')).toBeTruthy());
    // exactly one View trace action — the delivery item; the held item shows none (honest absence)
    expect(screen.getAllByLabelText('View evidence trace').length).toBe(1);
  });

  it('opening the trace fetches QueryEvidenceTrace for the item’s correlationId and renders its entries', async () => {
    let sawTraceOp = '';
    let sawCorr: unknown;
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      const p = payload as { operation: string; payload?: { correlationId?: string } };
      if (p.operation === 'QueryOperationalExceptions') return excWithCorr();
      sawTraceOp = p.operation;
      sawCorr = p.payload?.correlationId;
      return { ok: true, data: { correlationId: 'corr-tx1', found: true, counts: { command: 1, delivered: 1, total: 2 }, entries: [
        { source: 'command-journal', id: 'tx1', at: '2026-09-05T10:00:00.000Z', type: 'SalesOrderCreated', status: 'RETRYABLE' },
        { source: 'delivered-event', id: 'evt1', at: '2026-09-05T10:00:02.000Z', type: 'SalesOrderCreated', status: 'delivered' },
      ] }, requestId: 'r', correlationId: 'c', operation: p.operation };
    });
    render(<OperationalExceptionsPanel />);
    await waitFor(() => expect(screen.getByText('Delivery retrying: SalesOrderCreated')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('View evidence trace'));
    await waitFor(() => expect(screen.getAllByText(/SalesOrderCreated/).length).toBeGreaterThan(1));
    expect(sawTraceOp).toBe('QueryEvidenceTrace');
    expect(sawCorr).toBe('corr-tx1'); // the item's real correlationId, never manufactured
  });

  it('honest absence: an open trace with found:false shows "No correlation records"', async () => {
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      const op = (payload as { operation: string }).operation;
      return op === 'QueryOperationalExceptions' ? excWithCorr() : { ok: true, data: { correlationId: 'corr-tx1', found: false, counts: { total: 0 }, entries: [] }, requestId: 'r', correlationId: 'c', operation: op };
    });
    render(<OperationalExceptionsPanel />);
    await waitFor(() => expect(screen.getByText('Delivery retrying: SalesOrderCreated')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('View evidence trace'));
    await waitFor(() => expect(screen.getByText(/No correlation records/)).toBeTruthy());
  });

  // ---- S141 held-reconciliation → Hold Center deep-link ----

  it('S141 — a held reconciliation offers a read-only Hold Center deep-link (delivery item does NOT)', async () => {
    let navTo: string | undefined;
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      const op = (payload as { operation: string }).operation;
      return op === 'QueryOperationalExceptions' ? excWithCorr() : { ok: true, data: { correlationId: 'corr-tx1', found: false, counts: { total: 0 }, entries: [] }, requestId: 'r', correlationId: 'c', operation: op };
    });
    render(<OperationalExceptionsPanel onNavigate={(s) => { navTo = s; }} />);
    await waitFor(() => expect(screen.getByText('Held for reconciliation: kA')).toBeTruthy());
    // exactly one Hold Center link — the held item; the delivery item gets Evidence Trace, not Hold Center
    const links = screen.getAllByLabelText('Open in Hold Center');
    expect(links.length).toBe(1);
    fireEvent.click(links[0]);
    expect(navTo).toBe('holds'); // routes to the EXISTING governed Hold Center section; no mutation here
    // the held item never offers an Evidence Trace (no correlationId) — only the delivery item does
    expect(screen.getAllByLabelText('View evidence trace').length).toBe(1);
  });

  it('S141 — with no onNavigate, no Hold Center link is shown (honest, no dangling action)', async () => {
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      const op = (payload as { operation: string }).operation;
      return op === 'QueryOperationalExceptions' ? excWithCorr() : { ok: true, data: { correlationId: 'corr-tx1', found: false, counts: { total: 0 }, entries: [] }, requestId: 'r', correlationId: 'c', operation: op };
    });
    render(<OperationalExceptionsPanel />);
    await waitFor(() => expect(screen.getByText('Held for reconciliation: kA')).toBeTruthy());
    expect(screen.queryByLabelText('Open in Hold Center')).toBeNull();
  });
});
