import { describe, it, expect, beforeEach, vi } from 'vitest';

// Keep logs quiet and decouple from real process.env.
vi.mock('../config/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../config/env', () => ({
  loadEnv: () => ({ ALERT_WEBHOOK_URL: undefined, ALERT_WEBHOOK_TIMEOUT_MS: 5000 }),
}));

import {
  buildAlertPayload,
  postAlertToWebhook,
  installWebhookAlertSink,
} from './alertWebhookSink';
import { reportComponentHealth, resetHealthAlerts, type HealthAlert } from './healthAlerts';
import { resetMetrics } from './metrics';

const downAlert: HealthAlert = { component: 'redis', state: 'down', at: '2026-07-24T00:00:00.000Z' };
const upAlert: HealthAlert = { component: 'database', state: 'up', at: '2026-07-24T00:01:00.000Z' };

/** A fetch double that records calls and returns a controllable Response. */
function fakeFetch(response: { ok: boolean; status: number } | Error) {
  return vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response as unknown as Response;
  }) as unknown as typeof fetch & { mock: { calls: unknown[][] } };
}

describe('alertWebhookSink (NEEO — webhook alert routing)', () => {
  beforeEach(() => {
    resetHealthAlerts();
    resetMetrics();
  });

  describe('buildAlertPayload', () => {
    it('renders a secret-free DOWN payload with a human-readable text', () => {
      const p = buildAlertPayload(downAlert);
      expect(p).toEqual({
        source: 'neuropause-backend',
        component: 'redis',
        state: 'down',
        at: '2026-07-24T00:00:00.000Z',
        text: 'NeuroPause: dependency "redis" is DOWN (2026-07-24T00:00:00.000Z)',
      });
    });

    it('renders a recovery payload for UP', () => {
      const p = buildAlertPayload(upAlert);
      expect(p.state).toBe('up');
      expect(p.text).toMatch(/has recovered/);
    });
  });

  describe('postAlertToWebhook', () => {
    it('POSTs JSON and resolves true on a 2xx', async () => {
      const f = fakeFetch({ ok: true, status: 200 });
      const ok = await postAlertToWebhook('https://hook.example/x', downAlert, { fetchImpl: f });
      expect(ok).toBe(true);
      expect(f).toHaveBeenCalledTimes(1);
      const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
      expect(url).toBe('https://hook.example/x');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
      const body = JSON.parse(init.body as string);
      expect(body.component).toBe('redis');
      expect(body.state).toBe('down');
    });

    it('resolves false (never throws) on a non-2xx', async () => {
      const f = fakeFetch({ ok: false, status: 500 });
      await expect(
        postAlertToWebhook('https://hook.example/x', downAlert, { fetchImpl: f }),
      ).resolves.toBe(false);
    });

    it('resolves false (never throws) on a network error', async () => {
      const f = fakeFetch(new Error('ECONNREFUSED'));
      await expect(
        postAlertToWebhook('https://hook.example/x', downAlert, { fetchImpl: f }),
      ).resolves.toBe(false);
    });
  });

  describe('installWebhookAlertSink', () => {
    it('is a no-op (returns false) when no URL is configured', () => {
      expect(installWebhookAlertSink()).toBe(false);
    });

    it('installs a sink that POSTs on a health transition when a URL is given', async () => {
      const f = fakeFetch({ ok: true, status: 200 });
      const installed = installWebhookAlertSink({
        url: 'https://hook.example/alerts',
        timeoutMs: 50,
        fetchImpl: f,
      });
      expect(installed).toBe(true);

      reportComponentHealth('redis', 'up'); // baseline — silent, no post
      expect(f).not.toHaveBeenCalled();

      reportComponentHealth('redis', 'down'); // transition — fires the sink
      // The fetch call is issued synchronously inside the sink; let the
      // fire-and-forget promise settle so its timer is cleared.
      await new Promise((r) => setTimeout(r, 0));

      expect(f).toHaveBeenCalledTimes(1);
      const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
      expect(url).toBe('https://hook.example/alerts');
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({ component: 'redis', state: 'down', source: 'neuropause-backend' });
    });
  });
});
