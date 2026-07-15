/**
 * P9 — Marketplace renderer view-model tests (presentation mappings + derivations).
 */
import { describe, expect, it } from 'vitest';
import type { MarketplaceEntry } from '@neuropause/shared';
import {
  actionLabel,
  capabilityLabel,
  channelTone,
  decisionTone,
  groupByType,
  isActionable,
  tierLabel,
  tierTone,
  trustTone,
  typeIcon,
  typeLabel,
} from './marketplaceModel';

const NOW = '2026-07-15T00:00:00.000Z';
function entry(over: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    id: 'e', slug: 's', name: 'N', summary: '', packageType: 'worker', listingKind: 'ai_worker',
    capability: 'installable', category: 'Ops',
    publisher: { id: 'p', name: 'P', tier: 'verified', trustScore: 0.6 },
    version: '1.0.0', channel: 'stable', signed: true, certified: true, trustScore: 0.8,
    rating: 4, ratingCount: 10, installs: 100, installState: 'not_installed', dependencies: [], updatedAt: NOW,
    ...over,
  };
}

describe('presentation mappings', () => {
  it('labels + icons every package type', () => {
    expect(typeLabel('worker')).toBe('Worker');
    expect(typeLabel('policy_pack')).toBe('Policy Pack');
    expect(typeIcon('connector')).toBe('connectors');
  });
  it('tones tiers, trust, channels, decisions', () => {
    expect(tierTone('official')).toBe('accent');
    expect(tierLabel('trusted')).toBe('Trusted');
    expect(trustTone(0.9)).toBe('green');
    expect(trustTone(0.5)).toBe('orange');
    expect(trustTone(0.1)).toBe('red');
    expect(channelTone('canary')).toBe('red');
    expect(decisionTone('deny')).toBe('red');
    expect(decisionTone('require_approval')).toBe('orange');
  });
  it('labels capabilities', () => {
    expect(capabilityLabel('installable')).toBe('Install');
    expect(capabilityLabel('connect')).toBe('Connect');
    expect(capabilityLabel('catalog')).toBe('View');
  });
});

describe('actions', () => {
  it('derives the action label from install state + capability', () => {
    expect(actionLabel(entry({ installState: 'not_installed', capability: 'installable' }))).toBe('Install');
    expect(actionLabel(entry({ installState: 'update_available' }))).toBe('Update');
    expect(actionLabel(entry({ installState: 'installed' }))).toBe('Installed');
    expect(actionLabel(entry({ capability: 'connect', installState: 'not_installed' }))).toBe('Connect');
  });
  it('marks actionable entries', () => {
    expect(isActionable(entry({ installState: 'not_installed', capability: 'installable' }))).toBe(true);
    expect(isActionable(entry({ installState: 'installed' }))).toBe(false);
    expect(isActionable(entry({ capability: 'catalog', installState: 'not_installed' }))).toBe(false);
    expect(isActionable(entry({ installState: 'update_available', capability: 'catalog' }))).toBe(true);
  });
});

describe('groupByType', () => {
  it('groups by type, largest first', () => {
    const groups = groupByType([
      entry({ id: 'a', packageType: 'worker' }),
      entry({ id: 'b', packageType: 'worker' }),
      entry({ id: 'c', packageType: 'connector' }),
    ]);
    expect(groups[0].type).toBe('worker');
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[1].type).toBe('connector');
  });
});
