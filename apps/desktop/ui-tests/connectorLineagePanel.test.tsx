/**
 * S121 — the Connector Lineage panel renders REAL verified inbound-webhook lineage fetched through the
 * governed read IPC (`ipc.platform.inboundLineage` → `platform:command.dispatch`, `QueryInboundLineage`).
 * Proves the real UI → bridge → governed read path, a per-connector summary, and — critically — that the
 * panel shows NO secret/token/signature/payload and marks rows credential-free with dedupe "none".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { ConnectorLineagePanel } from '@renderer/operationsPlatform/ConnectorLineagePanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

const resp = (over: Record<string, unknown>) => ({
  ok: true,
  data: { counts: { lineage: 0, connectors: 0 }, lineage: [], summary: [], tenantId: 'tenant-A', ...over },
  requestId: 'r', correlationId: 'c', operation: 'QueryInboundLineage',
});

describe('ConnectorLineagePanel', () => {
  it('renders a verified inbound lineage row + per-connector summary', async () => {
    let sawOperation = '';
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      sawOperation = (payload as { operation: string }).operation;
      return resp({
        counts: { lineage: 1, connectors: 1 },
        lineage: [{ eventId: 'e1', connectorId: 'github', provider: 'github', verifiedSource: 'github', receivedAt: 1_700_000_000_000, tenantId: 'tenant-A', dedupeRef: null, credentialsPresent: false }],
        summary: [{ connectorId: 'github', provider: 'github', events: 1, lastReceivedAt: 1_700_000_000_000 }],
      });
    });
    render(<ConnectorLineagePanel />);
    await waitFor(() => expect(screen.getByText('Events: 1')).toBeTruthy());
    expect(sawOperation).toBe('QueryInboundLineage');
    expect(screen.getAllByText(/github/).length).toBeGreaterThan(0);
    expect(screen.getByText(/verified: github/)).toBeTruthy();
    expect(screen.getByText(/dedupe none/)).toBeTruthy();
    expect(screen.getByText('credential-free')).toBeTruthy();
  });

  it('S135 — renders the per-connector inbound intelligence section (state + correlatable + dedupe)', async () => {
    route(IpcChannel.PlatformCommandDispatch, () =>
      resp({
        counts: { lineage: 2, connectors: 1 },
        lineage: [{ eventId: 'e1', connectorId: 'github', provider: 'github', verifiedSource: 'github', receivedAt: 1_700_000_000_000, tenantId: 'tenant-A', dedupeRef: null, credentialsPresent: false }],
        summary: [{ connectorId: 'github', provider: 'github', events: 2, lastReceivedAt: 1_700_000_000_000 }],
        intelligence: [
          { connectorId: 'github', provider: 'github', verifiedSource: 'github', events: 2, lastReceivedAt: 1_700_000_000_000, trendDirection: 'INCREASE', state: 'ACTIVE', correlatable: false, dedupeRefStatus: 'absent', sampleEventIds: ['e1'] },
        ],
      }),
    );
    render(<ConnectorLineagePanel />);
    await waitFor(() => expect(screen.getByText('Connector inbound intelligence')).toBeTruthy());
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.getByText(/2 verified inbound/)).toBeTruthy();
    expect(screen.getByText(/not correlatable/)).toBeTruthy();
    expect(screen.getByText(/dedupe absent/)).toBeTruthy();
  });

  it('renders the inbound TREND section (new / quiet connectors)', async () => {
    route(IpcChannel.PlatformCommandDispatch, () =>
      resp({
        counts: { lineage: 4, connectors: 2 },
        lineage: [{ eventId: 'e1', connectorId: 'slack', provider: 'slack', verifiedSource: 'slack', receivedAt: 1_700_000_000_000, tenantId: 'tenant-A', dedupeRef: null, credentialsPresent: false }],
        summary: [{ connectorId: 'slack', provider: 'slack', events: 2, lastReceivedAt: 1_700_000_000_000 }],
        trend: {
          comparable: true,
          window: { previous: 2, recent: 2 },
          totalVolume: { previous: 2, recent: 2, delta: 0, direction: 'STABLE' },
          newConnectors: ['slack'],
          quietConnectors: ['github'],
          byConnector: [{ connectorId: 'slack', provider: 'slack', previous: 0, recent: 2, delta: 2, direction: 'INCREASE' }],
        },
      }),
    );
    render(<ConnectorLineagePanel />);
    await waitFor(() => expect(screen.getByText(/Inbound trend · 2 → 2 events/)).toBeTruthy());
    expect(screen.getByText(/New connectors:/)).toBeTruthy();
    expect(screen.getByText(/Quiet connectors:/)).toBeTruthy();
  });

  it('shows an empty state when there is no verified inbound activity', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => resp({}));
    render(<ConnectorLineagePanel />);
    await waitFor(() => expect(screen.getByText('No verified inbound webhooks yet')).toBeTruthy());
  });

  it('never renders secret/token/signature/payload material', async () => {
    route(IpcChannel.PlatformCommandDispatch, () =>
      resp({
        counts: { lineage: 1, connectors: 1 },
        lineage: [{ eventId: 'e1', connectorId: 'slack', provider: 'slack', verifiedSource: 'slack', receivedAt: 1_700_000_000_000, tenantId: 'tenant-A', dedupeRef: null, credentialsPresent: false }],
        summary: [{ connectorId: 'slack', provider: 'slack', events: 1, lastReceivedAt: 1_700_000_000_000 }],
      }),
    );
    const { container } = render(<ConnectorLineagePanel />);
    await waitFor(() => expect(screen.getByText(/verified: slack/)).toBeTruthy());
    const blob = (container.textContent ?? '').toLowerCase();
    for (const forbidden of ['secret', 'token', 'signature', 'authorization', 'payload']) {
      expect(blob).not.toContain(forbidden);
    }
  });
});
