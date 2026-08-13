/**
 * P13C Part 3 — the executive delivery engine across two tenants.
 *
 * Phase 3 of the program asks for one thing in particular: run tenant A's and
 * tenant B's scheduled delivery SIMULTANEOUSLY and prove no A data reaches B's
 * briefing and no B data reaches A's. The engine itself holds no data, so the
 * way to assert that here is to make `produce()` report the tenant it was
 * invoked under and check that each item was built from — and delivered as —
 * exactly one organization.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELIVERY_PREFERENCES,
  type DeliveryChannel,
  type DeliveryPreferences,
  type IntelligenceItem,
  type IntelligenceSource,
} from '@neuropause/shared';
import { DeliveryEngine } from './deliveryEngine';
import { forEachTenant } from '../tenancy/backgroundFanOut';
import { principalScope } from '../tenancy/backgroundPrincipal';
import {
  OTHER_TENANT_SCOPE,
  SINGLE_TENANT_FAN_OUT,
  TEST_TENANT_SCOPE,
  TWO_TENANT_FAN_OUT,
} from '../tenancy/testScope';

const A = TEST_TENANT_SCOPE.tenantId;
const B = OTHER_TENANT_SCOPE.tenantId;
/** 08:00 local, matching the daily cadence used below. */
const NOW = new Date(2026, 0, 5, 8, 0, 0);

function harness(fanOut = TWO_TENANT_FAN_OUT, prefs: Partial<DeliveryPreferences> = {}) {
  const delivered: IntelligenceItem[] = [];
  const channel: DeliveryChannel = {
    key: 'notification-center',
    available: true,
    deliver: (it) => {
      delivered.push(it);
    },
  };
  const engine = new DeliveryEngine({
    now: () => NOW,
    scheduler: { every: () => undefined, cancel: () => true },
    channels: [channel],
    getPreferences: () => ({ ...DEFAULT_DELIVERY_PREFERENCES, ...prefs }),
    forEachTenant: (jobId, fn) => forEachTenant(jobId, fanOut, fn),
  });
  return { engine, delivered };
}

/**
 * A source whose item body IS the tenant it was produced under.
 *
 * Standing in for `buildMissionBriefItem`, which reads the unified store and the
 * timeline through `activeTenantScope()`. Reporting the resolved principal is
 * the same question those reads ask, without needing the stores present.
 */
function tenantReportingSource(key = 'brief'): IntelligenceSource {
  return {
    key,
    label: key,
    cadence: { kind: 'daily', atMinutes: 8 * 60 },
    produce: () => {
      const tenantId = principalScope()?.tenantId ?? 'NO-TENANT';
      return [
        {
          id: `${key}:item`,
          title: `Brief for ${tenantId}`,
          body: tenantId,
          priority: 'high' as const,
          producedAt: NOW.toISOString(),
        },
      ];
    },
  };
}

describe('scheduled delivery fans out across tenants', () => {
  it('fires for BOTH tenants — the second one is no longer silently skipped', async () => {
    const { engine, delivered } = harness();
    engine.register(tenantReportingSource());
    await engine.tick();
    expect(delivered.map((d) => d.body).sort()).toEqual([A, B].sort());
  });

  /**
   * The de-dupe collision, asserted directly.
   *
   * `lastFiredKeyMinute` used to key on the source alone. With a fan-out that
   * means the FIRST tenant to fire in a given minute suppresses every other
   * tenant's identical source — tenant A's brief silently cancelling B's, which
   * looks exactly like "B has nothing to report".
   */
  it('does not let one tenant’s fire suppress another’s in the same minute', async () => {
    const { engine, delivered } = harness();
    engine.register(tenantReportingSource('mission-brief-morning'));
    await engine.tick();
    expect(delivered).toHaveLength(2);
    expect(new Set(delivered.map((d) => d.body))).toEqual(new Set([A, B]));
  });

  it('still de-dupes WITHIN a tenant across repeated ticks in the same minute', async () => {
    const { engine, delivered } = harness();
    engine.register(tenantReportingSource());
    await engine.tick();
    await engine.tick();
    await engine.tick();
    expect(delivered).toHaveLength(2); // one per tenant, not six
  });

  it('builds each tenant’s brief from that tenant only — no A content in B', async () => {
    const { engine, delivered } = harness();
    engine.register(tenantReportingSource());
    await engine.tick();
    const forA = delivered.filter((d) => d.title.includes(A));
    const forB = delivered.filter((d) => d.title.includes(B));
    expect(forA).toHaveLength(1);
    expect(forB).toHaveLength(1);
    expect(forA[0]!.body).not.toContain(B);
    expect(forB[0]!.body).not.toContain(A);
  });

  it('produces under a REAL principal, never an unresolved one', async () => {
    const { engine, delivered } = harness();
    engine.register(tenantReportingSource());
    await engine.tick();
    expect(delivered.map((d) => d.body)).not.toContain('NO-TENANT');
  });

  /* ── Fail-closed ──────────────────────────────────────────────────────── */

  it('delivers NOTHING when no tenant is operable', async () => {
    const { engine, delivered } = harness({ organizations: () => [], workspaces: () => [] });
    engine.register(tenantReportingSource());
    await engine.tick();
    expect(delivered).toEqual([]);
  });

  it('honours the install-level DND gate before fanning out at all', async () => {
    const { engine, delivered } = harness(TWO_TENANT_FAN_OUT, { enabled: false });
    engine.register(tenantReportingSource());
    await engine.tick();
    expect(delivered).toEqual([]);
  });
});

describe('event-driven delivery does NOT fan out', () => {
  /**
   * An event already has an owner, so the only correct number of deliveries is
   * one. Fanning here would be the notification twin of the webhook defect
   * Part 2a closed — one tenant's event reaching every tenant's surface.
   */
  it('delivers an owned item exactly once even with two tenants configured', async () => {
    const { engine, delivered } = harness();
    const ok = await engine.deliverNow('connector-issue', {
      id: 'connector-issue:crm-primary',
      title: 'Connector needs attention',
      body: 'The last sync failed.',
      priority: 'high',
      producedAt: NOW.toISOString(),
    });
    expect(ok).toBe(true);
    expect(delivered).toHaveLength(1);
  });

  it('is unchanged on a single-tenant install', async () => {
    const { engine, delivered } = harness(SINGLE_TENANT_FAN_OUT);
    await engine.deliverNow('work-failed', {
      id: 'job-failed:1',
      title: 'Failed',
      body: 'x',
      priority: 'high',
      producedAt: NOW.toISOString(),
    });
    expect(delivered).toHaveLength(1);
  });
});
