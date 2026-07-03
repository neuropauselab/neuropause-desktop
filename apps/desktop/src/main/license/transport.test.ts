import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { createHttpLicenseTransport, LicenseTransportError } from './transport';

// config + authService import electron, which can't load under vitest. The transport
// takes injected deps in these tests, so these mocks only satisfy the static imports.
vi.mock('../config', () => ({ config: { backendUrl: 'http://test.local:4000' } }));
vi.mock('../auth/authService', () => ({
  authService: { getValidAccessToken: async () => null },
}));

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

const token = async (): Promise<string | null> => 'tok-123';

const sampleLicense = {
  orgId: 'org 1',
  snapshot: { planTier: 'pro', status: 'active', currentPeriodEnd: null, trialEndsAt: null },
  evaluation: {
    state: 'valid',
    reason: 'active',
    entitledPlan: 'pro',
    expiresAt: null,
    graceDaysRemaining: 0,
  },
  checkedAt: '2026-06-01T00:00:00.000Z',
};

describe('createHttpLicenseTransport', () => {
  it('GETs the license with the bearer token and an encoded org id', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const transport = createHttpLicenseTransport({
      baseUrl: 'http://api.test',
      getToken: token,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse(200, sampleLicense);
      },
    });

    const out = await transport.fetchLicense('org 1');
    expect(out).toEqual(sampleLicense);
    expect(calls[0].url).toBe('http://api.test/license/org%201');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('throws a typed http error with the backend code on a non-2xx response', async () => {
    const transport = createHttpLicenseTransport({
      baseUrl: 'http://api.test',
      getToken: token,
      fetchImpl: async () =>
        jsonResponse(403, { error: { code: 'not_member', message: 'Not a member.' } }),
    });

    const err = await transport.fetchLicense('org-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LicenseTransportError);
    expect(err).toMatchObject({ kind: 'http', status: 403, code: 'not_member' });
  });

  it('throws a typed network error when fetch rejects', async () => {
    const transport = createHttpLicenseTransport({
      baseUrl: 'http://api.test',
      getToken: token,
      fetchImpl: async () => {
        throw new Error('socket hang up');
      },
    });

    const err = await transport.fetchLicense('org-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LicenseTransportError);
    expect(err).toMatchObject({ kind: 'network' });
    expect((err as Error).message).toBe('socket hang up');
  });

  it('refuses without a session (not_authenticated, no request made)', async () => {
    let called = false;
    const transport = createHttpLicenseTransport({
      baseUrl: 'http://api.test',
      getToken: async () => null,
      fetchImpl: async () => {
        called = true;
        return jsonResponse(200, sampleLicense);
      },
    });

    const err = await transport.fetchLicense('org-1').catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'http', status: 401, code: 'not_authenticated' });
    expect(called).toBe(false);
  });
});
