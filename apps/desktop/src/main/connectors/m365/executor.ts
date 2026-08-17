/**
 * P2.4 — Microsoft 365 write executor.
 *
 * Wraps every WriteAction with the cross-cutting concerns so a domain action stays a pure Graph call:
 *   1. confirmation gate  — a mutating action refuses unless `confirmed === true` (AI can never reach this);
 *   2. scope validation   — the account's granted Graph scopes must cover the action (least privilege);
 *   3. token reuse        — the SAME auto-refreshing Graph bearer as sync (no new OAuth);
 *   4. audited fan-out     — started → completed|failed platform events (Timeline + Audit + Diagnostics +
 *                            Executive Center) + connector activity + write-health metrics.
 * No mocks — actions hit live Microsoft Graph.
 */
import type { ConnectorWriteActionInfo, ConnectorWriteResult, PlatformEventInput } from '@neuropause/shared';
import { AuthError, HttpClient, NetworkError, type RateGate } from '../../unified/sync/http';
import { rateGateKey } from '../../unified/sync/rateLimiter';
import type { SyncStateStore } from '../../unified/sync/syncStateStore';
import { writeEvents } from '../../unified/sync/events';
import type { WriteAction } from './actionSdk';
import { ActionInputError } from './actionSdk';

export interface M365ExecutorDeps {
  /** Auto-refreshing Graph bearer for an account (connectorService.getValidAccessToken). */
  getToken: (connectorId: string, accountId: string) => Promise<string | null>;
  /** Platform event bus (fans out to Timeline / Audit / Diagnostics / Executive Center). */
  publish: (event: PlatformEventInput) => void;
  rate: RateGate;
  /** Connector activity feed (connectorService.recordWrite). */
  recordActivity: (connectorId: string, accountId: string, level: 'info' | 'warn' | 'error', message: string) => void;
  /** Write-health store (extended AccountSyncState). */
  health: SyncStateStore;
  /** Human connector name for events. */
  manifestName: (connectorId: string) => string;
  /** Scopes the account's token actually carries (for pre-flight validation). */
  grantedScopes: (connectorId: string, accountId: string) => string[];
  /**
   * Whether `accountId` names a connected account THIS CALLER MAY USE.
   *
   * P13C ROUND 6 — the authorization step, made explicit.
   *
   * `accountId` arrives from the renderer payload and every downstream dep took
   * it on faith. The only thing standing between a foreign account id and a
   * write against that account's mailbox was `grantedScopes` returning `[]` for
   * an account the workspace filter did not resolve — which denied only because
   * every shipped action happens to declare at least one scope. An action with
   * `scopes: []`, or a future action added without one, would sail through the
   * scope check and reach `getToken` with someone else's account id.
   *
   * That is authorization as a SIDE EFFECT of a least-privilege check, and it is
   * the shape this whole program keeps finding: the boundary holds because of a
   * property of the data rather than because anything asserts it.
   */
  ownsAccount: (connectorId: string, accountId: string) => boolean;
  /** Test seam: build the Graph client (defaults to a real, rate-gated HttpClient). */
  makeHttp?: (connectorId: string, getToken: () => Promise<string>, rate: RateGate) => HttpClient;
}

/** A `.Read` requirement is satisfied by the matching `.ReadWrite` grant. */
function hasScope(granted: readonly string[], need: string): boolean {
  if (granted.includes(need)) return true;
  if (need.endsWith('.Read')) return granted.includes(`${need.slice(0, -'.Read'.length)}.ReadWrite`);
  return false;
}

export class M365Executor {
  private readonly byId = new Map<string, WriteAction>();

  constructor(
    private readonly deps: M365ExecutorDeps,
    actions: WriteAction[],
  ) {
    for (const a of actions) this.byId.set(a.id, a);
  }

  /** The catalog the renderer renders (no tokens, no handlers). */
  list(): ConnectorWriteActionInfo[] {
    return [...this.byId.values()].map((a) => ({ id: a.id, label: a.label, domain: a.domain, scopes: a.scopes, mutates: a.mutates }));
  }

