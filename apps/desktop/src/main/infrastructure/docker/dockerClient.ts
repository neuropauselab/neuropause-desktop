/**
 * The Docker transport (P6.5 — Docker Cloud Platform). A `DockerClient` implements the P6.0 `DiscoveryHttp`
 * contract against ONE configured Docker Engine — a Unix socket (`unix:///var/run/docker.sock`), a TCP endpoint
 * (`tcp://host:2375`), or a mutually-authenticated TLS endpoint (`tcp://host:2376` + client cert/key + CA).
 * Unlike the bearer platforms (Azure/GCP) it is NOT `fetch`/https-only: the Docker Engine API is most commonly
 * a Unix-domain socket, which `fetch` cannot address, so this client speaks the `node:http` / `node:https`
 * builtins directly (`socketPath` for the socket, `host`/`port` for TCP, native `ca`/`cert`/`key` for mTLS).
 * No new dependency, no new runtime — it reuses the shared rate-gate and the connector error taxonomy.
 *
 * SECURITY — the engine is the pin (SSRF hard stop). The transport is bound to ONE engine at construction
 * (socket path OR host+port, fixed); collectors and actions build only ROOT-RELATIVE API paths
 * (`/containers/json`, `/services`), and the client REFUSES any non-relative / absolute-URL request before it
 * touches the socket. A response can never redirect the transport to another host: the destination is never
 * derived from a request URL — only its path + query are used. Pagination does not exist in the Engine API
 * (endpoints return full JSON arrays), so there is no response-provided URL to follow at all.
 */
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { DiscoveryHttp, DiscoveryRequest, DiscoveryResponse } from '@neuropause/shared';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const REQUEST_TIMEOUT_MS = 60_000;

/** A resolved Docker Engine target: either a Unix socket, or a TCP host+port with optional client TLS. */
export interface DockerTarget {
  /** unix:///var/run/docker.sock — a local engine socket. */
  socketPath?: string;
  /** A TCP engine host. */
  host?: string;
  port?: number;
  /**
   * Force TLS even when no client cert material is supplied — an `https://` engine with a publicly/CA-trusted
   * server cert (verified against the system trust store). Any of `ca`/`cert`/`key` implies TLS regardless.
   */
  tls?: boolean;
  /** mTLS material (PEM) for a `tcp://…:2376` engine — verified natively by node:https. */
  ca?: string;
  cert?: string;
  key?: string;
}

/** How the client reaches the engine: the fixed request-options fragment + whether TLS is in play. */
interface ResolvedTransport {
  base: RequestOptions;
  useTls: boolean;
}

export class DockerClient implements DiscoveryHttp {
  private readonly base: RequestOptions;
  private readonly useTls: boolean;

  constructor(
    target: DockerTarget,
    private readonly gate: RateGate,
    /** Rate-gate + telemetry key (the engine/host identifier). */
    private readonly key: string,
  ) {
    const t = resolveTransport(target); // throws on an empty/invalid target — the caller guards + degrades
    this.base = t.base;
    this.useTls = t.useTls;
  }

