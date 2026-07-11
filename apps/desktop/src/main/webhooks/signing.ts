/**
 * Webhook payload signing (P3.0) — HMAC-SHA256 over `<timestamp>.<body>`, emitted as
 * `t=<unix_ms>,v1=<hex>`. This is the SAME wire format the official SDK's
 * `verifyWebhook` checks (timestamped to resist replay), so a delivery signed here
 * verifies with the SDK unchanged. Dependency-free; timing-safe compare.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TOLERANCE_MS = 5 * 60_000;

/** `t=<ms>,v1=<hex>` — the value for the `x-neuropause-signature` header. */
export function signWebhook(secret: string, body: string, timestampMs: number = Date.now()): string {
  const mac = createHmac('sha256', secret).update(`${timestampMs}.${body}`).digest('hex');
  return `t=${timestampMs},v1=${mac}`;
}

function parseHeader(header: string): { t: number; v1: string } | null {
  const parts = header.split(',').reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  if (!parts.t || !parts.v1) return null;
  const t = Number(parts.t);
  return Number.isFinite(t) ? { t, v1: parts.v1 } : null;
}

/** Verify a `t=,v1=` signature over the body, within a freshness tolerance. Never throws. */
export function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  toleranceMs: number = DEFAULT_TOLERANCE_MS,
  nowMs: number = Date.now(),
): boolean {
  const parsed = parseHeader(header);
  if (!parsed) return false;
  if (Math.abs(nowMs - parsed.t) > toleranceMs) return false;
  const expected = createHmac('sha256', secret).update(`${parsed.t}.${body}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(parsed.v1, 'hex');
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
