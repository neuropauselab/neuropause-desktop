/**
 * Inbound webhook router (P5 — Increment 2).
 *
 * Turns a provider delivery into action: it resolves the connector's webhook secret, runs the
 * provider-specific verification (verify.ts), handles the one-time handshakes providers use to prove
 * endpoint ownership (Slack `url_verification`, Microsoft Graph `validationToken`), and — on an
 * authentic delivery — triggers a targeted incremental sync of the affected connector's connected
 * accounts through the EXISTING sync path (`connectorService.sync` → orchestrator). It adds no data
 * pipeline of its own: a webhook is just a low-latency trigger for the same delta sync the scheduler
 * already runs, so the Increment-1 conditional/delta foundation keeps a triggered sync cheap.
 *
 * Two entry points:
 *   • `handle(delivery)` — for SIGNED deliveries (a cloud relay / local tunnel): verify, then sync.
 *   • `triggerSync(connectorId)` — for PRE-AUTHENTICATED transports (Slack Socket Mode, opened with our
 *     app token): no signature exists or is needed, so just sync.
 *
 * Deps-injected and transport-agnostic; never throws on a bad delivery — returns a structured,
 * non-sensitive result.
 */
import { createLogger } from '../../logger';
import {
  graphValidationResponse,
  verifyGitHubSignature,
  verifyGraphClientState,
  verifyNotionSignature,
  verifySlackSignature,
  type VerifyResult,
  type WebhookProvider,
} from './verify';

const log = createLogger('connector-webhooks');

/** Everything the router needs, injected so it unit-tests without Electron/network. */
export interface InboundWebhookPorts {
  /** The signing secret / verification token for a connector, or null if not configured. */
  resolveSecret: (connectorId: string) => string | null;
  /** Connected account ids for a connector (the targeted-sync fan-out set). */
  accountsFor: (connectorId: string) => string[];
  /** Trigger an incremental sync of one account (the existing connector sync path). */
  requestSync: (connectorId: string, accountId: string) => Promise<unknown>;
  now: () => number;
}

/** One inbound delivery, normalized by whatever transport received it. Header keys MUST be lowercased. */
export interface InboundDelivery {
  provider: WebhookProvider;
  connectorId: string;
  headers: Record<string, string>;
  rawBody: string;
  /** URL query params (Microsoft Graph passes `validationToken` here). */
  query?: Record<string, string>;
}

export interface InboundResult {
  accepted: boolean;
  /** Non-sensitive rejection label, when `accepted` is false. */
  reason?: string;
  /** A handshake response the transport must return verbatim (Slack challenge / Graph validationToken). */
  challenge?: { status: number; contentType: string; body: string };
  /** Accounts a sync was triggered for. */
  synced: string[];
}

function reject(reason: string): InboundResult {
  return { accepted: false, reason, synced: [] };
}

export class InboundWebhookRouter {
  constructor(private readonly ports: InboundWebhookPorts) {}

  /** Handle a SIGNED delivery: run handshakes, verify authenticity, then trigger a targeted sync. */
  async handle(d: InboundDelivery): Promise<InboundResult> {
    // 1) Endpoint-ownership handshakes run BEFORE signature checks (they carry no signature).
    const handshake = this.handshake(d);
    if (handshake) return handshake;

    // 2) A connector with no configured webhook secret cannot be verified → reject (never trust unsigned).
    const secret = this.ports.resolveSecret(d.connectorId);
    if (!secret) return reject('webhook secret not configured');

    // 3) Provider-specific authenticity. verify() parses attacker-controlled JSON, so any unexpected
    //    throw fails closed as a rejection — the router's contract is to never throw on a bad delivery.
    let verdict: VerifyResult;
    try {
      verdict = this.verify(d, secret);
    } catch {
      verdict = { ok: false, reason: 'verification error' };
    }
    if (!verdict.ok) {
      log.warn('Rejected inbound webhook', { connectorId: d.connectorId, provider: d.provider, reason: verdict.reason });
      return reject(verdict.reason ?? 'verification failed');
    }

    // 4) Authentic → trigger a targeted incremental sync of the connector's connected accounts.
    const synced = await this.fanOutSync(d.connectorId);
    return { accepted: true, synced };
  }

  /** Pre-authenticated transport (e.g. Slack Socket Mode): sync without a signature check. */
  async triggerSync(connectorId: string): Promise<string[]> {
    return this.fanOutSync(connectorId);
  }

  /** Slack url_verification + Microsoft Graph validationToken. Returns a response, or null if not a handshake. */
  private handshake(d: InboundDelivery): InboundResult | null {
    if (d.provider === 'microsoft') {
      const gv = graphValidationResponse(d.query?.validationToken);
      if (gv) return { accepted: true, challenge: gv, synced: [] };
    }
    if (d.provider === 'slack') {
      const parsed = safeJson(d.rawBody);
      if (parsed && parsed.type === 'url_verification' && typeof parsed.challenge === 'string') {
        return { accepted: true, challenge: { status: 200, contentType: 'text/plain', body: parsed.challenge }, synced: [] };
      }
    }
    return null;
  }

  private verify(d: InboundDelivery, secret: string): VerifyResult {
    const h = d.headers;
    switch (d.provider) {
      case 'github':
        return verifyGitHubSignature(d.rawBody, h['x-hub-signature-256'], secret);
      case 'notion':
        return verifyNotionSignature(d.rawBody, h['x-notion-signature'], secret);
      case 'slack':
        return verifySlackSignature(d.rawBody, h['x-slack-signature'], h['x-slack-request-timestamp'], secret, this.ports.now());
      case 'microsoft': {
        // Graph has no HMAC — each notification carries the clientState we set at subscription creation.
        const value = safeJson(d.rawBody)?.value;
        const notifications: unknown[] = Array.isArray(value) ? value : [];
        if (notifications.length === 0) return { ok: false, reason: 'no notifications' };
        for (const n of notifications) {
          // Elements are attacker-controlled JSON: a `null` element must reject, not throw on `.clientState`.
          const cs = n && typeof n === 'object' ? (n as { clientState?: string }).clientState : undefined;
          const v = verifyGraphClientState(cs, secret);
          if (!v.ok) return v;
        }
        return { ok: true };
      }
      default:
        return { ok: false, reason: 'unknown provider' };
    }
  }

  private async fanOutSync(connectorId: string): Promise<string[]> {
    const synced: string[] = [];
    for (const accountId of this.ports.accountsFor(connectorId)) {
      try {
        await this.ports.requestSync(connectorId, accountId);
        synced.push(accountId);
      } catch (err) {
        log.warn('Webhook-triggered sync failed', { connectorId, accountId, err });
      }
    }
    return synced;
  }
}

/** Parse JSON, returning null on any error (a malformed body is just an untrusted delivery). */
function safeJson(body: string): { type?: string; challenge?: unknown; value?: unknown } | null {
  try {
    return JSON.parse(body) as { type?: string; challenge?: unknown; value?: unknown };
  } catch {
    return null;
  }
}
