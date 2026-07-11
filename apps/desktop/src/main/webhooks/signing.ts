/**
 * Webhook payload signing (P3.0, Increment 4) — HMAC-SHA256, dependency-free.
 * The platform signs each outbound body; the receiver verifies with the shared
 * secret. `verifyWebhook` is exported for parity/testing and mirrors what an SDK
 * consumer runs. Timing-safe comparison. Pure.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** `sha256=<hex hmac>` over the raw request body. */
export function signWebhook(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** Constant-time verification of a presented signature against the body. */
export function verifyWebhook(secret: string, body: string, signature: string): boolean {
  const expected = signWebhook(secret, body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
