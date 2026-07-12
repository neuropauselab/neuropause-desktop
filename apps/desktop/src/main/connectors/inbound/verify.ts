/**
 * Inbound connector-webhook verification (P5 — Increment 2).
 *
 * Third-party providers sign the webhooks they deliver so we can prove a delivery is authentic
 * before acting on it. Each provider uses its own wire format, so this module implements them
 * precisely — GitHub / Notion / Slack HMAC-SHA256 over the RAW request body, plus the Microsoft
 * Graph subscription handshake — using the same timing-safe discipline as the outbound signer
 * (`webhooks/signing.ts`), but never that signer's format (which is NeuroPause's own `t=,v1=`).
 *
 * It is pure and dependency-injected (the clock is a parameter), so it unit-tests without any
 * network or Electron, and it is deployment-independent: the identical check runs whether a
 * delivery arrives over a cloud relay, a local tunnel, or Slack Socket Mode, or is replayed for
 * a test. No secret material is ever placed in a `reason` or logged.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type WebhookProvider = 'github' | 'slack' | 'notion' | 'microsoft';

export interface VerifyResult {
  ok: boolean;
  /** Why a delivery was rejected — a stable, non-sensitive label (never contains secret material). */
  reason?: string;
}

/** Slack rejects request timestamps older than 5 minutes to blunt replay attacks; we mirror that. */
export const SLACK_REPLAY_TOLERANCE_MS = 5 * 60_000;

/** Constant-time compare of two hex digests; false on any length/parse mismatch (never throws). */
export function timingSafeHexEqual(aHex: string, bHex: string): boolean {
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(aHex, 'hex');
    b = Buffer.from(bHex, 'hex');
  } catch {
    return false;
  }
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time compare of two opaque utf8 strings (e.g. Microsoft `clientState`). */
export function timingSafeUtf8Equal(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length > 0 && ab.length === bb.length && timingSafeEqual(ab, bb);
}

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

/** Verify a `sha256=<hex>` HMAC over the raw body with the given key. Shared by GitHub and Notion. */
function verifySha256Prefixed(rawBody: string, header: string | undefined, key: string): VerifyResult {
  if (!header) return { ok: false, reason: 'missing signature' };
  if (!header.startsWith('sha256=')) return { ok: false, reason: 'unsupported signature scheme' };
  const provided = header.slice('sha256='.length);
  return timingSafeHexEqual(provided, hmacHex(key, rawBody)) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

/** GitHub: `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256(webhookSecret, rawBody). */
export function verifyGitHubSignature(rawBody: string, signatureHeader: string | undefined, secret: string): VerifyResult {
  return verifySha256Prefixed(rawBody, signatureHeader, secret);
}

/** Notion: `X-Notion-Signature: sha256=<hex>` = HMAC-SHA256(verificationToken, rawBody). */
export function verifyNotionSignature(rawBody: string, signatureHeader: string | undefined, verificationToken: string): VerifyResult {
  return verifySha256Prefixed(rawBody, signatureHeader, verificationToken);
}

/**
 * Slack: `X-Slack-Signature: v0=<hex>` = HMAC-SHA256(signingSecret, `v0:<ts>:<rawBody>`), with the
 * request rejected if its `X-Slack-Request-Timestamp` is outside the replay window.
 */
export function verifySlackSignature(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
  signingSecret: string,
  nowMs: number,
  toleranceMs: number = SLACK_REPLAY_TOLERANCE_MS,
): VerifyResult {
  if (!signature || !timestamp) return { ok: false, reason: 'missing signature or timestamp' };
  const tsSec = Number(timestamp);
  if (!Number.isFinite(tsSec)) return { ok: false, reason: 'bad timestamp' };
  if (Math.abs(nowMs - tsSec * 1000) > toleranceMs) return { ok: false, reason: 'stale timestamp' };
  if (!signature.startsWith('v0=')) return { ok: false, reason: 'unsupported signature scheme' };
  const provided = signature.slice('v0='.length);
  const expected = hmacHex(signingSecret, `v0:${timestamp}:${rawBody}`);
  return timingSafeHexEqual(provided, expected) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

/**
 * Microsoft Graph subscription-creation handshake: Graph POSTs `?validationToken=<t>` and expects a
 * 200 with the token echoed as `text/plain` within 10s. Returns the response to send, or null if this
 * delivery is not a validation request.
 */
export function graphValidationResponse(
  validationToken: string | undefined,
): { status: number; contentType: string; body: string } | null {
  if (!validationToken) return null;
  return { status: 200, contentType: 'text/plain', body: validationToken };
}

/**
 * Microsoft Graph notification authenticity: Graph has no HMAC, so a notification is trusted only when
 * its `clientState` equals the opaque secret we set at subscription creation (compared constant-time).
 */
export function verifyGraphClientState(received: string | undefined, expected: string): VerifyResult {
  return timingSafeUtf8Equal(received, expected) ? { ok: true } : { ok: false, reason: 'clientState mismatch' };
}
