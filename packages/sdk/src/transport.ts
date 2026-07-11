/**
 * Transport layer for the NeuroPause SDK. The client is transport-agnostic: it
 * speaks to a `Transport`, and ships an `HttpTransport` for the public REST
 * gateway. A custom transport (in-process, mock, proxy) can be supplied for
 * tests or for embedding inside the desktop app over IPC.
 *
 * No DOM lib dependency — we declare the minimal fetch shape we use, so the
 * package compiles under a plain ES2022 target.
 */
import type { ApiVersion } from '@neuropause/shared';

export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponseLike>;

export interface TransportRequest {
  method: string;
  path: string;
  version?: ApiVersion;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** The scope this route requires — informational; the gateway enforces it. */
  scope?: string;
}

export interface TransportResponse<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

export interface Transport {
  request<T>(req: TransportRequest): Promise<TransportResponse<T>>;
}

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

function trimEnd(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function buildQuery(query: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface HttpTransportOptions {
  baseUrl: string;
  apiKey?: string;
  defaultVersion?: ApiVersion;
  fetchImpl?: FetchLike;
  /** Retry attempts on 429/502/503/504 + network errors (default 2). */
  maxRetries?: number;
  /** Base backoff between retries in ms (default 200; doubles each attempt). */
  retryDelayMs?: number;
  /** Injected sleep (tests pass a no-op); defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/** Statuses worth retrying — transient gateway/infra conditions. */
const RETRYABLE = new Set([429, 502, 503, 504]);

export class HttpTransport implements Transport {
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HttpTransportOptions) {
    const fallback = (globalThis as { fetch?: FetchLike }).fetch;
    const f = opts.fetchImpl ?? fallback;
    if (!f) throw new Error('No fetch implementation available; pass { fetchImpl }.');
    this.fetchImpl = f;
    this.maxRetries = Math.max(0, opts.maxRetries ?? 2);
    this.retryDelayMs = Math.max(0, opts.retryDelayMs ?? 200);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
    const version = req.version ?? this.opts.defaultVersion ?? 'v1';
    const qs = req.query ? buildQuery(req.query) : '';
    const url = `${trimEnd(this.opts.baseUrl)}/${version}${req.path}${qs}`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    const body = req.body !== undefined ? JSON.stringify(req.body) : undefined;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) await this.sleep(this.retryDelayMs * 2 ** (attempt - 1));
      let res: FetchResponseLike;
      try {
        res = await this.fetchImpl(url, { method: req.method, headers, body });
      } catch (err) {
        lastErr = err; // network error — retry
        continue;
      }
      // Retry transient statuses (unless this was the last attempt).
      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) continue;

      const text = await res.text();
      const data = text ? safeJson(text) : undefined;
      const outHeaders: Record<string, string> = {};
      for (const h of ['x-ratelimit-remaining', 'x-quota-remaining', 'x-api-version']) {
        const v = res.headers.get(h);
        if (v) outHeaders[h] = v;
      }
      if (res.status >= 400) throw new GatewayError(res.status, `Gateway responded ${res.status}`, data);
      return { status: res.status, data: data as T, headers: outHeaders };
    }
    throw new GatewayError(0, 'Request failed after retries', lastErr instanceof Error ? lastErr.message : lastErr);
  }
}
