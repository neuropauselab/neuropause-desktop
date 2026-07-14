/**
 * The VMware vSphere transport (P6.6 — VMware Cloud Platform). A `VmwareClient` implements the P6.0
 * `DiscoveryHttp` contract against ONE configured vCenter Server via its vSphere Automation REST API (the modern
 * `/api` namespace). vCenter lives at an ARBITRARY host per deployment, so — like the Kubernetes API server — the
 * client is SERVER-PINNED: bound to one vCenter origin, collectors/actions use RELATIVE paths
 * (`/api/vcenter/vm`, `/api/vcenter/host`), and any request whose origin is not the pinned vCenter is refused.
 *
 * AUTH — a session token, obtained lazily. vCenter authenticates a `POST /api/session` with HTTP Basic
 * (username:password) and returns a session id; every subsequent call carries it in a `vmware-api-session-id`
 * header (never Basic again). This client mirrors the GCP lazy-credential pattern: the session is created on
 * first use, cached, and re-created ONCE on a 401 (an expired/idle-timed session). The Basic credential is only
 * ever sent to `${pinnedOrigin}/api/session` — after the origin guard — so it can never leak to another host.
 *
 * SECURITY: the origin-equality guard in `send` runs BEFORE the session header (or the Basic credential) is
 * attached; a vSphere list endpoint returns a full array (no pagination), so nothing a response returns can
 * redirect the transport off-vCenter. TLS: the client uses the process trust store — a private vCenter CA is
 * trusted via the standard `NODE_EXTRA_CA_CERTS` mechanism (documented); per-request CA injection is a noted
 * enhancement (it would add the `undici` dependency). Reuses the shared rate-gate + connector error taxonomy.
 */
import type { DiscoveryHttp, DiscoveryRequest, DiscoveryResponse } from '@neuropause/shared';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const REQUEST_TIMEOUT_MS = 60_000;

export class VmwareClient implements DiscoveryHttp {
  /** protocol+host+port of the configured vCenter (the pin). */
  private readonly serverOrigin: string;
  /** origin + any path prefix; relative paths resolve against this. */
  private readonly base: string;
  /** The cached session id, or null when not yet authenticated / after a 401. */
  private sessionId: string | null;
  /** De-dupe concurrent first-use authentications into one `POST /api/session`. */
  private authInFlight: Promise<string> | null = null;

  constructor(
    server: string,
    private readonly username: string,
    private readonly password: string,
    private readonly gate: RateGate,
    /** Optional pre-seeded session (tests inject it to skip the Basic-auth round-trip). */
    initialSession: string | null = null,
  ) {
    const u = new URL(server); // throws on a malformed server URL — the caller guards + degrades unconfigured
    this.serverOrigin = u.origin;
    this.base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    this.sessionId = initialSession;
  }

  /** Relative paths resolve against the pinned vCenter; an absolute URL is left as-is (and guarded in send). */
  private resolveUrl(url: string): string {
    return url.startsWith('/') ? `${this.base}${url}` : url;
  }

