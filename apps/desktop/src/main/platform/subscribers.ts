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
} from '@neuropause/shared';
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

  // Notifications — high/critical priority signals.
  subscriptions.push(
    bus.subscribe((e) => { if (e.priority === 'high' || e.priority === 'critical') deps.notify(e); }, { id: 'notifications' }),
  );

  // Forwarder — mirror to renderer.
  subscriptions.push(bus.subscribe((e) => deps.broadcast(e), { id: 'forwarder' }));

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
