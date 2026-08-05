import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createCustomerExperience } from './platform';

describe('E1 / E2 — customer portal + authentication', () => {
  it('runs a REAL signup → verify → login → MFA journey via the reused security platform', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const cx = createCustomerExperience(rt, { clock, security: sec });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'cx.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    const account = await cx.auth().signup({ email: 'ada@example.com', displayName: 'Ada', organizationName: 'acme' });
    expect(account.identityId).toBeTruthy(); // real identity
    expect(account.status).toBe('verification-pending');

    const early = await cx.auth().login(account.id);
    expect(early.sessionVerified).toBe(false); // cannot log in before verification

    const verified = await cx.auth().verifyEmail(account.id, account.verificationToken!);
    expect(verified.verified).toBe(true);
    const bad = await cx.auth().verifyEmail(account.id, 'wrong-token');
    expect(bad.verified).toBe(false);

    const login = await cx.auth().login(account.id);
    expect(login.sessionVerified).toBe(true); // real token issue + verify
    expect((await cx.auth().enrollMfa(account.id)).enrolled).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    expect(events[events.length - 1]!['replayId']).toBeTruthy();
  });

  it('creates organizations + invites (email delivery represented) and the portal counts them', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const cx = createCustomerExperience(rt, { clock, security: sec });

    const account = await cx.auth().signup({ email: 'o@example.com', displayName: 'Owner', organizationName: 'acme' });
    const org = await cx.auth().createOrganization({ ownerAccountId: account.id, name: 'Acme Inc' });
    const invite = await cx.auth().invite({ organizationId: org.id, email: 'teammate@example.com' });
    expect(invite.emailDelivered).toBe(false); // invite recorded, email not sent

    const dash = cx.portal().customerDashboard();
    expect(dash.accounts).toBe(1);
    expect(dash.organizations).toBe(1);
  });
});
