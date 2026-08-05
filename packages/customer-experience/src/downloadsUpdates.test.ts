import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createProductionPlatform } from '@neuropause/production';
import { createReliabilityPlatform } from '@neuropause/reliability';
import { createReleasePlatform } from '@neuropause/release';
import { createCustomerExperience } from './platform';

describe('E5 / E6 — download center + automatic updates', () => {
  it('builds a download catalog with REAL checksums (reused packaging), honestly not built binaries', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const release = createReleasePlatform(rt, { clock, production: prod });
    const cx = createCustomerExperience(rt, { clock, release });

    const catalog = await cx.downloads().catalog('1.0.0');
    expect(catalog).toHaveLength(5); // windows, macos, appimage, deb, rpm
    expect(catalog.every((e) => e.checksum.length === 64)).toBe(true); // real sha256
    expect(catalog.every((e) => e.built === false)).toBe(true); // descriptor, not a built binary
    expect(catalog.every((e) => e.reusedReleasePackaging)).toBe(true);

    const win = cx.downloads().get('windows', '1.0.0')!;
    expect(cx.downloads().verifyChecksum('windows', '1.0.0', win.checksum).valid).toBe(true);
    expect(cx.downloads().verifyChecksum('windows', '1.0.0', 'nope').valid).toBe(false);
  });

  it('checks for updates against reused release versions and rolls back via reliability', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const reliability = createReliabilityPlatform(rt, { clock, production: prod });
    const release = createReleasePlatform(rt, { clock, production: prod });
    await release.runtime().register({ version: '1.0.0' });
    await release.runtime().register({ version: '1.1.0' });
    const cx = createCustomerExperience(rt, { clock, release, reliability });

    const check = await cx.updates().checkForUpdate('1.0.0');
    expect(check.reusedRelease).toBe(true);
    expect(check.latestVersion).toBe('1.1.0');
    expect(check.updateAvailable).toBe(true);

    const rollback = await cx.updates().rollback('1.1.0');
    expect(rollback.reusedReliability).toBe(true);
    expect(rollback.rolledBack).toBe(true);
  });
});
