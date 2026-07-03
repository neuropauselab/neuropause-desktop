/**
 * Notification Scheduler — schedules native desktop notifications for a future
 * time. The Notification Center and Reminder Engine (Phase 6) drive this; here
 * it provides the scheduling + delivery primitive built on the task scheduler.
 */
import { Notification } from 'electron';
import { createLogger } from '../logger';
import { taskScheduler } from './taskScheduler';

const log = createLogger('notify-scheduler');

export interface ScheduledNotification {
  id: string;
  title: string;
  body: string;
  at: string;
}

class NotificationScheduler {
  readonly name = 'notification-scheduler';
  private scheduled = new Map<string, ScheduledNotification>();

  start(): void {
    log.info('Notification scheduler started');
  }
  stop(): void {
    for (const id of this.scheduled.keys()) taskScheduler.cancel(`notif:${id}`);
    this.scheduled.clear();
  }

  schedule(notification: ScheduledNotification): void {
    this.scheduled.set(notification.id, notification);
    taskScheduler.at(`notif:${notification.id}`, new Date(notification.at), () => {
      this.scheduled.delete(notification.id);
      if (Notification.isSupported()) {
        new Notification({ title: notification.title, body: notification.body }).show();
      }
    });
  }

  /** Fires a notification immediately. */
  notifyNow(title: string, body: string): void {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  }

  cancel(id: string): boolean {
    this.scheduled.delete(id);
    return taskScheduler.cancel(`notif:${id}`);
  }

  list(): ScheduledNotification[] {
    return [...this.scheduled.values()];
  }
}

export const notificationScheduler = new NotificationScheduler();
