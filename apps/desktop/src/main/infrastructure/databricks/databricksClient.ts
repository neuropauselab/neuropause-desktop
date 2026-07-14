/**
 * The Databricks transport (P6.9 — Databricks Cloud Platform). A `DatabricksClient` implements the P6.0
 * `DiscoveryHttp` contract against ONE configured Databricks workspace via its REST API 2.x
 * (`https://<workspace-host>/api/…`). A workspace lives at an ARBITRARY per-workspace host, so — like the
 * Kubernetes API server / vCenter / Snowflake account — the client is HOST-PINNED: bound to one workspace origin,
 * collectors/actions use RELATIVE paths, and any request whose origin is not the pinned workspace is refused.
 *
 * AUTH — a static Personal Access Token (PAT). The token is attached as `Authorization: Bearer <PAT>` (no signing,
 * no token exchange — the simplest of the platform transports). The origin guard runs BEFORE the token is
 * attached, and the fetch sets `redirect: 'error'`, so the bearer PAT can never be carried to another host.
 *
 * PAGINATION — Databricks list endpoints paginate with an opaque `next_page_token` echoed back as `?page_token=`
 * (the Repos endpoint uniquely echoes it as `?next_page_token=`); some carry `max_results`. `dbxList` drains all
 * pages within one collect() (Pattern B), bounded by `MAX_PAGES`. Responses are NOT enveloped — a list is
 * `{ <listKey>: [...], next_page_token? }`. Reuses the shared rate-gate + connector error taxonomy, no new runtime.
 */
import type { DiscoveryHttp, DiscoveryRequest, DiscoveryResponse } from '@neuropause/shared';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const REQUEST_TIMEOUT_MS = 60_000;
/** Cap the internal page walk (safety net against a pathological token loop); real workspaces stay well under. */
export const MAX_PAGES = 100;

export class DatabricksClient implements DiscoveryHttp {
  private readonly origin: string;
  private readonly base: string;

  constructor(
    workspaceUrl: string,
    private readonly token: string,
    private readonly gate: RateGate,
  ) {
    const u = new URL(workspaceUrl); // throws on a malformed workspace URL — the caller guards + degrades unconfigured
    this.origin = u.origin;
    this.base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  }

  private resolveUrl(url: string): string {
    return url.startsWith('/') ? `${this.base}${url}` : url;
  }

  async send(req: DiscoveryRequest): Promise<DiscoveryResponse> {
    const full = this.resolveUrl(req.url);
    const u = new URL(full);
    // SSRF / token-exfiltration hard stop: the PAT is bound to ONE configured workspace; refuse any other origin
    // BEFORE the token is attached.
    if (u.origin !== this.origin) {
      throw new HttpError(400, `Refusing to send a request to a non-Databricks host: ${u.origin}`, false);
    }
    await this.gate.acquire(u.host);
    const headers: Record<string, string> = { ...(req.headers ?? {}), Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
    const isBodyless = req.method === 'GET' || req.method === 'HEAD';
    if (!isBodyless && req.body && !headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';

    let resp: Response;
    try {
      resp = await fetch(full, { method: req.method, headers, body: isBodyless ? undefined : (req.body ?? undefined), redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'databricks fetch failed');
    }
    let text: string;
    try {
      text = await resp.text();
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'databricks body read failed');
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

  async getJson<T>(url: string, opts?: { query?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string> }): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    const u = new URL(this.resolveUrl(url));
    for (const [k, v] of Object.entries(opts?.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    const r = await this.send({ method: 'GET', url: u.toString(), headers: opts?.headers });
    return { data: (r.text ? JSON.parse(r.text) : null) as T, status: r.status, headers: r.headers };
  }
}

/** Map a Databricks REST HTTP status onto the connector error taxonomy so the Discovery Engine degrades gracefully. */
export function errorFor(status: number, headers: Record<string, string>, text: string): Error {
  const msg = databricksErrorMessage(text);
  if (status === 401 || status === 403) return new AuthError(msg ?? 'Databricks access denied', status);
  if (status === 404) return new HttpError(404, msg ?? 'Databricks resource not found', false);
  if (status === 429) {
    const retryAfter = Number(headers['retry-after']);
    return new RateLimitError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(1000, retryAfter * 1000) : 5000);
  }
  if (status >= 500) return new HttpError(status, msg ?? 'Databricks server error', true);
  return new HttpError(status, msg ?? `Databricks request failed (${status})`, false);
}

/** Pull the message out of a Databricks error body (`{ error_code, message }`) — best-effort, non-sensitive. */
export function databricksErrorMessage(text: string): string | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as { message?: unknown; error_code?: unknown };
    if (typeof j.message === 'string' && j.message.trim()) return typeof j.error_code === 'string' ? `${j.error_code}: ${j.message}` : j.message;
    return null;
  } catch {
    return null;
  }
}

/* ── Request helpers (what the collectors + actions call) ──────────────────────────────────────────── */

type Rec = Record<string, unknown>;

function requireSend(http: DiscoveryHttp): NonNullable<DiscoveryHttp['send']> {
  if (!http.send) throw new HttpError(500, 'Databricks platform requires a bearer transport (send)', false);
  return http.send.bind(http);
}
function safeJson(text: string): Rec {
  if (!text) return {};
  try {
    const j = JSON.parse(text) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Rec) : {};
  } catch {
    return {};
  }
}

/** GET a Databricks object (a single un-enveloped JSON object). */
export async function dbxGet(http: DiscoveryHttp, path: string): Promise<Rec> {
  const send = requireSend(http);
  const r = await send({ method: 'GET', url: path });
  return safeJson(r.text);
}

/**
 * GET a list endpoint to exhaustion, following the opaque `next_page_token`. `listKey` is the array wrapper
 * (`clusters`, `jobs`, `catalogs`, …). `tokenParam` defaults to `page_token`; the Repos endpoint uniquely echoes
 * it as `next_page_token`. `maxResults`/`limit` are appended when set. Bounded by `MAX_PAGES`.
 */
export async function dbxList(
  http: DiscoveryHttp,
  path: string,
  listKey: string,
  opts?: { tokenParam?: string; maxResults?: number; limit?: number },
): Promise<Rec[]> {
  const tokenParam = opts?.tokenParam ?? 'page_token';
  const items: Rec[] = [];
  let token: string | null = null;
  let pages = 0;
  for (;;) {
    const params: string[] = [];
    if (opts?.maxResults != null) params.push(`max_results=${opts.maxResults}`);
    if (opts?.limit != null) params.push(`limit=${opts.limit}`);
    if (token) params.push(`${tokenParam}=${encodeURIComponent(token)}`);
    const url = params.length ? `${path}${path.includes('?') ? '&' : '?'}${params.join('&')}` : path;
    const body = await dbxGet(http, url);
    const arr = body[listKey];
    if (Array.isArray(arr)) items.push(...(arr as Rec[]));
    const next = body.next_page_token;
    token = typeof next === 'string' && next.length > 0 ? next : null;
    pages += 1;
    if (!token || pages >= MAX_PAGES) break;
  }
  return items;
}

/** POST a mutating request (cluster start/stop, jobs run-now, warehouse start/stop). Returns the parsed body. */
export async function dbxPost(http: DiscoveryHttp, path: string, body?: Rec): Promise<Rec> {
  const send = requireSend(http);
  const r = await send({
    method: 'POST',
    url: path,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return r.text ? safeJson(r.text) : {};
}
