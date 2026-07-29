import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createAiRuntime } from '@neuropause/ai-runtime';
import { createPlatformOperations } from './platform';

describe('E6 / E7 — identity activation + AI runtime operations', () => {
  it('activates a REAL identity/MFA/session via the reused security platform', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const ops = createPlatformOperations(rt, { clock, security: sec });

    const email = await ops.identity().activateMethod('email');
    expect(email.external).toBe(false);
    const google = await ops.identity().activateMethod('google');
    expect(google.external).toBe(true); // external IdP represented

    const session = await ops.identity().activateUserSession({ displayName: 'Ada', tenant: 'acme' });
    expect(session.reusedSecurity).toBe(true);
    expect(session.identityId).toBeTruthy();
    expect(session.mfaEnrolled).toBe(true);
    expect(session.sessionVerified).toBe(true); // real token issue + verify roundtrip
  });

  it('routes AI requests across configured providers and fails over honestly', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ai = createAiRuntime(rt);
    const ops = createPlatformOperations(rt, { clock, aiRuntime: ai });

    expect(ops.aiOps().supportedProviders().length).toBe(5);
    const none = ops.aiOps().route({ model: 'gpt' });
    expect(none.selected).toBeNull(); // no configured provider — nothing invoked

    await ops.aiOps().register({ provider: 'anthropic', configured: true });
    const routed = ops.aiOps().route({ model: 'claude', preference: ['openai', 'anthropic'] });
    expect(routed.selected).toBe('anthropic');
    expect(routed.failedOver).toBe(true); // openai not configured → failed over
    expect(ops.aiOps().aiRuntimeProviderCount().reusedAiRuntime).toBe(true);
  });
});
