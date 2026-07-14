/**
 * The IaC transport (P6.10 — Infrastructure as Code Platform). ONE flavor-aware, HOST-PINNED `DiscoveryHttp`
 * that talks to the three IaC backends under one platform:
 *   • Terraform Cloud / Enterprise (flavor `terraform`)  — `Authorization: Bearer <token>`, JSON:API
 *     (`Accept: application/vnd.api+json`), `links.next` pagination, base `https://app.terraform.io`.
 *   • OpenTofu (flavor `opentofu`) — the SAME TFC-compatible JSON:API transport, flavor-tagged.
 *   • Pulumi Cloud (flavor `pulumi`) — `Authorization: token <PAT>` (NOT Bearer), `Accept: application/vnd.pulumi+8`,
 *     `continuationToken` pagination, base `https://api.pulumi.com`.
 *
 * SSRF / token-exfiltration hard stop: the API token is bound to ONE configured backend origin. `send()` refuses
 * any request whose resolved origin != the pinned origin BEFORE attaching the token, and every authenticated fetch
 * sets `redirect: 'error'` so a 3xx can never carry the token off-origin. A signed STATE / PLAN artifact URL that
 * the AUTHENTICATED API hands back (TFC `hosted-state-download-url`, the `json-output` 307 target) is fetched via a
 * SEPARATE credential-free path (`getArtifact`) — https-only, NO `Authorization` header — so the token never leaves
 * the pinned host even when we follow a capability URL the trusted API returned.
 *
 * Pagination is drained inside one collect() (Pattern B), bounded by `MAX_PAGES`. Reuses the shared rate-gate +
 * connector error taxonomy — no new runtime.
 */
import type { DiscoveryHttp, DiscoveryRequest, DiscoveryResponse } from '@neuropause/shared';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';
import type { IacFlavor } from './iacState';

const REQUEST_TIMEOUT_MS = 60_000;
/** Cap the internal page walk (safety net against a pathological pagination loop). */
export const MAX_PAGES = 200;
/** Bound the manual redirect chain + response size of a credential-free artifact fetch (SSRF / DoS guards). */
const MAX_ARTIFACT_REDIRECTS = 4;
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;

/** Is a hostname a private / loopback / link-local address (an SSRF target we refuse to fetch credential-free)? */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local (cloud metadata 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true; // IPv6 loopback/ULA/link-local
  return false;
}

export interface IacClientConfig {
  flavor: IacFlavor;
  /** The configured backend base URL (`https://app.terraform.io` / `https://api.pulumi.com` / a TFE host). */
  host: string;
  token: string;
  organization: string;
}

/** The transport a collector narrows `ctx.http` to (adds flavor/org + the artifact/redirect reads). */
export interface IacTransport extends DiscoveryHttp {
  readonly flavor: IacFlavor;
  readonly organization: string;
  /** Credential-free fetch of a signed artifact URL returned by the authenticated API (state/plan blob). */
  getArtifact(url: string): Promise<string>;
  /** Authenticated GET that captures a 3xx `Location` (the TFC `json-output` 307) without following it. */
  getLocation(path: string): Promise<{ location: string | null; text: string | null }>;
}

/** Narrow a `DiscoveryHttp` to the IaC transport (throws if it is not one — the collector requires it). */
export function asIac(http: DiscoveryHttp): IacTransport {
  const t = http as Partial<IacTransport>;
  if (typeof t.flavor !== 'string' || typeof t.getArtifact !== 'function' || typeof t.getLocation !== 'function') {
    throw new HttpError(500, 'IaC platform requires the IaC transport', false);
  }
  return http as IacTransport;
}

export class IacClient implements IacTransport {
  readonly flavor: IacFlavor;
  readonly organization: string;
  private readonly origin: string;
  private readonly base: string;
  private readonly token: string;

  constructor(config: IacClientConfig, private readonly gate: RateGate) {
    const u = new URL(config.host); // throws on a malformed host — the caller guards + degrades unconfigured
    this.origin = u.origin;
    this.base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    this.flavor = config.flavor;
    this.organization = config.organization;
    this.token = config.token;
  }

  private resolveUrl(url: string): string {
    return url.startsWith('/') ? `${this.base}${url}` : url;
  }

