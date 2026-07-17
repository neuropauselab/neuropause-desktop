/**
 * P5 — Increment 4: the Enterprise Connector Center's pure view-model. Framework-free, so it runs in
 * the desktop workspace's node test gate (no jsdom). Verifies per-service capability presentation,
 * connector search/filter/category ordering, and the Overview roll-up over the existing DTOs.
 */
import { describe, expect, it } from 'vitest';
import type {
  ConnectorCategory,
  ConnectorDto,
  ConnectorServiceCapability,
  ConnectorStats,
} from '@neuropause/shared';
import {
  connectorNeedsAttention,
  connectorStatusMeta,
  filterConnectors,
  matchesConnectorQuery,
  overviewMetrics,
  presentCategories,
  serviceStatusMeta,
  summarizeServices,
} from './connectorCenterModel';

function dto(over: Partial<ConnectorDto> = {}): ConnectorDto {
  return {
    id: 'github', name: 'GitHub', provider: 'GitHub', description: 'Code hosting', category: 'developer',
    website: '', docsUrl: '', brandColor: '#000', version: '1.0.0', authType: 'oauth2_pkce', capabilities: [],
    scopes: [], multiAccount: true, configured: true, status: 'connected', health: 'healthy', accounts: [],
    lastSyncAt: null, setupHint: null, lifecycle: 'production', ...over,
  };
}

function svc(over: Partial<ConnectorServiceCapability> = {}): ConnectorServiceCapability {
  return { id: 's', label: 'S', kind: null, scope: null, status: 'available', objectCount: null, lastSyncAt: null, reason: null, ...over };
}

describe('serviceStatusMeta', () => {
  it('maps every service status to a label + tone', () => {
    expect(serviceStatusMeta('available')).toEqual({ label: 'Available', tone: 'green' });
    expect(serviceStatusMeta('requires_scope')).toEqual({ label: 'Scope needed', tone: 'orange' });
    expect(serviceStatusMeta('unprovisioned')).toEqual({ label: 'Not provisioned', tone: 'gray' });
    expect(serviceStatusMeta('disabled')).toEqual({ label: 'Disabled', tone: 'gray' });
  });
});

describe('summarizeServices', () => {
  it('counts services by status and sums live object counts', () => {
    const summary = summarizeServices([
      svc({ status: 'available', objectCount: 10 }),
      svc({ status: 'available', objectCount: 5 }),
      svc({ status: 'requires_scope' }),
      svc({ status: 'unprovisioned', objectCount: 0 }),
      svc({ status: 'disabled' }),
    ]);
    expect(summary).toEqual({ total: 5, available: 2, requiresScope: 1, unprovisioned: 1, disabled: 1, objects: 15 });
  });

  it('is empty-safe', () => {
    expect(summarizeServices([])).toEqual({ total: 0, available: 0, requiresScope: 0, unprovisioned: 0, disabled: 0, objects: 0 });
  });
});

describe('connectorStatusMeta', () => {
  it('faults dominate; a degraded/down connected connector is a caution/critical', () => {
    expect(connectorStatusMeta('error', 'healthy').tone).toBe('red');
    expect(connectorStatusMeta('reauth_required', 'healthy').tone).toBe('orange');
    expect(connectorStatusMeta('connecting', 'unknown').tone).toBe('blue');
    expect(connectorStatusMeta('unavailable', 'unknown')).toEqual({ label: 'Not configured', tone: 'gray' });
    expect(connectorStatusMeta('disconnected', 'unknown').tone).toBe('gray');
    expect(connectorStatusMeta('connected', 'healthy')).toEqual({ label: 'Connected', tone: 'green' });
    expect(connectorStatusMeta('connected', 'degraded').tone).toBe('orange');
    expect(connectorStatusMeta('connected', 'down').tone).toBe('red');
  });
});

describe('connectorNeedsAttention', () => {
  it('flags error / reauth / degraded / down and nothing healthy', () => {
    expect(connectorNeedsAttention({ status: 'error', health: 'healthy' })).toBe(true);
    expect(connectorNeedsAttention({ status: 'reauth_required', health: 'healthy' })).toBe(true);
    expect(connectorNeedsAttention({ status: 'connected', health: 'degraded' })).toBe(true);
    expect(connectorNeedsAttention({ status: 'connected', health: 'down' })).toBe(true);
    expect(connectorNeedsAttention({ status: 'connected', health: 'healthy' })).toBe(false);
    expect(connectorNeedsAttention({ status: 'disconnected', health: 'unknown' })).toBe(false);
  });
});

describe('matchesConnectorQuery', () => {
  const c = dto({ name: 'Google Workspace', provider: 'Google', description: 'Gmail, Drive, Calendar' });
  it('matches on name / provider / description, case-insensitive; empty matches all', () => {
    expect(matchesConnectorQuery(c, '')).toBe(true);
    expect(matchesConnectorQuery(c, 'google')).toBe(true);
    expect(matchesConnectorQuery(c, 'DRIVE')).toBe(true); // description
    expect(matchesConnectorQuery(c, '  workspace  ')).toBe(true); // trimmed
    expect(matchesConnectorQuery(c, 'slack')).toBe(false);
  });
});

describe('filterConnectors', () => {
  const list = [
    dto({ id: 'github', name: 'GitHub', category: 'developer' }),
    dto({ id: 'slack', name: 'Slack', provider: 'Slack', category: 'communication' }),
    dto({ id: 'notion', name: 'Notion', provider: 'Notion', category: 'productivity' }),
  ];
  it('filters by category and query, preserving order', () => {
    expect(filterConnectors(list, { query: '', category: 'all' }).map((c) => c.id)).toEqual(['github', 'slack', 'notion']);
    expect(filterConnectors(list, { query: '', category: 'communication' }).map((c) => c.id)).toEqual(['slack']);
    expect(filterConnectors(list, { query: 'notion', category: 'all' }).map((c) => c.id)).toEqual(['notion']);
    expect(filterConnectors(list, { query: 'x', category: 'developer' })).toEqual([]);
  });
});

describe('presentCategories', () => {
  const order: ConnectorCategory[] = ['ai_assistant', 'developer', 'productivity', 'communication'];
  it('returns only the categories present, in the given order', () => {
    const list = [dto({ category: 'communication' }), dto({ category: 'developer' }), dto({ category: 'developer' })];
    expect(presentCategories(list, order)).toEqual(['developer', 'communication']);
    expect(presentCategories([], order)).toEqual([]);
  });
});

describe('overviewMetrics', () => {
  it('is null-safe (pre-load) and rolls up attention = degraded + down', () => {
    expect(overviewMetrics(null)).toEqual({ total: 0, configured: 0, connected: 0, accounts: 0, healthy: 0, degraded: 0, down: 0, attention: 0 });
    const stats: ConnectorStats = { total: 10, configured: 8, connected: 5, accounts: 7, healthy: 4, degraded: 2, down: 1, byCategory: {} };
    expect(overviewMetrics(stats)).toEqual({ total: 10, configured: 8, connected: 5, accounts: 7, healthy: 4, degraded: 2, down: 1, attention: 3 });
  });
});
