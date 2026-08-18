/**
 * P13C ROUND 33 — the first direct tests for `authService`.
 *
 * Every prior round's session-loss defect lived in this file precisely because
 * nothing tested it: the three fixed here are
 *
 *   1. a transient NETWORK failure during token refresh deleted the vault and
 *      signed the user out (~14 min after any sign-in, offline);
 *   2. `restoreSession`'s retry re-sent an already-CONSUMED refresh token,
 *      which the backend treats as theft (`refresh_reused`) and answers by
 *      revoking every session the user has, on every device;
 *   3. concurrent expired-token calls each POSTed the same refresh token — the
 *      second one tripped the same reuse detector. Refresh is single-flight.
 *
 * The backend client and secure store are mocked at the module boundary; the
 * service under test is the real one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Tokens {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
}

const { mockState, MockBackendError } = vi.hoisted(() => {
  class MockBackendError extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  }
  return {
    MockBackendError,
    mockState: {
      stored: null as string | null,
      refreshCalls: [] as string[],
      refreshImpl: null as null | ((token: string) => { tokens: Tokens }),
      meImpl: null as null | (() => { user: { id: string; email: string; displayName: string } }),
    },
  };
});

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  // `config.ts` → `buildInfo.ts` reach these at module scope.
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
    isPackaged: false,
    getVersion: () => '0.0.0-test',
  },
}));

vi.mock('../security/secureStore', () => ({
  secureStore: {
    getRefreshToken: async () => mockState.stored,
    setRefreshToken: async (t: string) => {
      mockState.stored = t;
    },
    clear: async () => {
      mockState.stored = null;
    },
  },
}));

vi.mock('./backendClient', () => ({
  BackendError: MockBackendError,
  backendClient: {
    refresh: async (token: string) => {
      mockState.refreshCalls.push(token);
      if (!mockState.refreshImpl) throw new MockBackendError(401, 'invalid_grant');
      return mockState.refreshImpl(token);
    },
    me: async () => {
      if (!mockState.meImpl) throw new MockBackendError(0, 'network_error');
      return mockState.meImpl();
    },
  },
}));

vi.mock('./loopbackServer', () => ({ startLoopbackServer: vi.fn() }));

// S17/FG-6: the device-local principal store, mocked so restoreSession's
// no-token branch enters local mode without touching the real filesystem.
vi.mock('./localPrincipalStore', () => ({
  localPrincipalStore: {
    loadOrCreate: async () => ({ id: 'device-1', displayName: 'Local User', createdAt: '2026-08-18T00:00:00.000Z' }),
  },
}));

import { authService } from './authService';

const USER = { id: 'u1', email: 'a@example.test', displayName: 'A' };
const rotated = (n: number): { tokens: Tokens } => ({
  tokens: {
    accessToken: `access-${n}`,
    accessTokenExpiresAt: Date.now() + 900_000,
    refreshToken: `refresh-${n}`,
  },
});

beforeEach(() => {
  mockState.stored = null;
  mockState.refreshCalls = [];
  mockState.refreshImpl = null;
  mockState.meImpl = null;
  // Reset the singleton's in-memory token state via logout (backend absent —
  // best-effort revoke fails silently, local state clears).
  return authService.logout().then(() => {
    mockState.stored = null;
    mockState.refreshCalls = [];
  });
});

describe('round 33 — network failure does not destroy credentials', () => {
  it('keeps the stored refresh token when refresh fails with a network error', async () => {
    mockState.stored = 'refresh-valid';
    mockState.refreshImpl = () => {
      throw new MockBackendError(0, 'network_error');
    };
    const token = await authService.getValidAccessToken();
    expect(token).toBeNull();
    // The vault survives — the session can restore when connectivity returns.
    expect(mockState.stored).toBe('refresh-valid');
  });

  it('clears the vault on a genuine rejection', async () => {
    mockState.stored = 'refresh-revoked';
    mockState.refreshImpl = () => {
      throw new MockBackendError(401, 'invalid_grant');
    };
    const token = await authService.getValidAccessToken();
    expect(token).toBeNull();
    expect(mockState.stored).toBeNull();
  });
});

describe('round 33 — restoreSession never re-sends a consumed token', () => {
  it('retries only me() after a successful rotation; the old token is sent once', async () => {
    mockState.stored = 'refresh-original';
    let refreshes = 0;
    mockState.refreshImpl = () => {
      refreshes += 1;
      return rotated(refreshes);
    };
    // me() fails on the first two attempts (the boot race), then succeeds.
    let meCalls = 0;
    mockState.meImpl = () => {
      meCalls += 1;
      if (meCalls < 3) throw new MockBackendError(0, 'network_error');
      return { user: USER };
    };

    await authService.restoreSession();

    expect(refreshes).toBe(1); // the rotation happened exactly once
    expect(mockState.refreshCalls).toEqual(['refresh-original']);
    expect(mockState.stored).toBe('refresh-1'); // rotated token persisted
    expect(authService.getStatus().state).toBe('authenticated');
  }, 15_000);
});

describe('round 33 — refresh is single-flight', () => {
  it('concurrent callers share one refresh; the token is POSTed once', async () => {
    mockState.stored = 'refresh-a';
    let refreshes = 0;
    mockState.refreshImpl = () => {
      refreshes += 1;
      return rotated(refreshes);
    };
    const [t1, t2, t3] = await Promise.all([
      authService.getValidAccessToken(),
      authService.getValidAccessToken(),
      authService.getValidAccessToken(),
    ]);
    expect(refreshes).toBe(1);
    expect(t1).toBe('access-1');
    expect(t2).toBe('access-1');
    expect(t3).toBe('access-1');
  });
});

describe('S17/FG-6 — local-first (no cloud account)', () => {
  it('enterLocalMode flips status to local with a stable principal', async () => {
    const s = await authService.enterLocalMode();
    expect(s.state).toBe('local');
    if (s.state === 'local') {
      expect(s.principal.id).toBe('device-1');
      expect(s.principal.displayName).toBe('Local User');
    }
    expect(authService.getStatus().state).toBe('local');
  });

  it('restoreSession with no stored token enters local mode — NOT the sign-in wall', async () => {
    mockState.stored = null;
    await authService.restoreSession();
    expect(authService.getStatus().state).toBe('local');
  });

  it('restoreSession WITH a valid stored token still authenticates (local mode is only the no-account path)', async () => {
    mockState.stored = 'refresh-0';
    mockState.refreshImpl = () => rotated(1);
    mockState.meImpl = () => ({ user: USER });
    await authService.restoreSession();
    expect(authService.getStatus().state).toBe('authenticated');
  });
});
