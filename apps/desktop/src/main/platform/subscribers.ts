/**
 * Platform subscribers. The Event Bus carries events; *these* contain the
 * reactions. Each subscriber does one job and is independently testable:
 *
 *   - TimelineSubscriber    → durably records events (skips ephemeral churn).
 *   - AuditSubscriber       → security-relevant events to the audit log.
 *   - AnalyticsSubscriber   → rolling counts by type/category (in-memory).
 *   - DiagnosticsCollector  → per-category liveness for the Diagnostics report.
 *   - NotificationsSubscriber → surfaces high-priority events to the user.
 *   - ForwarderSubscriber   → mirrors events to the renderer (Inspector etc.).
 *   - DomainProjection      → a small recent-activity view per domain.
 *
 * Side-effecting dependencies (persist, audit, notify, broadcast) are injected
 * so subscribers stay pure and unit-testable.
 */
import type {
  PlatformEvent,
  PlatformEventCategory,
  PlatformEventType,
  TenantScope,
} from '@neuropause/shared';
import { recordInScope } from '@neuropause/shared';
import type { EventBus, Subscription } from './eventBus';

/** High-frequency events that are delivered live but not persisted verbatim. */
const EPHEMERAL: Set<PlatformEventType> = new Set(['download.progress']);

/** Events worth writing to the security audit log. */
const AUDIT_TYPES: Set<PlatformEventType> = new Set([
  'application.installed',
  'application.updated',
  'application.removed',
  'permission.granted',
  'permission.revoked',
  'plugin.installed',
  'plugin.removed',
  'user.signed_in',
  'user.signed_out',
  // Connector lifecycle events with security relevance (P2.2) — a connection grants directory access.
  'connector.connected',
  'connector.disconnected',
  'connector.reauth_required',
  'connector.error',
  'connector.sync_failed',
  // P2.4 — every Microsoft 365 write mutates the user's mailbox/calendar/files/chats; its outcome is audited.
  'connector.write_completed',
  'connector.write_failed',
]);

/* ───────────────────────────── Analytics ───────────────────────────────── */

export class AnalyticsSubscriber {
  readonly id = 'analytics';
  private total = 0;
  private byType = new Map<PlatformEventType, number>();
  private byCategory = new Map<PlatformEventCategory, number>();

  handle = (e: PlatformEvent): void => {
    this.total += 1;
    this.byType.set(e.type, (this.byType.get(e.type) ?? 0) + 1);
    this.byCategory.set(e.category, (this.byCategory.get(e.category) ?? 0) + 1);
  };

  snapshot(): { total: number; byType: Record<string, number>; byCategory: Record<string, number> } {
    return {
      total: this.total,
      byType: Object.fromEntries(this.byType),
      byCategory: Object.fromEntries(this.byCategory),
    };
  }
}

/* ─────────────────────────── Diagnostics collector ─────────────────────── */

interface CategoryLiveness {
  count: number;
  lastAt: string | null;
  lastType: PlatformEventType | null;
}

export class DiagnosticsCollector {
  readonly id = 'diagnostics-collector';
  private categories = new Map<PlatformEventCategory, CategoryLiveness>();
  private crashes = 0;
  private failures = 0;

  handle = (e: PlatformEvent): void => {
    const cur = this.categories.get(e.category) ?? { count: 0, lastAt: null, lastType: null };
    cur.count += 1;
    cur.lastAt = e.timestamp;
    cur.lastType = e.type;
    this.categories.set(e.category, cur);
    if (e.type === 'runtime.crashed' || e.type === 'plugin.crashed') this.crashes += 1;
    if (e.type === 'download.failed') this.failures += 1;
  };

  liveness(category: PlatformEventCategory): CategoryLiveness {
    return this.categories.get(category) ?? { count: 0, lastAt: null, lastType: null };
  }

  counters(): { crashes: number; failures: number } {
    return { crashes: this.crashes, failures: this.failures };
  }
}

/* ─────────────────────────── Domain projection ─────────────────────────── */

/** A bounded recent-activity view for one event family. */
export class DomainProjection {
  readonly id: string;
  private readonly category: PlatformEventCategory;
  private readonly cap: number;
  private recent: PlatformEvent[] = [];
  private count = 0;

  constructor(category: PlatformEventCategory, cap = 50) {
    this.category = category;
    this.cap = cap;
    this.id = `projection:${category}`;
  }

  handle = (e: PlatformEvent): void => {
    if (e.category !== this.category) return;
    this.count += 1;
    this.recent.unshift(e);
    if (this.recent.length > this.cap) this.recent.pop();
  };

  view(): { category: PlatformEventCategory; count: number; recent: PlatformEvent[] } {
    return { category: this.category, count: this.count, recent: this.recent.slice() };
  }
}

/* ──────────────────────────── Registration ─────────────────────────────── */

export interface SubscriberDeps {
  /** Persist an event to the timeline. */
  persist: (event: PlatformEvent) => void;
  /** Append a structured line to the security audit log. */
  audit: (event: PlatformEvent) => void;
  /** Surface a high-priority event to the user (e.g., native notification). */
  notify: (event: PlatformEvent) => void;
  /** Mirror an event to the renderer. */
  broadcast: (event: PlatformEvent) => void;
  /**
   * The tenant of the WINDOW IN FRONT OF THE USER. P13C ROUND 9 — F5.
   *
   * NOT the tenant of whatever is publishing. A background pass legitimately
   * runs as tenant A while the renderer is showing tenant B, so the forwarder
   * must ask "who is the viewer" and not "who is the actor" — the composition
   * root supplies this through `runOutsidePrincipal`, which is the primitive
   * built for exactly this and grants nothing (it falls back to the session, so
   * it can only ever see what the signed-in user could).
   *
   * Optional so a standalone bus in a unit test needs no wiring; ABSENT MEANS
   * UNRESOLVED, which the predicate below treats as "system events only", not
   * as "deliver everything".
   */
  viewerScope?: () => TenantScope | null;
}

