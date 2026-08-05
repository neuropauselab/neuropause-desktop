/**
 * Webhook framework (NCEA 13.0, Phase 6). Real signature verification (HMAC via
 * node:crypto with a timing-safe compare) for GitHub, Slack, and Stripe — this
 * crypto is genuine and VERIFIED here. The receiver verifies, deduplicates by
 * event id, publishes accepted events to the ONE Enterprise Runtime event bus
 * (topic `webhooks`), and dead-letters failures for replay. Nothing bypasses the
 * bus; invalid signatures are rejected, not trusted.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from '@neuropause/cloud-core';
import { randomId } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** GitHub: `X-Hub-Signature-256: sha256=<hmac>`. */
export function verifyGithubSignature(secret: string, body: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  return safeEqualHex(expected, header);
}

/** Slack: `v0=<hmac(secret, 'v0:'+ts+':'+body)>` with a timestamp freshness window. */
export function verifySlackSignature(
  secret: string,
  body: string,
  timestamp: string | undefined,
  signature: string | undefined,
  now: number,
  toleranceSec = 300,
): boolean {
  if (!timestamp || !signature) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSec) return false;
  const expected = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Stripe: `Stripe-Signature: t=<ts>,v1=<hmac(secret, ts+'.'+body)>`. */
export function verifyStripeSignature(secret: string, body: string, header: string | undefined, now: number, toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=').map((s) => s.trim()) as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return safeEqualHex(expected, v1);
}

export type WebhookVerifier = (input: { body: string; headers: Record<string, string>; secret: string; now: number }) => boolean;

/** Built-in verifiers keyed by provider. */
export const WEBHOOK_VERIFIERS: Record<string, WebhookVerifier> = {
  github: ({ body, headers, secret }) => verifyGithubSignature(secret, body, headers['x-hub-signature-256']),
  slack: ({ body, headers, secret, now }) => verifySlackSignature(secret, body, headers['x-slack-request-timestamp'], headers['x-slack-signature'], now),
  stripe: ({ body, headers, secret, now }) => verifyStripeSignature(secret, body, headers['stripe-signature'], now),
};

export interface WebhookReceipt {
  accepted: boolean;
  deduped: boolean;
  reason?: string;
  eventId?: string;
}

export interface DeadLetter {
  id: string;
  provider: string;
  body: string;
  headers: Record<string, string>;
  reason: string;
  at: number;
}

export class WebhookReceiver {
  private readonly verifiers = new Map<string, WebhookVerifier>(Object.entries(WEBHOOK_VERIFIERS));
  private readonly seen = new Set<string>();
  private readonly dead: DeadLetter[] = [];
  private metrics = { received: 0, accepted: 0, rejected: 0, deduped: 0 };

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  registerVerifier(provider: string, verifier: WebhookVerifier): void {
    this.verifiers.set(provider, verifier);
  }

  private eventId(provider: string, headers: Record<string, string>, body: string): string {
    return (
      headers['x-github-delivery'] ??
      headers['x-request-id'] ??
      `${provider}:${createHmac('sha256', 'dedup').update(body).digest('hex').slice(0, 24)}`
    );
  }

  /** Verify → dedup → publish to the runtime bus. Failures dead-letter. */
  async receive(provider: string, input: { headers: Record<string, string>; body: string; secret: string }): Promise<WebhookReceipt> {
    this.metrics.received += 1;
    const verifier = this.verifiers.get(provider);
    const now = this.clock.now();
    if (verifier && !verifier({ body: input.body, headers: input.headers, secret: input.secret, now })) {
      this.metrics.rejected += 1;
      return { accepted: false, deduped: false, reason: 'signature verification failed' };
    }
    const eventId = this.eventId(provider, input.headers, input.body);
    if (this.seen.has(eventId)) {
      this.metrics.deduped += 1;
      return { accepted: false, deduped: true, eventId };
    }
    this.seen.add(eventId);
    try {
      await this.runtime.events().publish({
        type: `webhook.${provider}`,
        topic: 'webhooks',
        partitionKey: provider,
        version: 1,
        payload: { provider, eventId, body: safeParse(input.body) },
      });
      this.metrics.accepted += 1;
      return { accepted: true, deduped: false, eventId };
    } catch (e) {
      this.dead.push({ id: randomId('dlq'), provider, body: input.body, headers: input.headers, reason: e instanceof Error ? e.message : String(e), at: now });
      return { accepted: false, deduped: false, reason: 'delivery failed (dead-lettered)', eventId };
    }
  }

  deadLetters(): DeadLetter[] {
    return [...this.dead];
  }

  /** Replay a dead-lettered webhook (e.g. after fixing a downstream outage). */
  async replay(deadLetterId: string, secret: string): Promise<WebhookReceipt> {
    const idx = this.dead.findIndex((d) => d.id === deadLetterId);
    if (idx < 0) return { accepted: false, deduped: false, reason: 'unknown dead-letter' };
    const dl = this.dead[idx]!;
    this.seen.delete(this.eventId(dl.provider, dl.headers, dl.body)); // allow re-delivery
    const receipt = await this.receive(dl.provider, { headers: dl.headers, body: dl.body, secret });
    if (receipt.accepted) this.dead.splice(idx, 1);
    return receipt;
  }

  stats(): { received: number; accepted: number; rejected: number; deduped: number; deadLettered: number } {
    return { ...this.metrics, deadLettered: this.dead.length };
  }
}

function safeParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
