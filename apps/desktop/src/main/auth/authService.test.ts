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

describe('P13C GATE 1 — no backend-dependent sign-in dead end', () => {
  /**
   * THE OFFLINE-RETURNING-USER WALL. A user who previously connected a cloud
   * account launches with the backend unreachable. `restoreSession` used to set
   * `unauthenticated` here, and `App.tsx` renders that fallback as `LoginScreen`
   * with NO `onDismiss` — an escape-less sign-in wall, reached with no server.
   *
   * The fix degrades to the device-local principal instead: cloud is absent
   * right now, which is exactly S17's no-reachable-account case. The status must
   * be `local` (the full shell, with a "connect an account" affordance), NOT
   * `unauthenticated`.
   */
  it('a network failure across every attempt enters local mode, not the wall', async () => {
    mockState.stored = 'refresh-offline';
    mockState.refreshImpl = () => {
      throw new MockBackendError(0, 'network_error');
    };
    await authService.restoreSession();
    expect(authService.getStatus().state).toBe('local');
    expect(authService.getStatus().state).not.toBe('unauthenticated');
  }, 15_000);

  it('DEGRADING TO LOCAL DOES NOT CLEAR THE VAULT — the cloud session restores later', async () => {
    // Fail-closed AND recoverable: the refresh token is untouched, so a later
    // online launch (or the in-shell connect affordance) restores the account.
    mockState.stored = 'refresh-keep';
    mockState.refreshImpl = () => {
      throw new MockBackendError(0, 'network_error');
    };
    await authService.restoreSession();
    expect(authService.getStatus().state).toBe('local');
    expect(mockState.stored).toBe('refresh-keep');
  }, 15_000);

  it('a GENUINE auth rejection still clears and does NOT fall back to local — local is the OFFLINE answer only', async () => {
    // The discriminating negative: local fallback must not swallow a real
    // credential rejection. An invalid/revoked token clears the vault and lands
    // on `unauthenticated` (re-authenticate), never silently drops to local.
    mockState.stored = 'refresh-revoked';
    mockState.refreshImpl = () => {
      throw new MockBackendError(401, 'invalid_grant');
    };
    await authService.restoreSession();
    expect(authService.getStatus().state).toBe('unauthenticated');
    expect(mockState.stored).toBeNull();
  });

  /**
   * F-4 RETIREMENT. The certification blocker was "a fresh install opens on a
   * sign-in screen and cannot reach the product." On this branch a fresh
   * profile has no stored token, so `restoreSession` enters local mode and the
   * product is reachable with no backend. Pinned so a regression re-opens F-4
   * loudly rather than silently.
   */
  it('F-4 — a fresh install (no stored token, backend never contacted) reaches local mode', async () => {
    mockState.stored = null;
    // No refreshImpl / meImpl: the backend is never even called on this path.
    await authService.restoreSession();
    expect(mockState.refreshCalls).toEqual([]); // proves the backend was not contacted
    expect(authService.getStatus().state).toBe('local');
  });
});

