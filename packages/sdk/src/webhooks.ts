/**
 * Webhook helpers — HMAC-SHA256 signing + verification for event delivery, with
 * a constant-time comparison and a timestamp tolerance to resist replay. The
 * signature header format is `t=<unix_ms>,v1=<hex>` over `<t>.<payload>`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookEvent<T = unknown> {
  id: string;
  type: string;
  createdAt: string;
  data: T;
}

const DEFAULT_TOLERANCE_MS = 5 * 60_000;

export function signWebhook(payload: string, secret: string, timestamp: number = Date.now()): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

function parseHeader(header: string): { t: number; v1: string } | null {
  const parts = header.split(',').reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  if (!parts.t || !parts.v1) return null;
  const t = Number(parts.t);
  if (!Number.isFinite(t)) return null;
  return { t, v1: parts.v1 };
}

export function verifyWebhook(payload: string, header: string, secret: string, toleranceMs: number = DEFAULT_TOLERANCE_MS): boolean {
  const parsed = parseHeader(header);
  if (!parsed) return false;
  if (Math.abs(Date.now() - parsed.t) > toleranceMs) return false;
  const expected = createHmac('sha256', secret).update(`${parsed.t}.${payload}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(parsed.v1, 'hex');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export function parseWebhook<T = unknown>(payload: string): WebhookEvent<T> {
  return JSON.parse(payload) as WebhookEvent<T>;
}
