/** P3.0 Increment 4 — webhook HMAC signing tests. */
import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhook } from './signing';

describe('webhook signing', () => {
  it('signs deterministically and verifies', () => {
    const body = JSON.stringify({ deliveryId: 'd1', event: { type: 'x' } });
    const sig = signWebhook('whsec_abc', body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhook('whsec_abc', body, sig)).toBe(true);
  });

  it('rejects a wrong secret or tampered body', () => {
    const body = '{"a":1}';
    const sig = signWebhook('whsec_abc', body);
    expect(verifyWebhook('whsec_other', body, sig)).toBe(false);
    expect(verifyWebhook('whsec_abc', '{"a":2}', sig)).toBe(false);
    expect(verifyWebhook('whsec_abc', body, 'sha256=deadbeef')).toBe(false);
  });
});
