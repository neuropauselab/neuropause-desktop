/**
 * Phase 6 Stage 5 — delivery-engine additions: per-source mutes on the tick
 * path, the deliverNow() event-driven path (same gates: enabled → mute →
 * priority → DND with critical bypass), and sourceKey stamping on delivered
 * items so the Notification Inbox can attribute them.
 */
import { describe, expect, it } from 'vitest';
import type {
  DeliveryChannel,
  DeliveryPreferences,
  IntelligenceItem,
  IntelligenceSource,
} from '@neuropause/shared';
import { DEFAULT_DELIVERY_PREFERENCES } from '@neuropause/shared';
import { DeliveryEngine } from './deliveryEngine';
import { forEachTenant } from '../tenancy/backgroundFanOut';
import { SINGLE_TENANT_FAN_OUT } from '../tenancy/testScope';

const NOW = new Date('2026-07-31T08:00:00.000Z');

function item(over: Partial<IntelligenceItem> = {}): IntelligenceItem {
  return {
    id: 'it1',
    title: 'T',
    body: 'B',
    priority: 'high',
    producedAt: NOW.toISOString(),
    ...over,
  };
}

function mkEngine(prefs: Partial<DeliveryPreferences> = {}): {
  engine: DeliveryEngine;
  delivered: IntelligenceItem[];
} {
  const delivered: IntelligenceItem[] = [];
  const channel: DeliveryChannel = {
    key: 'notification-center',
    available: true,
    deliver: (it) => {
      delivered.push(it);
    },
  };
  const engine = new DeliveryEngine({
    now: () => NOW,
    scheduler: { every: () => undefined, cancel: () => true },
    channels: [channel],
    getPreferences: () => ({ ...DEFAULT_DELIVERY_PREFERENCES, timezoneOffsetMinutes: 0, ...prefs }),
    // P13C Part 3 — one tenant; the fan-out has its own suite.
    forEachTenant: (jobId, fn) => forEachTenant(jobId, SINGLE_TENANT_FAN_OUT, fn),
  });
  return { engine, delivered };
}

function sourceAt(minutes: number, key = 'src1'): IntelligenceSource {
  return { key, label: key, cadence: { kind: 'daily', atMinutes: minutes }, produce: () => [item()] };
}

describe('per-source mute on the scheduled tick', () => {
  it('skips a muted source entirely and fires an unmuted one', async () => {
    const { engine, delivered } = mkEngine({ mutedSources: ['muted-src'] });
    engine.register(sourceAt(8 * 60, 'muted-src'));
    engine.register(sourceAt(8 * 60, 'live-src'));
    await engine.tick();
    expect(delivered.length).toBe(1);
    expect(delivered[0]!.sourceKey).toBe('live-src');
  });
});

describe('sourceKey stamping', () => {
  it('stamps the source key on scheduled deliveries', async () => {
    const { engine, delivered } = mkEngine();
    const prefs = { ...DEFAULT_DELIVERY_PREFERENCES, timezoneOffsetMinutes: 0 };
    await engine.fireSource(sourceAt(0, 'mission-brief-morning'), prefs);
    expect(delivered[0]!.sourceKey).toBe('mission-brief-morning');
  });

  it('stamps the source key on deliverNow', async () => {
    const { engine, delivered } = mkEngine();
    await engine.deliverNow('approval-needed', item());
    expect(delivered[0]!.sourceKey).toBe('approval-needed');
  });
});

describe('deliverNow gates (event-driven path)', () => {
  it('delivers a high item under default prefs', async () => {
    const { engine, delivered } = mkEngine();
    expect(await engine.deliverNow('approval-needed', item())).toBe(true);
    expect(delivered.length).toBe(1);
  });

  it('respects the global enabled switch', async () => {
    const { engine, delivered } = mkEngine({ enabled: false });
    expect(await engine.deliverNow('approval-needed', item())).toBe(false);
    expect(delivered).toEqual([]);
  });

  it('respects the per-source mute', async () => {
    const { engine, delivered } = mkEngine({ mutedSources: ['approval-needed'] });
    expect(await engine.deliverNow('approval-needed', item())).toBe(false);
    expect(delivered).toEqual([]);
  });

  it('filters below-threshold priorities (normal < high default)', async () => {
    const { engine, delivered } = mkEngine();
    expect(await engine.deliverNow('work-complete', item({ priority: 'normal' }))).toBe(false);
    expect(delivered).toEqual([]);
    const lowered = mkEngine({ minPriority: 'normal' });
    expect(await lowered.engine.deliverNow('work-complete', item({ priority: 'normal' }))).toBe(true);
  });

  it('DND blocks high but critical always gets through', async () => {
    const dnd = mkEngine({ doNotDisturb: true });
    expect(await dnd.engine.deliverNow('risk-signal', item({ priority: 'high' }))).toBe(false);
    expect(await dnd.engine.deliverNow('risk-signal', item({ priority: 'critical' }))).toBe(true);
    expect(dnd.delivered.length).toBe(1);
  });
});
