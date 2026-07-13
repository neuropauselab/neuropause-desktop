/**
 * The AWS transport (P6.1). An `AwsClient` implements the P6.0 `DiscoveryHttp` contract (adding `send`) by
 * SIGNING each request with SigV4 (deriving the signing service + region from the host) and rate-gating it,
 * then returning the raw response text for the collector to parse. This is the client the Infrastructure
 * Runtime injects as `ctx.http` for the AWS platform — reusing the shared rate-gate and the connector error
 * taxonomy (so a 403 degrades a domain `unauthorized`, a 404 `unprovisioned`, a 429/5xx is retryable) with
 * NO new runtime. The per-protocol helpers below are what the collectors call.
 */
import type { DiscoveryHttp, DiscoveryRequest, DiscoveryResponse } from '@neuropause/shared';
import { AuthError, HttpError, RateLimitError, type RateGate } from '../../unified/sync/http';
import { canonicalQuery, payloadHash, signRequest, type AwsCredentials } from './awsSigv4';
import { asArray, parseXml, xmlGet } from './awsXml';

/** A well-formed AWS region token: `xx-region-N`, including GovCloud (`us-gov-west-1`) and multi-word
 *  regions (`ap-southeast-1`). Commercial/gov all match; this is also the SSRF guard's region shape. */
export const AWS_REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d+$/;

/** Every AWS endpoint is under `amazonaws.com` (or `amazonaws.com.cn`). A host that does not match is NOT AWS
 *  and must never receive a signed request (it would carry the Authorization header + session token). */
const AWS_HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.amazonaws\.com(\.cn)?$/i;
export function isAwsHost(host: string): boolean {
  return AWS_HOST_RE.test(host);
}

/** Derive the SigV4 signing scope from an AWS host. Global services sign against `us-east-1`. */
export function deriveScope(host: string): { service: string; region: string } {
  const parts = host.split('.');
  // `svc.{region}.amazonaws.com` → regional (GovCloud-safe region match).
  if (parts.length >= 4 && AWS_REGION_RE.test(parts[1])) {
    return { service: parts[0], region: parts[1] };
  }
  // `svc.amazonaws.com` (IAM / STS-global / Route53 / CloudFront / S3-global) → sign us-east-1.
  return { service: parts[0], region: 'us-east-1' };
}

export { type AwsCredentials };

/** A source of AWS credentials — either static (env keys) or an async provider (assume-role, cached). */
export type CredentialSource = AwsCredentials | (() => Promise<AwsCredentials>);

export class AwsClient implements DiscoveryHttp {
  constructor(
    private readonly credsOrProvider: CredentialSource,
    private readonly gate: RateGate,
    private readonly nowFn: () => string = () => new Date().toISOString(),
  ) {}

  private async creds(): Promise<AwsCredentials> {
    return typeof this.credsOrProvider === 'function' ? this.credsOrProvider() : this.credsOrProvider;
  }

  async send(req: DiscoveryRequest): Promise<DiscoveryResponse> {
    const u = new URL(req.url);
    // SSRF / credential-exfiltration hard stop: NEVER sign+send a request (which carries the Authorization
    // header and, for an assumed-role profile, the live X-Amz-Security-Token) to a non-AWS host. A crafted
    // region/host that resolves off `amazonaws.com` is refused here BEFORE any credential is attached — the
    // single choke point covering both discovery and automation.
    if (!isAwsHost(u.hostname)) {
      throw new HttpError(400, `Refusing to sign a request to a non-AWS host: ${u.hostname}`, false);
    }
    const { service, region } = deriveScope(u.hostname);
    const creds = await this.creds();
    await this.gate.acquire(service);

    // Canonicalize the query for signing (AWS re-canonicalizes; the wire order is irrelevant).
    const params: Record<string, string> = {};
    u.searchParams.forEach((v, k) => (params[k] = v));
    const query = Object.keys(params).length ? canonicalQuery(params) : '';

    const signed = signRequest(creds, {
      method: req.method,
      host: u.hostname,
      path: u.pathname || '/',
      query,
      headers: req.headers ?? {},
      body: req.body ?? '',
      region,
      service,
      now: this.nowFn(),
    });

    const resp = await fetch(req.url, {
      method: req.method,
      headers: signed.headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : (req.body ?? ''),
    });
    const text = await resp.text();
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => (headers[k] = v));
    if (!resp.ok) throw errorFor(resp.status, headers, text);
    return { status: resp.status, headers, text };
  }

  /** DiscoveryHttp compatibility — a signed GET whose body is parsed as JSON. Unused by AWS collectors. */
  async getJson<T>(url: string, opts?: { query?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string> }): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    const u = new URL(url);
    for (const [k, v] of Object.entries(opts?.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    const r = await this.send({ method: 'GET', url: u.toString(), headers: opts?.headers });
    return { data: (r.text ? JSON.parse(r.text) : null) as T, status: r.status, headers: r.headers };
  }
}

