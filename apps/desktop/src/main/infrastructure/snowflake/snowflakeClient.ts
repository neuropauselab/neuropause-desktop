/**
 * The Snowflake transport (P6.8 — Snowflake Cloud Platform). A `SnowflakeClient` implements the P6.0
 * `DiscoveryHttp` contract against ONE configured Snowflake account via its SQL API v2
 * (`POST https://<account>.snowflakecomputing.com/api/v2/statements`). Discovery runs credit-free `SHOW` metadata
 * statements (no warehouse required); automation runs `ALTER` / `EXECUTE` statements. A Snowflake account lives at
 * an ARBITRARY per-account host, so — like the Kubernetes API server / vCenter — the client is HOST-PINNED: bound
 * to one account origin, collectors/actions use RELATIVE paths, and any request whose origin is not the pinned
 * account is refused.
 *
 * AUTH — a key-pair JWT (RS256), injected lazily. The account/user + RSA private key are signed into a
 * self-contained JWT (see `snowflakeAdapter.signSnowflakeJwt`) sent as `Authorization: Bearer <jwt>` plus the
 * `X-Snowflake-Authorization-Token-Type: KEYPAIR_JWT` header; there is no token-exchange round-trip. The origin
 * guard runs BEFORE the JWT is attached, and both fetches set `redirect: 'error'`, so the bearer JWT can never be
 * carried to another host.
 *
 * RESULT MODEL — the SQL API returns `{ resultSetMetaData: { rowType:[{name}], partitionInfo:[…] }, data:[[…]] }`
 * where EVERY cell is a JSON string (or null), regardless of the Snowflake type. Rows are parsed BY COLUMN NAME
 * (Snowflake appends new SHOW columns over time — positional parsing would silently break) and lower-cased. A
 * large result is split into PARTITIONS (partition 0 inline; the rest via `GET …?partition=N`), drained within one
 * collect() (Pattern B). A long statement answers 202 with a handle, polled to completion. Reuses the shared
 * rate-gate + connector error taxonomy, no new runtime.
 */
import type { DiscoveryHttp, DiscoveryRequest, DiscoveryResponse } from '@neuropause/shared';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const REQUEST_TIMEOUT_MS = 90_000;
/** Statement timeout (seconds) sent to the SQL API — SHOW/ALTER are fast; this bounds a pathological statement. */
const STATEMENT_TIMEOUT_S = 60;
/** Safety caps: a `SHOW` result rarely exceeds a few partitions, and a metadata statement completes fast. */
const MAX_PARTITIONS = 100;
const MAX_POLLS = 30;

/** A JWT provider — signs (and caches) the account's key-pair JWT, re-signing before it expires. */
export type SnowflakeTokenProvider = () => Promise<string>;

export class SnowflakeClient implements DiscoveryHttp {
  private readonly origin: string;
  private readonly base: string;

  constructor(
    accountUrl: string,
    private readonly token: SnowflakeTokenProvider,
    private readonly gate: RateGate,
  ) {
    const u = new URL(accountUrl); // throws on a malformed account URL — the caller guards + degrades unconfigured
    this.origin = u.origin;
    this.base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  }

  private resolveUrl(url: string): string {
    return url.startsWith('/') ? `${this.base}${url}` : url;
  }

  async send(req: DiscoveryRequest): Promise<DiscoveryResponse> {
    const full = this.resolveUrl(req.url);
    const u = new URL(full);
    // SSRF / token-exfiltration hard stop: the JWT is bound to ONE configured account; refuse any other origin
    // BEFORE the token is attached.
    if (u.origin !== this.origin) {
      throw new HttpError(400, `Refusing to send a request to a non-Snowflake host: ${u.origin}`, false);
    }
    const jwt = await this.token();
    await this.gate.acquire(u.host);
    const headers: Record<string, string> = {
      ...(req.headers ?? {}),
      Authorization: `Bearer ${jwt}`,
      'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
      Accept: 'application/json',
    };
    const isBodyless = req.method === 'GET' || req.method === 'HEAD';
    if (!isBodyless && req.body && !headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';

    let resp: Response;
    try {
      resp = await fetch(full, { method: req.method, headers, body: isBodyless ? undefined : (req.body ?? undefined), redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'snowflake fetch failed');
    }
    let text: string;
    try {
      text = await resp.text();
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'snowflake body read failed');
    }
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => (respHeaders[k.toLowerCase()] = v));
    // 202 (async / still running) is NOT an error — return it so the caller polls the statement handle.
    if (!resp.ok && resp.status !== 202) {
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

/** Map a Snowflake SQL API HTTP status onto the connector error taxonomy so the Discovery Engine degrades gracefully. */
export function errorFor(status: number, headers: Record<string, string>, text: string): Error {
  const msg = snowflakeErrorMessage(text);
  if (status === 401 || status === 403) return new AuthError(msg ?? 'Snowflake access denied', status);
  if (status === 404) return new HttpError(404, msg ?? 'Snowflake resource not found', false);
  if (status === 429) {
    const retryAfter = Number(headers['retry-after']);
    return new RateLimitError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(1000, retryAfter * 1000) : 5000);
  }
  if (status >= 500) return new HttpError(status, msg ?? 'Snowflake server error', true);
  // 400/422 (a SQL compile/execution error) is a non-retryable client error carrying the Snowflake message.
  return new HttpError(status, msg ?? `Snowflake request failed (${status})`, false);
}

/** Pull the message out of a Snowflake SQL API error/result body (`{ message, code, sqlState }`). */
export function snowflakeErrorMessage(text: string): string | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as { message?: unknown; code?: unknown };
    if (typeof j.message === 'string' && j.message.trim()) return typeof j.code === 'string' ? `${j.code}: ${j.message}` : j.message;
    return null;
  } catch {
    return null;
  }
}

