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
  constructor(message = 'unauthorized') {
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
      });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'fetch failed');
    }

    const responseHeaders = headersToObject(res.headers);

    if (res.status === 403 && responseHeaders['x-ratelimit-remaining'] === '0') {
      const ms = resetMs(responseHeaders);
      this.gate.penalize(this.key, ms);
      throw new RateLimitError(ms);
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`HTTP ${res.status}`);
    }
    if (res.status === 429) {
      const ms = retryAfterMs(responseHeaders);
      this.gate.penalize(this.key, ms);
      throw new RateLimitError(ms);
    }
    if (res.status >= 500) throw new HttpError(res.status, `HTTP ${res.status}`, true);
    if (res.status >= 400) throw new HttpError(res.status, `HTTP ${res.status}`, false);

    const text = await res.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { data, headers: responseHeaders, status: res.status };
  }
}
