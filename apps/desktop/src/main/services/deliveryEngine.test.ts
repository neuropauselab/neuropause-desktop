import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DELIVERY_PREFERENCES,
  meetsPriority,
  scoreImpact,
  type DeliveryChannel,
  type DeliveryPreferences,
  type IntelligenceItem,
  type IntelligenceSource,
} from '@neuropause/shared';
import { DeliveryEngine } from './deliveryEngine';

function makeChannel(): DeliveryChannel & { sent: IntelligenceItem[] } {
  const sent: IntelligenceItem[] = [];
  return {
    key: 'desktop',
    available: true,
    sent,
    deliver: (it) => {
      sent.push(it);
    },
  };
}

function fakeScheduler() {
  return { every: vi.fn(), cancel: vi.fn() };
}

function prefs(patch: Partial<DeliveryPreferences> = {}): DeliveryPreferences {
  return { ...DEFAULT_DELIVERY_PREFERENCES, ...patch };
}

// A fixed local time of 08:00 for deterministic cadence tests.
const at0800 = new Date(2026, 0, 5, 8, 0, 0); // Mon Jan 5 2026, 08:00 local

describe('scoreImpact / meetsPriority', () => {
  it('scales impact by confidence', () => {
    const full = scoreImpact({ security: 1, confidence: 1 });
    const half = scoreImpact({ security: 1, confidence: 0.5 });
    expect(half).toBeCloseTo(full * 0.5, 5);
  });
  it('enforces the priority threshold', () => {
    expect(meetsPriority('high', 'high')).toBe(true);
    expect(meetsPriority('normal', 'high')).toBe(false);
    expect(meetsPriority('critical', 'high')).toBe(true);
  });
});

describe('DeliveryEngine', () => {
  function engine(channel: DeliveryChannel, p: DeliveryPreferences, now = at0800) {
    return new DeliveryEngine({
      now: () => now,
      scheduler: fakeScheduler(),
      channels: [channel],
      getPreferences: () => p,
    });
  }

  const dailySource = (produce: IntelligenceSource['produce']): IntelligenceSource => ({
    key: 'test-daily',
    label: 'Test',
    cadence: { kind: 'daily', atMinutes: 8 * 60 }, // 08:00
    produce,
  });

  it('fires a daily source at its scheduled minute and delivers a high item', async () => {
    const ch = makeChannel();
    const e = engine(ch, prefs({ minPriority: 'high' }));
    e.register(
      dailySource(() => [
        {
          id: 'x',
          title: 'Brief',
          body: 'ready',
          priority: 'high',
          producedAt: at0800.toISOString(),
        },
      ]),
    );
    await e.tick();
    expect(ch.sent).toHaveLength(1);
    expect(ch.sent[0].title).toBe('Brief');
  });

  it('does not fire off-schedule', async () => {
    const ch = makeChannel();
    const e = engine(ch, prefs(), new Date(2026, 0, 5, 9, 30, 0)); // 09:30, not 08:00
    e.register(
      dailySource(() => [{ id: 'x', title: 'B', body: 'b', priority: 'high', producedAt: '' }]),
    );
    await e.tick();
    expect(ch.sent).toHaveLength(0);
  });

  it('is a silent no-op when the source produces nothing', async () => {
    const ch = makeChannel();
    const e = engine(ch, prefs());
    e.register(dailySource(() => []));
    await e.tick();
    expect(ch.sent).toHaveLength(0);
  });

  it('suppresses items below the priority threshold', async () => {
    const ch = makeChannel();
    const e = engine(ch, prefs({ minPriority: 'high' }));
    e.register(
      dailySource(() => [{ id: 'x', title: 'low', body: '', priority: 'normal', producedAt: '' }]),
    );
    await e.tick();
    expect(ch.sent).toHaveLength(0);
  });

  it('respects Do Not Disturb for non-critical, but lets critical through', async () => {
    const chA = makeChannel();
    const eA = engine(chA, prefs({ doNotDisturb: true, minPriority: 'high' }));
    eA.register(
      dailySource(() => [{ id: 'h', title: 'high', body: '', priority: 'high', producedAt: '' }]),
    );
    await eA.tick();
    expect(chA.sent).toHaveLength(0); // DND blocks high

    const chB = makeChannel();
    const eB = engine(chB, prefs({ doNotDisturb: true, minPriority: 'high' }));
    eB.register(
      dailySource(() => [
        { id: 'c', title: 'critical', body: '', priority: 'critical', producedAt: '' },
      ]),
    );
    await eB.tick();
    expect(chB.sent).toHaveLength(1); // critical overrides DND
  });

  it('does not double-fire within the same minute', async () => {
    const ch = makeChannel();
    const e = engine(ch, prefs());
    e.register(
      dailySource(() => [{ id: 'x', title: 'B', body: '', priority: 'high', producedAt: '' }]),
    );
    await e.tick();
    await e.tick(); // same clock => must not deliver twice
    expect(ch.sent).toHaveLength(1);
  });

  it('does nothing when delivery is globally disabled', async () => {
    const ch = makeChannel();
    const e = engine(ch, prefs({ enabled: false }));
    e.register(
      dailySource(() => [{ id: 'x', title: 'B', body: '', priority: 'high', producedAt: '' }]),
    );
    await e.tick();
    expect(ch.sent).toHaveLength(0);
  });

  it('delivers higher-impact items after lower ones (most important most-recent)', async () => {
    const ch = makeChannel();
    const e = engine(ch, prefs({ minPriority: 'normal' }));
    e.register(
      dailySource(() => [
        {
          id: 'lo',
          title: 'low-impact',
          body: '',
          priority: 'high',
          impact: { business: 0.1, confidence: 1 },
          producedAt: '',
        },
        {
          id: 'hi',
          title: 'high-impact',
          body: '',
          priority: 'high',
          impact: { revenue: 0.9, urgency: 0.9, confidence: 1 },
          producedAt: '',
        },
      ]),
    );
    await e.tick();
    expect(ch.sent.map((i) => i.id)).toEqual(['lo', 'hi']);
  });
});
