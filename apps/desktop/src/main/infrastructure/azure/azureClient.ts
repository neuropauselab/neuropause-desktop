/**
 * The Azure transport (P6.2 — Azure Cloud Platform). An `AzureClient` implements the P6.0 `DiscoveryHttp`
 * contract by attaching an OAuth2 BEARER token (Microsoft Entra ID) to each request and rate-gating it, then
 * returning the raw response for the collector/action to parse. Unlike AWS (SigV4), Azure is plain bearer
 * JSON across three planes — ARM (`management.azure.com`), Microsoft Graph (`graph.microsoft.com`), and Key
 * Vault data-plane (`*.vault.azure.net`) — so this reuses the connector error taxonomy and the shared
 * rate-gate with NO new runtime and NO signing. The token AUDIENCE is derived from the request host, so one
 * client transparently serves all three planes.
 *
 * SECURITY: Azure list responses carry a `nextLink` URL that the engine fetches next — a compromised or
 * spoofed response could point it off-Azure and exfiltrate the bearer token. `isAzureHost` is the single
 * choke point that refuses to attach a token to any host that is not a known Azure endpoint.
 */
import type { DiscoveryHttp, DiscoveryRequest, DiscoveryResponse } from '@neuropause/shared';
import { AuthError, HttpError, RateLimitError, type RateGate } from '../../unified/sync/http';

/** The three Azure token audiences (the `{audience}/.default` scope is requested per-plane). */
export const ARM_AUDIENCE = 'https://management.azure.com';
export const GRAPH_AUDIENCE = 'https://graph.microsoft.com';
export const VAULT_AUDIENCE = 'https://vault.azure.net';

/** Map an Azure request host onto the token audience it needs, or null if the host is NOT a known Azure plane. */
export function audienceForHost(host: string): string | null {
  const h = host.toLowerCase();
  if (h === 'management.azure.com') return ARM_AUDIENCE;
  if (h === 'graph.microsoft.com') return GRAPH_AUDIENCE;
  if (h === 'vault.azure.net' || h.endsWith('.vault.azure.net')) return VAULT_AUDIENCE;
  return null;
}

/** A host is Azure iff it maps to a known audience — the SSRF guard for bearer-token requests. */
export function isAzureHost(host: string): boolean {
  return audienceForHost(host) !== null;
}

/** A source of a bearer token for a given audience (env service principal, managed identity, or a test stub). */
export type AzureTokenProvider = (audience: string) => Promise<string>;

/**
 * Wrap a raw token fetch with per-audience caching (re-fetch ~60s before expiry). Pure + injectable so the
 * caching is unit-testable without a live Entra endpoint. Mirrors AWS's cached `assumeRoleProvider`.
 */
export function cachedTokenProvider(
  fetchToken: (audience: string) => Promise<{ token: string; expiresInSec: number }>,
  nowMs: () => number = () => Date.now(),
): AzureTokenProvider {
  const cache = new Map<string, { token: string; expiresAtMs: number }>();
  return async (audience) => {
    const now = nowMs();
    const hit = cache.get(audience);
    if (hit && hit.expiresAtMs - 60_000 > now) return hit.token;
    const { token, expiresInSec } = await fetchToken(audience);
    cache.set(audience, { token, expiresAtMs: now + Math.max(0, expiresInSec) * 1000 });
    return token;
  };
}

export class AzureClient implements DiscoveryHttp {
  constructor(
    private readonly token: AzureTokenProvider,
    private readonly gate: RateGate,
  ) {}

