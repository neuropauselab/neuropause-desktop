import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createCommercialPlatform } from './platform';

describe('M4–M6 — licensing, subscriptions, usage metering', () => {
  it('licensing really enforces seat capacity', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    const lic = await cm.licenses().issue({ tenantId: 't1', type: 'seat', seats: 2 });
    await cm.licenses().allocateSeat(lic.id);
    await cm.licenses().allocateSeat(lic.id);
    await expect(cm.licenses().allocateSeat(lic.id)).rejects.toThrow(/no seats remaining/);
    expect(cm.licenses().get(lic.id)!.used).toBe(2);
  });

  it('subscriptions are represented (no charge) and MRR/ARR come from real records only', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    expect(cm.subscriptions().mrrCents()).toBe(0); // nothing fabricated
    const sub = await cm.subscriptions().subscribe({ tenantId: 't1', plan: 'monthly', seats: 10, unitPriceCents: 5000 });
    expect(sub.state).toBe('active');
    expect(cm.subscriptions().mrrCents()).toBe(50000);
    expect(cm.subscriptions().arrCents()).toBe(600000);
    await cm.subscriptions().suspend(sub.id);
    expect(cm.subscriptions().mrrCents()).toBe(0); // suspended subs drop out of MRR
  });

  it('annual plans amortize to a monthly MRR', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    await cm.subscriptions().subscribe({ tenantId: 't1', plan: 'annual', seats: 12, unitPriceCents: 12000 });
    expect(cm.subscriptions().mrrCents()).toBe(12000); // 12*12000/12
  });

  it('usage meters record real counters and read 0 before any activity', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    expect(cm.usage().usage('t1', 'api-calls')).toBe(0);
    await cm.usage().record({ tenantId: 't1', meter: 'api-calls', amount: 5 });
    await cm.usage().record({ tenantId: 't1', meter: 'api-calls', amount: 3 });
    expect(cm.usage().usage('t1', 'api-calls')).toBe(8);
    expect(cm.usage().total('t1')).toBe(8);
  });
});
