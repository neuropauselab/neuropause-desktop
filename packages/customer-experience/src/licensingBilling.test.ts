import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createCommercialPlatform } from '@neuropause/commercial';
import { createReleasePlatform } from '@neuropause/release';
import { createCustomerExperience } from './platform';

describe('E3 / E4 — licensing + billing', () => {
  it('assigns a REAL license via the reused release + commercial licensing', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const commercial = createCommercialPlatform(rt, { clock });
    const release = createReleasePlatform(rt, { clock, commercial });
    const cx = createCustomerExperience(rt, { clock, release, commercial });

    const license = await cx.licensing().assign({ tier: 'professional', tenantId: 'acme', seats: 10 });
    expect(license.reusedRelease).toBe(true);
    expect(license.grantId).toBeTruthy();
    await cx.licensing().allocateSeat('acme');
    expect(cx.licensing().validate('acme').valid).toBe(true);
    expect(cx.licensing().upgradePath('professional')).toContain('enterprise');
    expect(cx.licensing().downgradePath('professional')).toContain('community');
  });

  it('NEVER marks a payment successful — Stripe/Razorpay require configured credentials', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cx = createCustomerExperience(rt, { clock });

    const sub = await cx.billing().createSubscription({ tenantId: 'acme', tier: 'professional', provider: 'stripe' });
    const invoice = await cx.billing().createInvoice({ subscriptionId: sub.id, amountCents: 4900 });
    const payment = await cx.billing().attemptPayment({ invoiceId: invoice.id, provider: 'stripe' });
    expect(payment.status).toBe('requires-credentials'); // never 'succeeded'
    expect(cx.billing().successfulPaymentCount()).toBe(0); // no revenue, no fabricated payment
    expect(cx.billing().providers()).toContain('razorpay');
  });
});