describe('P13C GATE 2 — re-restore on reachability recovery', () => {
  /**
   * THE MISSING HALF. The offline-returning user degrades to local mode with a
   * valid token (the Gate-1 fix above). Nothing used to re-attempt the cloud
   * restore when the backend came back, so they stayed local for the whole
   * session. `retryCloudRestore` closes that — wired to the backend-reachable
   * edge — while staying fail-closed and never re-sending the rotating token.
   */

  it('SINGLE-FLIGHT: two concurrent restoreSession calls POST the rotating token exactly ONCE (no refresh_reused)', async () => {
    // Without the guard, the second overlapping restore re-sends the consumed
    // token — which the backend treats as theft and answers by revoking every
    // session on every device. This is the security regression this guard exists
    // for, and it becomes reachable the moment a runtime re-restore trigger exists.
    mockState.stored = 'refresh-concurrent';
    let refreshes = 0;
    mockState.refreshImpl = () => {
      refreshes += 1;
      return rotated(refreshes);
    };
    mockState.meImpl = () => ({ user: USER });
    await Promise.all([authService.restoreSession(), authService.restoreSession()]);
    expect(refreshes).toBe(1);
    expect(mockState.refreshCalls).toEqual(['refresh-concurrent']); // POSTed once
    expect(authService.getStatus().state).toBe('authenticated');
  });

  it('recovers a degraded local session: backend reachable again → local promotes to authenticated', async () => {
    // Precondition: the exact offline-degraded state (local + a stored token).
    mockState.stored = 'refresh-offline';
    await authService.enterLocalMode();
    expect(authService.getStatus().state).toBe('local');
    // Connectivity returns; the reachable edge fires retryCloudRestore.
    mockState.refreshImpl = () => rotated(1);
    mockState.meImpl = () => ({ user: USER });
    await authService.retryCloudRestore();
    expect(authService.getStatus().state).toBe('authenticated');
    expect(mockState.stored).toBe('refresh-1'); // rotated token persisted
  });

  it('END-TO-END: offline launch degrades to local, then a reachable edge restores the cloud session', async () => {
    mockState.stored = 'refresh-e2e';
    mockState.refreshImpl = () => {
      throw new MockBackendError(0, 'network_error');
    };
    await authService.restoreSession(); // offline across all retries → local, token kept
    expect(authService.getStatus().state).toBe('local');
    expect(mockState.stored).toBe('refresh-e2e');
    // Backend comes back.
    mockState.refreshImpl = () => rotated(1);
    mockState.meImpl = () => ({ user: USER });
    await authService.retryCloudRestore();
    expect(authService.getStatus().state).toBe('authenticated');
  }, 15_000);

  it('NO-OP when already authenticated — never re-POSTs the token from a live session', async () => {
    mockState.stored = 'refresh-auth';
    mockState.refreshImpl = () => rotated(1);
    mockState.meImpl = () => ({ user: USER });
    await authService.restoreSession();
    expect(authService.getStatus().state).toBe('authenticated');
    const callsBefore = mockState.refreshCalls.length;
    await authService.retryCloudRestore();
    expect(authService.getStatus().state).toBe('authenticated');
    expect(mockState.refreshCalls.length).toBe(callsBefore); // no extra POST
  });

  it('NO-OP for a genuine local-first user (local, NO token) — the backend is never contacted', async () => {
    mockState.stored = null;
    await authService.enterLocalMode();
    await authService.retryCloudRestore();
    expect(mockState.refreshCalls).toEqual([]);
    expect(authService.getStatus().state).toBe('local');
  });

  it('a network error during re-restore STAYS local and keeps the token (waits for the next edge)', async () => {
    mockState.stored = 'refresh-flap';
    await authService.enterLocalMode();
    mockState.refreshImpl = () => {
      throw new MockBackendError(0, 'network_error');
    };
    await authService.retryCloudRestore();
    expect(authService.getStatus().state).toBe('local'); // never walled
    expect(mockState.stored).toBe('refresh-flap'); // token preserved
  });

  it('a GENUINE rejection during re-restore clears the dead token but STAYS local — never an escape-less wall', async () => {
    // The reverse-wall guard: a background reachability probe must never convert
    // a working local session into the escape-less sign-in screen. The invalid
    // token is cleared (so it is not retried forever) but the app stays local.
    mockState.stored = 'refresh-revoked';
    await authService.enterLocalMode();
    mockState.refreshImpl = () => {
      throw new MockBackendError(401, 'invalid_grant');
    };
    await authService.retryCloudRestore();
    expect(authService.getStatus().state).toBe('local');
    expect(authService.getStatus().state).not.toBe('unauthenticated'); // NOT the wall
    expect(mockState.stored).toBeNull(); // dead token cleared
  });

  it('concurrent retryCloudRestore calls share one run — the token is POSTed once', async () => {
    mockState.stored = 'refresh-race';
    await authService.enterLocalMode();
    let refreshes = 0;
    mockState.refreshImpl = () => {
      refreshes += 1;
      return rotated(refreshes);
    };
    mockState.meImpl = () => ({ user: USER });
    await Promise.all([authService.retryCloudRestore(), authService.retryCloudRestore()]);
    expect(refreshes).toBe(1);
    expect(authService.getStatus().state).toBe('authenticated');
  });
});
