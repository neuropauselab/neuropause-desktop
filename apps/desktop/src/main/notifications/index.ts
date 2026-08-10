/**
 * Notification subsystem composition root (Phase 6 Stage 5).
 *
 * Builds the in-app Notification Inbox as the EXISTING delivery engine's
 * (previously typed-only) `notification-center` channel, routes the bus events
 * that warrant user attention through the SAME engine gates as scheduled
 * intelligence (enabled → per-source mute → priority threshold → DND with
 * critical bypass), registers the `meeting-soon` interval source, and exposes
 * the `notifications:*` IPC cluster — including the preference surface over the
 * EXISTING delivery-preference store (5.10: same store, now user-visible).
 *
 * Creates NO new scheduler, NO new notification path, NO new AI: scheduled
 * briefs land here because the channel is registered, not because anything is
 * generated twice.
 */
import { join } from 'node:path';
import { app } from 'electron';
import type {
  DeliveryChannel,
  DeliveryPreferences,
  InboxNotification,
  PlatformEvent,
  PlatformEventType,
  NotificationsListRequest as TNotificationsListRequest,
  NotificationsMarkReadRequest as TNotificationsMarkReadRequest,
  NotificationsPrefsSetRequest as TNotificationsPrefsSetRequest,
} from '@neuropause/shared';
import {
  EmptyRequest,
  IpcChannel,
  NotificationsListRequest,
  NotificationsMarkReadRequest,
  NotificationsPrefsSetRequest,
} from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { unifiedStore } from '../unified/storeInstance';
import {
  deliveryEngine,
  loadDeliveryPreferences,
  registerDeliveryChannel,
  reregisterScheduledSources,
  saveDeliveryPreferences,
} from '../services/executiveDelivery';
import { InboxStore } from './inboxStore';
import { activeTenantScope } from '../enterprise/index';
import { runAsPrincipal, runOutsidePrincipal } from '../tenancy/backgroundPrincipal';
import { principalForOwnedWork } from '../tenancy/backgroundFanOut';
import {
  DeliveryCooldown,
  NOTIFICATION_EVENT_TYPES,
  routeEvent,
  toInboxNotification,
  upcomingMeetingItems,
} from './eventNotifications';

const log = createLogger('notifications');

/** Same item id is re-delivered at most once per this window (anti-flap). */
const REDELIVERY_COOLDOWN_MS = 30 * 60_000;
/** How often the meeting-soon scan runs. */
const MEETING_SCAN_EVERY_MS = 5 * 60_000;

export interface NotificationsSubsystemDeps {
  broadcast: IpcBroadcaster;
  /** Typed subscription on the EXISTING platform event bus. */
  on: (
    types: PlatformEventType[],
    handler: (evt: PlatformEvent) => void,
  ) => { dispose: () => void };
  /**
   * P13C PART 3 — fan a SYSTEM alert out to every operable tenant, each under
   * its own principal. Injected, like `on`, so this root stays testable.
   */
  forEachTenant: (jobId: string, fn: () => void | Promise<void>) => Promise<unknown>;
}

export interface NotificationsSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
  /** Live unread count (for peers that compose it, e.g. the Work Hub). */
  unreadCount: () => number;
  /** Phase 6 Stage 6 — read-only inbox items for the insight signal read. */
  inboxItems: () => InboxNotification[];
}