  /** Create (or reuse) the vCenter session. The Basic credential is sent ONLY to the pinned `/api/session`. */
  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    if (this.authInFlight) return this.authInFlight;
    this.authInFlight = (async () => {
      const host = new URL(this.base).host;
      await this.gate.acquire(host);
      const basic = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      let resp: Response;
      try {
        resp = await fetch(`${this.base}/api/session`, {
          method: 'POST',
          headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
          // Refuse to follow a redirect: a 3xx off the pinned origin must never carry (or re-issue) the credential.
          redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new NetworkError(err instanceof Error ? err.message : 'vCenter session request failed');
      }
      let text: string;
      try {
        text = await resp.text();
      } catch (err) {
        throw new NetworkError(err instanceof Error ? err.message : 'vCenter session body read failed');
      }
      if (!resp.ok) {
        const headers: Record<string, string> = {};
        resp.headers.forEach((v, k) => (headers[k] = v));
        const err = errorFor(resp.status, headers, text);
        if (err instanceof RateLimitError) this.gate.penalize(host, err.retryAfterMs);
        throw err;
      }
      const token = parseSessionId(text);
      if (!token) throw new AuthError('vCenter did not return a session id', 401);
      this.sessionId = token;
      return token;
    })();
    try {
      return await this.authInFlight;
    } finally {
      this.authInFlight = null;
    }
  }

  async send(req: DiscoveryRequest): Promise<DiscoveryResponse> {
    const full = this.resolveUrl(req.url);
    const u = new URL(full);
    // SSRF / credential-exfiltration hard stop: the session (and the Basic credential behind it) is bound to ONE
    // configured vCenter; refuse any other origin BEFORE authenticating or attaching the session header.
    if (u.origin !== this.serverOrigin) {
      throw new HttpError(400, `Refusing to send a request to a non-vCenter host: ${u.origin}`, false);
    }
    return this.sendAuthenticated(req, full, u.host, true);
  }

  private async sendAuthenticated(req: DiscoveryRequest, full: string, host: string, allowReauth: boolean): Promise<DiscoveryResponse> {
    const session = await this.ensureSession();
    await this.gate.acquire(host);
    const headers: Record<string, string> = { ...(req.headers ?? {}), 'vmware-api-session-id': session, Accept: 'application/json' };
    const isBodyless = req.method === 'GET' || req.method === 'HEAD';
    if (!isBodyless && req.body && !headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';

    let resp: Response;
    try {
      resp = await fetch(full, {
        method: req.method,
        headers,
        body: isBodyless ? undefined : (req.body ?? undefined),
        // Refuse to follow a redirect: a 3xx to another host would otherwise carry the `vmware-api-session-id`
        // header (fetch only strips Authorization/Cookie cross-origin, not a custom header) — a token exfil.
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'vCenter fetch failed');
    }
    let text: string;
    try {
      text = await resp.text();
    } catch (err) {
      // A connection dropped WHILE the body streams (or a timeout mid-body) degrades like an offline connector.
      throw new NetworkError(err instanceof Error ? err.message : 'vCenter body read failed');
    }
    // A 401 means the session expired / idle-timed out — drop it and re-authenticate ONCE, then retry.
    if (resp.status === 401 && allowReauth) {
      this.sessionId = null;
      return this.sendAuthenticated(req, full, host, false);
    }
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => (respHeaders[k] = v));
    if (!resp.ok) {
      const err = errorFor(resp.status, respHeaders, text);
      if (err instanceof RateLimitError) this.gate.penalize(host, err.retryAfterMs);
      throw err;
    }
    return { status: resp.status, headers: respHeaders, text };
  }

  /** DiscoveryHttp compatibility — a GET whose body is parsed as JSON (the `/api` namespace returns bare JSON). */
  async getJson<T>(url: string, opts?: { query?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string> }): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    const u = new URL(this.resolveUrl(url));
    for (const [k, v] of Object.entries(opts?.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    const r = await this.send({ method: 'GET', url: u.toString(), headers: opts?.headers });
    return { data: (r.text ? JSON.parse(r.text) : null) as T, status: r.status, headers: r.headers };
  }
}

/** Parse the `POST /api/session` body: `/api` returns a bare quoted string; legacy `/rest` returns `{"value":…}`. */
export function parseSessionId(text: string): string | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as unknown;
    if (typeof j === 'string') return j.trim() || null;
    if (j && typeof j === 'object' && typeof (j as { value?: unknown }).value === 'string') return ((j as { value: string }).value).trim() || null;
    return null;
  } catch {
    return text.replace(/^"|"$/g, '').trim() || null;
  }
}

/** Map a vCenter HTTP status onto the connector error taxonomy so the Discovery Engine degrades gracefully. */
export function errorFor(status: number, headers: Record<string, string>, text: string): Error {
  const msg = vmwareErrorMessage(text);
  if (status === 401 || status === 403) return new AuthError(msg ?? 'vCenter access denied', status);
  if (status === 404) return new HttpError(404, msg ?? 'vCenter resource not found', false);
  if (status === 429 || status === 503) {
    const retryAfter = Number(headers['retry-after']);
    return new RateLimitError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(1000, retryAfter * 1000) : 2000);
  }
  if (status >= 500) return new HttpError(status, msg ?? 'vCenter server error', true);
  return new HttpError(status, msg ?? `vCenter request failed (${status})`, false);
}

