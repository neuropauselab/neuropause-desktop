/**
 * S124 — the Operational Overview panel renders a composed at-a-glance posture from TWO existing
 * governed reads: `ipc.platform.operationalOverview()` (QueryOperationalOverview) and
 * `ipc.security.auditIntegrity()` (the S115 audit-integrity channel). Proves the real UI→bridge
 * composition path, the seven posture tiles, the audit tile from its own channel, graceful degradation
 * when the audit read is unavailable, and that no secret/token/payload is rendered.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { OperationalOverviewPanel } from '@renderer/operationsPlatform/OperationalOverviewPanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

const overview = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    health: { status: 'HEALTHY', ready: true, components: { delivery: { pendingOutbox: 0 } } },
    reliability: { available: true, value: { totals: { commands: 5, delivered: 4, retryable: 1 }, successRatio: 0.8, trend: { comparable: true, posture: 'DEGRADING', deliveryFailureRateDirection: 'INCREASE', retryPressureDirection: 'STABLE', newSignatures: 1 } } },
    delivery: { available: true, value: { pending: 1, inFlight: 0, retryable: 1, delivered: 4 } },
    connectorInbound: { available: true, counts: { lineage: 3, connectors: 2 }, trend: { comparable: true, volumeDirection: 'INCREASE', newConnectors: 1, quietConnectors: 0 } },
    tenantId: 'tenant-A', ...over,
  },
  requestId: 'r', correlationId: 'c', operation: 'QueryOperationalOverview',
});

// S140 — the exceptions count is fetched from QueryOperationalExceptions on the SAME channel; route by op.
const exc = (total: number) => ({ ok: true, data: { counts: { retryingDeliveries: total, heldReconciliations: 0, total }, exceptions: [] }, requestId: 'r', correlationId: 'c', operation: 'QueryOperationalExceptions' });
const routePlatform = (over: () => Record<string, unknown>, total = 0): void => {
  route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
    const op = (payload as { operation: string }).operation;
    return op === 'QueryOperationalExceptions' ? exc(total) : over();
  });
};

describe('OperationalOverviewPanel', () => {
  it('composes the overview read + audit-integrity read into posture tiles', async () => {
    let sawOverview = '';
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      const op = (payload as { operation: string }).operation;
      if (op === 'QueryOperationalExceptions') return exc(0);
      sawOverview = op;
      return overview();
    });
    route(IpcChannel.SecurityAuditIntegrityStatus, () => ({ state: 'SIGNED', algorithm: 'ed25519', keyId: 'k1', keyVersion: 1 }));
    render(<OperationalOverviewPanel />);
    await waitFor(() => expect(screen.getByText('HEALTHY')).toBeTruthy());
    expect(sawOverview).toBe('QueryOperationalOverview');
    expect(screen.getByText('SIGNED')).toBeTruthy(); // audit tile from its own channel
    expect(screen.getByText(/80\.0% success/)).toBeTruthy();
    expect(screen.getByText(/degrading/)).toBeTruthy();
    expect(screen.getByText(/3 events · 2 connectors/)).toBeTruthy();
  });

  it('S140 — shows the honest "needs attention" exceptions count (reused from QueryOperationalExceptions)', async () => {
    routePlatform(() => overview(), 2);
    route(IpcChannel.SecurityAuditIntegrityStatus, () => ({ state: 'SIGNED' }));
    render(<OperationalOverviewPanel />);
    await waitFor(() => expect(screen.getByText('HEALTHY')).toBeTruthy());
    expect(screen.getByText('2 exceptions')).toBeTruthy();
  });

  it('S140 — the exceptions count is honestly "unavailable" when that read fails (never a fabricated 0)', async () => {
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      const op = (payload as { operation: string }).operation;
      if (op === 'QueryOperationalExceptions') return { ok: false, error: { code: 'UNAUTHORIZED', message: 'no' }, requestId: 'r', correlationId: 'c', operation: op };
      return overview();
    });
    route(IpcChannel.SecurityAuditIntegrityStatus, () => ({ state: 'SIGNED' }));
    render(<OperationalOverviewPanel />);
    await waitFor(() => expect(screen.getByText('HEALTHY')).toBeTruthy());
    expect(screen.getAllByText('unavailable').length).toBeGreaterThan(0);
  });

  it('degrades gracefully when the audit-integrity read is unavailable', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => overview());
    route(IpcChannel.SecurityAuditIntegrityStatus, () => { throw new Error('audit down'); });
    render(<OperationalOverviewPanel />);
    await waitFor(() => expect(screen.getByText('HEALTHY')).toBeTruthy());
    expect(screen.getAllByText('unavailable').length).toBeGreaterThan(0); // audit tile shows unavailable, overview still renders
  });

  it('shows an error state when the overview read fails', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => ({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated.' }, requestId: 'r', correlationId: 'c', operation: 'QueryOperationalOverview' }));
    route(IpcChannel.SecurityAuditIntegrityStatus, () => ({ state: 'SIGNED' }));
    render(<OperationalOverviewPanel />);
    await waitFor(() => expect(screen.getByText('Unavailable')).toBeTruthy());
  });

  it('never renders secret/token/payload material', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => overview());
    route(IpcChannel.SecurityAuditIntegrityStatus, () => ({ state: 'SIGNED' }));
    const { container } = render(<OperationalOverviewPanel />);
    await waitFor(() => expect(screen.getByText('HEALTHY')).toBeTruthy());
    const blob = (container.textContent ?? '').toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload']) {
      expect(blob).not.toContain(forbidden);
    }
  });
});
