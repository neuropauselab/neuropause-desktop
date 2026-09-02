/**
 * FG-ERP-LIVE-IPC (ERP Session 22) — the LIVE `platform:command.dispatch` handler.
 *
 * This is the ONE production caller that puts the S17–S21 governed platform on the
 * live Electron IPC path. It is the Electron-coupled COMPOSITION layer: it resolves
 * the authoritative principal SERVER-SIDE (authenticated session + active tenant
 * scope + real RBAC), builds the production `ApplicationDeps` by REUSE (the live
 * enterprise registry, a durable command journal, the enterprise governance audit
 * sink), and hands a serializable `ClientRequest` to the existing `ElectronClientAdapter`
 * → `handleApplicationRequest` (Application Boundary) → the command bus.
 *
 * WHY IT LIVES IN `ipc/handlers/` AND NOT `platform/adapter/`: `platform/*` is proven
 * Electron-free by the S19/S21 independence tests. The principal resolver, the durable
 * journal path and the audit sink are all Electron-coupled singletons, so the
 * composition belongs in the IPC layer (the same place `capabilities/capabilityProposeIpc.ts`
 * sits), and the platform core stays pure.
 *
 * GOVERNANCE INVARIANTS (all reuse, none new):
 *   • requireAuth at the channel; the FINE per-command RBAC is `ctx.authorize(PERMISSION_FOR_COMMAND[op])`
 *     inside the command bus — the SAME `enterprise.allows` gate the live module handlers use.
 *   • identity/tenant are NEVER read from the renderer envelope; `claimedTenantId` is validated
 *     against the resolved principal and rejected on mismatch (application boundary).
 *   • the handler has no store handle and performs no mutation itself — everything flows through
 *     the command bus → durable transaction → event → outbox → audit.
 *   • one authorization engine (`enterprise.allows`), one audit sink (`governanceStore`),
 *     one durable transaction/event/outbox (the Session-18 journal). No second engine.
 */
