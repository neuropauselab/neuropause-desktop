/**
 * P13C Part 3 — the notification delivery boundary (Phases 11-15).
 *
 * The inbox store was scoped in Program 12. What was NOT closed is the path
 * INTO it: the delivery engine had no tenant, so what got produced and who it
 * was stamped for came from whichever organization the UI had open. These tests
 * exercise the store through the same resolver production uses — a session
 * scope that a background principal overrides — so they assert the composed
 * behaviour rather than the store in isolation.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { InboxNotification, TenantScope } from '@neuropause/shared';
import { InboxStore } from '../notifications/inboxStore';
import { routeEvent } from '../notifications/eventNotifications';
import { principalForOwnedWork } from './backgroundFanOut';
import { runAsPrincipal, runOutsidePrincipal, resolveTenantScope } from './backgroundPrincipal';
import { OTHER_TENANT_SCOPE, TEST_TENANT_SCOPE } from './testScope';

const A = TEST_TENANT_SCOPE;
const B = OTHER_TENANT_SCOPE;

/** Who is signed in. Mutable, because tenant switching is the thing under test. */
let session: TenantScope | null = A;

function newStore(): InboxStore {
  const dir = mkdtempSync(join(tmpdir(), 'np-inbox-'));
  return new InboxStore(join(dir, 'inbox.json')).bindScope(() =>
    // Exactly the production binding: `activeTenantScope`, whose precedence is
    // "a background principal wins, otherwise the session".
    resolveTenantScope(() => session),
  );
}

function note(id: string, over: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id,
    title: id,
    body: 'b',
    priority: 'high',
    sourceKey: 'work-failed',
    deepLink: null,
    at: '2026-01-05T08:00:00.000Z',
    read: false,
    ...over,
  } as InboxNotification;
}

/** Deliver `n` as the tenant that owns the work — the production contract. */
async function deliverAs(store: InboxStore, tenant: TenantScope, n: InboxNotification) {
  const principal = principalForOwnedWork({
    jobId: 'notification-delivery',
    tenantId: tenant.tenantId,
    workspaceId: null,
  });
  expect(principal).not.toBeNull();
  await runAsPrincipal(principal!, () => store.add(n));
}

beforeEach(() => {
  session = A;
});

describe('Phase 11/12 — delivery carries its own tenant, not the session’s', () => {
  it('a job running as B writes into B’s inbox while A is signed in', async () => {
    const store = newStore();
    session = A;
    await deliverAs(store, B, note('job-failed:1'));

    // A is looking at the app and sees nothing of B's.
    expect(store.page().items).toEqual([]);
    expect(store.unreadCount()).toBe(0);

    session = B;
    expect(store.page().items.map((i) => i.id)).toEqual(['job-failed:1']);
  });

  it('refuses to store a notification that has no tenant, rather than guessing', async () => {
    const store = newStore();
    session = null; // signed out, no principal
    await store.add(note('orphan'));
    session = A;
    expect(store.page().items).toEqual([]);
    session = B;
    expect(store.page().items).toEqual([]);
  });

  it('an UNOWNED event yields no principal, so it is never delivered', () => {
    // Program 13B leaves pre-13B and boot-time events unstamped.
    expect(
      principalForOwnedWork({ jobId: 'notification-delivery', tenantId: null, workspaceId: null }),
    ).toBeNull();
  });
});

describe('Phase 13 — retry keeps the ORIGINAL tenant', () => {
  /**
   * The exact scenario the program names: A's notification fails, the user
   * switches to B, the retry runs. The retry must still be A's.
   *
   * It holds because the principal is rebuilt from the QUEUED WORK's tenant,
   * which is a property of the artefact, and switching organizations does not
   * edit the artefact.
   */
  it('re-delivers to A after the user has switched to B', async () => {
    const store = newStore();
    const failedForA = note('connector-issue:crm');

    session = B; // the switch happened while the delivery was pending
    await deliverAs(store, A, failedForA); // the retry

    expect(store.page().items).toEqual([]); // B sees nothing
    session = A;
    expect(store.page().items.map((i) => i.id)).toEqual(['connector-issue:crm']);
  });
});

