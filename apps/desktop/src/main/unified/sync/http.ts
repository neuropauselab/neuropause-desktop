/**
 * The HTTP layer every adapter talks through. It attaches the bearer token,
 * applies the rate gate before each call, and translates transport outcomes into
 * a small, typed error taxonomy the orchestrator keys its behavior off:
 *
 *   AuthError      → token rejected; reconnect required (no retry)
 *   RateLimitError → 429 / quota; back off for `retryAfterMs`
 *   NetworkError   → fetch failed; treat the connector as offline
 *   HttpError      → other 4xx/5xx (`retryable` true for 5xx)
 */

export class AuthError extends Error {
  constructor(
    message = 'unauthorized',
    /** The HTTP status that produced this error: 401 = token rejected, 403 = forbidden / insufficient scope. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super('rate limited');
    this.name = 'RateLimitError';
  }
}

export class NetworkError extends Error {
  constructor(message = 'network error') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** A rate gate the client consults before each request. */
export interface RateGate {
  acquire(key: string): Promise<void>;
  penalize(key: string, ms: number): void;
}

export interface HttpResponse<T> {
  data: T;
  headers: Record<string, string>;
  status: number;
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
}

type HeaderBag = { forEach(cb: (value: string, key: string) => void): void };

function headersToObject(h: HeaderBag): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function withQuery(url: string, query?: HttpRequestOptions['query']): string {
  if (!query) return url;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  if (parts.length === 0) return url;
  return url + (url.includes('?') ? '&' : '?') + parts.join('&');
}

function retryAfterMs(headers: Record<string, string>): number {
  const ra = headers['retry-after'];
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.max(1000, secs * 1000);
  }
  return resetMs(headers);
}

/** Honor GitHub-style `x-ratelimit-reset` (epoch seconds) when present. */
function resetMs(headers: Record<string, string>): number {
  const reset = headers['x-ratelimit-reset'];
  if (reset) {
    const at = Number(reset) * 1000;
    if (Number.isFinite(at)) return Math.max(1000, at - Date.now());
  }
  return 60_000;
}

/** The body type `fetch` accepts here — derived from fetch's own typing to avoid the DOM `BodyInit` lib type. */
type FetchBody = NonNullable<Parameters<typeof fetch>[1]>['body'];

/**
 * P4.1 — per-request timeout. Aborts a hung request so it fails fast as a NetworkError (→ offline/retry)
 * and releases the orchestrator's per-account sync mutex, instead of stalling that account's syncs until
 * the transport's own (~5 min) timeout.
 */
const REQUEST_TIMEOUT_MS = 60_000;

export class HttpClient {
  constructor(
    private readonly key: string,
    private readonly getToken: () => Promise<string>,
    private readonly gate: RateGate,
    private readonly baseHeaders: Record<string, string> = {},
  ) {}

  getJson<T>(url: string, opts?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('GET', url, undefined, opts);
  }

  postJson<T>(url: string, body: unknown, opts?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('POST', url, body, opts);
  }

  patchJson<T>(url: string, body: unknown, opts?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('PATCH', url, body, opts);
  }

  putJson<T>(url: string, body: unknown, opts?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', url, body, opts);
  }

  deleteJson<T>(url: string, opts?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', url, undefined, opts);
  }

  /** Upload raw bytes (mail/event attachments, OneDrive content PUT, resumable chunks). Returns parsed JSON, if any. */
  async sendBinary<T>(
    method: string,
    url: string,
    bytes: Uint8Array,
    contentType: string,
    opts?: HttpRequestOptions,
  ): Promise<HttpResponse<T>> {
    await this.gate.acquire(this.key);
    const token = await this.getToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': contentType,
      ...this.baseHeaders,
      ...opts?.headers,
    };
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(withQuery(url, opts?.query), { method, headers, body: bytes as unknown as FetchBody, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'fetch failed');
    }
    const responseHeaders = headersToObject(res.headers);
    this.throwForStatus(res.status, responseHeaders);
    const text = await res.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { data, headers: responseHeaders, status: res.status };
  }

  /** Download raw bytes (attachment content, OneDrive file content). */
  async getBinary(
    url: string,
    opts?: HttpRequestOptions,
  ): Promise<{ bytes: Uint8Array; headers: Record<string, string>; status: number }> {
    await this.gate.acquire(this.key);
    const token = await this.getToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...this.baseHeaders,
      ...opts?.headers,
    };
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(withQuery(url, opts?.query), { method: 'GET', headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'fetch failed');
    }
    const responseHeaders = headersToObject(res.headers);
    this.throwForStatus(res.status, responseHeaders);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, headers: responseHeaders, status: res.status };
  }

  private async request<T>(
    method: string,
    url: string,
    body: unknown,
    opts?: HttpRequestOptions,
  ): Promise<HttpResponse<T>> {
    await this.gate.acquire(this.key);
    const token = await this.getToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...this.baseHeaders,
      ...opts?.headers,
    };

    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(withQuery(url, opts?.query), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'fetch failed');
    }

    const responseHeaders = headersToObject(res.headers);
    this.throwForStatus(res.status, responseHeaders);
    const text = await res.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { data, headers: responseHeaders, status: res.status };
  }

  /** Translate an HTTP status into the typed error taxonomy (shared by the JSON + binary paths). */
  private throwForStatus(status: number, responseHeaders: Record<string, string>): void {
    // A 403 signals rate-limiting in two shapes that must BOTH back off rather than read as an auth
    // failure: PRIMARY exhaustion (x-ratelimit-remaining: 0) and a SECONDARY/abuse limit (a Retry-After
    // header, with remaining possibly > 0 — GitHub's pattern). Honor Retry-After, then x-ratelimit-reset.
    if (
      status === 403 &&
      (responseHeaders['x-ratelimit-remaining'] === '0' || responseHeaders['retry-after'] !== undefined)
    ) {
      const ms = retryAfterMs(responseHeaders);
      this.gate.penalize(this.key, ms);
      throw new RateLimitError(ms);
    }
    if (status === 401 || status === 403) {
      throw new AuthError(`HTTP ${status}`, status);
    }
    if (status === 429) {
      const ms = retryAfterMs(responseHeaders);
      this.gate.penalize(this.key, ms);
      throw new RateLimitError(ms);
    }
    if (status >= 500) throw new HttpError(status, `HTTP ${status}`, true);
    if (status >= 400) throw new HttpError(status, `HTTP ${status}`, false);
  }
}
