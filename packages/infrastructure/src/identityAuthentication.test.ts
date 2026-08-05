import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createInfrastructurePlatform } from './platform';

describe('E6–E7 — enterprise identity, authentication', () => {
  it('identity REUSES the security identity registry and providers', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt);
    const infra = createInfrastructurePlatform(rt, { clock, security: sec });

    const oidc = await infra.identity().registerProvider({ protocol: 'entra-id', name: 'Corp Entra', tenant: 'acme' });
    expect(oidc.reusedSecurity).toBe(true); // Entra maps to OIDC on the reused registry
    const ldap = await infra.identity().registerProvider({ protocol: 'ldap', name: 'Corp LDAP', tenant: 'acme' });
    expect(ldap.reusedSecurity).toBe(false); // represented as an adapter

    const prov = await infra.identity().provisionIdentity({ displayName: 'Jane Admin', tenant: 'acme', roles: ['org-admin'] });
    expect(prov.identityId).toBeTruthy();
    expect(infra.identity().directory('acme')).toBe(1);
  });

  it('authentication REUSES security MFA/tokens/sessions — a wrong MFA code really fails', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt);
    const infra = createInfrastructurePlatform(rt, { clock, security: sec });
    const id = await sec.identity().register({ type: 'user', displayName: 'Bob', tenant: 'acme' });

    expect((await infra.authentication().enrollMfa(id.id)).enrolled).toBe(true);
    expect(await infra.authentication().verifyMfa(id.id, '000000')).toBe(false); // wrong code fails

    const tok = await infra.authentication().issueToken(id.id, 'ci-token');
    expect(infra.authentication().verifyToken(tok!.token)).toBe(id.id);

    const session = await infra.authentication().createSession({ identityId: id.id, tenant: 'acme', deviceId: 'dev-1' });
    expect(infra.authentication().validateSession(session!.sessionId)).toBe(true);

    infra.authentication().trustDevice('dev-1');
    expect(infra.authentication().adaptiveDecision({ deviceId: 'dev-1', riskScore: 10 }).requiresStepUp).toBe(false);
    expect(infra.authentication().adaptiveDecision({ deviceId: 'dev-x', riskScore: 10 }).requiresStepUp).toBe(true);
  });
});
