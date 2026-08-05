import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createExecutionPlatform } from '@neuropause/execution';
import { createCommercialPlatform } from './platform';
import { COMMERCIAL_MATRIX, commercialReadiness, EXPECTED_ADAPTERS } from './evidence';
import { REGULATED_COMMERCE } from './constants';

describe('M18–M19 — SDK, governance, honesty boundary & reuse', () => {
  it('the SDK rejects an extension that reuses nothing (compose, do not fork)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    await expect(cm.sdk().register({ kind: 'billing-provider', name: 'rogue', reuses: [] })).rejects.toThrow(/reuse at least one/);
    const m = await cm.sdk().register({ kind: 'billing-provider', name: 'Stripe App', reuses: ['M5', 'M17'] });
    expect(m.reuses).toEqual(['M5', 'M17']);
  });

  it('every commercial action is audited on the ONE chain with evidence + a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'commercial.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    await cm.runtime().registerCustomer({ name: 'Acme' });
    expect(cm.governance().count()).toBeGreaterThan(0);
    expect(cm.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last).toHaveProperty('evidence');
  });

  it('seeds the payment adapters as adapter-verified (represented, never charged)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    await cm.adapters().seed();
    expect(cm.adapters().count()).toBe(EXPECTED_ADAPTERS);
    expect(cm.adapters().list().every((a) => a.evidence === 'adapter-verified' && !a.configured)).toBe(true);
  });

  it('reuses the Wave 5 execution connector count (does not duplicate connectors)', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const exec = createExecutionPlatform(rt, { clock });
    const cm = createCommercialPlatform(rt, { clock, execution: exec });
    expect(cm.reusedConnectorCount()).toBe(22);
  });

  it('keeps the four-level honesty boundary — no regulated financial op is live-verified', () => {
    const live = COMMERCIAL_MATRIX.filter((m) => m.level === 'live-verified' && /payment|settlement|remittance|payout|reconciliation/i.test(m.capability));
    expect(live).toHaveLength(0);

    const regulated = COMMERCIAL_MATRIX.filter((m) => m.level === 'regulated-external');
    expect(regulated.length).toBe(REGULATED_COMMERCE.length); // all 4 regulated financial ops represented only

    const r = commercialReadiness();
    expect(r.total).toBe(COMMERCIAL_MATRIX.length);
    expect(r.liveVerified).toBeGreaterThan(0);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS);
    expect(r.businessDataPending).toBeGreaterThan(0);
    expect(r.regulatedExternal).toBe(4);
  });
});
