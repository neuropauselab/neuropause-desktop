/**
 * The Google Cloud transport (P6.3 — GCP Cloud Platform). A `GcpClient` implements the P6.0 `DiscoveryHttp`
 * contract by attaching an OAuth2 BEARER token (a service-account access token) to each request and rate-gating
 * it, then returning the raw response for the collector/action to parse. Like Azure, GCP is plain bearer JSON —
 * but every GCP REST API is a single audience (`*.googleapis.com`, one `cloud-platform` scope), so this is even
 * simpler: one token serves compute, storage, IAM, SQL, GKE, Secret Manager, DNS, etc. This reuses the shared
 * rate-gate and the connector error taxonomy with NO new runtime and NO signing on the request path.
 *
 * SECURITY: GCP list responses carry a `nextPageToken` the engine feeds into the NEXT request (built from the
 * collector's own base URL), and actions interpolate params into paths. `isGcpHost` is the single choke point
 * that refuses to attach a token to any host that is not a `*.googleapis.com` endpoint.
 */
import type { DiscoveryHttp, DiscoveryRequest, DiscoveryResponse } from '@neuropause/shared';
import { AuthError, HttpError, RateLimitError, type RateGate } from '../../unified/sync/http';

/** The one OAuth scope for all GCP resource-management APIs. */
export const GCP_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** A host is Google iff it is a `*.googleapis.com` endpoint — the SSRF guard for bearer-token requests. */
export function isGcpHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'googleapis.com' || h.endsWith('.googleapis.com');
}

/** A source of a bearer token for a scope (service-account JWT-bearer, ADC, or a test stub). */
export type GcpTokenProvider = (scope: string) => Promise<string>;

/**
 * Wrap a raw token fetch with per-scope caching (re-fetch ~60s before expiry). Pure + injectable so the caching
 * is unit-testable without a live token endpoint. Same caching shape as the Azure token cache, kept local so the
 * platform adapters stay independent (no cross-platform import).
 */
export function cachedGcpToken(
  fetchToken: (scope: string) => Promise<{ token: string; expiresInSec: number }>,
  nowMs: () => number = () => Date.now(),
): GcpTokenProvider {
  const cache = new Map<string, { token: string; expiresAtMs: number }>();
  return async (scope) => {
    const now = nowMs();
    const hit = cache.get(scope);
    if (hit && hit.expiresAtMs - 60_000 > now) return hit.token;
    const { token, expiresInSec } = await fetchToken(scope);
    cache.set(scope, { token, expiresAtMs: now + Math.max(0, expiresInSec) * 1000 });
    return token;
  };
}

export class GcpClient implements DiscoveryHttp {
  constructor(
    private readonly token: GcpTokenProvider,
    private readonly gate: RateGate,
  ) {}

  async send(req: DiscoveryRequest): Promise<DiscoveryResponse> {
    const u = new URL(req.url);
    // SSRF / token-exfiltration hard stop: NEVER attach a bearer token to a non-Google host. Runs BEFORE the
    // token is acquired/attached (a `nextPageToken` is fed into a URL, and action params into paths).
    if (!isGcpHost(u.hostname)) throw new HttpError(400, `Refusing to send a request to a non-Google host: ${u.hostname}`, false);

    await this.gate.acquire(u.hostname);
    const bearer = await this.token(GCP_SCOPE);
    const headers: Record<string, string> = { ...(req.headers ?? {}), Authorization: `Bearer ${bearer}` };
    const isBodyless = req.method === 'GET' || req.method === 'HEAD';
    if (!isBodyless && req.body && !headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';

    const resp = await fetch(req.url, { method: req.method, headers, body: isBodyless ? undefined : (req.body ?? undefined) });
    const text = await resp.text();
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => (respHeaders[k] = v));
    if (!resp.ok) {
      const err = errorFor(resp.status, respHeaders, text);
      if (err instanceof RateLimitError) this.gate.penalize(u.hostname, err.retryAfterMs);
      throw err;
    }
    return { status: resp.status, headers: respHeaders, text };
  }

  /** DiscoveryHttp compatibility — a bearer GET whose body is parsed as JSON. */
  async getJson<T>(url: string, opts?: { query?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string> }): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    const u = new URL(url);
    for (const [k, v] of Object.entries(opts?.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    const r = await this.send({ method: 'GET', url: u.toString(), headers: opts?.headers });
    return { data: (r.text ? JSON.parse(r.text) : null) as T, status: r.status, headers: r.headers };
  }
}

/** Map a GCP HTTP status onto the connector error taxonomy so the Discovery Engine degrades gracefully. */
export function errorFor(status: number, headers: Record<string, string>, text: string): Error {
  if (status === 401 || status === 403) return new AuthError(gcpErrorMessage(text) ?? 'Google Cloud access denied', status);
  if (status === 404) return new HttpError(404, gcpErrorMessage(text) ?? 'Google Cloud resource not found', false);
  if (status === 429 || status === 503) {
    const retryAfter = Number(headers['retry-after']);
    return new RateLimitError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(1000, retryAfter * 1000) : 2000);
  }
  if (status >= 500) return new HttpError(status, 'Google Cloud server error', true);
  return new HttpError(status, gcpErrorMessage(text) ?? `Google Cloud request failed (${status})`, false);
}

