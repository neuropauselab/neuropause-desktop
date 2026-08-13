/**
 * P13C ROUND 9 — F5. AN EVENT FEED IS A READ.
 *
 * `registerSubscribers` mirrored EVERY event raw to the single renderer:
 * `bus.subscribe((e) => deps.broadcast(e))`. No filter, no principal handling.
 * The same rows read back through `timeline:query` were hard-filtered, and that
 * filter's comment explains why — an event carries `actor.id`, `resource.id` and
 * free-form metadata. Background fan-outs publish into the same bus, so
 * workspace B's sync pass sent B's identifiers and record names into A's window.
 *
 * THE FIXTURE IS POSITIVE. A produces 3 events, B produces 7, C produces 11, and
 * the assertions name those numbers. "B received nothing" is only meaningful
 * because B's own feed is provably 7 — a suite where every feed is empty passes
 * against a bus that delivers nothing at all.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { PlatformEvent, TenantScope } from '@neuropause/shared';
import { EventBus } from '../platform/eventBus';
import { registerSubscribers, eventDeliverableTo } from '../platform/subscribers';
import { runAsPrincipal, tenantPrincipal, systemPrincipal } from './backgroundPrincipal';

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };
const C: TenantScope = { tenantId: 'org-c', workspaceId: 'ws-c' };

/** The tenant the BUS stamps events with — i.e. whose work is being done. */
let actor: TenantScope | null = null;
/** The tenant the WINDOW is showing. */
let viewer: TenantScope | null = null;

let bus: EventBus;
let delivered: PlatformEvent[];

beforeEach(() => {
  actor = null;
  viewer = null;
  delivered = [];
  bus = new EventBus({ tenantId: () => actor?.tenantId ?? null });
  registerSubscribers(bus, {
    persist: () => undefined,
    audit: () => undefined,
    notify: () => undefined,
    broadcast: (e) => delivered.push(e),
    viewerScope: () => viewer,
  });
});

/** Publish `n` events as `scope`, each naming a resource only that tenant has. */
function publishAs(scope: TenantScope, n: number, tag: string): void {
  actor = scope;
  for (let i = 0; i < n; i += 1) {
    bus.publish({
      type: 'application.installed',
      category: 'application',
      source: `${tag}-${i}`,
      priority: 'normal',
      resource: { id: `${tag}-resource-${i}`, name: `${tag}-secret-${i}` },
    });
  }
  actor = null;
}

function titlesFor(prefix: string): PlatformEvent[] {
  return delivered.filter((e) => e.source.startsWith(prefix));
}

describe('A/B/C each receive their own events and no others', () => {
  it('A viewing sees exactly its 3 — not B’s 7, not C’s 11', () => {
    viewer = A;
    publishAs(A, 3, 'A');
    publishAs(B, 7, 'B');
    publishAs(C, 11, 'C');

    expect(titlesFor('A-')).toHaveLength(3);
    expect(titlesFor('B-')).toHaveLength(0);
    expect(titlesFor('C-')).toHaveLength(0);
    expect(delivered).toHaveLength(3);
  });

  it('B viewing sees exactly its 7 — the count, not an inequality', () => {
    viewer = B;
    publishAs(A, 3, 'A');
    publishAs(B, 7, 'B');
    publishAs(C, 11, 'C');

    expect(titlesFor('B-')).toHaveLength(7);
    expect(delivered).toHaveLength(7);
  });

  it('C viewing sees exactly its 11', () => {
    viewer = C;
    publishAs(A, 3, 'A');
    publishAs(B, 7, 'B');
    publishAs(C, 11, 'C');

    expect(titlesFor('C-')).toHaveLength(11);
    expect(delivered).toHaveLength(11);
  });

  it('no delivered payload carries another tenant’s resource id', () => {
    viewer = A;
    publishAs(A, 3, 'A');
    publishAs(B, 7, 'B');

    const wire = JSON.stringify(delivered);
    expect(wire).toContain('A-resource-0');
    expect(wire).not.toContain('B-resource');
    expect(wire).not.toContain('B-secret');
  });
});

describe('a background job does not publish into the viewer’s window', () => {
  /**
   * THE FINDING'S SHARPEST FORM. The job's principal is A; the window shows B.
   * `activeTenantScope` prefers the principal, so a forwarder that asked "who am
   * I acting as" would answer A and deliver A's rows to B.
   */
  it('principal = A while viewer = B delivers nothing to B', () => {
    viewer = B;
    const principal = tenantPrincipal({ jobId: 'sync', scope: A })!;
    runAsPrincipal(principal, () => {
      publishAs(A, 3, 'A');
    });
    expect(titlesFor('A-')).toHaveLength(0);
    expect(delivered).toHaveLength(0);
  });

  it('principal = A while viewer = A DOES deliver — not "always no"', () => {
    viewer = A;
    const principal = tenantPrincipal({ jobId: 'sync', scope: A })!;
    runAsPrincipal(principal, () => {
      publishAs(A, 3, 'A');
    });
    expect(titlesFor('A-')).toHaveLength(3);
  });

  it('a SYSTEM job’s events are global and reach whoever is viewing', () => {
    viewer = B;
    runAsPrincipal(systemPrincipal('update-check'), () => {
      bus.publish({
        type: 'update.available',
        category: 'update',
        source: 'SYS-update',
        priority: 'normal',
      });
    });
    expect(delivered.map((e) => e.source)).toContain('SYS-update');
  });
});

describe('the delivery predicate itself', () => {
  const ev = (tenantId: string | null, scopeKind: 'system' | 'tenant'): PlatformEvent =>
    ({ tenantId, scopeKind, workspaceId: null }) as unknown as PlatformEvent;

  it('a system event is global', () => {
    expect(eventDeliverableTo(ev(null, 'system'), A)).toBe(true);
    expect(eventDeliverableTo(ev(null, 'system'), null)).toBe(true);
  });

  it('a tenant event reaches only that tenant', () => {
    expect(eventDeliverableTo(ev('org-a', 'tenant'), A)).toBe(true);
    expect(eventDeliverableTo(ev('org-a', 'tenant'), B)).toBe(false);
    expect(eventDeliverableTo(ev('org-b', 'tenant'), A)).toBe(false);
  });

  it('an UNOWNED event is refused once any tenant is resolved — fail closed', () => {
    expect(eventDeliverableTo(ev(null, 'tenant'), A)).toBe(false);
    // …and is allowed only when there is no session to leak to at all.
    expect(eventDeliverableTo(ev(null, 'tenant'), null)).toBe(true);
  });

  it('an unresolved viewer never receives a tenant’s event', () => {
    expect(eventDeliverableTo(ev('org-a', 'tenant'), null)).toBe(false);
  });

  it('an unwired forwarder (no viewerScope) is fail-closed, not fail-open', () => {
    const bare = new EventBus({ tenantId: () => 'org-a' });
    const got: PlatformEvent[] = [];
    registerSubscribers(bare, {
      persist: () => undefined,
      audit: () => undefined,
      notify: () => undefined,
      broadcast: (e) => got.push(e),
      // viewerScope deliberately omitted — the pre-composition state.
    });
    bare.publish({
      type: 'application.installed',
      category: 'application',
      source: 'A-leak',
      priority: 'normal',
    });
    expect(got).toHaveLength(0);
  });
});