  async execute(
    connectorId: string,
    accountId: string,
    actionId: string,
    params: Record<string, unknown>,
    confirmed: boolean,
  ): Promise<ConnectorWriteResult> {
    const action = this.byId.get(actionId);
    if (!action) return { ok: false, message: `Unknown action "${actionId}"` };

    /**
     * 0. AUTHORIZATION. Before the confirmation gate, before the scope check.
     *
     * Ordered first deliberately: a caller probing another workspace's account
     * ids must not learn from the response whether the action needed
     * confirmation or which Graph permissions that account is missing. Same
     * message an unknown account gets, because to this caller it IS unknown.
     */
    if (!this.deps.ownsAccount(connectorId, accountId)) {
      return { ok: false, message: 'Not authorized — reconnect this account.' };
    }

    // 1. Confirmation gate — no mutation without an explicit, user-originated confirmation.
    if (action.mutates && confirmed !== true) {
      return { ok: false, requiresConfirmation: true, message: `“${action.label}” modifies data and needs explicit confirmation.` };
    }

    // 2. Scope validation — fail closed with an honest, actionable message.
    const granted = this.deps.grantedScopes(connectorId, accountId);
    const missing = action.scopes.filter((s) => !hasScope(granted, s));
    if (missing.length > 0) {
      return { ok: false, message: `Missing Graph permission(s): ${missing.join(', ')}. Grant them in Azure and reconnect.` };
    }

    // 3. Token reuse (auto-refresh via the accessor; never handled or logged here).
    const token = await this.deps.getToken(connectorId, accountId);
    if (!token) return { ok: false, message: 'Not authorized — reconnect this account.' };

    const name = this.deps.manifestName(connectorId);
    const tokenFn = async (): Promise<string> => {
      const t = await this.deps.getToken(connectorId, accountId);
      if (!t) throw new AuthError('no valid token');
      return t;
    };
    const makeHttp = this.deps.makeHttp ?? ((c, gt, r): HttpClient => new HttpClient(c, gt, r));
    // P13C ROUND 11 — M-8. Per-credential gate key; see `rateGateKey`.
    const http = makeHttp(rateGateKey(connectorId, accountId), tokenFn, this.deps.rate);
    const nowIso = new Date().toISOString();

    // 4. Audited fan-out.
    this.deps.publish(writeEvents.started(connectorId, name, accountId, actionId));
    const before = this.deps.health.get(connectorId, accountId);
    await this.deps.health.recordRun(connectorId, accountId, { pendingWrites: (before.pendingWrites ?? 0) + 1 });

    const startedMs = Date.now();
    try {
      const result = await action.run({ connectorId, accountId, http, now: nowIso }, params);
      const latencyMs = Date.now() - startedMs;
      const cur = this.deps.health.get(connectorId, accountId);
      await this.deps.health.recordRun(connectorId, accountId, {
        lastWriteAt: nowIso,
        lastWriteAction: actionId,
        writeCount: (cur.writeCount ?? 0) + 1,
        pendingWrites: Math.max(0, (cur.pendingWrites ?? 0) - 1),
        lastWriteLatencyMs: latencyMs,
        apiQuotaRemaining: result.quotaRemaining ?? cur.apiQuotaRemaining ?? null,
      });
      this.deps.publish(writeEvents.completed(connectorId, name, accountId, actionId, { summary: result.summary, latencyMs }));
      this.deps.recordActivity(connectorId, accountId, 'info', `${action.label}: ${result.summary}`);
      return { ok: result.ok, message: result.summary, data: result.data };
    } catch (err) {
      const message = this.classify(err);
      const cur = this.deps.health.get(connectorId, accountId);
      await this.deps.health.recordRun(connectorId, accountId, {
        failedWrites: (cur.failedWrites ?? 0) + 1,
        pendingWrites: Math.max(0, (cur.pendingWrites ?? 0) - 1),
      });
      this.deps.publish(writeEvents.failed(connectorId, name, accountId, actionId, message));
      this.deps.recordActivity(connectorId, accountId, 'error', `${action.label} failed: ${message}`);
      // A NetworkError means the request was TRANSMITTED but no response was received — the external outcome is
      // UNKNOWN, not a proven failure. Surface that class (in `data.outcome`) instead of collapsing it, so the
      // governed worker path can raise a durable reconciliation hold and never blindly retry. Definite failures
      // (HttpError/AuthError/input) stay as a plain failure. `ok` is false either way — UNKNOWN is never success.
      if (err instanceof NetworkError) {
        return { ok: false, message, data: { outcome: 'UNKNOWN' } };
      }
      return { ok: false, message };
    }
  }

  private classify(err: unknown): string {
    if (err instanceof ActionInputError) return err.message;
    if (err instanceof AuthError) {
      return err.status === 403
        ? 'Permission denied by Microsoft Graph (grant the scope + admin consent, then reconnect).'
        : 'Authorization failed — reconnect this account.';
    }
    return err instanceof Error ? err.message : 'Write failed';
  }
}