/** Pull the GCP error `status`/`message` out of a JSON error body (best-effort, non-sensitive). */
export function gcpErrorMessage(text: string): string | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as { error?: { status?: string; message?: string } | string; error_description?: string; message?: string };
    if (j && typeof j.error === 'object' && j.error) return j.error.status ?? j.error.message ?? null;
    if (typeof j?.error === 'string') return j.error;
    return j?.error_description ?? j?.message ?? null;
  } catch {
    return null;
  }
}

/* ── Per-protocol request helpers (what the collectors + actions call) ────────────── */

type Rec = Record<string, unknown>;

function requireSend(http: DiscoveryHttp): NonNullable<DiscoveryHttp['send']> {
  if (!http.send) throw new HttpError(500, 'GCP platform requires a bearer transport (send)', false);
  return http.send.bind(http);
}

/** GET one page of a GCP list. `listKey` names the array field (`items` / `instances` / `buckets` / `secrets` /
 *  `clusters` / …). Pagination is `nextPageToken` — the caller appends `pageToken=` to its base URL next call. */
export async function gcpList(http: DiscoveryHttp, url: string, listKey: string): Promise<{ items: Rec[]; nextPageToken: string | null }> {
  const send = requireSend(http);
  const r = await send({ method: 'GET', url });
  const data = (r.text ? JSON.parse(r.text) : {}) as Rec;
  const items = Array.isArray(data[listKey]) ? (data[listKey] as Rec[]) : [];
  return { items, nextPageToken: (typeof data.nextPageToken === 'string' ? data.nextPageToken : null) };
}

/** Follow `nextPageToken` to exhaustion for a single GCP list URL (used by the per-location fan-out for APIs
 *  that reject the `locations/-` aggregate wildcard, e.g. Cloud Run + Certificate Manager). */
export async function gcpListAll(http: DiscoveryHttp, initialUrl: string, listKey: string): Promise<Rec[]> {
  const out: Rec[] = [];
  let token: string | null = null;
  do {
    const url: string = token ? `${initialUrl}${initialUrl.includes('?') ? '&' : '?'}pageToken=${encodeURIComponent(token)}` : initialUrl;
    const { items, nextPageToken } = await gcpList(http, url, listKey);
    out.push(...items);
    token = nextPageToken;
  } while (token);
  return out;
}

/** GET one page of a Compute `aggregatedList`: `items` is a map `scope → { [resourceKey]: [...] }` across all
 *  zones/regions (scopes with only a `warning` are skipped). Flattened here into a single array. */
export async function gcpAggregated(http: DiscoveryHttp, url: string, resourceKey: string): Promise<{ items: Rec[]; nextPageToken: string | null }> {
  const send = requireSend(http);
  const r = await send({ method: 'GET', url });
  const data = (r.text ? JSON.parse(r.text) : {}) as { items?: Record<string, Rec>; nextPageToken?: string };
  const items: Rec[] = [];
  for (const scoped of Object.values(data.items ?? {})) {
    const arr = (scoped as Rec)[resourceKey];
    if (Array.isArray(arr)) items.push(...(arr as Rec[]));
  }
  return { items, nextPageToken: (typeof data.nextPageToken === 'string' ? data.nextPageToken : null) };
}

/** POST a GCP mutation (an action), parse the JSON response (usually an Operation resource). */
export async function gcpPost(http: DiscoveryHttp, url: string, body?: Rec): Promise<Rec> {
  const send = requireSend(http);
  const r = await send({ method: 'POST', url, body: body ? JSON.stringify(body) : undefined });
  return r.text ? (JSON.parse(r.text) as Rec) : {};
}

/**
 * Normalize a GCP selfLink / resource reference to its RELATIVE resource name (from `projects/`), so an
 * instance's `network` reference resolves against the network's own selfLink regardless of the API host or
 * version (`www.googleapis.com/compute/v1/...` vs `compute.googleapis.com/compute/v1/...`).
 */
export function relName(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const i = ref.indexOf('/projects/');
  if (i >= 0) return ref.slice(i + 1); // drop the leading slash → `projects/...`
  return ref; // already a relative name (or a short name we leave as-is)
}