  /** The flavor-specific auth + accept headers. */
  private authHeaders(): Record<string, string> {
    return this.flavor === 'pulumi'
      ? { Authorization: `token ${this.token}`, Accept: 'application/vnd.pulumi+8' }
      : { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.api+json' };
  }

  async send(req: DiscoveryRequest): Promise<DiscoveryResponse> {
    const full = this.resolveUrl(req.url);
    const u = new URL(full);
    if (u.origin !== this.origin) {
      throw new HttpError(400, `Refusing to send a request to a non-IaC host: ${u.origin}`, false);
    }
    await this.gate.acquire(u.host);
    const headers: Record<string, string> = { ...(req.headers ?? {}), ...this.authHeaders() };
    const isBodyless = req.method === 'GET' || req.method === 'HEAD';
    if (!isBodyless && req.body && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = this.flavor === 'pulumi' ? 'application/json' : 'application/vnd.api+json';
    }
    let resp: Response;
    try {
      resp = await fetch(full, { method: req.method, headers, body: isBodyless ? undefined : (req.body ?? undefined), redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'iac fetch failed');
    }
    const text = await readText(resp);
    const respHeaders = headerBag(resp);
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

  async getArtifact(url: string): Promise<string> {
    // Credential-free capability fetch of a signed URL the trusted API handed back: the API token is NEVER attached,
    // so there is nothing to leak. Redirects are followed MANUALLY (not `redirect:'follow'`) so EVERY hop is
    // re-validated — https-only and never a private/loopback/link-local host — closing the SSRF vector where a
    // compromised backend redirects the credential-free fetch at an internal or cloud-metadata endpoint.
    let current = url;
    for (let hop = 0; hop <= MAX_ARTIFACT_REDIRECTS; hop++) {
      const u = new URL(current);
      if (u.protocol !== 'https:') throw new HttpError(400, `Refusing to fetch a non-https artifact: ${u.protocol}`, false);
      if (isPrivateHost(u.hostname)) throw new HttpError(400, `Refusing to fetch an artifact from a private/link-local host: ${u.hostname}`, false);
      await this.gate.acquire(u.host);
      let resp: Response;
      try {
        resp = await fetch(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (err) {
        throw new NetworkError(err instanceof Error ? err.message : 'iac artifact fetch failed');
      }
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get('location');
        if (!loc) throw new HttpError(resp.status, 'artifact redirect without a Location', false);
        current = new URL(loc, current).toString(); // re-validated at the top of the next iteration
        continue;
      }
      const size = Number(resp.headers.get('content-length'));
      if (Number.isFinite(size) && size > MAX_ARTIFACT_BYTES) throw new HttpError(413, `Artifact too large (${size} bytes)`, false);
      const text = await readText(resp);
      // A credential-free fetch holds NO token to be rejected, so a 4xx here is a stale/GC'd signed URL — a plain
      // HttpError (never AuthError), so a single bad state URL is tolerated per-source and doesn't degrade the domain.
      if (!resp.ok) throw new HttpError(resp.status, iacErrorMessage(text) ?? 'iac artifact fetch failed', resp.status >= 500);
      return text;
    }
    throw new HttpError(310, 'Too many artifact redirects', false);
  }

  async getLocation(path: string): Promise<{ location: string | null; text: string | null }> {
    const full = this.resolveUrl(path);
    const u = new URL(full);
    if (u.origin !== this.origin) throw new HttpError(400, `Refusing to send a request to a non-IaC host: ${u.origin}`, false);
    await this.gate.acquire(u.host);
    let resp: Response;
    try {
      resp = await fetch(full, { method: 'GET', headers: this.authHeaders(), redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'iac redirect fetch failed');
    }
    if (resp.status >= 300 && resp.status < 400) {
      return { location: resp.headers.get('location'), text: null };
    }
    const text = await readText(resp);
    if (!resp.ok) throw errorFor(resp.status, headerBag(resp), text);
    return { location: null, text };
  }
}

async function readText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch (err) {
    throw new NetworkError(err instanceof Error ? err.message : 'iac body read failed');
  }
}
function headerBag(resp: Response): Record<string, string> {
  const bag: Record<string, string> = {};
  resp.headers.forEach((v, k) => (bag[k.toLowerCase()] = v));
  return bag;
}

/** Map an IaC-backend HTTP status onto the connector error taxonomy so the Discovery Engine degrades gracefully. */
export function errorFor(status: number, headers: Record<string, string>, text: string): Error {
  const msg = iacErrorMessage(text);
  if (status === 401 || status === 403) return new AuthError(msg ?? 'IaC backend access denied', status);
  if (status === 404) return new HttpError(404, msg ?? 'IaC resource not found', false);
  if (status === 429) {
    const retryAfter = Number(headers['retry-after']);
    return new RateLimitError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(1000, retryAfter * 1000) : 5000);
  }
  if (status >= 500) return new HttpError(status, msg ?? 'IaC backend server error', true);
  return new HttpError(status, msg ?? `IaC request failed (${status})`, false);
}

/** Pull a message from a TFC JSON:API error (`{errors:[{detail|title}]}`) or a Pulumi error (`{message|error}`). */
export function iacErrorMessage(text: string): string | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as { errors?: Array<{ detail?: unknown; title?: unknown }>; message?: unknown; error?: unknown };
    if (Array.isArray(j.errors) && j.errors.length) {
      const e = j.errors[0];
      const s = typeof e.detail === 'string' ? e.detail : typeof e.title === 'string' ? e.title : null;
      if (s) return s;
    }
    if (typeof j.message === 'string' && j.message.trim()) return j.message;
    if (typeof j.error === 'string' && j.error.trim()) return j.error;
    return null;
  } catch {
    return null;
  }
}

/* ── Request helpers (what the collectors + actions call) ──────────────────────────────────────────── */

type Rec = Record<string, unknown>;

function requireSend(http: DiscoveryHttp): NonNullable<DiscoveryHttp['send']> {
  if (!http.send) throw new HttpError(500, 'IaC platform requires a bearer transport (send)', false);
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

/** GET a single JSON object (TFC single-resource / Pulumi object). */
export async function iacGet(http: DiscoveryHttp, path: string): Promise<Rec> {
  const send = requireSend(http);
  const r = await send({ method: 'GET', url: path });
  return safeJson(r.text);
}

/**
 * Drain a TFC JSON:API list endpoint, following `links.next` (an absolute same-origin URL). Returns the flattened
 * `data[]` records. Bounded by `MAX_PAGES`.
 */
export async function tfcList(http: DiscoveryHttp, path: string): Promise<Rec[]> {
  const send = requireSend(http);
  const items: Rec[] = [];
  let url: string | null = path;
  let pages = 0;
  while (url) {
    const r = await send({ method: 'GET', url });
    const body = safeJson(r.text);
    for (const d of Array.isArray(body.data) ? (body.data as Rec[]) : []) items.push(d);
    const links = (body.links ?? {}) as Rec;
    const next = typeof links.next === 'string' ? links.next : null;
    pages += 1;
    url = next && pages < MAX_PAGES ? next : null;
  }
  return items;
}

/** Drain a Pulumi list endpoint, following `continuationToken`. `listKey` is the array wrapper (`stacks`). */
export async function pulumiList(http: DiscoveryHttp, path: string, listKey: string): Promise<Rec[]> {
  const send = requireSend(http);
  const items: Rec[] = [];
  let token: string | null = null;
  let pages = 0;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const url = token ? `${path}${sep}continuationToken=${encodeURIComponent(token)}` : path;
    const r = await send({ method: 'GET', url });
    const body = safeJson(r.text);
    const arr = body[listKey];
    if (Array.isArray(arr)) for (const it of arr as Rec[]) items.push(it);
    const next = body.continuationToken;
    token = typeof next === 'string' && next.length > 0 ? next : null;
    pages += 1;
    if (!token || pages >= MAX_PAGES) break;
  }
  return items;
}

/** POST a mutating request (a TFC run / lock — never an apply). Returns the parsed body. */
export async function iacPost(http: DiscoveryHttp, path: string, body?: Rec): Promise<Rec> {
  const send = requireSend(http);
  const r = await send({
    method: 'POST',
    url: path,
    headers: body !== undefined ? { 'Content-Type': 'application/vnd.api+json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return r.text ? safeJson(r.text) : {};
}

/** Fetch + parse a signed state/plan artifact (credential-free) into a JSON object. */
export async function fetchArtifactJson(http: IacTransport, url: string): Promise<Rec> {
  const text = await http.getArtifact(url);
  return safeJson(text);
}

/** Fetch the TFC `json-output` plan JSON: follow the authenticated 307 to its signed URL, then fetch it. */
export async function fetchPlanJson(http: IacTransport, path: string): Promise<Rec | null> {
  const { location, text } = await http.getLocation(path);
  if (text) return safeJson(text);
  if (location) return fetchArtifactJson(http, location);
  return null;
}
