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

    registerSubscribers(bus, {
      persist: (e) => timeline.append(e),
      audit: () => undefined,
      notify: () => undefined,
      broadcast: (e) => broadcasts.push(e.type),
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

    // The live stream saw both events.
    expect(broadcasts).toEqual(['application.installed', 'download.progress']);

    // Export reflects exactly what was persisted.
    const ex = await timeline.export();
    expect(ex.count).toBe(1);

    await timeline.dispose();
  });
});
