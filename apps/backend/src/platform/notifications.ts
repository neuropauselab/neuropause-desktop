/**
 * Notification publishing (NCEA 10.2B).
 *
 * The backend PUBLISHES notification events onto the platform event bus; the
 * cloud notification platform (and desktop, and future mobile) consume and
 * deliver them. No mobile UI is implemented here — only the publish contract.
 */
import type { DomainEventPublisher } from './events';

export interface NotificationRequest {
  userId: string;
  title: string;
  channels: string[];
}

export function publishNotification(
  publisher: DomainEventPublisher,
  request: NotificationRequest,
): Promise<void> {
  return publisher.publish({
    type: 'notification.requested',
    topic: 'notifications',
    partitionKey: request.userId,
    version: 1,
    payload: request,
  });
}
