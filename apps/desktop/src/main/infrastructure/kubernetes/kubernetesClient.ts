/**
 * The Kubernetes transport (P6.4 — Kubernetes Cloud Platform). A `KubernetesClient` implements the P6.0
 * `DiscoveryHttp` contract by attaching a BEARER service-account token to each request against ONE configured
 * API server, rate-gating it, and returning the raw response for the collector/action to parse. Like Azure/GCP
 * it is plain bearer JSON — but a Kubernetes API server lives at an ARBITRARY host (per kubeconfig), so instead
 * of a `*.googleapis.com`-style allowlist, this client is SERVER-PINNED: it is bound to one API-server origin,
 * collectors/actions use RELATIVE paths (`/api/v1/pods`, `/apis/apps/v1/deployments`) resolved against it, and
 * any request whose origin is not the pinned server is refused. This reuses the shared rate-gate and the
 * connector error taxonomy with NO new runtime.
 *
 * SECURITY: the bearer token is bound to the one configured API server. Pagination is a `metadata.continue`
 * token passed as a `?continue=` query param — never a URL taken from a response — so nothing a response
 * returns can redirect the token off-cluster; the origin-equality guard in `send` is the belt-and-suspenders
 * backstop. TLS: the client uses the process trust store — a private cluster CA is trusted via the standard
 * `NODE_EXTRA_CA_CERTS` mechanism (documented); per-request CA injection via an undici dispatcher is a noted
 * enhancement (it would add the `undici` dependency).
 */
import type { DiscoveryHttp, DiscoveryRequest, DiscoveryResponse } from '@neuropause/shared';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const REQUEST_TIMEOUT_MS = 60_000;

export class KubernetesClient implements DiscoveryHttp {
  /** protocol+host+port of the configured API server (the pin). */
  private readonly serverOrigin: string;
  /** origin + any path prefix (for API-server proxies); relative paths resolve against this. */
  private readonly base: string;

  constructor(
    server: string,
    private readonly token: string,
    private readonly gate: RateGate,
  ) {
    const u = new URL(server); // throws on a malformed server URL — the caller guards + degrades unconfigured
    this.serverOrigin = u.origin;
    this.base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  }

  /** Relative paths resolve against the pinned server; an absolute URL is left as-is (and guarded in send). */
  private resolveUrl(url: string): string {
    return url.startsWith('/') ? `${this.base}${url}` : url;
  }

