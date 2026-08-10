/**
 * The platform event log's tenant boundary (P13B).
 *
 * WHY THIS FILE EXISTS. The cross-domain matrix in `fabricTenancy.test.ts` was
 * green, and an adversarial review still found this: `PlatformEvent` had no
 * tenant field at all, and the Enterprise Timeline fuses the (scoped) entity
 * half with this (unscoped) event half. So every briefing, and the timeline leg
 * of Enterprise Search, reached the model with another tenant's activity — no
 * matter how well the entities themselves were guarded. `timeline:export`
 * returned the entire durable log verbatim.
 *
 * The lesson worth keeping: scoping the ROOT store does not scope everything
 * downstream of it. A second, independent source feeding the same consumer is
 * a second boundary, and it has to be drawn separately.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { EventBus } from '../platform/eventBus';
import { TimelineService } from '../platform/timelineService';

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };

const A_SECRET = 'NP-A-8472';

describe('the platform event log: the tenant boundary', () => {
  let dir: string;
  let timeline: TimelineService;
  let bus: EventBus;
  let scope: TenantScope | null;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-timeline-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    timeline = new TimelineService({ dir });
    timeline.bindScope(() => scope);
    bus = new EventBus();
    bus.bindTenant(() => scope?.tenantId ?? null);
    bus.subscribe((e) => timeline.append(e));

    scope = A;
    bus.publish({
      type: 'connector.sync_completed',
      category: 'connector',
      source: 'test',
      resource: { kind: 'connector', id: `hubspot-${A_SECRET}`, name: `Tenant A connector ${A_SECRET}` },
      metadata: { secret: A_SECRET },
    });

    scope = B;
    bus.publish({
      type: 'connector.sync_completed',
      category: 'connector',
      source: 'test',
      resource: { kind: 'connector', id: 'slack-b', name: 'Tenant B connector' },
      metadata: {},
    });
  });

  afterEach(async () => {
    await timeline.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('an event is stamped with the tenant that was active when it happened', () => {
    scope = A;
    const mine = timeline.query({ limit: 100 });
    expect(mine.events).toHaveLength(1);
    expect(mine.events[0]?.tenantId).toBe('org-a');
  });

  it('query does not return another tenant’s events', () => {
    scope = B;
    const page = timeline.query({ limit: 100 });
    expect(page.events).toHaveLength(1);
    expect(page.total).toBe(1);
    expect(JSON.stringify(page)).not.toContain(A_SECRET);
  });

  /**
   * `q.search` matches over metadata VALUES, so an unscoped log was not merely
   * a listing — it was a targeted oracle. This is the query an attacker runs
   * once they can guess a term.
   */
  it('search over metadata cannot confirm another tenant’s events exist', () => {
    scope = B;
    const hit = timeline.query({ search: A_SECRET, limit: 100 });
    expect(hit.events).toHaveLength(0);
    expect(hit.total).toBe(0);
  });

  it('stats do not disclose another tenant’s volume or activity times', () => {
    scope = B;
    const stats = timeline.stats();
    expect(stats.total).toBe(1);
    expect(Object.values(stats.byType).reduce((a, b) => a + b, 0)).toBe(1);

    scope = null;
    expect(timeline.stats().total).toBe(0);
    expect(timeline.stats().oldest).toBeNull();
  });

  /** The single largest disclosure in the program: the whole log, ungated. */
  it('export returns only the caller’s own events', async () => {
    scope = B;
    const out = await timeline.export();
    expect(out.data).not.toContain(A_SECRET);
    expect(out.count).toBe(1);

    scope = A;
    const mine = await timeline.export();
    expect(mine.data).toContain(A_SECRET);
    expect(mine.count).toBe(1);
  });

  it('unbound denies every read', async () => {
    scope = null;
    expect(timeline.query({ limit: 100 }).events).toEqual([]);
    expect(timeline.stats().total).toBe(0);
    expect((await timeline.export()).count).toBe(0);
  });

  /**
   * An event published with no active tenant — boot, or a background timer with
   * no principal — belongs to nobody and is shown to nobody. That is fail-closed
   * and it is also a REAL FUNCTIONAL GAP: such events disappear from the
   * timeline until their producers carry a tenant, which is the background-jobs
   * work and is recorded as such in the migration inventory.
   */
  it('an event published with no active tenant is owned by nobody', () => {
    scope = null;
    bus.publish({ type: 'connector.sync_completed', category: 'connector', source: 'boot' });

    scope = A;
    expect(timeline.query({ limit: 100 }).events).toHaveLength(1); // A's own, not the orphan
    scope = B;
    expect(timeline.query({ limit: 100 }).events).toHaveLength(1);
  });
});
