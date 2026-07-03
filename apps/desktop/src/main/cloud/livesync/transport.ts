/**
 * The HTTP implementation of SyncTransport — calls the backend sync API
 * (POST /sync/:orgId/push, GET /sync/:orgId/pull) with the authenticated cloud
 * session. Errors are typed so the engine's classifier can tell a network failure
 * (offline) from an HTTP error (retryable 5xx vs non-retryable 4xx).
 *
 * Dependencies (base URL, token getter, fetch) are injected with real defaults, so
 * the transport is unit-testable without module mocking.
 */
import type {
  SyncChange,
  SyncEntityType,
  SyncPullResponse,
  SyncPushResponse,
} from '@neuropause/shared';
import { config } from '../../config';
import { authService } from '../../auth/authService';
import type { SyncTransport } from './types';

export class SyncTransportError extends Error {
  readonly status?: number;
  readonly kind: 'network' | 'http';
  readonly code?: string;
  constructor(message: string, opts: { status?: number; kind: 'network' | 'http'; code?: string }) {
    super(message);
    this.name = 'SyncTransportError';
    this.status = opts.status;
    this.kind = opts.kind;
    this.code = opts.code;
  }
}

export interface HttpSyncTransportDeps {
  baseUrl?: string;
  getToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
}

function buildQuery(query: Record<string, string | undefined> | undefined): string {
  if (!query) return '';
  const parts = Object.entries(query)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export function createHttpSyncTransport(deps: HttpSyncTransportDeps = {}): SyncTransport {
  const baseUrl = deps.baseUrl ?? config.backendUrl;
  const getToken = deps.getToken ?? (() => authService.getValidAccessToken());
  const doFetch = deps.fetchImpl ?? fetch;

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const token = await getToken();
    if (!token) {
      throw new SyncTransportError('Sign in to sync.', {
        status: 401,
        kind: 'http',
        code: 'not_authenticated',
      });
    }
    headers.Authorization = `Bearer ${token}`;

    const url = `${baseUrl}/sync${path}${buildQuery(options.query)}`;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      throw new SyncTransportError((err as Error).message || 'Network request failed', {
        kind: 'network',
      });
    }

    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const body = (json ?? {}) as { error?: { code?: string; message?: string } };
      throw new SyncTransportError(
        body.error?.message ?? `Request failed with status ${res.status}`,
        { status: res.status, kind: 'http', code: body.error?.code },
      );
    }
    return json as T;
  }

  return {
    push(orgId: string, deviceId: string, changes: SyncChange[]): Promise<SyncPushResponse> {
      return request<SyncPushResponse>(`/${encodeURIComponent(orgId)}/push`, {
        method: 'POST',
        body: { deviceId, changes },
      });
    },
    pull(
      orgId: string,
      cursor: number,
      opts: { deviceId: string; limit?: number; entityTypes?: SyncEntityType[] },
    ): Promise<SyncPullResponse> {
      return request<SyncPullResponse>(`/${encodeURIComponent(orgId)}/pull`, {
        query: {
          cursor: String(cursor),
          deviceId: opts.deviceId,
          limit: opts.limit !== undefined ? String(opts.limit) : undefined,
          entityTypes:
            opts.entityTypes && opts.entityTypes.length > 0
              ? opts.entityTypes.join(',')
              : undefined,
        },
      });
    },
  };
}
