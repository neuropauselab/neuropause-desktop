/**
 * Typed client for the NeuroPause backend auth API. This is the *only* place
 * in the desktop app that performs network requests to the backend, and it
 * runs exclusively in the main process. Tokens never transit the renderer.
 */
import type { TokenPair, User } from '@neuropause/shared';
import { config } from '../config';

export class BackendError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
    this.code = code;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

interface AuthResult {
  user: User;
  tokens: TokenPair;
}

async function request<T>(
  path: string,
  init: { method: string; body?: unknown; accessToken?: string },
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.accessToken) headers.Authorization = `Bearer ${init.accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${config.backendUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    // Network-level failure (backend down, DNS, etc.).
    throw new BackendError(0, 'network_error', (err as Error).message || 'Network request failed');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;

  if (!res.ok) {
    const body = (json ?? {}) as ErrorBody;
    throw new BackendError(
      res.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? `Request failed with status ${res.status}`,
    );
  }

  return json as T;
}

export const backendClient = {
  getProviders(): Promise<{ providers: string[] }> {
    return request('/auth/providers', { method: 'GET' });
  },

  exchangeOAuthCode(code: string, codeVerifier: string): Promise<AuthResult> {
    return request('/auth/token', {
      method: 'POST',
      body: { code, code_verifier: codeVerifier },
    });
  },

  registerEmail(email: string, password: string): Promise<AuthResult> {
    return request('/auth/email/register', { method: 'POST', body: { email, password } });
  },

  loginEmail(email: string, password: string): Promise<AuthResult> {
    return request('/auth/email/login', { method: 'POST', body: { email, password } });
  },

  refresh(refreshToken: string): Promise<{ tokens: TokenPair }> {
    return request('/auth/token/refresh', { method: 'POST', body: { refreshToken } });
  },

  logout(refreshToken: string): Promise<void> {
    return request('/auth/logout', { method: 'POST', body: { refreshToken } });
  },

  me(accessToken: string): Promise<{ user: User }> {
    return request('/auth/me', { method: 'GET', accessToken });
  },
};
