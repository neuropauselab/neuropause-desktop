/**
 * Webhook alert sink (completes the TD-6 alerting thread).
 *
 * `healthAlerts.ts` already fires edge-triggered alerts and exposes a
 * `registerAlertSink` extension point; until now the only "sinks" were the
 * structured log and the Prometheus counter. This module adds an OPTIONAL,
 * operator-configured HTTP sink: when `ALERT_WEBHOOK_URL` is set, each health
 * transition is POSTed to that URL as generic JSON (with a human-readable
 * `text` summary that renders in Slack/Discord-style incoming webhooks).
 *
 * Design constraints honoured:
 *   - No new dependency: uses global `fetch` + `AbortController`, matching the
 *     existing outbound-HTTP pattern (see `semantic/qdrant/httpJson.ts`).
 *   - No new framework: reuses the existing `AlertSink` hook.
 *   - Off by default: a no-op when the URL is unset, so behaviour is unchanged
 *     for every deployment that has not opted in.
 *   - Best-effort: delivery never throws and never blocks health handling; a
 *     failed post is logged and dropped (the Prometheus counter remains the
 *     durable signal).
 *   - No secrets in the payload: alerts carry only component, state, timestamp.
 */
import { registerAlertSink, type HealthAlert } from './healthAlerts';
import { loadEnv } from '../config/env';
import { logger } from '../config/logger';

export interface WebhookAlertPayload {
  source: 'neuropause-backend';
  component: string;
  state: 'up' | 'down';
  at: string;
  /** Human-readable summary; Slack/Discord incoming webhooks render this. */
  text: string;
}

/** Build the (secret-free) webhook payload for an alert. Pure. */
export function buildAlertPayload(alert: HealthAlert): WebhookAlertPayload {
  const verb = alert.state === 'down' ? 'is DOWN' : 'has recovered';
  return {
    source: 'neuropause-backend',
    component: alert.component,
    state: alert.state,
    at: alert.at,
    text: `NeuroPause: dependency "${alert.component}" ${verb} (${alert.at})`,
  };
}

export interface PostOptions {
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * POST an alert to the webhook URL. Best-effort: resolves `true` on a 2xx,
 * `false` on any failure (non-2xx, network error, or timeout). Never throws.
 */
export async function postAlertToWebhook(
  url: string,
  alert: HealthAlert,
  opts: PostOptions = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildAlertPayload(alert)),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(
        { component: alert.component, status: res.status },
        'Alert webhook returned a non-2xx status',
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err, component: alert.component }, 'Alert webhook delivery failed');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface InstallOptions {
  /** Override the URL (else read from ALERT_WEBHOOK_URL). */
  url?: string;
  /** Override the timeout (else read from ALERT_WEBHOOK_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * If a webhook URL is configured, register a best-effort `AlertSink` that POSTs
 * each health transition to it. A no-op (returns false) when no URL is set, so
 * the default behaviour is unchanged. Returns true when a sink was installed.
 */
export function installWebhookAlertSink(opts: InstallOptions = {}): boolean {
  const env = loadEnv();
  const url = opts.url ?? env.ALERT_WEBHOOK_URL;
  if (!url) return false;
  const timeoutMs = opts.timeoutMs ?? env.ALERT_WEBHOOK_TIMEOUT_MS;
  registerAlertSink((alert) => {
    // Fire-and-forget: postAlertToWebhook never throws or rejects, so voiding
    // the promise cannot produce an unhandled rejection or block the caller.
    void postAlertToWebhook(url, alert, { timeoutMs, fetchImpl: opts.fetchImpl });
  });
  logger.info('Alert webhook sink installed — health transitions will POST to the configured URL');
  return true;
}
