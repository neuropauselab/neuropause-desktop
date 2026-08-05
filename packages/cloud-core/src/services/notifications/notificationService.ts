/**
 * Notification Platform (NCEA 10.2) — FOUNDATION.
 *
 * A notification service with pluggable CHANNEL adapters (push / email /
 * desktop / a mobile interface — no mobile UI here), a history store, and
 * per-channel delivery tracking. The adapters are interfaces; the only adapters
 * shipped are in-memory (for tests). Real APNs/FCM/SMTP transports are the
 * follow-up (STATUS.md). Notifications carry references + titles, never secrets.
 */
import type { NotificationId, UserId } from '@neuropause/shared-cloud';
import type { Clock } from '../../lib/clock';
import { randomId } from '../../lib/ids';

export interface Notification {
  notificationId: NotificationId;
  userId: UserId;
  title: string;
  body?: string;
  channels: string[];
  createdAt: number;
}

export interface DeliveryResult {
  ok: boolean;
  detail?: string;
}

export interface NotificationChannel {
  readonly name: string;
  deliver(notification: Notification): Promise<DeliveryResult>;
}

export interface DeliveryRecord {
  notificationId: NotificationId;
  channel: string;
  status: 'delivered' | 'failed';
  at: number;
  detail?: string;
}

export interface SendInput {
  userId: UserId;
  title: string;
  body?: string;
  channels: string[];
}

/** In-memory channel for tests; behavior injectable to simulate failures. */
export class InMemoryChannel implements NotificationChannel {
  readonly delivered: Notification[] = [];
  constructor(
    readonly name: string,
    private readonly behavior: (n: Notification) => DeliveryResult = () => ({ ok: true }),
  ) {}
  async deliver(notification: Notification): Promise<DeliveryResult> {
    const result = this.behavior(notification);
    if (result.ok) this.delivered.push(notification);
    return result;
  }
}

export class NotificationService {
  private readonly channels = new Map<string, NotificationChannel>();
  private readonly history: Notification[] = [];
  private readonly deliveries: DeliveryRecord[] = [];

  constructor(private readonly clock: Clock) {}

  registerChannel(channel: NotificationChannel): void {
    this.channels.set(channel.name, channel);
  }

  async send(input: SendInput): Promise<{ notification: Notification; deliveries: DeliveryRecord[] }> {
    const notification: Notification = {
      notificationId: randomId('ntf') as NotificationId,
      userId: input.userId,
      title: input.title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      channels: input.channels,
      createdAt: this.clock.now(),
    };
    this.history.push(notification);

    const records: DeliveryRecord[] = [];
    for (const channelName of input.channels) {
      const channel = this.channels.get(channelName);
      const at = this.clock.now();
      if (!channel) {
        records.push({ notificationId: notification.notificationId, channel: channelName, status: 'failed', at, detail: 'no such channel' });
        continue;
      }
      const result = await channel.deliver(notification);
      records.push({
        notificationId: notification.notificationId,
        channel: channelName,
        status: result.ok ? 'delivered' : 'failed',
        at,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
      });
    }
    this.deliveries.push(...records);
    return { notification, deliveries: records };
  }

  historyFor(userId: UserId): Notification[] {
    return this.history.filter((n) => n.userId === userId);
  }

  deliveriesFor(notificationId: NotificationId): DeliveryRecord[] {
    return this.deliveries.filter((d) => d.notificationId === notificationId);
  }
}
