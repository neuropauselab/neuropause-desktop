import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createCustomerExperience } from './platform';
import { TARGET_DOMAIN } from './constants';

describe('E11 / E13 / E14 — website, analytics, communications', () => {
  it('represents website pages + marketing assets but NEVER claims the site is live', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cx = createCustomerExperience(rt, { clock });

    expect(cx.website().pageList().length).toBe(11);
    expect(cx.website().pageList().every((p) => p.published === false)).toBe(true);
    const status = cx.website().deploymentStatus();
    expect(status.live).toBe(false); // NOT publicly live
    expect(status.domain).toBe(TARGET_DOMAIN);

    const asset = await cx.marketing().register({ kind: 'demo-videos', name: 'product-tour' });
    expect(asset.published).toBe(false); // represented until published
  });

  it('reports measured analytics and composes emails WITHOUT delivering them', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const cx = createCustomerExperience(rt, { clock, security: sec });
    await cx.auth().signup({ email: 'a@example.com', displayName: 'A', organizationName: 'acme' });

    const dash = cx.analytics().dashboard();
    expect(dash.find((m) => m.metric === 'signups')!.value).toBe('1'); // measured in-process
    expect(dash.find((m) => m.metric === 'installations')!.live).toBe(false); // requires the deployed client
    expect(cx.analytics().pendingMetrics()).toContain('revenue');

    const email = await cx.communications().compose({ kind: 'welcome', to: 'a@example.com' });
    expect(email.delivered).toBe(false); // composed, not sent
    expect(cx.communications().deliveryConfigured()).toBe(false);
    expect(cx.communications().deliveredCount()).toBe(0);
  });
});
