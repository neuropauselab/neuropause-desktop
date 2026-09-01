/**
 * NeuroPause Platform — Domain Command bus (ERP Session 17, Track B).
 *
 * The ONE governed entry point for procurement commands, reusable by any client
 * (Electron, and future Web / Mobile / API / AI agent) because it depends only
 * on the enterprise module framework — no Electron, no IPC, no DB handle. The
 * flow the seam guarantees:
 *
 *   client → DomainCommand → [envelope validation] → [tenant derivation from the
 *   PRINCIPAL, not the command] → [authorization] → [idempotency] →
 *   [delegated governed transaction] → [state change] → [domain event] → [audit]
 *
 * REUSE, NOT DUPLICATION: validation, authorization, mutation, audit and the
 * lifecycle event are performed by the SAME `buildModuleHandlers` path the IPC
 * layer uses. The bus adds only what is genuinely new — the canonical envelope,
 * principal-derived tenancy, idempotency, and the named domain event. There is
 * no second authorization engine and no second audit trail.
 */
import type { TenantScope } from '@neuropause/shared';
import { IpcChannel, PURCHASE_REQUESTS_MODULE_ID } from '@neuropause/shared';
import {
  buildModuleHandlers,
  type EnterpriseModuleContext,
  type EnterpriseModuleRegistry,
} from '../../enterprise/framework';
import { CREATE_PO_ACTION } from '../../enterprise/modules/procurement/conversion';
import type { DomainEventLog } from './domainEventLog';
import type { CommandIdempotencyStore } from './commandIdempotency';
import {
  EVENT_FOR_COMMAND,
  PERMISSION_FOR_COMMAND,
  type CommandResult,
  type DomainCommand,
} from './domainCommand';