/* ── SQL execution helpers (what the collectors + actions call) ────────────────────────────────────── */

type Rec = Record<string, unknown>;
interface SqlResultBody {
  statementHandle?: string;
  resultSetMetaData?: { rowType?: Array<{ name?: unknown }>; partitionInfo?: unknown[] };
  data?: unknown[][];
  message?: string;
}

function requireSend(http: DiscoveryHttp): NonNullable<DiscoveryHttp['send']> {
  if (!http.send) throw new HttpError(500, 'Snowflake platform requires a SQL transport (send)', false);
  return http.send.bind(http);
}
function parseBody(text: string): SqlResultBody {
  if (!text) return {};
  try {
    const j = JSON.parse(text) as unknown;
    return j && typeof j === 'object' ? (j as SqlResultBody) : {};
  } catch {
    return {};
  }
}
/** Turn a partition's `data` (arrays of string cells) into row objects keyed by the LOWER-cased column names. */
function rowsToObjects(cols: string[], data: unknown[][] | undefined): Rec[] {
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const o: Rec = {};
    for (let i = 0; i < cols.length; i += 1) o[cols[i]] = Array.isArray(row) ? (row[i] ?? null) : null;
    return o;
  });
}

/**
 * Run a read statement (a `SHOW`) and return every row as a lower-cased-key object, draining all result
 * partitions. A 202 (still running) is polled to completion first. No warehouse is consumed by `SHOW`.
 */
export async function snowflakeQuery(http: DiscoveryHttp, statement: string): Promise<Rec[]> {
  const send = requireSend(http);
  let resp = await send({ method: 'POST', url: '/api/v2/statements', body: JSON.stringify({ statement, timeout: STATEMENT_TIMEOUT_S }) });
  let body = parseBody(resp.text);
  // Poll a 202 (long statement) to completion via its handle.
  let polls = 0;
  while (resp.status === 202 && body.statementHandle && polls < MAX_POLLS) {
    resp = await send({ method: 'GET', url: `/api/v2/statements/${encodeURIComponent(body.statementHandle)}` });
    body = parseBody(resp.text);
    polls += 1;
  }
  // Still running after the poll budget — surface it as a retryable error rather than silently under-reporting.
  if (resp.status === 202) throw new HttpError(202, 'Snowflake statement did not complete within the poll budget', true);
  const cols = (body.resultSetMetaData?.rowType ?? []).map((c) => String(c?.name ?? '').toLowerCase());
  const rows = rowsToObjects(cols, body.data);
  // Drain partitions 1..N-1 (partition 0 is the inline `data`). Column layout is reused from partition 0.
  const partitions = body.resultSetMetaData?.partitionInfo ?? [];
  const handle = body.statementHandle;
  if (handle && Array.isArray(partitions)) {
    for (let n = 1; n < partitions.length && n <= MAX_PARTITIONS; n += 1) {
      const pr = await send({ method: 'GET', url: `/api/v2/statements/${encodeURIComponent(handle)}?partition=${n}` });
      rows.push(...rowsToObjects(cols, parseBody(pr.text).data));
    }
  }
  return rows;
}

/** Run a mutating statement (an `ALTER` / `EXECUTE`) and return the result body (`message`, `statementHandle`). */
export async function snowflakeExec(http: DiscoveryHttp, statement: string): Promise<SqlResultBody> {
  const send = requireSend(http);
  const resp = await send({ method: 'POST', url: '/api/v2/statements', body: JSON.stringify({ statement, timeout: STATEMENT_TIMEOUT_S }) });
  return parseBody(resp.text);
}
