/**
 * The Cloudflare transport (P6.7 — Cloudflare Cloud Platform). A `CloudflareClient` implements the P6.0
 * `DiscoveryHttp` contract against the Cloudflare API v4 — a plain bearer-token JSON REST API at the FIXED host
 * `api.cloudflare.com` (base `https://api.cloudflare.com/client/v4`). Like the Azure/GCP bearer clients it attaches
 * `Authorization: Bearer <token>`, rate-gates each call, and maps the response onto the connector error taxonomy;
 * unlike them the host is a single constant, so the SSRF guard is a host-equality check.
 *
 * SECURITY: the host-equality guard in `send` runs BEFORE the token is attached — an API token is only ever sent
 * to `api.cloudflare.com`. Both `fetch`es set `redirect: 'error'` so a 3xx can never carry the bearer token to
 * another origin (fetch strips Authorization on a cross-origin redirect, but refusing the redirect outright is the
 * belt-and-suspenders backstop, matching the repo's webhook egress guard). Pagination is page-number / cursor
 * driven from `result_info` — never a URL taken from a response — so nothing a response returns can redirect the
 * transport off-Cloudflare. Reuses the shared rate-gate + connector error taxonomy, no new runtime.
 *
 * Cloudflare envelope: every response is `{ success, errors:[{code,message}], messages, result, result_info }`.
 * The helpers unwrap `result`; a `success:false` on an HTTP 2xx (a logical failure) is surfaced as an error too.
 */
import type { DiscoveryHttp, DiscoveryRequest, DiscoveryResponse } from '@neuropause/shared';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const REQUEST_TIMEOUT_MS = 60_000;
const CLOUDFLARE_HOST = 'api.cloudflare.com';
const BASE_URL = `https://${CLOUDFLARE_HOST}/client/v4`;
/** Cap the internal page walk (safety net against a pathological `total_pages`); real accounts stay well under. */
export const MAX_PAGES = 100;

export class CloudflareClient implements DiscoveryHttp {
  constructor(
    private readonly token: string,
    private readonly gate: RateGate,
  ) {}

  /** Relative paths resolve against the fixed API base; an absolute URL is left as-is (and guarded in send). */
  private resolveUrl(url: string): string {
    return url.startsWith('/') ? `${BASE_URL}${url}` : url;
  }

  async send(req: DiscoveryRequest): Promise<DiscoveryResponse> {
    const full = this.resolveUrl(req.url);
    const u = new URL(full);
    // SSRF / token-exfiltration hard stop: the API token is bound to api.cloudflare.com; refuse any other host
    // BEFORE the token is attached.
    if (u.hostname !== CLOUDFLARE_HOST) {
      throw new HttpError(400, `Refusing to send a request to a non-Cloudflare host: ${u.hostname}`, false);
    }
    await this.gate.acquire(u.host);
    const headers: Record<string, string> = { ...(req.headers ?? {}), Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
    const isBodyless = req.method === 'GET' || req.method === 'HEAD';
    if (!isBodyless && req.body && !headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';

    let resp: Response;
    try {
      resp = await fetch(full, {
        method: req.method,
        headers,
        body: isBodyless ? undefined : (req.body ?? undefined),
        redirect: 'error', // a 3xx must never carry the bearer token off api.cloudflare.com
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'cloudflare fetch failed');
    }
    let text: string;
    try {
      text = await resp.text();
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'cloudflare body read failed');
    }
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => (respHeaders[k.toLowerCase()] = v));
    if (!resp.ok) {
      const err = errorFor(resp.status, respHeaders, text);
      if (err instanceof RateLimitError) this.gate.penalize(u.host, err.retryAfterMs);
      throw err;
    }
    return { status: resp.status, headers: respHeaders, text };
  }

  /** DiscoveryHttp compatibility — a bearer GET whose body is parsed as JSON (the Cloudflare envelope). */
  async getJson<T>(url: string, opts?: { query?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string> }): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    const u = new URL(this.resolveUrl(url));
    for (const [k, v] of Object.entries(opts?.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    const r = await this.send({ method: 'GET', url: u.toString(), headers: opts?.headers });
    return { data: (r.text ? JSON.parse(r.text) : null) as T, status: r.status, headers: r.headers };
  }
}

/** Map a Cloudflare HTTP status onto the connector error taxonomy so the Discovery Engine degrades gracefully. */
export function errorFor(status: number, headers: Record<string, string>, text: string): Error {
  const msg = cloudflareErrorMessage(text);
  if (status === 401 || status === 403) return new AuthError(msg ?? 'Cloudflare access denied', status);
  if (status === 404) return new HttpError(404, msg ?? 'Cloudflare resource not found', false);
  if (status === 429) {
    const retryAfter = Number(headers['retry-after']);
    return new RateLimitError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(1000, retryAfter * 1000) : 5000);
  }
  if (status >= 500) return new HttpError(status, msg ?? 'Cloudflare server error', true);
  return new HttpError(status, msg ?? `Cloudflare request failed (${status})`, false);
}

/** Pull the first `errors[].message` out of a Cloudflare envelope (best-effort, non-sensitive). */
export function cloudflareErrorMessage(textOrBody: string | Rec): string | null {
  const body = typeof textOrBody === 'string' ? safeJson(textOrBody) : textOrBody;
  const errors = body?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const e = errors[0] as { code?: unknown; message?: unknown };
    if (typeof e.message === 'string' && e.message.trim()) return typeof e.code === 'number' ? `${e.code}: ${e.message}` : e.message;
  }
  return null;
}

