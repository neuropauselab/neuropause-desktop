/**
 * Thin client over the REAL backend auth surface (mounted at /auth):
 *   GET  /auth/providers                 list configured OAuth providers
 *   GET  /auth/:provider/start           begin an OAuth sign-in (browser redirect)
 *   GET  /auth/me                        current principal (requires auth)
 *   POST /auth/token, /auth/token/refresh, /auth/logout
 *   POST /auth/verify-email              { token }
 *   POST /auth/request-password-reset    { email }
 *   POST /auth/reset-password            { token, password }
 * No mocks: in dev these proxy to the running backend (see vite.config.ts).
 */
const TOKEN_KEY = 'np.web.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    if (res.status === 401) setToken(null); // expired/invalid — never keep a dead token around
    const body = await res.text().catch(() => '');
    let detail = '';
    try {
      detail = JSON.parse(body)?.error ?? JSON.parse(body)?.message ?? '';
    } catch {
      /* non-JSON body: omit raw content from surfaced errors */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${String(detail).slice(0, 120)}` : ''}`);
  }
  return (await res.json()) as T;
}

export interface ProviderInfo {
  id: string;
  name?: string;
}

export const auth = {
  providers: () => req<{ providers: ProviderInfo[] } | ProviderInfo[]>('/auth/providers'),
  startUrl: (provider: string) => `/auth/${encodeURIComponent(provider)}/start`,
  me: () => req<unknown>('/auth/me'),
  logout: async () => {
    try {
      await req<unknown>('/auth/logout', { method: 'POST' });
    } finally {
      setToken(null);
    }
  },
  verifyEmail: (token: string) =>
    req<unknown>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  requestPasswordReset: (email: string) =>
    req<unknown>('/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    req<unknown>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
};

export interface AuthResult {
  user: { id: string; email: string; displayName: string | null };
  tokens: { accessToken: string; refreshToken?: string };
}

export const emailAuth = {
  register: async (email: string, password: string): Promise<AuthResult> => {
    const r = await req<AuthResult>('/auth/email/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(r.tokens.accessToken);
    return r;
  },
  login: async (email: string, password: string): Promise<AuthResult> => {
    const r = await req<AuthResult>('/auth/email/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(r.tokens.accessToken);
    return r;
  },
};

export interface PilotStatus {
  enrollment: { id: string; state: string; startedAt: string } | null;
  consentVersion: string | null;
  day: number | null;
  day7Ready: boolean;
  eventCount: number;
}
export interface Day7Report {
  day: number;
  activeDays: number;
  eventCounts: Record<string, number>;
  feedback: Array<Record<string, unknown>>;
  crashes: string;
  osUsage: string;
  state: string;
}
export const pilot = {
  consent: (version: string) => req<unknown>('/pilot/consent', { method: 'POST', body: JSON.stringify({ version }) }),
  enroll: () => req<unknown>('/pilot/enroll', { method: 'POST' }),
  status: () => req<PilotStatus>('/pilot/status'),
  event: (eventType: string, metadata: Record<string, unknown> = {}) =>
    req<unknown>('/pilot/events', { method: 'POST', body: JSON.stringify({ eventType, metadata }) }),
  day7: () => req<Day7Report>('/pilot/day7'),
  decision: (targetState: string, decision: string, reason: string) =>
    req<unknown>('/pilot/decision', { method: 'POST', body: JSON.stringify({ targetState, decision, reason }) }),
};
