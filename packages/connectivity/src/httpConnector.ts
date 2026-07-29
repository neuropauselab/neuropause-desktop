/**
 * The transport base every SaaS adapter (Modules 4–9) is built on. It reuses the
 * integrations `HttpClient` seam (inject `FakeHttpClient` in tests, `FetchHttpClient`
 * in production — adapters NEVER touch fetch) and the integrations reliability
 * primitives (`withRetry` + retryable-status classification). No new HTTP layer, no
 * new retry logic: this is a thin, typed ergonomic wrapper over what already exists.
 */
import { RateLimiter, type Clock } from '@neuropause/cloud-core';
import {
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  withRetry,
  DEFAULT_RETRY,
  isRetryableStatus,
  HttpError,
} from '@neuropause/integrations';

export interface TransportOptions {
  baseUrl: string;
  token?: string;
  /** header name for token; default Authorization: Bearer <token>. */
  authHeader?: string;
  authScheme?: string;
  headers?: Record<string, string>;
  rateLimit?: { capacity: number; refillPerSec: number };
  clock?: Clock;
}

export interface TransportRequest {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: string;
}

/** Typed, retrying request path over the one HttpClient. */
export class Transport {
  private readonly limiter?: RateLimiter;

  constructor(
    private readonly http: HttpClient,
    private readonly opts: TransportOptions,
  ) {
    if (opts.rateLimit && opts.clock) this.limiter = new RateLimiter(opts.clock, opts.rateLimit);
  }

  private authHeaders(): Record<string, string> {
    if (!this.opts.token) return { ...(this.opts.headers ?? {}) };
    const name = this.opts.authHeader ?? 'Authorization';
    const scheme = this.opts.authScheme ?? 'Bearer';
    const value = scheme ? `${scheme} ${this.opts.token}` : this.opts.token;
    return { [name]: value, ...(this.opts.headers ?? {}) };
  }

  private buildUrl(path: string, query?: TransportRequest['query']): string {
    const base = path.startsWith('http') ? path : this.opts.baseUrl + path;
    if (!query) return base;
    const parts = Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    if (parts.length === 0) return base;
    return base + (base.includes('?') ? '&' : '?') + parts.join('&');
  }

  async send(req: TransportRequest): Promise<HttpResponse> {
    if (this.limiter && !this.limiter.allow(this.opts.baseUrl)) {
      throw new Error(`rate limit exceeded for ${this.opts.baseUrl}`);
    }
    const url = this.buildUrl(req.path, req.query);
    const request: HttpRequest = {
      method: req.method,
      url,
      headers: { Accept: 'application/json', ...this.authHeaders(), ...(req.headers ?? {}) },
      ...(req.body !== undefined ? { body: req.body } : {}),
    };
    return withRetry(
      async () => {
        const r = await this.http.send(request);
        if (!r.ok && isRetryableStatus(r.status)) throw new HttpError(r.status, r.body);
        return r;
      },
      {
        policy: DEFAULT_RETRY,
        shouldRetry: (e) => e instanceof HttpError && isRetryableStatus(e.status),
        sleep: async () => {},
      },
    );
  }

  async getJson<T>(path: string, query?: TransportRequest['query']): Promise<T> {
    const r = await this.send({ method: 'GET', path, ...(query ? { query } : {}) });
    if (!r.ok) throw new HttpError(r.status, r.body, `GET ${path} → ${r.status}`);
    return JSON.parse(r.body || 'null') as T;
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const r = await this.send({ method: 'POST', path, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) throw new HttpError(r.status, r.body, `POST ${path} → ${r.status}`);
    return JSON.parse(r.body || 'null') as T;
  }
}

/** Base class for the SaaS provider adapters. */
export abstract class HttpConnector {
  protected readonly t: Transport;

  constructor(http: HttpClient, opts: TransportOptions) {
    this.t = new Transport(http, opts);
  }

  /** Fetch a list resource and map each row to a typed model. */
  protected async listMapped<T>(path: string, pick: (json: unknown) => unknown[], map: (row: Record<string, unknown>) => T, query?: TransportRequest['query']): Promise<T[]> {
    const json = await this.t.getJson<unknown>(path, query);
    return pick(json).map((row) => map(row as Record<string, unknown>));
  }
}

/** Read an array either at the JSON root or under a named key (e.g. Slack/Gmail wrap results). */
export function pickArray(key?: string): (json: unknown) => unknown[] {
  return (json: unknown): unknown[] => {
    if (Array.isArray(json)) return json;
    if (key && json && typeof json === 'object') {
      const v = (json as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
    return [];
  };
}

export const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
export const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
