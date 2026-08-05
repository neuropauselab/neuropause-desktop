import { describe, it, expect } from 'vitest';
import { ManualClock } from '../../lib/clock';
import { InMemoryChannel, NotificationService } from './notificationService';

function svc(): { service: NotificationService; push: InMemoryChannel; email: InMemoryChannel; desktop: InMemoryChannel } {
  const service = new NotificationService(new ManualClock(1000));
  const push = new InMemoryChannel('push');
  const email = new InMemoryChannel('email');
  const desktop = new InMemoryChannel('desktop');
  service.registerChannel(push);
  service.registerChannel(email);
  service.registerChannel(desktop);
  return { service, push, email, desktop };
}

describe('NotificationService', () => {
  it('fans out to requested channels and tracks delivery', async () => {
    const { service, push, desktop } = svc();
    const { notification, deliveries } = await service.send({
      userId: 'usr_1',
      title: 'Approval needed',
      channels: ['push', 'desktop'],
    });
    expect(notification.notificationId.startsWith('ntf_')).toBe(true);
    expect(deliveries.map((d) => d.status)).toEqual(['delivered', 'delivered']);
    expect(push.delivered).toHaveLength(1);
    expect(desktop.delivered).toHaveLength(1);
  });

  it('records a failed delivery for an unknown channel', async () => {
    const { service } = svc();
    const { deliveries } = await service.send({ userId: 'usr_1', title: 'x', channels: ['sms'] });
    expect(deliveries[0]).toMatchObject({ channel: 'sms', status: 'failed', detail: 'no such channel' });
  });

  it('records a failed delivery when a channel reports failure', async () => {
    const service = new NotificationService(new ManualClock(1000));
    service.registerChannel(new InMemoryChannel('push', () => ({ ok: false, detail: 'device offline' })));
    const { deliveries } = await service.send({ userId: 'usr_1', title: 'x', channels: ['push'] });
    expect(deliveries[0]).toMatchObject({ status: 'failed', detail: 'device offline' });
  });

  it('keeps history and per-notification delivery records', async () => {
    const { service } = svc();
    const a = await service.send({ userId: 'usr_1', title: 'a', channels: ['push'] });
    await service.send({ userId: 'usr_2', title: 'b', channels: ['email'] });
    expect(service.historyFor('usr_1')).toHaveLength(1);
    expect(service.deliveriesFor(a.notification.notificationId)).toHaveLength(1);
  });
});