/** The vSphere REST error type-id for an over-cap list (`GET /api/vcenter/vm` beyond ~1000 matches). */
const TOO_MANY_RE = /unable_to_allocate_resource|too_many|Too many/i;

/** True when an error is the vSphere "too many matches" 400 — the signal to fan out a list by container. */
export function isTooManyMatches(err: unknown): boolean {
  return err instanceof HttpError && err.status === 400 && TOO_MANY_RE.test(err.message);
}

/**
 * Pull a message out of a vSphere error body (`{ error_type, messages:[{default_message}] }`, possibly under a
 * `{ value: … }` envelope). The stable `error_type` token (e.g. `UNABLE_TO_ALLOCATE_RESOURCE`,
 * `ALREADY_IN_DESIRED_STATE`) is PREPENDED when present, so downstream matchers (the over-cap fan-out signal, the
 * benign already-in-state check) key off the machine token rather than a localizable `default_message`.
 */
export function vmwareErrorMessage(text: string): string | null {
  if (!text) return null;
  try {
    const root = JSON.parse(text) as Record<string, unknown>;
    const body = (root.value && typeof root.value === 'object' ? (root.value as Record<string, unknown>) : root);
    let human: string | null = null;
    const messages = body.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const m = messages[0] as { default_message?: unknown };
      if (typeof m.default_message === 'string') human = m.default_message.trim() || null;
    }
    const type = typeof (body as { error_type?: unknown }).error_type === 'string' ? (body as { error_type: string }).error_type : null;
    if (type && human) return `${type}: ${human}`;
    return type ?? human;
  } catch {
    return null;
  }
}

/* ── Per-verb request helpers (what the collectors + actions call) — the Automation API has NO pagination ──── */

type Rec = Record<string, unknown>;

function requireSend(http: DiscoveryHttp): NonNullable<DiscoveryHttp['send']> {
  if (!http.send) throw new HttpError(500, 'VMware platform requires a session transport (send)', false);
  return http.send.bind(http);
}

/** GET a vSphere list endpoint → a bare JSON array (tolerates the legacy `{ value: [...] }` envelope). */
export async function vmwareList<T = Rec>(http: DiscoveryHttp, path: string): Promise<T[]> {
  const send = requireSend(http);
  const r = await send({ method: 'GET', url: path });
  const data = r.text ? (JSON.parse(r.text) as unknown) : [];
  if (Array.isArray(data)) return data as T[];
  const inner = data && typeof data === 'object' ? (data as { value?: unknown }).value : undefined;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

/** GET a single vSphere object → parsed JSON (tolerates the legacy `{ value: {...} }` envelope). */
export async function vmwareGet<T = Rec>(http: DiscoveryHttp, path: string): Promise<T> {
  const send = requireSend(http);
  const r = await send({ method: 'GET', url: path });
  const data = r.text ? (JSON.parse(r.text) as unknown) : {};
  if (data && typeof data === 'object' && !Array.isArray(data) && 'value' in (data as Rec)) return (data as { value: T }).value;
  return data as T;
}

/** POST a vSphere action (power, clone, relocate). Returns the RAW status + text (a 200/204, or a task id). */
export async function vmwarePost(http: DiscoveryHttp, path: string, body?: Rec): Promise<{ status: number; text: string }> {
  const send = requireSend(http);
  const r = await send({
    method: 'POST',
    url: path,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, text: r.text };
}
