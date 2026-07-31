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
  broadcast: (channel: string, payload: unknown) => void;
  /** Typed subscription on the EXISTING platform event bus. */
  on: (
    types: PlatformEventType[],
    handler: (evt: PlatformEvent) => void,
  ) => { dispose: () => void };
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
  const store = new InboxStore(join(app.getPath('userData'), 'notification-inbox.json'));
  const loaded = store.loadAllSync();

  const announce = (kind: 'added' | 'read'): void => {
    deps.broadcast(IpcChannel.NotificationsEventBroadcast, {
      kind,
      unread: store.unreadCount(),
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
    if (!cooldown.allow(routed.item.id, Date.now())) return;
    void deliveryEngine.deliverNow(routed.sourceKey, routed.item);
  });

  // ── Meeting reminders: an interval source over the live UDM calendar ────────
  deliveryEngine.register({
    key: 'meeting-soon',
    label: 'Meeting reminders',
    cadence: { kind: 'interval', everyMs: MEETING_SCAN_EVERY_MS },
    produce: () => {
      const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
      const items = upcomingMeetingItems(entities, new Date().toISOString());
      // the cooldown keeps a meeting inside its window from re-toasting each scan
      return items.filter((it) => cooldown.allow(it.id, Date.now()));
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
