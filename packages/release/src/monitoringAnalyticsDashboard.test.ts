import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createOperationsPlatform } from '@neuropause/operations';
import { createReleasePlatform } from './platform';
import { GA_VERSION_TARGET } from './constants';

describe('E13 / E14 / E17 — monitoring, analytics, executive dashboard', () => {
  it('reports platform health from the reused operations overview', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createOperationsPlatform(rt, { clock });
    const release = createReleasePlatform(rt, { clock, operations: ops });
    const cfg = await release.monitoring().configure();
    expect(cfg.dashboards.length).toBe(7);
    expect(cfg.reusedOperations).toBe(true);
    expect(release.monitoring().platformHealth().available).toBe(true);
  });

  it('analytics shows real counts and reports commercial metrics as pending', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const release = createReleasePlatform(rt, { clock });
    await release.runtime().register({ version: GA_VERSION_TARGET });

    const dash = release.analytics().dashboard();
    const releases = dash.find((m) => m.metric === 'releases')!;
    expect(releases.live).toBe(true);
    expect(releases.value).toBe('1');
    const usage = dash.find((m) => m.metric === 'usage')!;
    expect(usage.live).toBe(false); // never fabricated
    expect(release.analytics().pendingMetrics()).toContain('revenue');
  });

  it('executive dashboard shows live tiles only where a real source exists', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createOperationsPlatform(rt, { clock });
    const release = createReleasePlatform(rt, { clock, operations: ops });
    await release.runtime().register({ version: GA_VERSION_TARGET });

    const tiles = release.executiveDashboard().snapshot();
    expect(tiles.find((t) => t.tile === 'release-status')!.live).toBe(true);
    expect(tiles.find((t) => t.tile === 'platform-health')!.live).toBe(true);
    expect(tiles.find((t) => t.tile === 'customer-health')!.live).toBe(false); // pending real data
    expect(release.executiveDashboard().liveTiles()).toBeGreaterThanOrEqual(3);
  });
});
