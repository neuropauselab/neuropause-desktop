/** P4.1 Increment 4 — connector diagnostics probe. Maps aggregate integration health → a DiagnosticCheck. */
import { describe, expect, it } from 'vitest';
import type { ConnectorSyncSnapshot } from '@neuropause/shared';
import { connectorHealthProbe } from './connectorDiagnostics';

function snap(over: Partial<ConnectorSyncSnapshot> = {}): ConnectorSyncSnapshot {
  return {
    connectorId: 'github', accountId: 'a1', status: 'success', lastSyncAt: '2026-07-12T00:00:00.000Z',
    lastDurationMs: 40, nextSyncAt: null, entityCount: 10, lastError: null, consecutiveFailures: 0,
    rateLimitedUntil: null, queueSize: 0, ...over,
  };
}
const NOW = Date.parse('2026-07-12T00:10:00.000Z');

describe('connectorHealthProbe', () => {
  it('reports ok when all accounts are healthy', async () => {
    const check = await connectorHealthProbe(() => [snap(), snap({ accountId: 'a2' })], { now: () => NOW })();
    expect(check.id).toBe('connectors');
    expect(check.status).toBe('ok');
    expect(check.detail).toContain('2 account');
  });

  it('degrades when an account is degraded (repeated failures)', async () => {
    const check = await connectorHealthProbe(() => [snap(), snap({ accountId: 'a2', consecutiveFailures: 2 })], { now: () => NOW })();
    expect(check.status).toBe('degraded');
    expect(check.recommendation).toContain('attention');
  });

  it('reports down when an account is unhealthy (offline + repeated failures)', async () => {
    const check = await connectorHealthProbe(() => [snap({ status: 'offline', consecutiveFailures: 6, lastError: 'net' })], { now: () => NOW })();
    expect(check.status).toBe('down');
  });

  it('is ok with no connected accounts (idle)', async () => {
    const check = await connectorHealthProbe(() => [], { now: () => NOW })();
    expect(check.status).toBe('ok');
  });

  it('surfaces reauth-needed accounts (not in snapshots) as at least degraded', async () => {
    const check = await connectorHealthProbe(() => [snap()], { now: () => NOW, attention: () => 2 })();
    expect(check.status).toBe('degraded'); // healthy snapshots, but 2 accounts need reauth
    expect(check.detail).toContain('2 need reauth');
    expect(check.recommendation).toContain('attention');
  });

  it('reports down when the snapshot getter throws (probe never escapes)', async () => {
    const check = await connectorHealthProbe(() => {
      throw new Error('boom');
    }, { now: () => NOW })();
    expect(check.status).toBe('down');
    expect(check.detail).toContain('boom');
  });
});
