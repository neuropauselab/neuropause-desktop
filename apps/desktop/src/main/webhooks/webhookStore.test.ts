/** P3.0 Increment 10 — WebhookStore SSRF guard at registration. */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WebhookStore } from './webhookStore';

let seq = 0;
async function tempStore(): Promise<WebhookStore> {
  seq += 1;
  const store = new WebhookStore(join(tmpdir(), `whs-${Date.now()}-${seq}.json`));
  await store.load();
  return store;
}

describe('WebhookStore.create SSRF guard', () => {
  it('rejects non-https and internal targets', async () => {
    const s = await tempStore();
    const sub = { categories: [], types: [] };
    expect(() => s.create('a', 'http://hooks.example.com/x', sub)).toThrow(/https/);
    expect(() => s.create('a', 'https://localhost/x', sub)).toThrow(/rejected/);
    expect(() => s.create('a', 'https://127.0.0.1/x', sub)).toThrow(/rejected/);
    expect(() => s.create('a', 'https://169.254.169.254/latest', sub)).toThrow(/rejected/);
    expect(s.list()).toHaveLength(0);
  });

  it('accepts a public https endpoint and returns a secret once', async () => {
    const s = await tempStore();
    const { webhook, secret } = s.create('a', 'https://hooks.example.com/x', { categories: ['enterprise'], types: [] });
    expect(webhook.url).toBe('https://hooks.example.com/x');
    expect(secret.startsWith('whsec_')).toBe(true);
    expect(s.list()[0]).not.toHaveProperty('secret');
  });
});
