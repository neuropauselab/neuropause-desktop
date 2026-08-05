import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createCommercialPlatform } from '@neuropause/commercial';
import { createReleasePlatform } from './platform';

describe('E12 / E11 — license management + marketplace distribution', () => {
  it('issues a REAL commercial license, validates it, and expires it honestly', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const commercial = createCommercialPlatform(rt, { clock });
    const release = createReleasePlatform(rt, { clock, commercial });

    const grant = await release.licenses().issue({ tier: 'enterprise', tenantId: 'acme', seats: 3, expiresAt: 5000 });
    expect(grant.reusedCommercial).toBe(true);
    expect(grant.commercialLicenseId).toBeTruthy();
    await release.licenses().allocateSeat(grant.id);
    expect(release.licenses().get(grant.id)!.seatsAllocated).toBe(1);
    expect(release.licenses().validate(grant.id).valid).toBe(true);

    clock.advance(10000); // past expiry
    expect(release.licenses().validate(grant.id).valid).toBe(false);
    expect(release.licenses().upgradePath('professional')).toContain('enterprise');
  });

  it('NEVER claims a marketplace listing live until a real publication URL is confirmed', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const release = createReleasePlatform(rt, { clock });

    const prepared = await release.marketplace().prepare({ channel: 'aws-marketplace', version: '1.0.0' });
    expect(prepared.status).toBe('prepared');
    expect(prepared.live).toBe(false); // not published

    const published = await release.marketplace().prepare({ channel: 'github-releases', version: '1.0.0', publishedUrl: 'https://github.com/example/nems/releases/tag/v1.0.0' });
    expect(published.status).toBe('published');
    expect(published.live).toBe(true);
    expect(release.marketplace().liveCount()).toBe(1);
  });
});
