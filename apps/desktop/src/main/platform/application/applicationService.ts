/**
 * NeuroPause Platform — application boundary (ERP Session 19, Track B).
 *
 * The thin, transport-neutral seam ABOVE the command bus that every client
 * adapter (Electron / Web / Mobile / API / AI) calls. It translates an
 * `ApplicationRequest` + an authenticated `RequestContext` into a canonical
 * DomainCommand, dispatches it through the SAME command bus (which authorizes and
 * commits through the durable transaction/event/outbox), and maps the outcome to
 * the deterministic application error contract — never leaking a raw internal
 * error, path, secret, or tenant data.
 *
 *   adapter → ApplicationRequest + RequestContext
 *           → [authenticate] → [validate tenant claim vs principal]
 *           → DomainCommand (tenant/actor from the AUTHENTICATED context)
 *           → dispatchCommand  (authorization → policy → durable transaction → event → outbox → audit)
 *           → ApplicationResult
 *
 * REUSE, NOT DUPLICATION: no second authorization, idempotency, transaction or
 * audit system. Authorization is `ctx.authorize` built from the principal's
 * granted permissions; idempotency/transaction/outbox are the Session 18 durable
 * journal, passed straight through. Electron/React/IPC-free.
 */
import type { TenantScope } from '@neuropause/shared';
import type { EnterpriseModuleContext, EnterpriseModuleRegistry } from '../../enterprise/framework';
import { dispatchCommand } from '../command/commandBus';
import type { DurableCommandJournal } from '../command/durableCommandJournal';
import type { CommandResult, DomainCommand, DomainCommandType, DomainEvent } from '../command/domainCommand';
import type { RequestContext } from './requestContext';
import { mapCommandError, safeMessage, type ApplicationErrorCode } from './applicationErrors';

/** A transport-neutral request from any adapter. The claimed tenant is untrusted. */
export interface ApplicationRequest {
  operation: DomainCommandType;
  target?: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  /** OPTIONAL client-claimed tenant — validated against the authenticated principal. */
  claimedTenantId?: string;
}

export interface ApplicationResult {
  ok: boolean;
  data?: Record<string, unknown>;
  event?: DomainEvent;
  replayed?: boolean;
  error?: { code: ApplicationErrorCode; message: string };
  // Observability — preserved on every result (§16).
  requestId: string;
  correlationId: string;
  causationId?: string;
  operation: DomainCommandType;
  target?: string;
  tenantId?: string;
  actor?: string;
}

export interface ApplicationDeps {
  registry: EnterpriseModuleRegistry;
  /** The durable idempotency + transaction + event + outbox (Session 18). Reused. */
  journal: DurableCommandJournal;
  /** The audit sink (the framework audit trail). Reused, not a second engine. */
  audit: (entry: { action: string; target: string; summary: string }) => void;
  /** Injected clock (tests). */
  now?: () => string;
}

const base = (req: ApplicationRequest, ctx: RequestContext): Pick<ApplicationResult, 'requestId' | 'correlationId' | 'causationId' | 'operation' | 'target'> => ({
  requestId: ctx.requestId,
  correlationId: ctx.correlationId,
  causationId: ctx.causationId,
  operation: req.operation,
  target: req.target,
});

const fail = (b: ReturnType<typeof base>, code: ApplicationErrorCode, extra: Partial<ApplicationResult> = {}): ApplicationResult => ({
  ok: false,
  ...b,
  ...extra,
  error: { code, message: safeMessage(code) },
});

/**
 * Handle one application request. Returns an `ApplicationResult` — a governance
 * refusal is a result with an error code, never a thrown exception; an
 * unexpected internal throw is caught and mapped to TRANSIENT_FAILURE so nothing
 * internal is ever exposed.
 */
export async function handleApplicationRequest(
  req: ApplicationRequest,
  ctx: RequestContext,
  deps: ApplicationDeps,
): Promise<ApplicationResult> {
  const b = base(req, ctx);
  try {
    // 1 · AUTHENTICATION — a resolved principal is required.
    const p = ctx.principal;
    if (!p || !p.actor || !p.tenantId) return fail(b, 'UNAUTHENTICATED');

    // 2 · TENANT — authoritative from the AUTHENTICATED principal. A client-claimed
    // tenant that disagrees is a scope violation (never trusted, never used).
    if (req.claimedTenantId && req.claimedTenantId !== p.tenantId) {
      return fail(b, 'TENANT_SCOPE_VIOLATION', { tenantId: p.tenantId, actor: p.actor });
    }

    // 3 · Canonical command — tenant + actor come from the authenticated context.
    const cmd: DomainCommand = {
      commandId: `cmd_${ctx.requestId}`,
      type: req.operation,
      tenantId: p.tenantId,
      ...(p.organizationId ? { organizationId: p.organizationId } : {}),
      ...(p.workspaceId ? { workspaceId: p.workspaceId } : {}),
      actor: p.actor,
      ...(req.target ? { target: { id: req.target } } : {}),
      payload: req.payload,
      correlationId: ctx.correlationId,
      idempotencyKey: req.idempotencyKey,
      timestamp: (deps.now ?? (() => new Date().toISOString()))(),
      source: ctx.source,
    };

    // 4 · Authorization ctx built from the PRINCIPAL's granted permissions — the
    // one authorization engine (`ctx.authorize`), reused. The bus and the module
    // both consult it; the boundary provides no bypass.
    const now = deps.now ?? (() => new Date().toISOString());
    const cmdCtx: EnterpriseModuleContext = {
      authorize: (perm) => {
        if (!p.permissions.includes(perm)) throw new Error('unauthorized');
      },
      audit: deps.audit,
      broadcast: () => undefined,
      actor: () => p.actor,
      now,
    };
    const scope: TenantScope = { tenantId: p.tenantId, workspaceId: p.workspaceId ?? '' };

    // 5 · Dispatch through the CANONICAL command bus (durable journal reused).
    const result: CommandResult = await dispatchCommand(cmd, {
      registry: deps.registry,
      ctx: cmdCtx,
      resolveScope: () => scope,
      journal: deps.journal,
    });

    // 6 · Map to the application result / error contract.
    const meta = { tenantId: p.tenantId, actor: p.actor };
    if (result.ok) {
      return {
        ok: true,
        ...b,
        ...meta,
        data: result.data,
        ...(result.event ? { event: result.event } : {}),
        ...(result.replayed ? { replayed: true } : {}),
      };
    }
    // Idempotency replays are surfaced honestly but not as an error unless the
    // caller cares; a failed original replays its failure code.
    return fail(b, mapCommandError(result.error), meta);
  } catch {
    // NEVER leak a raw internal exception.
    return fail(b, 'TRANSIENT_FAILURE');
  }
}