export function initNotifications(deps: NotificationsSubsystemDeps): NotificationsSubsystem {
  const store = new InboxStore(
    join(app.getPath('userData'), 'notification-inbox.json'),
    // P12 — the same tenant resolver every other store reads.
  ).bindScope(activeTenantScope);
  const loaded = store.loadAllSync();

  /**
   * Tell the open window that the inbox changed.
   *
   * P13C PART 3 — THE COUNT IS COMPUTED OUTSIDE ANY BACKGROUND PRINCIPAL.
   *
   * `unreadCount()` is scoped, so inside a fanned-out delivery it would count
   * the RUN's tenant. This function's audience is the renderer, which is showing
   * the SIGNED-IN user's tenant — so a background pass for tenant A would have
   * broadcast A's unread total into a window displaying B. Leaving the principal
   * makes the count the session's own, which is both correct for the badge and
   * the only value B is entitled to see.
   *
   * Note what this does NOT do: suppress the delivery. A's notification is still
   * written to A's inbox. Only the number sent to B's window is B's.
   */
  const announce = (kind: 'added' | 'read'): void => {
    const unread = runOutsidePrincipal(() => store.unreadCount());
    deps.broadcast(IpcChannel.NotificationsEventBroadcast, {
      kind,
      unread,
      at: new Date().toISOString(),
    });
  };

  // ── The notification-center delivery channel (the inbox) ────────────────────
  const inboxChannel: DeliveryChannel = {
    key: 'notification-center',
    available: true,
    deliver: async (item) => {
      await store.add(toInboxNotification(item, new Date().toISOString()));
      announce('added');
    },
  };
  registerDeliveryChannel(inboxChannel);

  // ── Bus-driven notifications, through the engine's normal gates ─────────────
  const cooldown = new DeliveryCooldown(REDELIVERY_COOLDOWN_MS);
  const sub = deps.on(NOTIFICATION_EVENT_TYPES, (evt) => {
    const routed = routeEvent(evt);
    if (!routed) return;

    /**
     * P13C PART 3 — DELIVER UNDER THE EVENT'S TENANT, OR NOT AT ALL.
     *
     * This subscriber receives the WHOLE bus. Before this, it called
     * `deliverNow` directly, and the inbox channel then stamped the resulting
     * notification with `activeTenantScope()` — the signed-in user's workspace.
     * So a `connector.sync_failed` raised by tenant A's sync, carrying A's
     * connector name in its title, was written into whichever tenant's inbox
     * happened to be open. That is the notification twin of the webhook
     * cross-tenant fan-out Part 2a closed, and it is closed the same way: the
     * scope comes from the EVENT, which Program 13B stamped at materialization,
     * never from the session.
     *
     * An UNOWNED event is dropped rather than delivered. Events published before
     * 13B, and those published with no tenant resolvable, have no owner —
     * delivering one would mean choosing a recipient for it, and every available
     * choice is somebody who is not entitled to it.
     */
    /**
     * A SYSTEM event reaches every tenant, and only a system event does.
     *
     * `scopeKind: 'system'` is stamped from a SYSTEM principal, which carries no
     * tenant — so such an event cannot have read customer data to put in its
     * payload. That is what makes broadcasting it safe, and it is the reason the
     * flag exists: Program 13B's fail-closed stamping correctly made the runtime
     * supervisor's CRITICAL alerts unowned, and therefore invisible to
     * everybody. Fanning them out under each tenant's own principal restores the
     * alert without making the timeline global.
     */
    if (evt.scopeKind === 'system') {
      if (!cooldown.allow(`system::${routed.item.id}`, Date.now())) return;
      void deps.forEachTenant('notification-system-broadcast', async () => {
        await deliveryEngine.deliverNow(routed.sourceKey, routed.item);
      });
      return;
    }

    /**
     * Events carry a TENANT and no workspace (P13B stamps one field), so the
     * principal is tenant-level. `recordInScope` reads an absent workspace as
     * tenant-wide, so the notification is visible from any of that tenant's
     * workspaces — correct for an alert about a connector or a job, neither of
     * which belongs to one workspace.
     */
    const principal = principalForOwnedWork({
      jobId: 'notification-delivery',
      tenantId: evt.tenantId,
      workspaceId: null,
    });
    if (principal === null) {
      log.debug('Unowned event not delivered', { type: evt.type });
      return;
    }

    /**
     * The cooldown key carries the tenant.
     *
     * Item ids are stable per SUBJECT so a flapping condition replaces its row
     * instead of flooding. Across tenants that makes them collide: two tenants
     * whose connector `crm-primary` both fail produce the same item id, and a
     * single-keyed cooldown means the first tenant's alert silences the
     * second's for thirty minutes. Same defect the inbox de-dupe had before P12
     * put the scope in its key.
     */
    if (!cooldown.allow(`${principal.tenantId}::${routed.item.id}`, Date.now())) return;

    void runAsPrincipal(principal, () =>
      deliveryEngine.deliverNow(routed.sourceKey, routed.item),
    );
  });

  // ── Meeting reminders: an interval source over the live UDM calendar ────────
  deliveryEngine.register({
    key: 'meeting-soon',
    label: 'Meeting reminders',
    cadence: { kind: 'interval', everyMs: MEETING_SCAN_EVERY_MS },
    /**
     * P13C PART 3 — this runs once PER TENANT, inside that tenant's principal.
     *
     * The body did not need to change for the read to become correct:
     * `unifiedStore.query` resolves through `activeTenantScope()`, which prefers
     * the running principal, so each pass scans that organization's calendar
     * and no other. Before the fan-out this scanned once, under the signed-in
     * user's workspace, which meant one organization got meeting reminders and
     * the rest silently got none.
     */
    produce: () => {
      const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
      const items = upcomingMeetingItems(entities, new Date().toISOString());
      // The cooldown keeps a meeting inside its window from re-toasting each
      // scan. Keyed by tenant for the same reason the bus path is: two
      // organizations' calendars can hold the same entity id.
      const tenantId = activeTenantScope()?.tenantId ?? '';
      return items.filter((it) => cooldown.allow(`${tenantId}::${it.id}`, Date.now()));
    },
  });

  // ── IPC ─────────────────────────────────────────────────────────────────────
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.NotificationsList,
      schema: NotificationsListRequest,
      handler: (p) => store.page((p as TNotificationsListRequest).limit ?? 50),
    },
    {
      channel: IpcChannel.NotificationsMarkRead,
      schema: NotificationsMarkReadRequest,
      handler: async (p) => {
        const changed = await store.markRead((p as TNotificationsMarkReadRequest).ids);
        if (changed > 0) announce('read');
        return { changed, unread: store.unreadCount() };
      },
    },
    {
      channel: IpcChannel.NotificationsPrefsGet,
      schema: EmptyRequest,
      handler: () => loadDeliveryPreferences(),
    },
    {
      channel: IpcChannel.NotificationsPrefsSet,
      schema: NotificationsPrefsSetRequest,
      audit: true,
      handler: async (p) => {
        const r = p as TNotificationsPrefsSetRequest;
        // Explicit conditional spreads: only user-provided fields patch the store
        // (exactOptionalPropertyTypes-safe; absent keys never clobber defaults).
        const patch: Partial<DeliveryPreferences> = {
          ...(r.enabled !== undefined ? { enabled: r.enabled } : {}),
          ...(r.doNotDisturb !== undefined ? { doNotDisturb: r.doNotDisturb } : {}),
          ...(r.minPriority !== undefined ? { minPriority: r.minPriority } : {}),
          ...(r.timezoneOffsetMinutes !== undefined
            ? { timezoneOffsetMinutes: r.timezoneOffsetMinutes }
            : {}),
          ...(r.morningBriefMinutes !== undefined
            ? { morningBriefMinutes: r.morningBriefMinutes }
            : {}),
          ...(r.afternoonUpdateMinutes !== undefined
            ? { afternoonUpdateMinutes: r.afternoonUpdateMinutes }
            : {}),
          ...(r.eveningSummaryMinutes !== undefined
            ? { eveningSummaryMinutes: r.eveningSummaryMinutes }
            : {}),
          ...(r.weeklyReportDay !== undefined ? { weeklyReportDay: r.weeklyReportDay } : {}),
          ...(r.mutedSources !== undefined ? { mutedSources: r.mutedSources } : {}),
        };
        const next = await saveDeliveryPreferences(patch);
        // Re-register the cadence sources so new times take effect immediately.
        reregisterScheduledSources(next);
        return next;
      },
    },
  ];

  log.info('Notification inbox initialized', {
    stored: loaded.length,
    unread: store.unreadCount(),
    busTypes: NOTIFICATION_EVENT_TYPES.length,
  });

  return {
    handlers,
    dispose: () => {
      sub.dispose();
      deliveryEngine.unregister('meeting-soon');
    },
    unreadCount: () => store.unreadCount(),
    // Phase 6 Stage 6 — read-only inbox accessor for the insight layer's
    // signal-freshness read (mirrors assistant.conversationSummaries).
    inboxItems: () => store.page(200).items,
  };
}