  async send(req: DiscoveryRequest): Promise<DiscoveryResponse> {
    const full = this.resolveUrl(req.url);
    const u = new URL(full);
    // SSRF / token-exfiltration hard stop: the bearer token is bound to ONE configured API server; refuse any
    // other origin BEFORE the token is attached.
    if (u.origin !== this.serverOrigin) {
      throw new HttpError(400, `Refusing to send a request to a non-cluster host: ${u.origin}`, false);
    }

    await this.gate.acquire(u.host);
    const headers: Record<string, string> = { ...(req.headers ?? {}), Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
    const isBodyless = req.method === 'GET' || req.method === 'HEAD';
    if (!isBodyless && req.body && !headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';

    let resp: Response;
    try {
      resp = await fetch(full, { method: req.method, headers, body: isBodyless ? undefined : (req.body ?? undefined), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      // A dropped connection / TLS handshake failure (e.g. an untrusted cluster CA) degrades like an offline
      // connector rather than crashing discovery.
      throw new NetworkError(err instanceof Error ? err.message : 'kubernetes fetch failed');
    }
    const text = await resp.text();
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => (respHeaders[k] = v));
    if (!resp.ok) {
      const err = errorFor(resp.status, respHeaders, text);
      if (err instanceof RateLimitError) this.gate.penalize(u.host, err.retryAfterMs);
      throw err;
    }
    return { status: resp.status, headers: respHeaders, text };
  }

  /** DiscoveryHttp compatibility — a bearer GET whose body is parsed as JSON. */
  async getJson<T>(url: string, opts?: { query?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string> }): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    const u = new URL(this.resolveUrl(url));
    for (const [k, v] of Object.entries(opts?.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    const r = await this.send({ method: 'GET', url: u.toString(), headers: opts?.headers });
    return { data: (r.text ? JSON.parse(r.text) : null) as T, status: r.status, headers: r.headers };
  }
}

/** Map a Kubernetes HTTP status onto the connector error taxonomy so the Discovery Engine degrades gracefully. */
export function errorFor(status: number, headers: Record<string, string>, text: string): Error {
  if (status === 401 || status === 403) return new AuthError(k8sErrorMessage(text) ?? 'Kubernetes access denied', status);
  if (status === 404) return new HttpError(404, k8sErrorMessage(text) ?? 'Kubernetes resource not found', false);
  if (status === 429 || status === 503) {
    const retryAfter = Number(headers['retry-after']);
    return new RateLimitError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(1000, retryAfter * 1000) : 2000);
  }
  if (status >= 500) return new HttpError(status, 'Kubernetes API server error', true);
  return new HttpError(status, k8sErrorMessage(text) ?? `Kubernetes request failed (${status})`, false);
}

/** Pull the message out of a Kubernetes `Status` error body (best-effort, non-sensitive). */
export function k8sErrorMessage(text: string): string | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as { kind?: string; reason?: string; message?: string };
    if (j && j.kind === 'Status') return j.reason ?? j.message ?? null;
    return j?.message ?? null;
  } catch {
    return null;
  }
}

/* ── Per-protocol request helpers (what the collectors + actions call) ────────────── */

type Rec = Record<string, unknown>;

function requireSend(http: DiscoveryHttp): NonNullable<DiscoveryHttp['send']> {
  if (!http.send) throw new HttpError(500, 'Kubernetes platform requires a bearer transport (send)', false);
  return http.send.bind(http);
}

/** GET one page of a Kubernetes list (a `*List` object). Items are in `items`; the pagination token is in
 *  `metadata.continue` (empty when the walk is done). The caller appends `?continue=` on the next call. */
export async function k8sList(http: DiscoveryHttp, path: string): Promise<{ items: Rec[]; continueToken: string | null }> {
  const send = requireSend(http);
  const r = await send({ method: 'GET', url: path });
  const data = (r.text ? JSON.parse(r.text) : {}) as { items?: Rec[]; metadata?: { continue?: string } };
  const items = Array.isArray(data.items) ? data.items : [];
  const cont = data.metadata?.continue;
  return { items, continueToken: typeof cont === 'string' && cont.length > 0 ? cont : null };
}

/** Follow the `metadata.continue` token to exhaustion for a single list path (for the drain fan-out). */
export async function k8sListAll(http: DiscoveryHttp, path: string): Promise<Rec[]> {
  const out: Rec[] = [];
  let token: string | null = null;
  do {
    const url: string = token ? `${path}${path.includes('?') ? '&' : '?'}continue=${encodeURIComponent(token)}` : path;
    const { items, continueToken } = await k8sList(http, url);
    out.push(...items);
    token = continueToken;
  } while (token);
  return out;
}

/** PATCH a Kubernetes object (strategic-merge / merge patch), parse the returned object. */
export async function k8sPatch(http: DiscoveryHttp, path: string, body: Rec, contentType = 'application/merge-patch+json'): Promise<Rec> {
  const send = requireSend(http);
  const r = await send({ method: 'PATCH', url: path, headers: { 'Content-Type': contentType }, body: JSON.stringify(body) });
  return r.text ? (JSON.parse(r.text) as Rec) : {};
}

/** DELETE a Kubernetes object, parse the returned Status/object. */
export async function k8sDelete(http: DiscoveryHttp, path: string): Promise<Rec> {
  const send = requireSend(http);
  const r = await send({ method: 'DELETE', url: path });
  return r.text ? (JSON.parse(r.text) as Rec) : {};
}

/** POST a Kubernetes subresource (e.g. an Eviction), parse the response. */
export async function k8sPost(http: DiscoveryHttp, path: string, body: Rec): Promise<Rec> {
  const send = requireSend(http);
  const r = await send({ method: 'POST', url: path, body: JSON.stringify(body) });
  return r.text ? (JSON.parse(r.text) as Rec) : {};
}
