import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TimelineService } from './timelineService';
import type { PlatformEvent, PlatformEventType, PlatformEventCategory } from '@neuropause/shared';

function evt(over: Partial<PlatformEvent> = {}): PlatformEvent {
  return {
    // P13B — an event with no tenant belongs to nobody and is shown to nobody.
    tenantId: 'org-test',
    id: 'e' + Math.random().toString(36).slice(2),
    type: 'system.ready' as PlatformEventType,
    category: 'system' as PlatformEventCategory,
    version: 1,
    priority: 'normal',
    timestamp: new Date().toISOString(),
    source: 'test',
    actor: { kind: 'system', id: null },
    resource: null,
    correlationId: 'c',
    causationId: null,
    metadata: {},
    ...over,
  };
}

async function fileLines(dir: string): Promise<number> {
  try {
    const raw = await fs.readFile(join(dir, 'timeline.jsonl'), 'utf8');
    return raw.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

let dir: string;
beforeEach(() => {
  dir = join(tmpdir(), 'nps-timeline-' + Math.random().toString(36).slice(2));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('TimelineService', () => {
  it('appends and queries in order', async () => {
    const t = new TimelineService({ dir, flushIntervalMs: 10_000 });
    await t.init();
    t.append(evt({ type: 'runtime.started', category: 'runtime', timestamp: '2026-01-01T00:00:00.000Z' }));
    t.append(evt({ type: 'system.ready', timestamp: '2026-01-01T00:00:01.000Z' }));
    const page = t.query({ order: 'asc' });
    expect(page.total).toBe(2);
    expect(page.events.map((e) => e.type)).toEqual(['runtime.started', 'system.ready']);
    await t.dispose();
  });

  it('filters by type, category, and free-text search', async () => {
    const t = new TimelineService({ dir });
    await t.init();
    t.append(evt({ type: 'runtime.started', category: 'runtime', resource: { type: 'app', id: 'figma', name: 'Figma' } }));
    t.append(evt({ type: 'application.installed', category: 'application', resource: { type: 'app', id: 'slack', name: 'Slack' } }));
    expect(t.query({ types: ['runtime.started'] }).total).toBe(1);
    expect(t.query({ categories: ['application'] }).total).toBe(1);
    expect(t.query({ search: 'figma' }).total).toBe(1);
    expect(t.query({ search: 'slack' }).events[0].type).toBe('application.installed');
    await t.dispose();
  });

  it('paginates with an opaque cursor', async () => {
    const t = new TimelineService({ dir });
    await t.init();
    for (let i = 0; i < 5; i++) t.append(evt({ timestamp: `2026-01-01T00:00:0${i}.000Z` }));
    const p1 = t.query({ limit: 2, order: 'asc' });
    expect(p1.events).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = t.query({ limit: 2, order: 'asc', cursor: p1.nextCursor });
    expect(p2.events).toHaveLength(2);
    expect(p2.events[0].timestamp).not.toBe(p1.events[0].timestamp);
    await t.dispose();
  });

  it('persists in batches (not per-append) and survives a reload', async () => {
    const t1 = new TimelineService({ dir, batchSize: 100, flushIntervalMs: 10_000 });
    await t1.init();
    t1.append(evt({ type: 'runtime.started', category: 'runtime' }));
    t1.append(evt({ type: 'runtime.stopped', category: 'runtime' }));
    t1.append(evt({ type: 'system.ready' }));
    // Batched: nothing on disk until a flush.
    expect(await fileLines(dir)).toBe(0);
    await t1.flush();
    expect(await fileLines(dir)).toBe(3);
    // A fresh service warms its query window from the durable log.
    const t2 = new TimelineService({ dir });
    await t2.init();
    expect(t2.query().total).toBe(3);
    await t1.dispose();
    await t2.dispose();
  });

  it('exports the durable log as JSONL', async () => {
    const t = new TimelineService({ dir });
    await t.init();
    t.append(evt());
    t.append(evt());
    const ex = await t.export();
    expect(ex.format).toBe('jsonl');
    expect(ex.count).toBe(2);
    expect(ex.data.split('\n').filter(Boolean)).toHaveLength(2);
    await t.dispose();
  });
});
