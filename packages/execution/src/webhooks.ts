/**
 * Module 9 — Webhook Runtime. Composes the integrations `WebhookReceiver` — REAL HMAC
 * signature verification (github / slack / stripe), dedup by delivery id, a dead-letter
 * queue for rejects, and replay. Inbound webhooks that verify are published to the one
 * event bus (feeding event automation). Signature verification genuinely executes.
 */
import type { Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { WebhookReceiver, WEBHOOK_VERIFIERS, type WebhookReceipt, type DeadLetter } from '@neuropause/integrations';

export class WebhookRuntime {
  private readonly receiver: WebhookReceiver;

  constructor(runtime: EnterpriseRuntime, clock: Clock) {
    this.receiver = new WebhookReceiver(runtime, clock);
    for (const [provider, verifier] of Object.entries(WEBHOOK_VERIFIERS)) this.receiver.registerVerifier(provider, verifier);
  }

  receive(provider: string, input: { headers: Record<string, string>; body: string; secret: string }): Promise<WebhookReceipt> {
    return this.receiver.receive(provider, input);
  }
  deadLetters(): DeadLetter[] {
    return this.receiver.deadLetters();
  }
  replay(deadLetterId: string, secret: string): Promise<WebhookReceipt> {
    return this.receiver.replay(deadLetterId, secret);
  }
  stats(): { received: number; accepted: number; rejected: number; deduped: number; deadLettered: number } {
    return this.receiver.stats();
  }
}