import { join } from 'node:path';
import { app } from 'electron';
import {
  ALL_ENTERPRISE_PERMISSIONS,
  IpcChannel,
  PlatformCommandDispatchRequest,
  type EnterprisePermission,
  type PlatformCommandDispatchResponse,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../secureBridge';
import type { EnterpriseModuleRegistry } from '../../enterprise/framework';
import { activeTenantScope } from '../../enterprise';
import { governanceStore } from '../../enterprise/governance/governanceInstance';
import { workspaceStore } from '../../enterprise/workspace/workspaceInstance';
import { authService } from '../../auth/authService';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { dispatchOutbox, type OutboxConsumer } from '../../platform/command/outboxDispatcher';
import { DeliveredEventLog } from '../../platform/command/deliveredEventLog';
import { ElectronClientAdapter, type ClientRequest } from '../../platform/adapter/clientAdapter';
import type { Principal } from '../../platform/application/requestContext';
import { registerShutdownFlush } from '../../shutdownFlush';

export interface PlatformCommandHandlerDeps {
  /** The LIVE enterprise module registry (`enterprise.modules`) — reused, not rebuilt. */
  registry: EnterpriseModuleRegistry;
  /** The ONE RBAC gate (`enterprise.allows`) — the authoritative permission predicate. */
  allows: (permission: EnterprisePermission) => boolean;
}

/** The fully-injected dependencies of the dispatch handler — the testable composition seam. */
export interface PlatformCommandDispatchDeps {
  registry: EnterpriseModuleRegistry;
  journal: DurableCommandJournal;
  audit: (e: { action: string; target: string; summary: string }) => void;
  /** Resolves the AUTHORITATIVE principal server-side, or null (fail-closed → UNAUTHENTICATED). */
  resolvePrincipal: () => Principal | null;
  /**
   * OPTIONAL production outbox delivery consumer (ERP Session 31). When provided, the handler drains
   * the durable outbox best-effort after each dispatch (at-least-once; the consumer MUST be
   * idempotent). Absent ⇒ no drain (the S17–S30 injectable-seam tests keep their exact behavior).
   */
  outboxConsumer?: OutboxConsumer;
}

/**
 * Build the `platform:command.dispatch` SecureHandlerDef from FULLY-INJECTED deps. This is the
 * composition seam with NO Electron singletons of its own, so a test drives it through the REAL
 * secure bridge + REAL command bus + REAL durable journal with an injected principal, and the
 * production path (`buildPlatformCommandHandlers`) constructs the same def with the live singletons.
 */
export function buildPlatformCommandDispatchDef(deps: PlatformCommandDispatchDeps): SecureHandlerDef {
  const adapter = new ElectronClientAdapter({
    registry: deps.registry,
    journal: deps.journal,
    audit: deps.audit,
    authenticator: { resolvePrincipal: deps.resolvePrincipal },
  });

  // SERIALIZED OUTBOX DRAIN (ERP Session 31). An outbox relay is a SINGLE drain loop, never N
  // concurrent drains: concurrent drains race on the durable single-file stores (the delivered-event
  // sink + the journal's outbox state) and can lose or duplicate a delivery. Reproduced first (the
  // S31 CONCURRENCY test failed intermittently — one delivered row lost — before this latch). A
  // per-handler chained-promise latch (the S24/S28 pattern) runs drains strictly one-at-a-time, and
  // each drain loops until the outbox is empty so an entry committed while a prior drain was mid-flight
  // is still delivered by the tail drain. At-least-once + idempotent consumer make this exactly-once
  // in effect; it never blocks concurrent COMMITS, only the (fast) delivery pass.
  let drainChain: Promise<unknown> = Promise.resolve();
  const drainOutbox = (consumer: OutboxConsumer): Promise<unknown> => {
    const run = async (): Promise<void> => {
      // Loop until nothing is left PENDING/RETRYABLE, so a commit that landed during a prior pass
      // is picked up by this one rather than waiting for the next dispatch.
      for (let pass = 0; pass < 100 && deps.journal.pendingOutbox().length > 0; pass += 1) {
        await dispatchOutbox(deps.journal, consumer);
      }
    };
    drainChain = drainChain.then(run, run);
    return drainChain;
  };
  return {
    channel: IpcChannel.PlatformCommandDispatch,
    schema: PlatformCommandDispatchRequest,
    // Authenticated at the channel; the command bus does the fine per-command RBAC. Same
    // two-layer pattern as EnterpriseModuleAction/Create/SetStatus (requireAuth + inner authorize).
    requireAuth: true,
    handler: async (req: unknown): Promise<PlatformCommandDispatchResponse> => {
      // `req` was validated against `PlatformCommandDispatchRequest` by the bridge before this call.
      const r = await adapter.submit(req as ClientRequest);
      // PRODUCTION OUTBOX DELIVERY (ERP Session 31): after a governed write commits its durable
      // outbox entry, drain PENDING/RETRYABLE deliveries through the existing at-least-once relay.
      // BEST-EFFORT AND FAIL-OPEN FOR THE BUSINESS COMMAND: a delivery failure must never fail or
      // alter the command response — the durable outbox retains the undelivered entry as RETRYABLE
      // and the next dispatch (or the shutdown drain) retries it. No tenant filter is needed: the
      // consumer attributes each delivery to the EVENT's own tenant, so a shared-process drain never
      // crosses tenants.
      if (deps.outboxConsumer) {
        try {
          await drainOutbox(deps.outboxConsumer);
        } catch {
          // swallow — evidence delivery is never on the business command's critical path
        }
      }
      // Map to the client-safe contract (deliberately omits the internal domain event).
      return {
        ok: r.ok,
        ...(r.data ? { data: r.data } : {}),
        ...(r.replayed ? { replayed: true } : {}),
        ...(r.error ? { error: r.error } : {}),
        requestId: r.requestId,
        correlationId: r.correlationId,
        operation: r.operation,
      };
    },
  };
}

/**
 * Build the live-dispatch handler group. Called ONCE by `runtimeCore` with the real enterprise
 * registry + RBAC predicate (FG-ERP-LIVE-IPC push). Everything Electron-coupled is constructed
 * here (durable journal path, governance audit sink, principal resolver), keeping the platform
 * core pure; the def itself is built by the injectable seam above.
 */
export function buildPlatformCommandHandlers(deps: PlatformCommandHandlerDeps): SecureHandlerDef[] {
  // Durable idempotency + transaction + event + outbox (Session 18), one file under userData.
  const journal = new DurableCommandJournal(join(app.getPath('userData'), 'platform-command-journal.json'));

  // PRODUCTION OUTBOX SINK (ERP Session 31): the durable, tenant-scoped, idempotent read-model the
  // at-least-once relay delivers into. Closes the "outbox written but never drained in production"
  // gap. Reuses the journal's own durable-store primitive — NOT a second outbox/event/audit engine.
  const deliveredLog = new DeliveredEventLog(join(app.getPath('userData'), 'platform-delivered-events.json'));
  const outboxConsumer: OutboxConsumer = (event) => deliveredLog.record(event);

  // Drain any outbox entries still PENDING/RETRYABLE at shutdown (e.g. a delivery that failed and
  // was left RETRYABLE), reusing the established shutdown-flush registry. Best-effort by design.
  registerShutdownFlush('platform-command-outbox', async () => {
    await dispatchOutbox(journal, outboxConsumer).catch(() => undefined);
  });

  // Attribution for the audit line — the authenticated actor, or 'owner' when local/degraded.
  const actorName = (): string => {
    const st = authService.getStatus();
    return st.state === 'authenticated' ? (st.session.user.displayName ?? st.session.user.email) : 'owner';
  };

  // Reuse the enterprise governance audit sink (the SAME one the live module handlers write to).
  const audit = (e: { action: string; target: string; summary: string }): void => {
    governanceStore.record({
      actor: actorName(),
      action: e.action,
      target: e.target,
      summary: e.summary,
      workspaceId: workspaceStore.activeWorkspaceIdForDisplay(),
    });
  };

  // Resolve the AUTHORITATIVE principal server-side. Fail-closed: no authenticated session or
  // no resolvable tenant ⇒ null ⇒ the application boundary returns UNAUTHENTICATED. The
  // permission set is derived from the REAL RBAC predicate (`enterprise.allows`), never claimed.
  const resolvePrincipal = (): Principal | null => {
    const status = authService.getStatus();
    const scope = activeTenantScope();
    if (status.state !== 'authenticated' || !scope || !scope.tenantId) return null;
    const actor = status.session.user.email ?? status.session.user.id;
    const permissions = ALL_ENTERPRISE_PERMISSIONS.filter((p) => deps.allows(p));
    return {
      actor,
      tenantId: scope.tenantId,
      ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
      permissions,
    };
  };

  return [buildPlatformCommandDispatchDef({ registry: deps.registry, journal, audit, resolvePrincipal, outboxConsumer })];
}