describe('Phase 14 — recipient authorization', () => {
  it('A event + B recipient is DENIED', async () => {
    const store = newStore();
    await deliverAs(store, A, note('risk:runtime:x'));
    session = B;
    expect(store.page().items).toEqual([]);
    expect(store.unreadCount()).toBe(0);
  });

  it('B event + A recipient is DENIED', async () => {
    const store = newStore();
    await deliverAs(store, B, note('risk:runtime:x'));
    session = A;
    expect(store.page().items).toEqual([]);
    expect(store.unreadCount()).toBe(0);
  });

  /**
   * The stable-per-subject id collision, which is the reason the de-dupe key
   * carries the scope. Two tenants whose connector is called `crm-primary`
   * produce the SAME item id; without the scope in the key one silently
   * overwrote the other.
   */
  it('two tenants may hold the same item id without overwriting each other', async () => {
    const store = newStore();
    await deliverAs(store, A, note('connector-issue:crm-primary', { title: 'A-TITLE' }));
    await deliverAs(store, B, note('connector-issue:crm-primary', { title: 'B-TITLE' }));

    session = A;
    expect(store.page().items.map((i) => i.title)).toEqual(['A-TITLE']);
    session = B;
    expect(store.page().items.map((i) => i.title)).toEqual(['B-TITLE']);
  });
});

describe('Phase 15 — the notification cache never aggregates across tenants', () => {
  it('A unread = 7 and B unread = 2, with no total of 9 anywhere', async () => {
    const store = newStore();
    for (let i = 0; i < 7; i += 1) await deliverAs(store, A, note(`a-${i}`));
    for (let i = 0; i < 2; i += 1) await deliverAs(store, B, note(`b-${i}`));

    session = A;
    expect(store.unreadCount()).toBe(7);
    expect(store.page().total).toBe(7);

    session = B;
    expect(store.unreadCount()).toBe(2);
    expect(store.page().total).toBe(2);
  });

  it('marking ALL read clears only the caller’s tenant', async () => {
    const store = newStore();
    await deliverAs(store, A, note('a-1'));
    await deliverAs(store, B, note('b-1'));

    session = A;
    expect(await store.markRead('all')).toBe(1);
    expect(store.unreadCount()).toBe(0);

    session = B;
    expect(store.unreadCount()).toBe(1); // untouched
  });

  /**
   * The badge broadcast, which is the one value a background pass sends to the
   * RENDERER. Computed inside the run it would be the run's tenant; the window
   * is showing the session's. `runOutsidePrincipal` is what makes the number
   * the one the viewer is entitled to.
   */
  it('the unread count broadcast during a B job is still A’s count', async () => {
    const store = newStore();
    for (let i = 0; i < 3; i += 1) await deliverAs(store, A, note(`a-${i}`));
    await deliverAs(store, B, note('b-1'));

    session = A; // the window is showing A
    const principal = principalForOwnedWork({
      jobId: 'notification-delivery',
      tenantId: B.tenantId,
      workspaceId: null,
    })!;

    const broadcast = runAsPrincipal(principal, () => ({
      leaked: store.unreadCount(), // what it WOULD have been
      announced: runOutsidePrincipal(() => store.unreadCount()), // what it is
    }));

    expect(broadcast.leaked).toBe(1); // B's count — not A's to see
    expect(broadcast.announced).toBe(3); // A's own count
  });
});

describe('event routing preserves nothing it should not', () => {
  it('routes a connector failure to an item whose id is stable per subject', () => {
    const routed = routeEvent({
      id: 'e1',
      type: 'connector.sync_failed',
      category: 'connector',
      version: 1,
      priority: 'high',
      timestamp: '2026-01-05T08:00:00.000Z',
      source: 'sync',
      metadata: {},
      resource: { id: 'crm-primary', name: 'CRM' },
      tenantId: A.tenantId,
    } as never);
    expect(routed?.item.id).toBe('connector-issue:crm-primary');
    // The router is pure and tenant-blind BY DESIGN: it maps shape to shape.
    // Ownership is applied by the caller, from the event — which is why the
    // caller is the thing these tests bind.
  });
});
