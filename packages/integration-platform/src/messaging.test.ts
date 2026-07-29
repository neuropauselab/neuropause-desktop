import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createIntegrationPlatform } from './platform';

describe('E9 — messaging platform (real in-process bus)', () => {
  it('publishes and consumes messages, with brokers adapter-verified', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    const broker = await ip.messaging().registerBroker('kafka');
    expect(broker.configured).toBe(false); // represented, not connected
    ip.messaging().publish('orders', { id: 1 });
    ip.messaging().publish('orders', { id: 2 });
    expect(ip.messaging().consume('orders')).toHaveLength(2);
    expect(ip.messaging().pending('orders')).toBe(0);
  });

  it('retries a failing handler and dead-letters exhausted messages', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    ip.messaging().publish('t', { fail: false });
    ip.messaging().publish('t', { fail: true });
    const res = await ip.messaging().processWithRetry('t', (m) => {
      if ((m.payload as { fail: boolean }).fail) throw new Error('boom');
    }, 2);
    expect(res.processed).toBe(1);
    expect(res.deadLettered).toBe(1);
    expect(ip.messaging().deadLetters()).toHaveLength(1);
  });

  it('replays a topic history back onto the live topic', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    ip.messaging().publish('t', { id: 1 });
    ip.messaging().consume('t');
    expect(ip.messaging().pending('t')).toBe(0);
    expect(ip.messaging().replay('t')).toBe(1);
    expect(ip.messaging().pending('t')).toBe(1); // replayed
  });
});
