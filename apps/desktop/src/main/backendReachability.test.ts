/**
 * P13C F-7 — the pre-authentication reachability channel, locked.
 *
 * F-7: the application knows its backend is unreachable and, since Round 10
 * removed `neurocore:systemHealth` and Round 11 removed `runtime:health` from
 * the public allowlist, has had no lawful way to say so before sign-in. The
 * repair is one narrow public channel. Its value is entirely in its narrowness,
 * so the narrowness is what this file tests — not that it "works".
 *
 * Every assertion below is a security property, and each names the regression it
 * would catch. Negative controls are recorded per block: revert the guard named
 * in the comment and that block must FAIL. A test that passes both ways proves
 * nothing, which is the mistake this program was convened over.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({ backendUrl: 'https://api.example.test' }));

vi.mock('./config', () => ({
  config: {
    get backendUrl() {
      return mockState.backendUrl;
    },
    isDev: true,
    oauthTimeoutMs: 1,
    accessTokenRefreshSkewMs: 1,
  },
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

import { PUBLIC_CHANNELS, RUNTIME_CHANNEL_PERMISSIONS } from './ipc/runtimeAuthz';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { BackendReachabilityRequest } from '@neuropause/shared';
import { RuntimeTelemetrySampler, classifyProbeError } from './runtimeTelemetry';

const CHANNEL = IpcChannel.BackendReachability;
const realFetch = globalThis.fetch;

/** Drive one probe with a stubbed fetch and read the public payload back. */
async function probeWith(
  impl: () => Promise<Response> | Promise<never>,
): Promise<ReturnType<RuntimeTelemetrySampler['reachability']>> {
  const sampler = new RuntimeTelemetrySampler(() => 1_700_000_000_000);
  globalThis.fetch = impl as unknown as typeof fetch;
  await sampler.probeBackend(0);
  return sampler.reachability();
}