export interface CommandDispatchDeps {
  registry: EnterpriseModuleRegistry;
  /** The identity / authz / audit primitives — the platform's identity seam. */
  ctx: EnterpriseModuleContext;
  /** Authoritative tenant scope from the PRINCIPAL. Never read from the command. */
  resolveScope: () => TenantScope | null;
  events: DomainEventLog;
  idempotency: CommandIdempotencyStore;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const fail = (cmd: DomainCommand, error: string): CommandResult => ({
  ok: false,
  commandId: cmd.commandId,
  type: cmd.type,
  error,
});

function validateEnvelope(cmd: DomainCommand): string | null {
  if (!cmd.commandId) return 'MISSING_COMMAND_ID';
  if (!cmd.type || !EVENT_FOR_COMMAND[cmd.type]) return 'UNKNOWN_COMMAND';
  if (!cmd.actor) return 'MISSING_ACTOR';
  if (!cmd.correlationId) return 'MISSING_CORRELATION_ID';
  if (!cmd.idempotencyKey) return 'MISSING_IDEMPOTENCY_KEY';
  // Every command except a create acts on a target entity.
  if (cmd.type !== 'CreatePurchaseRequest' && !cmd.target?.id) return 'MISSING_TARGET';
  return null;
}

type HandlerCall = (channel: string, payload: unknown) => Promise<unknown>;

async function route(cmd: DomainCommand, deps: CommandDispatchDeps, call: HandlerCall): Promise<CommandResult> {
  const ok = (data: Record<string, unknown>): CommandResult => ({ ok: true, commandId: cmd.commandId, type: cmd.type, data });
  const no = (error: string): CommandResult => fail(cmd, error);
  const action = async (act: string): Promise<{ ok: boolean; message?: string; error?: string }> =>
    (await call(IpcChannel.EnterpriseModuleAction, {
      moduleId: PURCHASE_REQUESTS_MODULE_ID,
      id: cmd.target?.id,
      action: act,
    })) as { ok: boolean; message?: string; error?: string };

  switch (cmd.type) {
    case 'CreatePurchaseRequest': {
      // Deny-by-default: a create is ALWAYS a draft — a client can never mint a
      // pre-approved request by supplying `status`.
      const r = (await call(IpcChannel.EnterpriseModuleCreate, {
        moduleId: PURCHASE_REQUESTS_MODULE_ID,
        fields: { ...cmd.payload, status: 'draft' },
      })) as { ok: boolean; record?: { id: string } };
      return r.ok && r.record ? ok({ id: r.record.id }) : no('VALIDATION_FAILED');
    }
    case 'SubmitPurchaseRequest': {
      const r = await action('submit');
      return r.ok ? ok({ id: str(cmd.target?.id) }) : no(r.error ?? r.message ?? 'SUBMIT_REFUSED');
    }
    case 'ApprovePurchaseRequest': {
      const r = await action('approve');
      return r.ok ? ok({ id: str(cmd.target?.id) }) : no(r.error ?? r.message ?? 'APPROVE_REFUSED');
    }
    case 'RejectPurchaseRequest': {
      const r = await action('reject');
      return r.ok ? ok({ id: str(cmd.target?.id) }) : no(r.error ?? r.message ?? 'REJECT_REFUSED');
    }
    case 'ConvertPurchaseRequestToPO': {
      const r = await action(CREATE_PO_ACTION);
      if (!r.ok) return no(r.error ?? r.message ?? 'CONVERT_REFUSED');
      // The PO id is stamped onto the PR by the conversion — read it back for the
      // event/result (an internal read of the just-written record, not a govern-
      // ed cross-tenant query).
      const pr = deps.registry.get(PURCHASE_REQUESTS_MODULE_ID)?.store.get(str(cmd.target?.id));
      return ok({ id: str(cmd.target?.id), purchaseOrderId: str(pr?.fields.convertedOrder) });
    }
    default:
      return no('UNKNOWN_COMMAND');
  }
}

/**
 * Dispatch one domain command through the full governed flow. Idempotent,
 * fail-closed, tenant-derived. Returns a `CommandResult` (never throws for a
 * governance refusal — a refusal is a result, not an exception).
 */
export async function dispatchCommand(cmd: DomainCommand, deps: CommandDispatchDeps): Promise<CommandResult> {
  const envelopeError = validateEnvelope(cmd);
  if (envelopeError) return fail(cmd, envelopeError);

  // TENANT IS DERIVED FROM THE PRINCIPAL, NEVER FROM THE COMMAND ENVELOPE. A
  // claimed tenant/workspace on the command is validated and rejected on
  // mismatch — deny-by-default against a forged or stale UI claim.
  const scope = deps.resolveScope();
  if (!scope || !scope.tenantId) return fail(cmd, 'UNRESOLVED_TENANT');
  if (cmd.tenantId && cmd.tenantId !== scope.tenantId) return fail(cmd, 'CROSS_TENANT_CLAIM');
  if (cmd.workspaceId && scope.workspaceId && cmd.workspaceId !== scope.workspaceId) return fail(cmd, 'CROSS_WORKSPACE_CLAIM');

  return deps.idempotency.run(scope.tenantId, cmd.idempotencyKey, async () => {
    // AUTHORIZATION at the domain boundary — reuses the one `ctx.authorize`
    // engine, fail-closed. The delegated module handler authorizes again
    // (defense in depth); this is the command's own explicit gate.
    try {
      deps.ctx.authorize(PERMISSION_FOR_COMMAND[cmd.type]);
    } catch {
      return fail(cmd, 'UNAUTHORIZED');
    }

    const handlers = buildModuleHandlers(deps.registry, deps.ctx);
    const call: HandlerCall = (channel, payload) => {
      const def = handlers.find((d) => d.channel === channel);
      if (!def) throw new Error(`no handler for channel ${channel}`);
      return (def.handler as (p: unknown) => Promise<unknown>)(payload);
    };

    let result: CommandResult;
    try {
      result = await route(cmd, deps, call);
    } catch (err) {
      return fail(cmd, err instanceof Error ? err.message : 'COMMAND_FAILED');
    }

    // A domain event is emitted ONLY on a successful state change — immutable,
    // tenant-scoped, correlated, attributable (§8).
    if (result.ok) {
      result.event = deps.events.append({
        type: EVENT_FOR_COMMAND[cmd.type],
        tenantId: scope.tenantId,
        aggregateId: str(result.data?.id ?? cmd.target?.id),
        correlationId: cmd.correlationId,
        actor: cmd.actor,
        at: cmd.timestamp || new Date().toISOString(),
        detail: { ...(result.data ?? {}), source: cmd.source },
      });
    }
    return result;
  });
}
