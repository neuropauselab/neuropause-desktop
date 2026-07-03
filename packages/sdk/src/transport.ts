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
}

export class HttpTransport implements Transport {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: HttpTransportOptions) {
    const fallback = (globalThis as { fetch?: FetchLike }).fetch;
    const f = opts.fetchImpl ?? fallback;
    if (!f) throw new Error('No fetch implementation available; pass { fetchImpl }.');
    this.fetchImpl = f;
  }

  async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
    const version = req.version ?? this.opts.defaultVersion ?? 'v1';
    const qs = req.query ? buildQuery(req.query) : '';
    const url = `${trimEnd(this.opts.baseUrl)}/${version}${req.path}${qs}`;

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;

    const res = await this.fetchImpl(url, {
      method: req.method,
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });

    const text = await res.text();
    const data = text ? safeJson(text) : undefined;

    const outHeaders: Record<string, string> = {};
    for (const h of ['x-ratelimit-remaining', 'x-quota-remaining', 'x-api-version']) {
      const v = res.headers.get(h);
      if (v) outHeaders[h] = v;
    }

    if (res.status >= 400) {
      throw new GatewayError(res.status, `Gateway responded ${res.status}`, data);
    }
    return { status: res.status, data: data as T, headers: outHeaders };
  }
}