/* ── Per-endpoint request helpers (what the collectors + actions call) ──────────────────────────────── */

type Rec = Record<string, unknown>;

function requireSend(http: DiscoveryHttp): NonNullable<DiscoveryHttp['send']> {
  if (!http.send) throw new HttpError(500, 'Cloudflare platform requires a bearer transport (send)', false);
  return http.send.bind(http);
}

function safeJson(text: string): Rec {
  if (!text) return {};
  try {
    const j = JSON.parse(text) as unknown;
    return j && typeof j === 'object' ? (j as Rec) : {};
  } catch {
    return {};
  }
}
const numOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** GET one Cloudflare envelope. A `success:false` on an HTTP 2xx (a logical failure) becomes a non-retryable error. */
async function cfGetEnvelope(http: DiscoveryHttp, path: string): Promise<{ result: unknown; resultInfo: Rec | null }> {
  const send = requireSend(http);
  const r = await send({ method: 'GET', url: path });
  const body = safeJson(r.text);
  if (body.success === false) {
    throw new HttpError(400, cloudflareErrorMessage(body) ?? 'Cloudflare request failed', false);
  }
  const resultInfo = body.result_info && typeof body.result_info === 'object' ? (body.result_info as Rec) : null;
  return { result: body.result, resultInfo };
}

/**
 * GET a page-paginated list to exhaustion (`?page=&per_page=`, following `result_info.total_pages`). Endpoints
 * that don't paginate (no `result_info`) return their single page. Bounded by `MAX_PAGES`.
 */
export async function cfList(http: DiscoveryHttp, path: string, perPage = 50): Promise<Rec[]> {
  const items: Rec[] = [];
  let page = 1;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const { result, resultInfo } = await cfGetEnvelope(http, `${path}${sep}page=${page}&per_page=${perPage}`);
    const arr = Array.isArray(result) ? (result as Rec[]) : [];
    items.push(...arr);
    const totalPages = numOf(resultInfo?.total_pages);
    if (!totalPages || page >= totalPages || page >= MAX_PAGES || arr.length === 0) break;
    page += 1;
  }
  return items;
}

/**
 * GET a cursor-paginated list to exhaustion (`?cursor=`, following top-level `result_info.cursor`), unwrapping a
 * nested list key — Cloudflare R2 returns `{ result: { buckets: [...] }, result_info: { cursor } }`.
 */
export async function cfListCursor(http: DiscoveryHttp, path: string, listKey: string, perPage = 100): Promise<Rec[]> {
  const items: Rec[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${path}${sep}per_page=${perPage}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const { result, resultInfo } = await cfGetEnvelope(http, url);
    const inner = result && typeof result === 'object' ? (result as Rec)[listKey] : undefined;
    const list = Array.isArray(inner) ? (inner as Rec[]) : [];
    items.push(...list);
    cursor = strOf(resultInfo?.cursor);
    pages += 1;
    if (!cursor || list.length === 0 || pages >= MAX_PAGES) break;
  }
  return items;
}

/** GET a single Cloudflare object (the `result`), or {} on a non-object result. */
export async function cfGet(http: DiscoveryHttp, path: string): Promise<Rec> {
  const { result } = await cfGetEnvelope(http, path);
  return result && typeof result === 'object' && !Array.isArray(result) ? (result as Rec) : {};
}

/** Issue a mutating request (POST/PATCH/DELETE), parse the envelope, throw on `success:false`, return `result`. */
export async function cfMutate(http: DiscoveryHttp, method: string, path: string, body?: Rec): Promise<Rec> {
  const send = requireSend(http);
  const r = await send({
    method,
    url: path,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const parsed = safeJson(r.text);
  if (parsed.success === false) throw new HttpError(400, cloudflareErrorMessage(parsed) ?? 'Cloudflare request failed', false);
  return parsed.result && typeof parsed.result === 'object' && !Array.isArray(parsed.result) ? (parsed.result as Rec) : {};
}
