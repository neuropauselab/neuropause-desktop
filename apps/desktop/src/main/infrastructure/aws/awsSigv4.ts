/**
 * AWS Signature Version 4 signer (P6.1 — AWS Cloud Platform).
 *
 * A from-scratch SigV4 implementation over Node's `crypto` (no AWS SDK, no new dependency). It is the trust
 * anchor for the entire AWS platform — every discovery + automation request is signed here — so it is
 * unit-tested against the official AWS `aws-sig-v4-test-suite` `get-vanilla` vector (the intermediate
 * canonical-request hash, signing key, and final signature are each asserted, so a regression localizes).
 *
 * Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
 */
import { createHash, createHmac } from 'node:crypto';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Present for temporary / assumed-role credentials; must be sent AND signed as `X-Amz-Security-Token`. */
  sessionToken?: string | null;
}

export interface SignInput {
  method: string;
  /** Host only, e.g. `ec2.us-east-1.amazonaws.com`. */
  host: string;
  /** Path, e.g. `/` or `/2015-03-31/functions/`. */
  path: string;
  /** Already-encoded canonical query string (may be empty). */
  query?: string;
  headers: Record<string, string>;
  /** Raw request body (empty string for a bodyless GET). */
  body: string;
  region: string;
  service: string;
  /** The signing instant as an ISO string; the amz date is derived from it. */
  now: string;
}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}
function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** `YYYYMMDDTHHMMSSZ` from an ISO instant. */
export function amzDate(nowIso: string): string {
  return new Date(nowIso).toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/** RFC-3986 encode a string; `encodeSlash=false` leaves `/` (for canonical URIs). */
function uriEncode(v: string, encodeSlash = true): string {
  let out = '';
  for (const ch of v) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else if (ch === '/' && !encodeSlash) out += ch;
    else out += [...Buffer.from(ch, 'utf8')].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('');
  }
  return out;
}

/** Encode a set of query params into a canonical (sorted, encoded) query string. */
export function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join('&');
}

/** The hex SHA-256 of a payload (empty → the well-known empty hash). */
export function payloadHash(body: string): string {
  return body ? sha256Hex(body) : EMPTY_SHA256;
}

/** The derived signing key `kSigning` (exposed for the test vector). */
export function signingKey(secret: string, datestamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, datestamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export interface SignedHeaders {
  headers: Record<string, string>;
  /** The canonical request (exposed for tests/debug). */
  canonicalRequest: string;
  signature: string;
}

/**
 * Sign a request, returning the headers to send (Authorization, X-Amz-Date, and X-Amz-Security-Token /
 * X-Amz-Content-Sha256 when applicable). `Host` is always signed; a session token is signed when present.
 */
export function signRequest(creds: AwsCredentials, input: SignInput): SignedHeaders {
  const amzdate = amzDate(input.now);
  const datestamp = amzdate.slice(0, 8);
  const hashedPayload = payloadHash(input.body);

  // Canonical headers: host + x-amz-date (+ content-sha256 / security-token / any caller headers), lowercased,
  // sorted, trimmed. We always include host + x-amz-date; the caller's headers (content-type, x-amz-target)
  // are folded in so they're signed too.
  const signed: Record<string, string> = {
    host: input.host,
    'x-amz-date': amzdate,
  };
  for (const [k, v] of Object.entries(input.headers)) {
    const lk = k.toLowerCase();
    if (lk === 'authorization' || lk === 'host' || lk === 'x-amz-date') continue;
    signed[lk] = String(v).trim();
  }
  if (creds.sessionToken) signed['x-amz-security-token'] = creds.sessionToken;

  const signedHeaderNames = Object.keys(signed).sort();
  const canonicalHeaders = signedHeaderNames.map((n) => `${n}:${signed[n]}\n`).join('');
  const signedHeadersList = signedHeaderNames.join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path || '/',
    input.query ?? '',
    canonicalHeaders,
    signedHeadersList,
    hashedPayload,
  ].join('\n');

  const scope = `${datestamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzdate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kSigning = signingKey(creds.secretAccessKey, datestamp, input.region, input.service);
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;

  const outHeaders: Record<string, string> = {
    ...input.headers,
    Host: input.host,
    'X-Amz-Date': amzdate,
    Authorization: authorization,
  };
  if (creds.sessionToken) outHeaders['X-Amz-Security-Token'] = creds.sessionToken;

  return { headers: outHeaders, canonicalRequest, signature };
}
