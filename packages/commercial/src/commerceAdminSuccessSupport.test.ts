import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createFederationPlatform } from '@neuropause/federation';
import { createBusinessPlatform } from '@neuropause/business';
import { createCommercialPlatform } from './platform';
import { NO_COMMERCIAL_DATA } from './constants';

describe('M11–M14 — marketplace commerce, administration, customer success, support', () => {
  it('marketplace commerce REUSES the Wave 6 federation marketplace to install a purchase', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const fed = createFederationPlatform(rt, { clock });
    const cm = createCommercialPlatform(rt, { clock, federation: fed });
    const purchase = await cm.marketplace().purchase({ tenantId: 't1', orgId: 'o1', kind: 'industry-pack', name: 'Healthcare Pack' });
    expect(purchase.reusedFederation).toBe(true);
    expect(purchase.listingId).toBeTruthy();
    expect(fed.marketplace().installsFor('o1').length).toBeGreaterThan(0); // real install on the reused marketplace
    expect(purchase.note).toMatch(/no charge settled/);
  });

  it('administration manages users, roles, and settings', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    const u = await cm.administration().addUser({ tenantId: 't1', email: 'admin@acme.com', role: 'admin' });
    cm.administration().setRole(u.id, 'owner');
    expect(cm.administration().usersOf('t1')[0]!.role).toBe('owner');
    await cm.administration().configureSettings({ tenantId: 't1', mfaRequired: true, region: 'eu' });
    expect(cm.administration().settingsOf('t1')!.mfaRequired).toBe(true);
  });

  it('customer success uses real signals and REUSES Wave 8 churn risk when linked', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    expect(cm.customerSuccess().health({ tenantId: 't1' }).note).toBe(NO_COMMERCIAL_DATA); // no usage yet
    await cm.usage().record({ tenantId: 't1', meter: 'ai-usage', amount: 4 });
    expect(cm.customerSuccess().health({ tenantId: 't1' }).adoptionScore).toBe(1);

    const biz = createBusinessPlatform(rt, { clock });
    const account = await biz.crm().createAccount({ name: 'Acme' });
    const linked = createCommercialPlatform(rt, { clock, business: biz });
    const health = linked.customerSuccess().health({ tenantId: 't1', accountId: account.id });
    expect(typeof health.risk).toBe('string'); // real churn band reused from Wave 8
    expect(health.source).toMatch(/business customer-success/);
  });

  it('support computes SLA status from real timestamps', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    const t = await cm.support().openTicket({ tenantId: 't1', subject: 'Cannot log in', priority: 'high', slaTargetMs: 5000 });
    clock.advance(3000);
    await cm.support().setState(t.id, 'resolved');
    const sla = cm.support().slaStatus(t.id);
    expect(sla.elapsedMs).toBe(3000);
    expect(sla.withinSla).toBe(true);
  });
});
