import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createCustomerExperience } from './platform';
import { CX_MATRIX, cxReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';

// External services, real data, or launch infrastructure — must NEVER be classified live.
const ADAPTER_OR_DATA = /Stripe|Razorpay|Email|Google Login|Microsoft Login|Customer Signups|Active Customers|Revenue|Renewal Metrics|Customer Adoption|Public Website|Production Download CDN|Payment Gateway|CDN|Email Delivery/;

describe('E15 + evidence — governance + honesty invariant', () => {
  it('audits every customer operation on the ONE chain with a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cx = createCustomerExperience(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'cx.action', (e) => { events.push(e.payload as Record<string, unknown>); });
    await cx.billing().createSubscription({ tenantId: 'acme', tier: 'trial', provider: 'stripe' });
    expect(cx.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['customer']).toBe('acme');
  });

  it('NEVER promotes evidence incorrectly — no live payment, delivered email, or live website', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cx = createCustomerExperience(rt, { clock });

    const nonLiveClassifiedLive = CX_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_OR_DATA.test(m.capability));
    expect(nonLiveClassifiedLive).toHaveLength(0);

    // honesty specifics
    expect(cx.billing().successfulPaymentCount()).toBe(0);
    expect(cx.website().deploymentStatus().live).toBe(false);
    expect(cx.communications().deliveryConfigured()).toBe(false);

    const r = cxReadiness();
    expect(r.total).toBe(CX_MATRIX.length);
    expect(r.liveVerified).toBe(16);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 5
    expect(r.businessDataPending).toBe(5);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 4
  });
});