  async send(req: DiscoveryRequest): Promise<DiscoveryResponse> {
    const u = new URL(req.url);
    // SSRF / token-exfiltration hard stop: NEVER attach a bearer token to a non-Azure host. Azure follows
    // `nextLink` URLs taken from response bodies, so this guard runs BEFORE the token is acquired/attached.
    const audience = audienceForHost(u.hostname);
    if (!audience) throw new HttpError(400, `Refusing to send a request to a non-Azure host: ${u.hostname}`, false);

    await this.gate.acquire(u.hostname);
    const bearer = await this.token(audience);
    const headers: Record<string, string> = { ...(req.headers ?? {}), Authorization: `Bearer ${bearer}` };
    const isBodyless = req.method === 'GET' || req.method === 'HEAD';
    if (!isBodyless && req.body && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }

    const resp = await fetch(req.url, { method: req.method, headers, body: isBodyless ? undefined : (req.body ?? undefined) });
    const text = await resp.text();
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => (respHeaders[k] = v));
    if (!resp.ok) {
      const err = errorFor(resp.status, respHeaders, text);
      // Back off the shared rate-gate on a throttle so the rest of the run paces itself (not just this call).
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

/** Map an Azure HTTP status onto the connector error taxonomy so the Discovery Engine degrades gracefully. */
export function errorFor(status: number, headers: Record<string, string>, text: string): Error {
  if (status === 401 || status === 403) return new AuthError(azureErrorMessage(text) ?? 'Azure access denied', status);
  if (status === 404) return new HttpError(404, azureErrorMessage(text) ?? 'Azure resource not found', false);
  if (status === 429 || status === 503) {
    const retryAfter = Number(headers['retry-after']);
    // Floor at 1s so a `Retry-After: 0` (or a missing header) still backs off meaningfully.
    return new RateLimitError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(1000, retryAfter * 1000) : 2000);
  }
  if (status >= 500) return new HttpError(status, 'Azure server error', true);
  return new HttpError(status, azureErrorMessage(text) ?? `Azure request failed (${status})`, false);
}

/** Pull the Azure error `code`/`message` out of an ARM/Graph JSON error body (best-effort, non-sensitive). */
export function azureErrorMessage(text: string): string | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as { error?: { code?: string; message?: string } | string; code?: string; message?: string };
    if (j && typeof j.error === 'object' && j.error) return j.error.code ?? j.error.message ?? null;
    if (typeof j?.error === 'string') return j.error;
    return j?.code ?? j?.message ?? null;
  } catch {
    return null;
  }
}

/* ── Per-protocol request helpers (what the collectors + actions call) ────────────── */

type Rec = Record<string, unknown>;

/** Require the transport's `send` (AzureClient provides it; the unconfigured stub throws before we get here). */
function requireSend(http: DiscoveryHttp): NonNullable<DiscoveryHttp['send']> {
  if (!http.send) throw new HttpError(500, 'Azure platform requires a bearer transport (send)', false);
  return http.send.bind(http);
}

/**
 * Fetch ONE page of an Azure list (ARM or Graph). Both return `{ value: [...] }`; ARM paginates via `nextLink`
 * and Graph via `@odata.nextLink` — both are absolute URLs, normalized here to a single `nextLink`.
 */
export async function azurePage(http: DiscoveryHttp, url: string): Promise<{ items: Rec[]; nextLink: string | null }> {
  const send = requireSend(http);
  const r = await send({ method: 'GET', url });
  const data = (r.text ? JSON.parse(r.text) : {}) as { value?: Rec[]; nextLink?: string; '@odata.nextLink'?: string };
  return { items: Array.isArray(data.value) ? data.value : [], nextLink: data.nextLink ?? data['@odata.nextLink'] ?? null };
}

/** Fetch EVERY page of an Azure list (follows nextLink to exhaustion) — for parent enumeration by sub-resource
 *  collectors. Bounded by the list size; the shared rate-gate paces the calls. */
export async function azureListAll(http: DiscoveryHttp, initialUrl: string): Promise<Rec[]> {
  const out: Rec[] = [];
  let url: string | null = initialUrl;
  while (url) {
    const { items, nextLink } = await azurePage(http, url);
    out.push(...items);
    url = nextLink;
  }
  return out;
}

/** POST an Azure mutation (ARM action or Key Vault data-plane), parse the JSON response (may be empty). */
export async function azurePost(http: DiscoveryHttp, url: string, body?: Rec): Promise<Rec> {
  const send = requireSend(http);
  const r = await send({ method: 'POST', url, body: body ? JSON.stringify(body) : undefined });
  return r.text ? (JSON.parse(r.text) as Rec) : {};
}