beforeEach(() => {
  mockState.backendUrl = 'https://api.neuropause033.com';
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('F-7 · the payload cannot widen', () => {
  // NEGATIVE CONTROL: add any field to RuntimeTelemetrySampler.reachability()
  // — latency, the URL, a failure count — and this test fails.
  it('exposes EXACTLY three keys and no others', async () => {
    const payload = await probeWith(async () => new Response('{}', { status: 200 }));
    expect(Object.keys(payload).sort()).toEqual(['checkedAt', 'lastError', 'reachable']);
  });

  it('never contains the backend URL, host, or any topology detail', async () => {
    mockState.backendUrl = 'https://api.neuropause033.com';
    const cases = [
      await probeWith(async () => new Response('{}', { status: 200 })),
      await probeWith(async () => new Response('nope', { status: 503 })),
      await probeWith(async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 134.199.250.188:443'), {
          code: 'ECONNREFUSED',
        });
      }),
    ];
    for (const payload of cases) {
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain('neuropause033');
      expect(serialized).not.toContain('api.');
      expect(serialized).not.toContain('134.199');
      expect(serialized).not.toContain('443');
      // A URL scheme, not the substring 'http' — `lastError: "http_error"` is a
      // classification and legitimately contains it. The first draft of this
      // assertion did not make that distinction and failed on its own payload.
      expect(serialized).not.toContain('http://');
      expect(serialized).not.toContain('https://');
    }
  });

  it('carries no latency, no failure count, and nothing user- or org-shaped', async () => {
    const payload = await probeWith(async () => new Response('{}', { status: 200 }));
    const keys = Object.keys(payload).join(',').toLowerCase();
    for (const forbidden of ['latency', 'ms', 'count', 'fail', 'tenant', 'org', 'user', 'url']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('F-7 · reachability is probe-derived, never auth-derived', () => {
  // NEGATIVE CONTROL: change reachability() to read `backendState` and this
  // fails — which is the point. `setBackendState` is called after AUTH failures,
  // so a state-derived answer would leak "somebody's sign-in failed" to an
  // unauthenticated caller.
  it('a forced backendState does not move the public answer', async () => {
    const sampler = new RuntimeTelemetrySampler(() => 1_700_000_000_000);
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await sampler.probeBackend(0);
    expect(sampler.reachability().reachable).toBe(true);

    sampler.setBackendState('failed');
    expect(sampler.read().backendState).toBe('failed');
    // The public answer still reports what the PROBE saw.
    expect(sampler.reachability().reachable).toBe(true);
  });

  it('reports unreachable before any probe has run — never "fine by default"', () => {
    const sampler = new RuntimeTelemetrySampler(() => 1_700_000_000_000);
    expect(sampler.reachability()).toEqual({
      reachable: false,
      checkedAt: null,
      lastError: null,
    });
  });
});

describe('F-7 · failure classification is honest', () => {
  it('maps the founder’s actual failure — the 4000ms abort — to "timeout"', () => {
    expect(classifyProbeError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(
      'timeout',
    );
  });

  it('maps DNS, refusal and connect-timeout codes to their own buckets', () => {
    expect(classifyProbeError(Object.assign(new Error(''), { code: 'ENOTFOUND' }))).toBe('dns');
    expect(classifyProbeError(Object.assign(new Error(''), { code: 'EAI_AGAIN' }))).toBe('dns');
    expect(classifyProbeError(Object.assign(new Error(''), { code: 'ECONNREFUSED' }))).toBe(
      'refused',
    );
    expect(
      classifyProbeError({ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }),
    ).toBe('timeout');
  });

  it('returns null for an unrecognized failure rather than guessing a label', () => {
    expect(classifyProbeError(Object.assign(new Error('weird'), { code: 'EPROTO' }))).toBeNull();
    expect(classifyProbeError(null)).toBeNull();
    expect(classifyProbeError('a string')).toBeNull();
  });

  it('a non-2xx response is http_error, not a connection failure', async () => {
    const payload = await probeWith(async () => new Response('down', { status: 502 }));
    expect(payload).toMatchObject({ reachable: false, lastError: 'http_error' });
    expect(payload.checkedAt).not.toBeNull();
  });

  it('a healthy response clears the previous error', async () => {
    const sampler = new RuntimeTelemetrySampler(() => 1_700_000_000_000);
    globalThis.fetch = (async () => {
      throw Object.assign(new Error(''), { code: 'ECONNREFUSED' });
    }) as unknown as typeof fetch;
    await sampler.probeBackend(0);
    expect(sampler.reachability().lastError).toBe('refused');

    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await sampler.probeBackend(0);
    expect(sampler.reachability()).toMatchObject({ reachable: true, lastError: null });
  });
});

describe('F-7 · the authorization surface stays where Rounds 10 and 11 left it', () => {
  it('the reachability channel is public', () => {
    expect(PUBLIC_CHANNELS.has(CHANNEL)).toBe(true);
  });

  it('is NOT also gated — public-and-gated is the Round 10 contradiction', () => {
    expect(RUNTIME_CHANNEL_PERMISSIONS[CHANNEL]).toBeUndefined();
  });

  it('is invokable, so the classification invariant actually sees it', () => {
    expect(RUNTIME_INVOKABLE_CHANNELS).toContain(CHANNEL);
  });

  // The regression this whole finding is one step away from causing: someone
  // "fixes" F-7 the lazy way by putting the old channels back on the allowlist.
  it('neurocore:systemHealth is STILL not public (Round 10, NEW-M2)', () => {
    expect(PUBLIC_CHANNELS.has(IpcChannel.SystemHealthSnapshot)).toBe(false);
  });

  it('runtime:health is STILL not public (Round 11, M-1/M-2)', () => {
    expect(PUBLIC_CHANNELS.has(IpcChannel.RuntimeHealth)).toBe(false);
  });

  /**
   * A snapshot lock, not a slogan.
   *
   * The first version of this test asserted "exactly one health channel is
   * public" and failed immediately: three already were. They are legitimately
   * different things — two are renderer→main REPORTS (the renderer holds the
   * active org and pushes health INTO main; no health flows out) and one probes
   * the LOCAL AI engine, not the backend. Rather than delete the check or weaken
   * the regex until it agreed with me, the honest form is an explicit snapshot:
   * a fourth public channel with `health` in its name has to be added here
   * deliberately, with a reason, by whoever adds it.
   */
  it('the public health surface is exactly these four, and no more', () => {
    const healthish = [...PUBLIC_CHANNELS].filter((c) => /health|reachab/i.test(c)).sort();
    expect(healthish).toEqual(
      [
        IpcChannel.AiConfigHealth, // probes the LOCAL AI engine, not the backend
        IpcChannel.BackendReachability, // F-7, this file
        IpcChannel.DeviceReportHealth, // renderer → main report; nothing flows out
        IpcChannel.LicenseReportHealth, // renderer → main report; nothing flows out
      ].sort(),
    );
  });
});

describe('F-7 · the request schema rejects anything it does not know', () => {
  it('accepts an empty body and an explicit refresh', () => {
    expect(BackendReachabilityRequest.safeParse({}).success).toBe(true);
    expect(BackendReachabilityRequest.safeParse({ refresh: true }).success).toBe(true);
  });

  it('rejects unknown keys — strict, because this channel needs no auth', () => {
    expect(BackendReachabilityRequest.safeParse({ verbose: true }).success).toBe(false);
    expect(BackendReachabilityRequest.safeParse({ refresh: 'yes' }).success).toBe(false);
  });
});
