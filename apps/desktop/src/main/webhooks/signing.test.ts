/** P3.0 — webhook HMAC signing tests (timestamped `t=,v1=` scheme, SDK-compatible). */
import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhook } from './signing';

describe('webhook signing', () => {
  it('signs in the t=,v1= format and verifies within tolerance', () => {
    const body = JSON.stringify({ deliveryId: 'd1', event: { type: 'x' } });
    const sig = signWebhook('whsec_abc', body, 1_000_000);
    expect(sig).toMatch(/^t=1000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhook('whsec_abc', body, sig, 5 * 60_000, 1_000_000)).toBe(true);
  });

  it('rejects a wrong secret, tampered body, and stale timestamp', () => {
    const body = '{"a":1}';
    const sig = signWebhook('whsec_abc', body, 1_000_000);
    expect(verifyWebhook('whsec_other', body, sig, 5 * 60_000, 1_000_000)).toBe(false);
    expect(verifyWebhook('whsec_abc', '{"a":2}', sig, 5 * 60_000, 1_000_000)).toBe(false);
    expect(verifyWebhook('whsec_abc', body, sig, 5 * 60_000, 1_000_000 + 10 * 60_000)).toBe(false); // stale
    expect(verifyWebhook('whsec_abc', body, 'garbage', 5 * 60_000, 1_000_000)).toBe(false);
  });
});
