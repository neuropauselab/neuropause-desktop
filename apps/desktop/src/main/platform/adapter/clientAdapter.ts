/**
 * NeuroPause Platform — client / API adapter boundary (ERP Session 21, Track B).
 *
 * The OUTERMOST governed seam: the single place an untrusted client (Electron,
 * Web, Mobile, HTTP API, or an AI agent) enters the platform. It sits ABOVE the
 * Session 19 application boundary and turns a plain, serializable `ClientRequest`
 * into an authenticated `RequestContext` + `ApplicationRequest`, then hands both
 * to `handleApplicationRequest` (which authorizes and commits through the SAME
 * command bus → durable transaction → event → outbox → audit).
 *
 *   client → ClientRequest (serializable, ZERO authority)
 *          → [adapter resolves the PRINCIPAL server-side]
 *          → RequestContext + ApplicationRequest
 *          → handleApplicationRequest  (authenticate → tenant claim → authorize → …)
 *          → ClientResponse (serializable, closed error contract)
 *
 * THE INVARIANTS THIS SEAM ENFORCES — none of them new engines, all of them the
 * shape of the boundary:
 *
 *   1. A `ClientRequest` is DATA. It carries no store handle, no privileged
 *      capability, no permission, no principal, and no `confirmed` flag — there is
 *      no field on the type through which a client could supply any of those, and
 *      anything smuggled inside `payload` is treated as ordinary command field
 *      data by the module `validate` hook, never as authority.
 *   2. The PRINCIPAL is resolved SERVER-SIDE by an injected `Authenticator` from
 *      the authenticated session — NEVER read from the client request. A claimed
 *      tenant on the request is validated against that principal and rejected on
 *      mismatch (deny-by-default, in the application boundary).
 *   3. An AI agent is JUST ANOTHER CLIENT (`AIAdapter`, source `'agent'`). It gains
 *      no special authority and no bypass: it provides only an operation + payload
 *      (untrusted data), and its human principal's granted permissions are what
 *      `ctx.authorize` consults. An agent acting for a principal without
 *      `sales:manage` is refused UNAUTHORIZED exactly like any other client.
 *   4. Only the CLOSED application error contract + a fixed safe message ever cross
 *      back out. No raw exception, path, secret, command code, or tenant data
 *      leaks — a misbehaving authenticator is caught and mapped to a safe failure.
 *
 * REUSE, NOT DUPLICATION: no second authentication, authorization, idempotency,
 * transaction, event, or audit engine — this seam only shapes the entry/exit.
 * Transport-neutral and Electron/React/IPC-free (proven by the independence test).
 */
import type { DomainCommandType, DomainEvent } from '../command/domainCommand';
import type { ApplicationDeps, ApplicationRequest, ApplicationResult } from '../application/applicationService';
import { handleApplicationRequest } from '../application/applicationService';
import type { Principal, RequestContext } from '../application/requestContext';
import { safeMessage, type ApplicationErrorCode } from '../application/applicationErrors';

/**
 * A plain, JSON-serializable request from an untrusted client. Deliberately
 * carries NO identity, NO tenant authority, NO permissions, and NO capability —
 * `operation` is a bare string (validated downstream, deny-by-default) precisely
 * because it arrives from the wire and must not be trusted to be a known command.
 */
export interface ClientRequest {
  /** The requested operation. UNTRUSTED — validated against the known command set. */
  operation: string;
  /** The entity a command acts on (absent for a create). */
  target?: string;
  /** Command input. UNTRUSTED DATA — never authority. */
  payload?: Record<string, unknown>;
  /** The client-controlled idempotency key (repeat delivery → one economic effect). */
  idempotencyKey: string;
  /** OPTIONAL client-CLAIMED tenant — validated against the resolved principal. */
  claimedTenantId?: string;
  /** OPTIONAL correlation id tying this to a business transaction (descriptive only). */
  correlationId?: string;
}

