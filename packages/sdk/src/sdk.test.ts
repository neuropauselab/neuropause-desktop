import { describe, expect, it } from 'vitest';
import { NeuroPauseClient } from './client';
import { signWebhook, verifyWebhook, parseWebhook } from './webhooks';
import { defineWorker, defineConnector } from './builders';
import type { Transport, TransportRequest, TransportResponse } from './transport';

class MockTransport implements Transport {
  calls: TransportRequest[] = [];
  constructor(private readonly canned: unknown = []) {}
  async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
    this.calls.push(req);
    return { status: 200, data: this.canned as T, headers: {} };
  }
}

describe('NeuroPauseClient', () => {
  it('routes marketplace.list to the right path + scope', async () => {
    const t = new MockTransport([{ id: 'lst_1' }]);
    const np = new NeuroPauseClient({ transport: t });
    const out = await np.marketplace.list();
    expect(out).toEqual([{ id: 'lst_1' }]);
    expect(t.calls[0]).toMatchObject({ method: 'GET', path: '/marketplace/listings', scope: 'marketplace:read' });
  });

  it('routes a version publish with the manifest body', async () => {
    const t = new MockTransport({ id: 'ver_1' });
    const np = new NeuroPauseClient({ transport: t });
    const manifest = defineConnector({ name: 'C', version: '1.0.0', entry: 'c.js' }).toManifest();
    await np.marketplace.publishVersion('lst_1', manifest, 'init');
    expect(t.calls[0]).toMatchObject({ method: 'POST', path: '/marketplace/listings/lst_1/versions', scope: 'marketplace:publish' });
    expect((t.calls[0].body as { manifest: unknown }).manifest).toEqual(manifest);
  });
});

describe('webhooks', () => {
  it('signs and verifies a payload', () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'listing.published', createdAt: '2026-06-29T00:00:00.000Z', data: {} });
    const header = signWebhook(payload, 'whsec_test');
    expect(verifyWebhook(payload, header, 'whsec_test')).toBe(true);
    expect(parseWebhook(payload).type).toBe('listing.published');
  });

  it('rejects a tampered payload and a wrong secret', () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'x', createdAt: '', data: {} });
    const header = signWebhook(payload, 'whsec_test');
    expect(verifyWebhook(payload + 'x', header, 'whsec_test')).toBe(false);
    expect(verifyWebhook(payload, header, 'whsec_wrong')).toBe(false);
  });

  it('rejects an expired timestamp', () => {
    const payload = '{}';
    const header = signWebhook(payload, 'whsec_test', Date.now() - 10 * 60_000);
    expect(verifyWebhook(payload, header, 'whsec_test')).toBe(false);
  });
});

describe('builders', () => {
  it('builds a valid worker manifest', () => {
    const def = defineWorker({ name: 'Analyst', version: '1.0.0', entry: 'worker.js', permissions: ['workers:read'], role: 'research' });
    expect(def.manifest.kind).toBe('ai_worker');
    expect(def.manifest.metadata.role).toBe('research');
    expect(def.manifest.capabilities).toContain('summarize');
  });

  it('throws when the entry point is missing', () => {
    expect(() => defineWorker({ name: 'X', version: '1.0.0', entry: '' })).toThrow(/entry/i);
  });
});
