/**
 * P6 — the Cloud Platform Center pure view-model. Framework-free vitest, mirroring connectorCenterModel.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { buildResourceGraph, makeResource, type CloudPlatformDto, type CloudPlatformStats } from '@neuropause/shared';
import {
  platformStatusMeta,
  healthTone,
  platformNeedsAttention,
  matchesPlatformQuery,
  filterPlatforms,
  presentProviders,
  cloudOverviewMetrics,
  summarizeResourceGraph,
} from './infrastructureCenterModel';

function platform(over: Partial<CloudPlatformDto> = {}): CloudPlatformDto {
  return {
    id: 'aws', name: 'Amazon Web Services', provider: 'aws', description: '', brandColor: '#f90',
    authKind: 'iam_role', configured: false, status: 'unconfigured', health: 'unknown',
    multiAccount: true, accountNoun: 'Account', domains: ['compute', 'storage'], accounts: [], resourceCount: 0,
    ...over,
  };
}

describe('platformStatusMeta', () => {
  it('maps lifecycle + health onto label + tone', () => {
    expect(platformStatusMeta('unconfigured', 'unknown')).toEqual({ label: 'Not configured', tone: 'gray' });
    expect(platformStatusMeta('connected', 'healthy')).toEqual({ label: 'Connected', tone: 'green' });
    expect(platformStatusMeta('discovering', 'healthy').tone).toBe('blue');
    expect(platformStatusMeta('degraded', 'degraded').tone).toBe('orange');
    expect(platformStatusMeta('error', 'down').tone).toBe('red');
    expect(platformStatusMeta('connected', 'down').label).toBe('Error'); // health down overrides
  });
});

describe('healthTone', () => {
  it('maps resource health onto a tone', () => {
    expect(healthTone('healthy')).toBe('green');
    expect(healthTone('degraded')).toBe('orange');
    expect(healthTone('critical')).toBe('red');
    expect(healthTone('unknown')).toBe('gray');
  });
});

describe('platformNeedsAttention', () => {
  it('flags error/degraded/down and failing accounts', () => {
    expect(platformNeedsAttention(platform())).toBe(false);
    expect(platformNeedsAttention(platform({ status: 'error' }))).toBe(true);
    expect(platformNeedsAttention(platform({ health: 'down' }))).toBe(true);
    expect(platformNeedsAttention(platform({ accounts: [{ accountId: 'a', label: 'a', status: 'error', health: 'down', region: null, lastDiscoveryAt: null, nextDiscoveryAt: null, resourceCount: 0, consecutiveFailures: 3 }] }))).toBe(true);
  });
});

describe('filtering', () => {
  it('matches by name, provider, and domain', () => {
    const p = platform();
    expect(matchesPlatformQuery(p, 'amazon')).toBe(true);
    expect(matchesPlatformQuery(p, 'aws')).toBe(true);
    expect(matchesPlatformQuery(p, 'storage')).toBe(true);
    expect(matchesPlatformQuery(p, 'kubernetes')).toBe(false);
    expect(matchesPlatformQuery(p, '')).toBe(true);
  });

  it('filterPlatforms honors provider + query; presentProviders is first-seen order', () => {
    const dtos = [platform(), platform({ id: 'azure', name: 'Microsoft Azure', provider: 'azure' }), platform({ id: 'k8s', name: 'Kubernetes', provider: 'kubernetes' })];
    expect(filterPlatforms(dtos, { query: '', provider: 'azure' })).toHaveLength(1);
    expect(filterPlatforms(dtos, { query: 'kube', provider: 'all' }).map((d) => d.id)).toEqual(['k8s']);
    expect(presentProviders(dtos)).toEqual(['aws', 'azure', 'kubernetes']);
  });
});

describe('overview metrics', () => {
  it('passes the stats rollup through', () => {
    const stats: CloudPlatformStats = { platforms: 6, configured: 1, connected: 1, discovering: 0, degraded: 0, down: 0, accounts: 2, resources: 42, domains: 12 };
    expect(cloudOverviewMetrics(stats)).toMatchObject({ platforms: 6, accounts: 2, resources: 42, domains: 12 });
  });
});

describe('summarizeResourceGraph', () => {
  it('summarizes a built model for the Resource Graph tab', () => {
    const rs = [
      makeResource({ platformId: 'aws', provider: 'aws', accountId: 'a', resourceType: 'vol', nativeId: 'v1', name: 'v1', domain: 'storage', health: 'critical', now: '2026-07-13T00:00:00.000Z' }),
      makeResource({ platformId: 'aws', provider: 'aws', accountId: 'a', resourceType: 'db', nativeId: 'd1', name: 'd1', domain: 'databases', health: 'healthy', now: '2026-07-13T00:00:00.000Z', relationships: [{ type: 'backed_by', targetId: 'v1' }] }),
    ];
    const summary = summarizeResourceGraph(buildResourceGraph({ resources: rs }, Date.parse('2026-07-13T00:00:00.000Z')));
    expect(summary.resources).toBe(2);
    expect(summary.edges).toBe(1);
    expect(summary.critical).toBe(1);
    expect(summary.topBlastRadius[0].name).toBe('v1'); // v1 has a dependent
  });
});
