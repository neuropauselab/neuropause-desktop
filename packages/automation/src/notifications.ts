/**
 * Module 6 — Notification Platform. Channels (email/Slack/in-app/push/webhook/SMS),
 * digest, scheduling, escalation, and per-user preferences. Only the in-app channel has a
 * real (recording) deliverer here and is live-verified; the external channels have no
 * deliverer in this environment, so their notifications are honestly QUEUED and labelled
 * infra-pending — never marked delivered. Every notification is audited.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { AutomationGovernance } from './governance';
import type { NotificationChannel } from './constants';

export interface Notification {
  id: string;
  tenantId: string;
  channel: NotificationChannel;
  to: string;
  subject: string;
  body: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'queued' | 'sent' | 'failed';
  at: number;
  detail?: string;
}

export interface ChannelDeliverer {
  channel: NotificationChannel;
  deliver(n: Notification): Promise<{ ok: boolean; detail?: string }>;
}

export interface NotificationPreferences {
  userId: string;
  channels: NotificationChannel[];
  digest: boolean;
}

/** The in-app recording deliverer — the one channel that genuinely delivers here. */
export class InAppRecordingChannel implements ChannelDeliverer {
  readonly channel: NotificationChannel = 'in-app';
  readonly inbox: Notification[] = [];
  async deliver(n: Notification): Promise<{ ok: boolean }> {
    this.inbox.push(n);
    return { ok: true };
  }
}

export class NotificationPlatform {
  private readonly channels = new Map<NotificationChannel, ChannelDeliverer>();
  private readonly log: Notification[] = [];
  private readonly scheduled: Array<{ notification: Notification; at: number }> = [];
  private readonly prefs = new Map<string, NotificationPreferences>();

  constructor(
    private readonly clock: Clock,
    private readonly governance?: AutomationGovernance,
  ) {
    this.registerChannel(new InAppRecordingChannel());
  }

  registerChannel(d: ChannelDeliverer): void {
    this.channels.set(d.channel, d);
  }

  async send(input: { tenantId: string; channel: NotificationChannel; to: string; subject: string; body: string; priority?: Notification['priority'] }): Promise<Notification> {
    const n: Notification = { id: randomId('ntf'), tenantId: input.tenantId, channel: input.channel, to: input.to, subject: input.subject, body: input.body, priority: input.priority ?? 'normal', status: 'queued', at: this.clock.now() };
    const deliverer = this.channels.get(input.channel);
    if (deliverer) {
      const res = await deliverer.deliver(n);
      n.status = res.ok ? 'sent' : 'failed';
      if (res.detail) n.detail = res.detail;
    } else {
      n.status = 'queued';
      n.detail = `no ${input.channel} deliverer configured — infra-pending`;
    }
    this.log.push(n);
    void this.governance?.recordNotification(input.tenantId, input.channel, n.status);
    return n;
  }

  /** Combine several items into one in-app digest notification. */
  async digest(tenantId: string, to: string, items: Array<{ subject: string; body: string }>): Promise<Notification> {
    const body = items.map((i, idx) => `${idx + 1}. ${i.subject}: ${i.body}`).join('\n');
    return this.send({ tenantId, channel: 'in-app', to, subject: `Digest (${items.length} items)`, body });
  }

  /** Schedule a notification for later (recorded; delivered when due()). */
  schedule(input: { tenantId: string; channel: NotificationChannel; to: string; subject: string; body: string }, at: number): void {
    const n: Notification = { id: randomId('ntf'), ...input, priority: 'normal', status: 'queued', at };
    this.scheduled.push({ notification: n, at });
  }
  async due(now: number): Promise<Notification[]> {
    const ready = this.scheduled.filter((s) => s.at <= now);
    const sent: Notification[] = [];
    for (const s of ready) {
      this.scheduled.splice(this.scheduled.indexOf(s), 1);
      sent.push(await this.send({ tenantId: s.notification.tenantId, channel: s.notification.channel, to: s.notification.to, subject: s.notification.subject, body: s.notification.body }));
    }
    return sent;
  }

  async escalate(notificationId: string): Promise<Notification | undefined> {
    const orig = this.log.find((n) => n.id === notificationId);
    if (!orig) return undefined;
    return this.send({ tenantId: orig.tenantId, channel: orig.channel, to: orig.to, subject: `[ESCALATED] ${orig.subject}`, body: orig.body, priority: 'urgent' });
  }

  setPreferences(p: NotificationPreferences): void {
    this.prefs.set(p.userId, p);
  }
  preferences(userId: string): NotificationPreferences {
    return this.prefs.get(userId) ?? { userId, channels: ['in-app'], digest: false };
  }

  list(tenantId: string): Notification[] {
    return this.log.filter((n) => n.tenantId === tenantId);
  }
  history(): Notification[] {
    return [...this.log];
  }
}