/** Map an AWS HTTP status onto the connector error taxonomy so the Discovery Engine degrades gracefully. */
function errorFor(status: number, headers: Record<string, string>, text: string): Error {
  if (status === 403) return new AuthError(awsErrorMessage(text) ?? 'AWS access denied', 403);
  if (status === 404) return new HttpError(404, awsErrorMessage(text) ?? 'AWS resource not found', false);
  if (status === 429 || status === 503) {
    const retryAfter = Number(headers['retry-after']);
    return new RateLimitError(Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000);
  }
  if (status >= 500) return new HttpError(status, 'AWS server error', true);
  return new HttpError(status, awsErrorMessage(text) ?? `AWS request failed (${status})`, false);
}

/** Pull the AWS error `Code`/`Message` out of an XML or JSON error body (best-effort, non-sensitive). */
function awsErrorMessage(text: string): string | null {
  if (!text) return null;
  const xmlCode = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
  if (xmlCode) return xmlCode;
  try {
    const j = JSON.parse(text) as { __type?: string; message?: string; Message?: string };
    return j.__type ?? j.message ?? j.Message ?? null;
  } catch {
    return null;
  }
}

/* ── Per-protocol request helpers (what the collectors call) ─────────────────── */

/** Require the transport's `send` (the AWS client provides it; a bearer-token fake would not). */
function requireSend(http: DiscoveryHttp): NonNullable<DiscoveryHttp['send']> {
  if (!http.send) throw new HttpError(500, 'AWS platform requires a signing transport (send)', false);
  return http.send.bind(http);
}

/** AWS "query" protocol (EC2/IAM/RDS/ELB/CloudWatch/AutoScaling): POST a form body, parse XML. */
export async function awsQuery(http: DiscoveryHttp, host: string, action: string, version: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const send = requireSend(http);
  const form = { Action: action, Version: version, ...params };
  const body = Object.entries(form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const r = await send({ method: 'POST', url: `https://${host}/`, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' }, body });
  return parseXml(r.text);
}

/** AWS JSON-RPC protocol (SecretsManager/ACM/ECS/CloudTrail): POST JSON with `X-Amz-Target`, parse JSON. */
export async function awsJsonRpc(http: DiscoveryHttp, host: string, target: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const send = requireSend(http);
  const r = await send({ method: 'POST', url: `https://${host}/`, headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': target }, body: JSON.stringify(body) });
  return r.text ? (JSON.parse(r.text) as Record<string, unknown>) : {};
}

/** AWS REST-JSON protocol (Lambda/EKS/EFS): a signed GET/POST at a path, parse JSON. */
export async function awsRestJson(http: DiscoveryHttp, method: string, url: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const send = requireSend(http);
  const r = await send({ method, url, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return r.text ? (JSON.parse(r.text) as Record<string, unknown>) : {};
}

/** AWS REST-XML protocol (S3/Route53/CloudFront): a signed request at a path, parse XML. The
 *  `x-amz-content-sha256` header is ALWAYS sent (S3 + CloudFront require it), set to the body's payload hash
 *  — the empty-body hash for a GET, the real hash for a mutating POST (e.g. a CloudFront invalidation). */
export async function awsRestXml(http: DiscoveryHttp, method: string, url: string, body?: string): Promise<Record<string, unknown>> {
  const send = requireSend(http);
  const headers: Record<string, string> = { 'x-amz-content-sha256': payloadHash(body ?? '') };
  if (body) headers['Content-Type'] = 'application/xml';
  const r = await send({ method, url, headers, body });
  return parseXml(r.text);
}

export { asArray, xmlGet };