/** The serializable, client-safe response. Only the closed error contract crosses. */
export interface ClientResponse {
  ok: boolean;
  data?: Record<string, unknown>;
  event?: DomainEvent;
  replayed?: boolean;
  error?: { code: ApplicationErrorCode; message: string };
  /** Observability — echoed so the client can correlate (no tenant data). */
  requestId: string;
  correlationId: string;
  operation: string;
}

/**
 * Resolves the authenticated principal for an adapter's session. The ONE place
 * identity enters — server-side, never from the client request. Returning `null`
 * means the caller is unauthenticated (→ UNAUTHENTICATED, fail-closed).
 */
export interface Authenticator {
  resolvePrincipal(): Principal | null;
}

export interface ClientAdapterDeps extends ApplicationDeps {
  /** How the adapter learns WHO is calling — resolved server-side. */
  authenticator: Authenticator;
  /** Server-minted request id per attempt (injected for deterministic tests). */
  newRequestId?: () => string;
}

let requestSeq = 0;
const defaultRequestId = (): string => `req_${Date.now().toString(36)}_${(requestSeq++).toString(36)}`;

/**
 * The base adapter. Concrete adapters differ ONLY in their declared `source`
 * (attribution, descriptive — it grants nothing). Everything governance-bearing
 * is identical across every client, which is the point: one governed path.
 */
export abstract class ClientAdapter {
  constructor(protected readonly deps: ClientAdapterDeps) {}

  /** The command source stamped for attribution. Descriptive only — no authority. */
  protected abstract source(): 'electron' | 'web' | 'mobile' | 'api' | 'agent' | 'test';

  async submit(request: ClientRequest): Promise<ClientResponse> {
    const newId = this.deps.newRequestId ?? defaultRequestId;
    const requestId = newId();
    const correlationId = (request.correlationId ?? '').trim() || requestId;
    const operation = request.operation;
    try {
      // (2) PRINCIPAL RESOLVED SERVER-SIDE — never from the client request.
      const principal = this.deps.authenticator.resolvePrincipal();

      const ctx: RequestContext = {
        principal,
        correlationId,
        requestId,
        source: this.source(),
      };
      const appReq: ApplicationRequest = {
        // UNTRUSTED string → the command bus validates it against the known set
        // (unknown → VALIDATION_ERROR). The cast does not confer trust.
        operation: operation as DomainCommandType,
        ...(request.target ? { target: request.target } : {}),
        payload: request.payload ?? {},
        idempotencyKey: request.idempotencyKey,
        ...(request.claimedTenantId ? { claimedTenantId: request.claimedTenantId } : {}),
      };

      const result = await handleApplicationRequest(appReq, ctx, this.deps);
      return toClientResponse(result, operation);
    } catch {
      // (4) A misbehaving authenticator (or any unexpected throw) NEVER leaks —
      // map to a safe transient failure with the closed contract.
      return {
        ok: false,
        requestId,
        correlationId,
        operation,
        error: { code: 'TRANSIENT_FAILURE', message: safeMessage('TRANSIENT_FAILURE') },
      };
    }
  }
}

/** Translate the internal application result into the client-safe response. */
function toClientResponse(result: ApplicationResult, operation: string): ClientResponse {
  return {
    ok: result.ok,
    ...(result.data ? { data: result.data } : {}),
    ...(result.event ? { event: result.event } : {}),
    ...(result.replayed ? { replayed: true } : {}),
    ...(result.error ? { error: result.error } : {}),
    requestId: result.requestId,
    correlationId: result.correlationId,
    operation,
  };
}

/** A concrete adapter for tests / harnesses (source `'test'`). */
export class TestClientAdapter extends ClientAdapter {
  protected source(): 'test' {
    return 'test';
  }
}

/**
 * The adapter an AI agent submits through. Identical governance to every other
 * adapter — the agent is a client, not an authority. It supplies only operation +
 * payload; identity, tenant and permissions come from the resolved human
 * principal, and `ctx.authorize` is the sole gate. Source `'agent'` is attribution
 * only. (There is deliberately no AI-specific allow/deny policy here — that would
 * be inventing policy; deny-by-default via the principal's permissions governs.)
 */
export class AIAdapter extends ClientAdapter {
  protected source(): 'agent' {
    return 'agent';
  }
}
