/**
 * P6.1 — Infrastructure automation executor.
 *
 * Wraps every `InfraAction` with the cross-cutting concerns so a platform action stays a pure provider call:
 *   1. confirmation gate — a mutating (high-privilege) action REFUSES unless `confirmed === true`. This gate
 *      is the single hard guarantee that AI / automation can never mutate infrastructure on its own: the flag
 *      originates only from an explicit human confirmation at the IPC edge and is never defaulted true.
 *   2. transport reuse   — the SAME signed, rate-gated discovery transport (`makeHttp`) the Discovery Engine
 *      uses; no new auth, no new vault, no new runtime. Authorization is enforced provider-side (least
 *      privilege) and a denial is surfaced verbatim.
 *   3. audited fan-out    — started → completed|failed events on the EXISTING Platform Event Bus, which the
 *      built-in timeline/audit/diagnostics subscribers persist automatically (one Timeline, no parallel log).
 *
 * It mirrors the connector `M365Executor` exactly, reused for the infrastructure runtime.
 */
import type { DiscoveryHttp, InfraActionInfo, InfraActionResult, PlatformEventInput } from '@neuropause/shared';
import { AuthError, HttpError, RateLimitError } from '../unified/sync/http';
import { infraEvents } from './infraEvents';
import { actionInfo, InfraActionInputError, type InfraAction } from './actionSdk';

export interface InfraExecutorDeps {
  /** Build the SAME signed transport discovery uses for a platform+account. */
  makeHttp: (platformId: string, accountId: string) => DiscoveryHttp;
  /** Platform event bus (fans out to Timeline / Audit / Diagnostics). */
  publish: (event: PlatformEventInput) => void;
  /** The account's discovered region for a regional action (a param `region` overrides; global actions ignore). */
  regionFor: (platformId: string, accountId: string) => string | null;
  /**
   * Whether the CALLER may act on this cloud account.
   *
   * P13C ROUND 7 — the authorization step, which did not exist. `accountId`
   * arrives from the renderer payload (`InfraExecuteAction`) and reached the
   * provider transport with only two checks: that the action id is known and that
   * a mutating action was confirmed. Neither says anything about WHOSE account it
   * is. So a `connectors:manage` holder in one tenant could run a MUTATING
   * provider action — restart, terminate, scale, revoke — against another
   * tenant's cloud infrastructure.
   *
   * Backed by `ResourceStore.ownsAccount`, the same filter the listings use, so
   * there is exactly one answer to "whose account is this".
   */
  ownsAccount: (platformId: string, accountId: string) => boolean;
  now: () => string;
}

export class InfraActionExecutor {
  private readonly byId = new Map<string, InfraAction>();

  constructor(
    private readonly deps: InfraExecutorDeps,
    actions: InfraAction[],
  ) {
    for (const a of actions) this.byId.set(a.id, a);
  }

  /** The catalog the renderer renders (no handlers, no secrets). */
  list(platformId?: string): InfraActionInfo[] {
    return [...this.byId.values()].filter((a) => !platformId || a.platformId === platformId).map(actionInfo);
  }

  async execute(
    platformId: string,
    accountId: string,
    actionId: string,
    params: Record<string, unknown>,
    confirmed: boolean,
  ): Promise<InfraActionResult> {
    const action = this.byId.get(actionId);
    if (!action || action.platformId !== platformId) {
      return { ok: false, message: `Unknown action "${actionId}" for platform "${platformId}"` };
    }

    /**
     * 0. AUTHORIZATION. Before the confirmation gate, deliberately.
     *
     * A caller probing account ids must not learn from the response whether the
     * action would have needed confirmation, or that the account exists at all.
     * Same message an unknown account gets — because to this caller it IS
     * unknown. Mirrors `m365/executor.ts`, where the identical shape was closed
     * in Round 6.
     */
    if (!this.deps.ownsAccount(platformId, accountId)) {
      return { ok: false, message: `Unknown account "${accountId}" for platform "${platformId}"` };
    }

    // 1. Confirmation gate — no high-privilege mutation without an explicit, user-originated confirmation.
    if (action.mutates && confirmed !== true) {
      return {
        ok: false,
        requiresConfirmation: true,
        message: `“${action.label}” changes live infrastructure and requires explicit confirmation.`,
      };
    }

    // 2. Transport reuse — the signed discovery transport for this account (least-privilege, provider-enforced).
    const http = this.deps.makeHttp(platformId, accountId);
    const paramRegion = typeof params.region === 'string' ? params.region.trim() : '';
    const region = paramRegion || this.deps.regionFor(platformId, accountId) || 'us-east-1';
    const now = this.deps.now();

    // 3. Audited fan-out.
    this.deps.publish(infraEvents.actionStarted(platformId, accountId, action.id, action.label));
    try {
      const result = await action.run({ platformId, accountId, region, http, now }, params);
      this.deps.publish(infraEvents.actionCompleted(platformId, accountId, action.id, action.label, result.summary));
      return { ok: result.ok, message: result.summary, data: result.data };
    } catch (err) {
      const message = this.classify(err);
      this.deps.publish(infraEvents.actionFailed(platformId, accountId, action.id, action.label, message));
      return { ok: false, message };
    }
  }

  private classify(err: unknown): string {
    if (err instanceof InfraActionInputError) return err.message;
    if (err instanceof AuthError) {
      return err.status === 403
        ? 'Permission denied by the cloud provider — the discovery credential profile lacks this action’s permission (grant it, least-privilege, and retry).'
        : 'Authorization failed — reconfigure the platform credentials.';
    }
    if (err instanceof RateLimitError) return 'Rate-limited by the cloud provider — retry shortly.';
    if (err instanceof HttpError) return err.message;
    return err instanceof Error ? err.message : 'Action failed';
  }
}