  /** Server-pin (SSRF hard stop): only a single-slash root-relative API path is accepted. An absolute URL, a
   *  protocol-relative `//host` path, or anything else is refused BEFORE the socket is opened. */
  private pinnedPath(url: string): string {
    if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) {
      throw new HttpError(400, `Refusing a non-relative Docker request path: ${String(url)}`, false);
    }
    return url;
  }

  async send(req: DiscoveryRequest): Promise<DiscoveryResponse> {
    const path = this.pinnedPath(req.url);
    await this.gate.acquire(this.key);
    const headers: Record<string, string> = { ...(req.headers ?? {}), Accept: 'application/json' };
    const isBodyless = req.method === 'GET' || req.method === 'HEAD';
    if (!isBodyless && req.body != null && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    const raw = await this.raw(req.method, path, headers, isBodyless ? undefined : req.body);
    if (raw.status >= 400) {
      const err = errorFor(raw.status, raw.headers, raw.text);
      if (err instanceof RateLimitError) this.gate.penalize(this.key, err.retryAfterMs);
      throw err;
    }
    return { status: raw.status, headers: raw.headers, text: raw.text };
  }

  /** DiscoveryHttp compatibility — a GET whose body is parsed as JSON. */
  async getJson<T>(
    url: string,
    opts?: { query?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string> },
  ): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    const path = withQuery(this.pinnedPath(url), opts?.query);
    const r = await this.send({ method: 'GET', url: path, headers: opts?.headers });
    return { data: (r.text ? JSON.parse(r.text) : null) as T, status: r.status, headers: r.headers };
  }

  /** The raw node:http / node:https round-trip against the pinned engine. */
  private raw(
    method: string,
    path: string,
    headers: Record<string, string>,
    body: string | undefined,
  ): Promise<{ status: number; headers: Record<string, string>; text: string }> {
    return new Promise((resolve, reject) => {
      // One options object typed as node:https RequestOptions feeds BOTH http.request and https.request
      // (https options is a structural superset — socketPath/host/port/ca/cert/key all typed).
      const opts: RequestOptions = { method, path, timeout: REQUEST_TIMEOUT_MS, headers, ...this.base };
      const onResponse = (res: IncomingMessage): void => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const respHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) respHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v ?? '';
          resolve({ status: res.statusCode ?? 0, headers: respHeaders, text: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', (err: Error) => reject(new NetworkError(err.message)));
      };
      let req: ClientRequest;
      try {
        req = this.useTls ? httpsRequest(opts, onResponse) : httpRequest(opts, onResponse);
      } catch (err) {
        reject(new NetworkError(err instanceof Error ? err.message : 'docker request failed'));
        return;
      }
      req.on('error', (err: Error) => reject(new NetworkError(err.message)));
      req.on('timeout', () => req.destroy(new NetworkError('docker request timed out')));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
}

/** Parse a `DockerTarget` into the fixed node request-options fragment (the pin). Throws on an empty target. */
function resolveTransport(target: DockerTarget): ResolvedTransport {
  if (target.socketPath) {
    return { base: { socketPath: target.socketPath }, useTls: false };
  }
  if (target.host) {
    // TLS is on if explicitly forced (an `https://` engine) OR any client cert material is present.
    const useTls = target.tls === true || !!(target.ca || target.cert || target.key);
    const base: RequestOptions = { host: target.host, port: target.port ?? (useTls ? 2376 : 2375) };
    if (useTls) {
      if (target.ca) base.ca = target.ca;
      if (target.cert) base.cert = target.cert;
      if (target.key) base.key = target.key;
    }
    return { base, useTls };
  }
  throw new Error('Docker engine target is empty (no socket path or host)');
}

/** Append a query string to a relative path (the engine has no pagination; this is for filters like `?all=true`). */
function withQuery(path: string, query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return path;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  if (parts.length === 0) return path;
  return path + (path.includes('?') ? '&' : '?') + parts.join('&');
}

/** Map a Docker Engine HTTP status onto the connector error taxonomy so the Discovery Engine degrades gracefully. */
export function errorFor(status: number, headers: Record<string, string>, text: string): Error {
  const msg = dockerErrorMessage(text);
  if (status === 401 || status === 403) return new AuthError(msg ?? 'Docker access denied', status);
  if (status === 404) return new HttpError(404, msg ?? 'Docker resource not found', false);
  // A Swarm endpoint (/nodes, /services, /tasks, /secrets, /configs) on an engine that is NOT a swarm manager
  // returns 503 "This node is not a swarm manager." — a PERMANENT not-provisioned condition, not a transient
  // overload. Map it to a NON-retryable 404 so the domain degrades `unprovisioned` (via errorStatus → 404),
  // instead of being retried forever as a rate-limit. A generic 503 stays a rate-limit backoff.
  if (status === 503 && /not a swarm manager/i.test(msg ?? '')) {
    return new HttpError(404, msg ?? 'This node is not a swarm manager', false);
  }
  if (status === 429 || status === 503) {
    const retryAfter = Number(headers['retry-after']);
    return new RateLimitError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(1000, retryAfter * 1000) : 2000);
  }
  if (status >= 500) return new HttpError(status, msg ?? 'Docker engine error', true);
  return new HttpError(status, msg ?? `Docker request failed (${status})`, false);
}

/** Pull the human message out of a Docker error body (`{"message":"…"}`) — best-effort, non-sensitive. */
export function dockerErrorMessage(text: string): string | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as { message?: unknown };
    return typeof j?.message === 'string' && j.message.trim() ? j.message.trim() : null;
  } catch {
    return null;
  }
}

/* ── Request helpers (what the collectors + actions call) — the Engine API has NO pagination ─────────── */

type Rec = Record<string, unknown>;

function requireSend(http: DiscoveryHttp): NonNullable<DiscoveryHttp['send']> {
  if (!http.send) throw new HttpError(500, 'Docker platform requires a raw transport (send)', false);
  return http.send.bind(http);
}

/**
 * GET a Docker list endpoint. Most return a bare JSON array (`/containers/json`, `/images/json`, `/networks`);
 * `/volumes` wraps its array in `{ Volumes: [...] }` — pass `listKey: 'Volumes'` for that shape. No pagination.
 */
export async function dockerList(http: DiscoveryHttp, path: string, listKey?: string): Promise<Rec[]> {
  const send = requireSend(http);
  const r = await send({ method: 'GET', url: path });
  const data = r.text ? (JSON.parse(r.text) as unknown) : [];
  if (listKey) {
    const inner = data && typeof data === 'object' ? (data as Rec)[listKey] : undefined;
    return Array.isArray(inner) ? (inner as Rec[]) : [];
  }
  return Array.isArray(data) ? (data as Rec[]) : [];
}

/** GET a single Docker object (e.g. a service inspect before an update), parsed as JSON. */
export async function dockerGet<T = Rec>(http: DiscoveryHttp, path: string): Promise<T> {
  const send = requireSend(http);
  const r = await send({ method: 'GET', url: path });
  return (r.text ? JSON.parse(r.text) : {}) as T;
}

/** POST to the engine (start/stop/restart, image pull, prune, service update). Returns the RAW status + text —
 *  some endpoints answer 204 no-content, and `/images/create` streams NDJSON progress, so the caller decides. */
export async function dockerPost(
  http: DiscoveryHttp,
  path: string,
  body?: Rec,
): Promise<{ status: number; text: string }> {
  const send = requireSend(http);
  const r = await send({
    method: 'POST',
    url: path,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, text: r.text };
}

/** DELETE an engine object (remove a container). Returns the raw status + text. */
export async function dockerDelete(http: DiscoveryHttp, path: string): Promise<{ status: number; text: string }> {
  const send = requireSend(http);
  const r = await send({ method: 'DELETE', url: path });
  return { status: r.status, text: r.text };
}
