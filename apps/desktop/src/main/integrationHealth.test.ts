import { describe, expect, it } from 'vitest';
import {
  computeIntegrationHealth,
  aggregateIntegrationHealth,
  integrationHealthRecommendations,
  type ConnectorSyncSnapshot,
} from '@neuropause/shared';

const NOW = 1_700_000_000_000;

function snap(over: Partial<ConnectorSyncSnapshot> = {}): ConnectorSyncSnapshot {
  return {
    connectorId: 'c',
    accountId: 'a',
    status: 'success',
    lastSyncAt: new Date(NOW - 60_000).toISOString(),
    lastDurationMs: 120,
    nextSyncAt: new Date(NOW + 900_000).toISOString(),
    entityCount: 42,
    lastError: null,
    consecutiveFailures: 0,
    rateLimitedUntil: null,
    queueSize: 0,
    ...over,
  };
}

describe('integrationHealth — scoring', () => {
  it('scores a healthy account 100/healthy/connected/authorized', () => {
    const h = computeIntegrationHealth(snap(), NOW);
    expect(h.score).toBe(100);
    expect(h.state).toBe('healthy');
    expect(h.connection).toBe('connected');
    expect(h.auth).toBe('authorized');
    expect(h.errors).toEqual([]);
    expect(h.latencyMs).toBe(120);
  });

  it('penalizes consecutive failures without an error status (degraded)', () => {
    const h = computeIntegrationHealth(snap({ consecutiveFailures: 2 }), NOW);
    expect(h.score).toBe(100 - 24);
    expect(h.state).toBe('degraded');
    expect(h.connection).toBe('connected');
  });

  it('penalizes error status + failures (unhealthy)', () => {
    const h = computeIntegrationHealth(snap({ status: 'error', lastError: 'boom', consecutiveFailures: 2 }), NOW);
    expect(h.score).toBe(100 - 40 - 24);
    expect(h.state).toBe('unhealthy');
    expect(h.connection).toBe('degraded');
    expect(h.errors).toContain('boom');
  });

  it('marks offline + disconnected on many failures', () => {
    expect(computeIntegrationHealth(snap({ status: 'offline' }), NOW).connection).toBe('offline');
    expect(computeIntegrationHealth(snap({ status: 'error', consecutiveFailures: 5 }), NOW).connection).toBe('disconnected');
  });

  it('flags rate limiting + reauth from real credential expiry', () => {
    const rl = computeIntegrationHealth(snap({ status: 'rate_limited' }), NOW);
    expect(rl.rateLimited).toBe(true);
    expect(rl.warnings.some((w) => w.includes('Rate limited'))).toBe(true);
    const reauth = computeIntegrationHealth(snap(), NOW, { authExpiresAt: NOW - 1 });
    expect(reauth.auth).toBe('reauth_required');
    expect(reauth.errors).toContain('Reauthorization required');
  });

  it('treats a never-synced idle account as idle/unknown', () => {
    const h = computeIntegrationHealth(snap({ status: 'idle', lastSyncAt: null, nextSyncAt: null }), NOW);
    expect(h.state).toBe('idle');
    expect(h.auth).toBe('unknown');
  });

  it('is deterministic', () => {
    const s = snap({ status: 'error', consecutiveFailures: 1 });
    expect(computeIntegrationHealth(s, NOW)).toEqual(computeIntegrationHealth(s, NOW));
  });
});

describe('integrationHealth — aggregate + recommendations', () => {
  it('rolls up to the worst state', () => {
    const healthy = computeIntegrationHealth(snap(), NOW);
    const bad = computeIntegrationHealth(snap({ status: 'error', consecutiveFailures: 5 }), NOW);
    const agg = aggregateIntegrationHealth([healthy, bad]);
    expect(agg.total).toBe(2);
    expect(agg.unhealthy).toBe(1);
    expect(agg.overall).toBe('unhealthy');
  });

  it('reports an idle overall for an empty set', () => {
    expect(aggregateIntegrationHealth([])).toMatchObject({ total: 0, score: 0, overall: 'idle' });
  });

  it('recommends fixes deterministically', () => {
    const h = computeIntegrationHealth(snap({ status: 'error', consecutiveFailures: 3 }), NOW, { authExpiresAt: NOW - 1 });
    const recs = integrationHealthRecommendations(h);
    expect(recs).toContain('Reconnect this account to restore access.');
    expect(recs.some((r) => r.includes('provider configuration'))).toBe(true);
  });
});