/**
 * May this event be mirrored to a renderer showing `viewer`? P13C ROUND 9 — F5.
 *
 * THE FINDING: `broadcast` mirrored every event raw to the single renderer with
 * no filter and no principal handling, while the SAME ROWS read back through
 * `timeline:query` were hard-filtered. An event carries `actor.id`,
 * `resource.id` and free-form metadata, so workspace B's sync pass was sending
 * B's identifiers and record names into A's window.
 *
 * THE PREDICATE IS THE TIMELINE'S, VERBATIM — `scopeKind === 'system' ||
 * recordInScope(...)`. Deliberately not a second opinion: two predicates for
 * "may this person see this event" is how a live feed shows what the query then
 * refuses, and the disagreement is the leak.
 *
 * The one addition is the both-unresolved case. An unowned event delivered while
 * NO tenant is resolved reaches nobody's session, so it cannot cross a boundary
 * — and refusing it would blank the pre-sign-in boot feed for no security gain.
 * The moment a tenant IS active, unowned events stop being delivered, which is
 * the fail-closed half and matches what the timeline shows.
 */
export function eventDeliverableTo(event: PlatformEvent, viewer: TenantScope | null): boolean {
  if (event.scopeKind === 'system') return true;
  if (viewer === null) return event.tenantId === null || event.tenantId === undefined;
  return recordInScope(event, viewer);
}

export interface SubscriberRegistry {
  analytics: AnalyticsSubscriber;
  diagnostics: DiagnosticsCollector;
  projections: DomainProjection[];
  subscriptions: Subscription[];
  disposeAll: () => void;
}

const DOMAIN_CATEGORIES: PlatformEventCategory[] = [
  'runtime',
  'application',
  'download',
  'permission',
  'plugin',
  'update',
];

/** Wire every subscriber onto the bus and return handles for diagnostics/tests. */
export function registerSubscribers(bus: EventBus, deps: SubscriberDeps): SubscriberRegistry {
  const analytics = new AnalyticsSubscriber();
  const diagnostics = new DiagnosticsCollector();
  const projections = DOMAIN_CATEGORIES.map((c) => new DomainProjection(c));

  const subscriptions: Subscription[] = [];

  // Timeline — everything except ephemeral churn.
  subscriptions.push(
    bus.subscribe((e) => { if (!EPHEMERAL.has(e.type)) deps.persist(e); }, { id: 'timeline' }),
  );

  // Audit — security-relevant events only.
  subscriptions.push(
    bus.subscribe((e) => { if (AUDIT_TYPES.has(e.type)) deps.audit(e); }, { id: 'audit', types: [...AUDIT_TYPES] }),
  );

  /**
   * Notifications — high/critical priority signals, SCOPED.
   *
   * P13C ROUND 9, FRESH RED TEAM. F5 scoped the forwarder eight lines below and
   * left this one unfiltered, in the same function, having written the reason
   * out in full directly above. `notifyUser` renders
   * `event.resource?.name ?? event.resource?.id` as the body of a NATIVE OS
   * notification — so a background pass for tenant A, running while the window
   * shows tenant B, put A's record name into macOS Notification Center.
   *
   * WORSE THAN THE WINDOW, WHICH IS WHY IT IS NOT A DUPLICATE OF F5: the
   * renderer feed is cleared by a workspace switch. Notification Center is not.
   * It persists after the switch, shows on the lock screen, and syncs to the
   * person's other Apple devices — a surface the tenant boundary does not
   * reach at all once the bytes are handed over.
   *
   * Same predicate as the forwarder, deliberately: two opinions about who may
   * see an event is how one surface shows what the other hides.
   */
  subscriptions.push(
    bus.subscribe(
      (e) => {
        if (e.priority !== 'high' && e.priority !== 'critical') return;
        if (!eventDeliverableTo(e, deps.viewerScope?.() ?? null)) return;
        deps.notify(e);
      },
      { id: 'notifications' },
    ),
  );

  /**
   * Forwarder — mirror to renderer, SCOPED. P13C ROUND 9 — F5.
   *
   * Was `bus.subscribe((e) => deps.broadcast(e))`: every tenant's events, raw,
   * to the one window.
   */
  subscriptions.push(
    bus.subscribe(
      (e) => {
        if (!eventDeliverableTo(e, deps.viewerScope?.() ?? null)) return;
        deps.broadcast(e);
      },
      { id: 'forwarder' },
    ),
  );

  // Analytics + diagnostics collectors.
  subscriptions.push(bus.subscribe(analytics.handle, { id: analytics.id }));
  subscriptions.push(bus.subscribe(diagnostics.handle, { id: diagnostics.id }));

  // Per-domain projections.
  for (const p of projections) {
    subscriptions.push(bus.subscribe(p.handle, { id: p.id, types: undefined }));
  }

  return {
    analytics,
    diagnostics,
    projections,
    subscriptions,
    disposeAll: () => subscriptions.forEach((s) => s.dispose()),
  };
}
