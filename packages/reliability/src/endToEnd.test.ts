import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createOperationsPlatform } from '@neuropause/operations';
import { createAiRuntime } from '@neuropause/ai-runtime';
import { createReliabilityPlatform } from './platform';

describe('E2 — end-to-end validation (real cross-subsystem traces)', () => {
  it('runs a REAL trace reusing security identity/authn/authz + operations + AI', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const ops = createOperationsPlatform(rt, { clock });
    const ai = createAiRuntime(rt);
    const rel = createReliabilityPlatform(rt, { clock, security: sec, operations: ops, aiRuntime: ai });

    const trace = await rel.endToEnd().runTrace({ name: 'full' });
    expect(trace.executed).toBeGreaterThanOrEqual(4);
    expect(trace.passed).toBe(true);

    // The authentication step really issued + verified a token against the reused security platform.
    const authn = trace.steps.find((s) => s.subsystem === 'security.authentication')!;
    expect(authn.status).toBe('passed');
    expect(authn.reused).toBe(true);

    // The authorization step really enforced least-privilege (permit for role, deny by default).
    const authz = trace.steps.find((s) => s.subsystem === 'security.authorization')!;
    expect(authz.status).toBe('passed');
  });

  it('marks steps SKIPPED (never fabricated as passed) when a platform is absent', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    const trace = await rel.endToEnd().runTrace({ name: 'bare' });
    expect(trace.executed).toBe(0);
    expect(trace.passed).toBe(false);
    expect(trace.steps.every((s) => s.status === 'skipped')).toBe(true);
  });
});
