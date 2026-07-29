import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { CONNECTOR_CATALOG, mockConnector, catalogDescriptor } from './catalog';
import { ConnectorRegistry } from './registry';
import { MarketplaceFoundation, type PackageDescriptor } from './marketplace';

describe('connector catalog', () => {
  it('has 42 connectors across AI/dev/chat/productivity/data/storage/protocol', () => {
    expect(CONNECTOR_CATALOG.length).toBe(42);
    const categories = new Set(CONNECTOR_CATALOG.map((c) => c.category));
    expect(categories.has('ai')).toBe(true);
    expect(categories.has('database')).toBe(true);
    expect(categories.has('protocol')).toBe(true);
    expect(new Set(CONNECTOR_CATALOG.map((c) => c.id)).size).toBe(42); // unique ids
  });
  it('mockConnector produces a valid, executable connector', () => {
    const gh = mockConnector(catalogDescriptor('github') as never);
    expect(gh.id).toBe('github');
    expect(gh.actions.map((a) => a.name)).toEqual(['ping', 'invoke']);
  });
});

describe('MarketplaceFoundation', () => {
  function setup() {
    const clock = new ManualClock(0);
    const registry = new ConnectorRegistry(clock);
    const mkt = new MarketplaceFoundation(registry, 'signing-key', '0.0.0-preview.1');
    return { registry, mkt };
  }
  const desc = (over: Partial<PackageDescriptor> = {}): PackageDescriptor => ({
    id: 'x',
    name: 'X',
    version: '1.0.0',
    category: 'test',
    capabilities: ['read'],
    permissions: ['x:use'],
    ...over,
  });

  it('signs + verifies; a tampered or unsigned package fails', () => {
    const { mkt } = setup();
    const d = desc();
    const signature = mkt.sign(d);
    expect(mkt.verify({ descriptor: d, signature })).toBe(true);
    expect(mkt.verify({ descriptor: { ...d, permissions: ['x:admin'] }, signature })).toBe(false);
    expect(mkt.verify({ descriptor: d })).toBe(false);
  });
  it('checks version compatibility', () => {
    const { mkt } = setup();
    expect(mkt.compatible(desc())).toBe(true);
    expect(mkt.compatible(desc({ requiresRuntime: '9.0.0' }))).toBe(false);
    expect(mkt.compatible(desc({ requiresRuntime: '0.0.0' }))).toBe(true);
  });
  it('resolves dependencies and reviews permissions', () => {
    const { registry, mkt } = setup();
    const d = desc({ dependencies: ['base'] });
    expect(mkt.missingDependencies(d)).toEqual(['base']);
    registry.install(mockConnector({ id: 'base', name: 'Base', category: 'test', auth: 'none', capabilities: [] }));
    expect(mkt.missingDependencies(d)).toEqual([]);
    expect(mkt.review({ descriptor: d, signature: mkt.sign(d) })).toMatchObject({
      signed: true,
      compatible: true,
      missingDependencies: [],
      permissions: ['x:use'],
    });
  });
  it('installs only signed, compatible, dependency-satisfied packages', () => {
    const { registry, mkt } = setup();
    const d = desc();
    const def = mockConnector({ id: 'x', name: 'X', category: 'test', auth: 'none', capabilities: ['read'] });
    expect(mkt.install({ descriptor: d, signature: 'bad' }, def).ok).toBe(false);
    expect(mkt.install({ descriptor: d, signature: mkt.sign(d) }, def).ok).toBe(true);
    expect(registry.has('x')).toBe(true);
    const d2 = desc({ id: 'y', requiresRuntime: '9.0.0' });
    const def2 = mockConnector({ id: 'y', name: 'Y', category: 'test', auth: 'none', capabilities: [] });
    const res = mkt.install({ descriptor: d2, signature: mkt.sign(d2) }, def2);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('requires runtime');
  });
});
