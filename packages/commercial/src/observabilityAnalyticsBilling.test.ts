import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createOperationsPlatform } from '@neuropause/operations';
import { createCommercialPlatform } from './platform';
import { NO_COMMERCIAL_DATA } from './constants';

describe('M15–M17 — observability, analytics, billing', () => {
  it('observability REUSES the operations base incident registry', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createOperationsPlatform(rt);
    const cm = createCommercialPlatform(rt, { clock, operations: ops });
    expect(cm.observability().platformHealth().connected).toBe(true);
    expect(cm.observability().platformHealth().openIncidents).toBe(0);
    ops.incidents().open({ title: 'API down', severity: 'sev2' });
    expect(cm.observability().platformHealth().openIncidents).toBe(1); // reflects real reused incidents

    const solo = createCommercialPlatform(rt, { clock });
    expect(solo.observability().platformHealth().openIncidents).toBe(NO_COMMERCIAL_DATA);
  });

  it('analytics shows only real commercial data — never fabricated', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    expect(cm.analytics().mrr()).toBe(NO_COMMERCIAL_DATA);
    expect(cm.analytics().arr()).toBe(NO_COMMERCIAL_DATA);
    expect(cm.analytics().customerGrowth().customers).toBe(0);

    await cm.runtime().registerCustomer({ name: 'Acme' });
    await cm.subscriptions().subscribe({ tenantId: 't1', plan: 'monthly', seats: 4, unitPriceCents: 2500 });
    expect(cm.analytics().mrr()).toBe(10000);
    expect(cm.analytics().customerGrowth().customers).toBe(1);
    expect(cm.analytics().snapshot().hasData).toBe(true);
  });

  it('billing represents invoices only — no charge, revenue pending', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'commercial.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    const inv = await cm.billing().draftInvoice({ tenantId: 't1', lines: [{ description: '4 seats', amountCents: 10000 }, { description: 'AI usage', amountCents: 2500 }] });
    expect(inv.amountCents).toBe(12500);
    expect(inv.status).toBe('draft');
    expect(inv.note).toMatch(/no payment processed/);
    const evt = events.find((e) => e['operation'] === 'billing.draft-invoice')!;
    expect(evt['evidence']).toBe('business-data-pending'); // revenue is pending, not live
  });
});
