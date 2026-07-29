import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createProductionPlatform } from '@neuropause/production';
import { createReliabilityPlatform } from '@neuropause/reliability';
import { createReleasePlatform } from './platform';

describe('E5 / E10 — release management + automation', () => {
  it('tracks schedules, hotfix/patch/LTS registries, and release notes', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const release = createReleasePlatform(rt, { clock });

    await release.releaseManagement().schedule({ version: '1.0.0', scheduledAt: 5000, channel: 'stable' });
    await release.releaseManagement().registerPatch({ baseVersion: '1.0.0', version: '1.0.1', kind: 'hotfix', summary: 'urgent fix' });
    await release.releaseManagement().registerLts('1.0.0');
    await release.releaseManagement().releaseNotes({ version: '1.0.0', changes: ['GA release'], knownIssues: ['external publication pending'] });

    expect(release.releaseManagement().patchList('hotfix')).toHaveLength(1);
    expect(release.releaseManagement().ltsVersions()).toContain('1.0.0');
    expect(release.releaseManagement().getNotes('1.0.0')!.changes).toContain('GA release');
  });

  it('runs the packaging → sign → validate → verify pipeline with real checksums', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const reliability = createReliabilityPlatform(rt, { clock, production: prod });
    const release = createReleasePlatform(rt, { clock, production: prod, reliability });

    const result = await release.automation().run({ version: '1.0.0' });
    expect(result.packaged).toHaveLength(7);
    expect(result.signed).toHaveLength(7);
    expect(result.artifactsValid).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.rollbackVerified).toBe(true); // reused Sprint-4 recovery validation
    expect(result.reusedReliability).toBe(true);
  });
});
