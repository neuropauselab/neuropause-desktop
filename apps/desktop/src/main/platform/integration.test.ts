import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from './eventBus';
import { TimelineService } from './timelineService';
import { PlatformEventApi } from './eventApi';
import { registerSubscribers } from './subscribers';

let dir = '';
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe('platform pipeline (integration)', () => {
  it('publish → subscribers → timeline query/export, end to end', async () => {
    dir = join(tmpdir(), 'nps-int-' + Math.random().toString(36).slice(2));
    const bus = new EventBus();
  // P13B — events are stamped at materialization from the resolved tenant.
  bus.bindTenant(() => 'org-test');
    const timeline = new TimelineService({ dir, flushIntervalMs: 10_000 });
    await timeline.init();
    const broadcasts: string[] = [];

    /**
     * P13C ROUND 9 — F5. The forwarder is scoped, so the pipeline needs a VIEWER.
     *
     * The suite previously registered no `viewerScope` and asserted the live
     * stream saw both events — which passed only because the forwarder mirrored
     * everything to everyone. Wiring the viewer is what production does at the
     * composition root; the mismatch case is asserted below rather than dropped.
     */
    registerSubscribers(bus, {
      persist: (e) => timeline.append(e),
      audit: () => undefined,
      notify: () => undefined,
      broadcast: (e) => broadcasts.push(e.type),
      viewerScope: () => ({ tenantId: 'org-test', workspaceId: '' }),
    });

    const api = new PlatformEventApi(bus, timeline);

    api.publish({
      type: 'application.installed', category: 'application', source: 'nps',
      resource: { type: 'app', id: 'figma', name: 'Figma' }, metadata: {},
    });
    api.publish({ type: 'download.progress', category: 'download', source: 'nps', priority: 'low', metadata: {} });

    // Durable timeline kept the install but skipped the ephemeral progress.
    const page = api.query({});
    expect(page.total).toBe(1);
    expect(page.events[0].type).toBe('application.installed');

    // The live stream saw both events — the viewer owns them.
    expect(broadcasts).toEqual(['application.installed', 'download.progress']);

    /**
     * …and A DIFFERENT viewer sees neither. P13C ROUND 9 — F5.
     *
     * Same bus, same two events, one field different. Without this the suite
     * above passes equally well against an unfiltered forwarder, which is
     * exactly how the finding survived Round 8.
     */
    const otherTenant: string[] = [];
    const bus2 = new EventBus();
    bus2.bindTenant(() => 'org-test');
    registerSubscribers(bus2, {
      persist: () => undefined,
      audit: () => undefined,
      notify: () => undefined,
      broadcast: (e) => otherTenant.push(e.type),
      viewerScope: () => ({ tenantId: 'org-other', workspaceId: '' }),
    });
    bus2.publish({
      type: 'application.installed', category: 'application', source: 'nps',
      resource: { type: 'app', id: 'figma', name: 'Figma' }, metadata: {},
    });
    expect(otherTenant).toEqual([]);

    // Export reflects exactly what was persisted.
    const ex = await timeline.export();
    expect(ex.count).toBe(1);

    await timeline.dispose();
  });
});
