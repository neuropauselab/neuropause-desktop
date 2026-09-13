import { describe, expect, it } from 'vitest';
import { isTransientBackendFailure } from './backendFailure';
const BackendError = class extends Error { constructor(readonly status: number, readonly code: string, m: string) { super(m); this.name = 'BackendError'; } };

describe('NP-GLOBAL-PUBLIC-LAUNCH-002 — transient backend failures do not clear credentials', () => {
  it('classifies network, 429, 5xx and Cloudflare 52x/53x as transient', () => {
    expect(isTransientBackendFailure(new BackendError(0, 'network_error', 'x'))).toBe(true);
    for (const s of [429, 500, 502, 503, 504, 520, 522, 530]) expect(isTransientBackendFailure(new BackendError(s, 'http_error', 'x'))).toBe(true);
  });
  it('classifies genuine 4xx rejections as rejections', () => {
    for (const s of [400, 401, 403, 404]) expect(isTransientBackendFailure(new BackendError(s, 'invalid_token', 'x'))).toBe(false);
    expect(isTransientBackendFailure(new Error('plain'))).toBe(false);
  });
});
