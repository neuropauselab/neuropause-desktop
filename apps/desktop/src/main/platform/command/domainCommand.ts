/**
 * NeuroPause Platform — Domain Command contract (ERP Session 17, Track B).
 *
 * The canonical envelope every client (Electron today; Web / Mobile / API / AI
 * agent tomorrow) uses to request a governed state change. It is deliberately
 * transport-agnostic and Electron-free: the command carries no database handle,
 * no privileged capability, and no authority of its own. Authority is resolved
 * at the domain boundary from the caller's PRINCIPAL (see `commandBus`), never
 * from fields on this envelope — a `tenantId` here is a CLAIM to be validated,
 * not a grant.
 *
 * Modular-monolith-first: this contract lives in-process and routes to the
 * existing enterprise module framework. No microservice, no message broker.
 */

/** The four governed procurement commands this session implements end-to-end. */
export type DomainCommandType =
  | 'CreatePurchaseRequest'
  | 'SubmitPurchaseRequest'
  | 'ApprovePurchaseRequest'
  | 'RejectPurchaseRequest'
  | 'ConvertPurchaseRequestToPO';

/** Where a command originated. Descriptive only — it grants nothing. */
export type CommandSource = 'electron' | 'web' | 'mobile' | 'api' | 'agent' | 'test';

export interface DomainCommand {
  /** Unique id for THIS command instance (one attempt). */
  commandId: string;
  type: DomainCommandType;
  /**
   * CLAIMED tenant / org / workspace. Validated against the resolved principal
   * scope at the boundary and rejected on mismatch — never trusted as authority.
   */
  tenantId?: string;
  organizationId?: string;
  workspaceId?: string;
  /** The requesting principal (attribution). Real authority is `ctx.authorize`. */
  actor: string;
  /** The entity a command acts on (absent for a create). */
  target?: { moduleId?: string; id?: string };
  /** Command-type-specific input. Treated as untrusted data. */
  payload: Record<string, unknown>;
  /** Ties this command to the business transaction it belongs to. */
  correlationId: string;
  /** Repeated delivery with the same key yields one economic effect. */
  idempotencyKey: string;
  /** ISO timestamp the command was minted. */
  timestamp: string;
  source: CommandSource;
}

/** A domain event produced by a successful command. Immutable + attributable. */
export interface DomainEvent {
  eventId: string;
  type: DomainEventType;
  tenantId: string;
  /** The aggregate the event is about (e.g. the Purchase Request id). */
  aggregateId: string;
  correlationId: string;
  actor: string;
  at: string;
  /** Small, event-specific detail (ids, status). No secrets, no payloads echoed. */
  detail: Record<string, unknown>;
}

export type DomainEventType =
  | 'PurchaseRequestCreated'
  | 'PurchaseRequestSubmitted'
  | 'PurchaseRequestApproved'
  | 'PurchaseRequestRejected'
  | 'PurchaseRequestConvertedToPO';

export interface CommandResult {
  ok: boolean;
  commandId: string;
  type: DomainCommandType;
  /** The domain event emitted on success. */
  event?: DomainEvent;
  /** Result data (created id, converted PO id, …). */
  data?: Record<string, unknown>;
  /** Failure reason (deny-by-default vocabulary). */
  error?: string;
  /** True when this was a replay of an already-processed idempotency key. */
  replayed?: boolean;
}

/** The domain event a successful command of each type produces. */
export const EVENT_FOR_COMMAND: Record<DomainCommandType, DomainEventType> = {
  CreatePurchaseRequest: 'PurchaseRequestCreated',
  SubmitPurchaseRequest: 'PurchaseRequestSubmitted',
  ApprovePurchaseRequest: 'PurchaseRequestApproved',
  RejectPurchaseRequest: 'PurchaseRequestRejected',
  ConvertPurchaseRequestToPO: 'PurchaseRequestConvertedToPO',
};

/**
 * The permission a command requires. All four procurement commands are governed
 * by the Purchase Request module's WRITE permission — resolved through the same
 * `ctx.authorize` engine every enterprise action uses (no second authz engine).
 */
export const PERMISSION_FOR_COMMAND: Record<DomainCommandType, 'procurement:manage'> = {
  CreatePurchaseRequest: 'procurement:manage',
  SubmitPurchaseRequest: 'procurement:manage',
  ApprovePurchaseRequest: 'procurement:manage',
  RejectPurchaseRequest: 'procurement:manage',
  ConvertPurchaseRequestToPO: 'procurement:manage',
};
