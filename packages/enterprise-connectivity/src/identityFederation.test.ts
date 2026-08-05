import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createEnterpriseConnectivity } from './platform';

describe('E2 — identity federation', () => {
  it('represents IdPs with OAuth pending-credentials — no live authorization claimed', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ec = createEnterpriseConnectivity(rt, { clock });
    expect(ec.identity().providers()).toContain('Microsoft Entra ID');
    const conn = await ec.identity().connect({ provider: 'Okta', protocol: 'oidc' });
    expect(conn.configured).toBe(false);
    expect(conn.oauthStatus).toBe('pending-credentials'); // never a live OAuth authorization
    expect(ec.identity().organizationMapping({ provider: 'Okta', externalOrg: 'acme.okta', tenant: 'acme' }).active).toBe(false);
  });

  it('REALLY provisions users via SCIM through the reused security identity platform', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const ec = createEnterpriseConnectivity(rt, { clock, security: sec });
    const result = await ec.identity().provisionUsers({
      provider: 'Microsoft Entra ID',
      tenant: 'acme',
      users: [
        { externalId: 'aad-1', displayName: 'Ada' },
        { externalId: 'aad-2', displayName: 'Bob' },
      ],
    });
    expect(result.reusedSecurity).toBe(true);
    expect(result.provisioned).toBe(2); // real identities registered
  });
});
