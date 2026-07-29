import { describe, it, expect } from 'vitest';
import { ManualClock } from '../../lib/clock';
import { isErr, isOk } from '../../lib/result';
import { RequestSigner } from './requestSigner';

const SECRET = 'test-only-secret-test-only-secret-0123456789';

describe('RequestSigner (zero-trust API signing)', () => {
  it('signs and verifies within the replay window', () => {
    const clock = new ManualClock(10_000);
    const signer = new RequestSigner(SECRET, clock);
    const { signature, timestamp } = signer.sign('POST', '/v1/sync', '{"kind":"timeline"}');
    expect(isOk(signer.verify('POST', '/v1/sync', '{"kind":"timeline"}', signature, timestamp))).toBe(true);
  });

  it('rejects a modified body and a stale timestamp', () => {
    const clock = new ManualClock(10_000);
    const signer = new RequestSigner(SECRET, clock, { toleranceMs: 1000 });
    const { signature, timestamp } = signer.sign('POST', '/v1/sync', '{"kind":"timeline"}');
    expect(isErr(signer.verify('POST', '/v1/sync', '{"kind":"TAMPERED"}', signature, timestamp))).toBe(true);
    clock.advance(5000);
    const stale = signer.verify('POST', '/v1/sync', '{"kind":"timeline"}', signature, timestamp);
    expect(isErr(stale)).toBe(true);
    if (isErr(stale)) expect(stale.error.code).toBe('stale');
  });
});
