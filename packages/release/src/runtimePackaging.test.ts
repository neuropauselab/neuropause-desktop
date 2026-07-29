import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createProductionPlatform } from '@neuropause/production';
import { createReleasePlatform } from './platform';
import { GA_VERSION_TARGET } from './constants';

describe('E1 / E2 — GA runtime + v1.0 packaging', () => {
  it('drives the release lifecycle and rejects an illegal transition', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const release = createReleasePlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'release.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    const rel = await release.runtime().register({ version: GA_VERSION_TARGET, channel: 'stable' });
    expect(rel.status).toBe('draft');
    await release.runtime().transition(rel.id, 'release-candidate');
    await release.runtime().transition(rel.id, 'validated');
    expect(release.runtime().history(rel.id).length).toBe(3);
    await expect(release.runtime().transition(rel.id, 'released')).rejects.toThrow(/illegal release transition/);
    expect(rt.audit().verify().valid).toBe(true);
    expect(events[events.length - 1]!['replayId']).toBeTruthy();
  });

  it('builds seven package descriptors with real checksums, reusing the production installer', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const release = createReleasePlatform(rt, { clock, production: prod });

    const all = await release.packaging().buildAll(GA_VERSION_TARGET);
    expect(all).toHaveLength(7);
    expect(all.every((a) => a.checksum.length === 64)).toBe(true); // real sha256
    expect(all.every((a) => a.built === false)).toBe(true); // honest: descriptor, not a built binary
    const win = all.find((a) => a.target === 'windows')!;
    expect(win.reusedProductionInstaller).toBe(true);
    const offline = all.find((a) => a.target === 'offline-bundle')!;
    expect(offline.reusedProductionInstaller).toBe(false); // represented, no installer target
  });
});
