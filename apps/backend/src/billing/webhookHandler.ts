/**
 * The Express handler for the Razorpay webhook. It receives the raw body (mounted
 * with express.raw before the JSON parser so the signature matches byte-for-byte),
 * verifies the signature, then delegates to the pure event handler. Configuration
 * errors are acknowledged (so Razorpay doesn't retry forever); transient errors
 * return 500 so Razorpay retries.
 */
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';
import type { SubscriptionRepository } from '../subscriptions/types';
import { BillingError } from './types';
import {
  handleRazorpayWebhookEvent,
  verifyRazorpaySignature,
  type RazorpayWebhookEvent,
} from './webhook';

export interface BillingWebhookDeps {
  subscriptions: SubscriptionRepository;
  webhookSecret: string | null;
}

export function createBillingWebhookHandler(deps: BillingWebhookDeps) {
  return async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    if (!deps.webhookSecret) {
      res
        .status(503)
        .json({
          error: { code: 'billing_disabled', message: 'Billing webhook is not configured.' },
        });
      return;
    }

    const raw = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string'
        ? req.body
        : '';
    const signature = req.header('x-razorpay-signature') ?? '';
    if (!raw || !verifyRazorpaySignature(raw, signature, deps.webhookSecret)) {
      res
        .status(400)
        .json({ error: { code: 'invalid_signature', message: 'Signature verification failed.' } });
      return;
    }

    let event: RazorpayWebhookEvent;
    try {
      event = JSON.parse(raw) as RazorpayWebhookEvent;
    } catch {
      res
        .status(400)
        .json({ error: { code: 'invalid_payload', message: 'Malformed webhook payload.' } });
      return;
    }

    try {
      const result = await handleRazorpayWebhookEvent(deps.subscriptions, event);
      res.json({ received: true, handled: result.handled });
    } catch (err) {
      if (err instanceof BillingError) {
        // A configuration error (e.g. an unknown plan) — acknowledge so Razorpay
        // stops retrying, but record it for operators to fix.
        logger.warn({ code: err.code, message: err.message }, 'Razorpay webhook event not applied');
        res.json({ received: true, handled: false });
        return;
      }
      logger.error({ err }, 'Razorpay webhook processing failed');
      res.status(500).json({ error: { code: 'webhook_failed', message: 'Processing failed.' } });
    }
  };
}
