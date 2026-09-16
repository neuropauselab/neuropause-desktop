/**
 * P5 — Increment 2: the Slack Socket Mode transport, driven against a fake socket (no network).
 * Proves: envelopes are ACKed by id, events_api payloads reach the sink, control frames are tolerated,
 * a close reconnects with the injected backoff, and stop() halts reconnection.
 */
import { describe, expect, it, vi } from 'vitest';
import { SlackSocketMode, type SocketLike } from './slackSocketMode';

class FakeSocket implements SocketLike {
  sent: string[] = [];
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};
  send(d: string): void {
    this.sent.push(d);
  }
  close(): void {
    this.emit('close', {});
  }
  addEventListener(type: string, l: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(l);
  }
  emit(type: string, ev: unknown): void {
    for (const l of this.listeners[type] ?? []) l(ev);
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function harness() {
  const sockets: FakeSocket[] = [];
  const onEvent = vi.fn();
  const timers: Array<() => void> = [];
  const sm = new SlackSocketMode({
    appToken: 'xapp-1',
    openConnection: () => Promise.resolve('wss://slack/ws'),
    connect: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    onEvent,
    backoffMs: [10],
    setTimer: (fn) => {
      timers.push(fn);
    },
  });
  return { sm, sockets, onEvent, timers };
}

describe('SlackSocketMode', () => {
  it('ACKs an events_api envelope by id and forwards its payload to the sink', async () => {
    const { sm, sockets, onEvent } = harness();
    await sm.start();
    const s = sockets[0]!;
    s.emit('message', { data: JSON.stringify({ type: 'events_api', envelope_id: 'e1', payload: { event: { type: 'message' } } }) });
    expect(s.sent).toContain(JSON.stringify({ envelope_id: 'e1' }));
    expect(onEvent).toHaveBeenCalledWith({ event: { type: 'message' } });
  });

  it('tolerates a hello control frame without forwarding it', async () => {
    const { sm, sockets, onEvent } = harness();
    await sm.start();
    sockets[0]!.emit('message', { data: JSON.stringify({ type: 'hello' }) });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('reconnects after a socket close, using the injected backoff timer', async () => {
    const { sm, sockets, timers } = harness();
    await sm.start();
    expect(sockets).toHaveLength(1);
    sockets[0]!.emit('close', {});
    expect(timers).toHaveLength(1); // a reconnect was scheduled
    timers[0]!();
    await flush();
    expect(sockets).toHaveLength(2); // re-opened
  });

  it('a disconnect frame reconnects exactly once — no stray timer, no zombie socket', async () => {
    const { sm, sockets, timers } = harness();
    await sm.start();
    expect(sockets).toHaveLength(1);
    sockets[0]!.emit('message', { data: JSON.stringify({ type: 'disconnect' }) });
    await flush(); // let the intentional-reconnect openOnce resolve
    expect(timers).toHaveLength(0); // the intentional close must NOT also schedule a reconnect
    expect(sockets).toHaveLength(2); // reconnected exactly once (no zombie)
  });

  it('degrades a socket-construction failure to a scheduled reconnect (no unhandled rejection)', async () => {
    const timers: Array<() => void> = [];
    let attempts = 0;
    const sm = new SlackSocketMode({
      appToken: 'xapp-1',
      openConnection: () => Promise.resolve('wss://slack/ws'),
      connect: () => {
        attempts += 1;
        throw new Error('no WebSocket implementation');
      },
      onEvent: vi.fn(),
      backoffMs: [10],
      setTimer: (fn) => {
        timers.push(fn);
      },
    });
    await sm.start();
    expect(attempts).toBe(1);
    expect(timers).toHaveLength(1); // bounded retry, not an escaping throw
  });

  it('stop() halts reconnection', async () => {
    const { sm, sockets, timers } = harness();
    await sm.start();
    sm.stop();
    sockets[0]!.emit('close', {});
    expect(timers).toHaveLength(0);
  });

  /**
   * NP-013 — the two failure logs redact AT THE CALL SITE (the mailer idiom):
   * the opener holds the xapp- app token and the ctor error can echo the WSS
   * ticket URL (`?ticket=…` — a bearer-ish one-time credential). Neither may
   * reach a console argument.
   */
  it('open/construction failures never log the app token or the WSS ticket', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const timers: Array<() => void> = [];
    const sm = new SlackSocketMode({
      appToken: 'xapp-1-A0-secret9876543210',
      openConnection: () =>
        Promise.reject(new Error('apps.connections.open rejected token xapp-1-A0-secret9876543210')),
      connect: () => {
        throw new Error('bad url wss://wss.slack.com/link?ticket=abc123def456ghi789&app_id=A0');
      },
      onEvent: vi.fn(),
      backoffMs: [10],
      setTimer: (fn) => {
        timers.push(fn);
      },
    });
    await sm.start(); // opener rejects → warn #1
    const smOk = new SlackSocketMode({
      appToken: 'xapp-1-A0-secret9876543210',
      openConnection: () => Promise.resolve('wss://wss.slack.com/link?ticket=abc123def456ghi789&app_id=A0'),
      connect: () => {
        throw new Error('bad url wss://wss.slack.com/link?ticket=abc123def456ghi789&app_id=A0');
      },
      onEvent: vi.fn(),
      backoffMs: [10],
      setTimer: (fn) => {
        timers.push(fn);
      },
    });
    await smOk.start(); // ctor throws → warn #2
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const args of warnSpy.mock.calls) {
      const flat = JSON.stringify(args);
      expect(flat).not.toContain('xapp-1-A0-secret9876543210');
      expect(flat).not.toContain('ticket=abc123def456ghi789');
    }
    warnSpy.mockRestore();
  });
});
