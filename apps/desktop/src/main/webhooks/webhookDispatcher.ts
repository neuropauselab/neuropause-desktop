/**
 * Webhook dispatcher (P3.0, Increment 4) — the outbox runner.
 *
 * On a tick (and on demand after an enqueue) it pulls due deliveries from the store,
 * signs each body, POSTs it via an injected `post` (real `fetch` at runtime, a fake in
 * tests), and folds the result back through the pure delivery state machine — so
 * success marks delivered, failure schedules a retry, and an exhausted schedule
 * dead-letters. The retry/deadletter logic itself is pure (`delivery.ts`/`retry.ts`);
 * this class only owns the loop + the HTTP call.
 */
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookDelivery,
  type WebhookEventPayload,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { WebhookStore } from './webhookStore';
import { applyAttemptResult, type AttemptResult } from './delivery';
import { signWebhook } from './signing';
import { classifyWebhookUrl } from './urlGuard';
import { runAsPrincipal, tenantPrincipal } from '../tenancy/backgroundPrincipal';

const log = createLogger('webhook-dispatcher');

/** POST a body to a URL; resolves with the HTTP status, rejects on network failure. */
export type WebhookPoster = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<{ status: number }>;

export interface WebhookDispatcherDeps {
  store: WebhookStore;
  post: WebhookPoster;
  now: () => number;
}

export class WebhookDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly deps: WebhookDispatcherDeps) {}

  start(intervalMs = 5_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  /** Nudge the loop (e.g. right after an enqueue) without waiting for the interval. */
  kick(): void {
    void this.tick();
  }

  /** Attempt every currently-due delivery once. Reentrancy-guarded. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = this.deps.store.due(this.deps.now());
      for (const item of due) {
        /**
         * P13C — EACH DELIVERY RUNS UNDER ITS OWN TENANT'S PRINCIPAL.
         *
         * The dispatcher is a 5-second timer with no session, so resolving the
         * tenant from the UI would be wrong in both directions: it would refuse
         * to send anything while nobody is signed in, and it would send under
         * whichever organization happened to be open when the timer fired.
         *
         * The delivery row carries the tenant it was enqueued for, and that is
         * the authority used here — so the outbox drains correctly with the app
         * locked, and a retry queued six hours ago still belongs to the tenant
         * that queued it.
         */
        const principal = tenantPrincipal({
          jobId: 'webhook-dispatch',
          scope: item.delivery.tenantId
            ? { tenantId: item.delivery.tenantId, workspaceId: '' }
            : null,
        });
        if (principal === null) {
          /**
           * An unowned delivery is never sent. Rows enqueued before P13C, and
           * any row whose tenant cannot be established, are failed rather than
           * transmitted — the only safe answer for a queue whose output leaves
           * the device.
           */
          this.deps.store.update(
            applyAttemptResult(
              item.delivery,
              { ok: false, statusCode: null, error: 'no tenant owner; not delivered' },
              this.deps.now(),
            ),
          );
          continue;
        }
        await runAsPrincipal(principal, () =>
          this.attempt(item.delivery, item.payload, item.webhookId),
        );
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }

  private async attempt(delivery: WebhookDelivery, payload: WebhookEventPayload, webhookId: string): Promise<void> {
    const now = this.deps.now();
    /**
     * Resolved UNDER THE DELIVERY'S PRINCIPAL, so both lookups are scoped to
     * the delivery's own tenant. That is the Phase 8 invariant enforced
     * structurally rather than by comparison: if the endpoint belonged to a
     * different tenant it is simply not visible from here, and the delivery
     * fails as "endpoint removed" instead of being signed with that tenant's
     * secret and POSTed to their URL.
     */
    const secret = this.deps.store.secretFor(webhookId);
    const url = this.deps.store.get(webhookId)?.url;
    if (!secret || !url) {
      this.deps.store.update(applyAttemptResult(delivery, { ok: false, statusCode: null, error: 'endpoint removed' }, now));
      return;
    }
    // Re-check egress at send time — defends against rows stored before the guard existed
    // and against a target that resolves/redirects internally (SSRF defense-in-depth).
    const verdict = classifyWebhookUrl(url);
    if (!verdict.ok) {
      this.deps.store.update(applyAttemptResult(delivery, { ok: false, statusCode: null, error: `blocked: ${verdict.reason}` }, now));
      return;
    }
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [WEBHOOK_SIGNATURE_HEADER]: signWebhook(secret, body, now),
      [WEBHOOK_DELIVERY_HEADER]: delivery.id,
      [WEBHOOK_EVENT_HEADER]: delivery.eventType,
    };
    let result: AttemptResult;
    try {
      const res = await this.deps.post(url, body, headers);
      result =
        res.status >= 200 && res.status < 300
          ? { ok: true, statusCode: res.status, error: null }
          : { ok: false, statusCode: res.status, error: `HTTP ${res.status}` };
    } catch (err) {
      result = { ok: false, statusCode: null, error: err instanceof Error ? err.message : 'network error' };
    }
    const updated = applyAttemptResult(delivery, result, now);
    this.deps.store.update(updated);
    if (updated.status === 'dead') {
      log.warn('Webhook delivery dead-lettered', { deliveryId: delivery.id, webhookId, attempts: updated.attempts });
    }
  }
}
