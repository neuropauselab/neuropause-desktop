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
 *
 * ERP Session 18 — the bus supports TWO idempotency/event backends, chosen by the
 * caller: the in-memory pair (`idempotency` + `events`, Session 17) OR a durable
 * `journal` (Session 18) that commits the idempotency record, the domain event
 * and the outbox entry as ONE atomic write, compensating the state mutation if
 * the commit fails. The routing/authorization/transaction logic is identical; only
 * the durability of the idempotency+event+outbox differs.
 */
import type { TenantScope } from '@neuropause/shared';
import { CUSTOMERS_MODULE_ID, FINANCE_MODULE_ID, GOODS_RECEIPTS_MODULE_ID, IpcChannel, ORDERS_MODULE_ID, PAYMENTS_MODULE_ID, PURCHASE_REQUESTS_MODULE_ID, QUOTES_MODULE_ID, VENDOR_BILLS_MODULE_ID, VENDOR_PAYMENTS_MODULE_ID } from '@neuropause/shared';
import {
  buildModuleHandlers,
  INTERNAL_ACTION_ORIGIN,
  type EnterpriseModuleContext,
  type EnterpriseModuleRegistry,
} from '../../enterprise/framework';
import { CREATE_PO_ACTION } from '../../enterprise/modules/procurement/conversion';
import { POST_RECEIPT_ACTION } from '../../enterprise/modules/procurement/goodsReceiptModule';
import type { DomainEventLog } from './domainEventLog';
import type { CommandIdempotencyStore } from './commandIdempotency';
import type { DurableCommandJournal, TxExecuteResult } from './durableCommandJournal';
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
  /** In-memory idempotency + events (Session 17). Used when `journal` is absent. */
  events?: DomainEventLog;
  idempotency?: CommandIdempotencyStore;
  /** Durable idempotency + event + outbox (Session 18). Preferred when present. */
  journal?: DurableCommandJournal;
}

/** A routed command's result + the metadata the durable journal needs to commit. */
interface RouteOutcome {
  result: CommandResult;
  aggregateId?: string;
  aggregateType?: string;
  /** Compensate the state mutation if the durable commit fails (case C). */
  rollback?: () => Promise<void>;
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
  const isCreate = cmd.type === 'CreatePurchaseRequest' || cmd.type === 'CreateSalesOrder' || cmd.type === 'PaySupplierInvoice' || cmd.type === 'ReceiveCustomerPayment';
  if (!isCreate && !cmd.target?.id) return 'MISSING_TARGET';
  return null;
}

type HandlerCall = (channel: string, payload: unknown) => Promise<unknown>;

async function route(cmd: DomainCommand, deps: CommandDispatchDeps, call: HandlerCall): Promise<RouteOutcome> {
  const ok = (data: Record<string, unknown>, extra: Omit<RouteOutcome, 'result'> = {}): RouteOutcome => ({
    result: { ok: true, commandId: cmd.commandId, type: cmd.type, data },
    ...extra,
  });
  const no = (error: string): RouteOutcome => ({ result: fail(cmd, error) });
  const prStore = () => deps.registry.get(PURCHASE_REQUESTS_MODULE_ID)?.store;
  const who = () => deps.ctx.actor() ?? 'system';
  const now = () => deps.ctx.now();
  const moduleAction = async (
    moduleId: string,
    id: string | undefined,
    act: string,
  ): Promise<{ ok: boolean; message?: string; error?: string }> =>
    // ERP Session 46 — stamp the SERVER-SIDE internal-origin token so the legacy action door admits a
    // now-governed action from the command bus (and ONLY the command bus). The token is module-private and
    // unforgeable; the renderer path is `.strict()`-parsed and cannot carry it, so external callers are
    // refused. Harmless on non-governed actions (the door only checks the token for the governed keys).
    (await call(IpcChannel.EnterpriseModuleAction, { moduleId, id, action: act, origin: INTERNAL_ACTION_ORIGIN })) as {
      ok: boolean;
      message?: string;
      error?: string;
    };
  const action = (act: string) => moduleAction(PURCHASE_REQUESTS_MODULE_ID, cmd.target?.id, act);

  switch (cmd.type) {
    case 'CreatePurchaseRequest': {
      // Deny-by-default: a create is ALWAYS a draft — a client can never mint a
      // pre-approved request by supplying `status`.
      const r = (await call(IpcChannel.EnterpriseModuleCreate, {
        moduleId: PURCHASE_REQUESTS_MODULE_ID,
        fields: { ...cmd.payload, status: 'draft' },
      })) as { ok: boolean; record?: { id: string } };
      if (!(r.ok && r.record)) return no('VALIDATION_FAILED');
      const id = r.record.id;
      // Compensation (case C): if the durable commit fails, soft-delete the PR.
      return ok({ id }, { aggregateId: id, aggregateType: 'PurchaseRequest', rollback: async () => { prStore()?.softDelete(id, { actor: who(), now: now() }); } });
    }
    case 'SubmitPurchaseRequest':
    case 'ApprovePurchaseRequest':
    case 'RejectPurchaseRequest': {
      const act = cmd.type === 'SubmitPurchaseRequest' ? 'submit' : cmd.type === 'ApprovePurchaseRequest' ? 'approve' : 'reject';
      const id = str(cmd.target?.id);
      const priorStatus = str(prStore()?.get(id)?.fields.status);
      const r = await action(act);
      if (!r.ok) return no(r.error ?? r.message ?? `${act.toUpperCase()}_REFUSED`);
      // Compensation (case C): revert the status flip.
      return ok({ id }, { aggregateId: id, aggregateType: 'PurchaseRequest', rollback: async () => { prStore()?.update(id, { fields: { status: priorStatus }, actor: who(), now: now() }); } });
    }
    case 'ConvertPurchaseRequestToPO': {
      const id = str(cmd.target?.id);
      const r = await action(CREATE_PO_ACTION);
      if (!r.ok) return no(r.error ?? r.message ?? 'CONVERT_REFUSED');
      // The PO id is stamped onto the PR by the conversion — read it back for the
      // event/result (an internal read of the just-written record, not a govern-
      // ed cross-tenant query).
      const pr = prStore()?.get(id);
      const poId = str(pr?.fields.convertedOrder);
      // Compensation (case C): revert the PR and soft-delete the created PO.
      return ok(
        { id, purchaseOrderId: poId },
        {
          aggregateId: id,
          aggregateType: 'PurchaseRequest',
          rollback: async () => {
            prStore()?.update(id, { fields: { status: 'approved', convertedOrder: '' }, actor: who(), now: now() });
            if (poId) deps.registry.get('procurement-orders')?.store.softDelete(poId, { actor: who(), now: now() });
          },
        },
      );
    }
    case 'CreateSalesOrder': {
      // Deny-by-default: a create is ALWAYS `pending` — a client can never mint a
      // shipped/fulfilled order by supplying `status` on the envelope.
      //
      // CROSS-TENANT SAFETY (§16): a `customerRef`, when supplied, must resolve in
      // the caller's OWN tenant-scoped customer master. `store.get` applies
      // `scopeOrDeny`, so a customer belonging to another tenant is indistinguish-
      // able from one that does not exist (both `null`) → refused. There is no
      // path by which a Sales Order references a foreign tenant's customer.
      const customerRef = str(cmd.payload.customerRef).trim();
      if (customerRef) {
        const customers = deps.registry.get(CUSTOMERS_MODULE_ID)?.store;
        if (customers) await customers.load();
        if (!customers?.get(customerRef)) return no('CUSTOMER_NOT_FOUND');
      }
      const r = (await call(IpcChannel.EnterpriseModuleCreate, {
        moduleId: ORDERS_MODULE_ID,
        fields: { ...cmd.payload, status: 'pending' },
      })) as { ok: boolean; record?: { id: string } };
      if (!(r.ok && r.record)) return no('VALIDATION_FAILED');
      const id = r.record.id;
      // Compensation (case C): if the durable commit fails, soft-delete the order.
      return ok(
        { id },
        {
          aggregateId: id,
          aggregateType: 'SalesOrder',
          rollback: async () => { deps.registry.get(ORDERS_MODULE_ID)?.store.softDelete(id, { actor: who(), now: now() }); },
        },
      );
    }
    case 'PostGoodsReceipt': {
      // ERP Session 23 — post an EXISTING goods receipt against its PO through the SAME governed
      // path (reuses the goods-receipt `post` action → postMultiLineReceipt → per-line valued
      // `receive` movement + Dr Inventory / Cr GRNI, all-or-nothing; no new inventory store, no
      // `stock += X`, no invented accounting). The economic effect is DOUBLE-GUARDED against
      // duplication: the module refuses to re-post a `received` receipt (document-level idempotency)
      // AND the durable journal keys on the command's idempotency key (command-level).
      const id = str(cmd.target?.id);
      const r = await moduleAction(GOODS_RECEIPTS_MODULE_ID, id, POST_RECEIPT_ACTION);
      if (!r.ok) return no(r.error ?? r.message ?? 'RECEIPT_POST_REFUSED');
      // The receipt's posted movement ids are stamped back onto the record — read them for the event.
      const gr = deps.registry.get(GOODS_RECEIPTS_MODULE_ID)?.store.get(id);
      // NO auto-rollback: a posted receipt is a REAL inventory movement (Dr Inventory / Cr GRNI),
      // and reversing it is a governed decision, never a silent soft-delete. At-most-once is
      // guaranteed WITHOUT compensation — the module's `received` status guard refuses any re-post,
      // so a commit-failure retry cannot double the effect (it is refused, not re-executed).
      return ok(
        { id, movements: str(gr?.fields.receiptMovements) },
        { aggregateId: id, aggregateType: 'GoodsReceipt' },
      );
    }
    case 'ApproveSupplierInvoice': {
      // ERP Session 25 — approve an EXISTING vendor bill (supplier invoice) through the SAME governed
      // path. Reuses the vendor-bill `approve` action → the fail-closed three-way match (PO↔GR↔Bill,
      // billed ≤ received cumulative, with the existing DEFAULT_TOLERANCE — no new policy) → GRNI relief
      // / AP booking. Double-guarded against duplication: the module refuses to re-approve a non-draft
      // bill (now serialized per-PO, S25) AND the durable journal keys on the command's idempotency key.
      const id = str(cmd.target?.id);
      const r = await moduleAction(VENDOR_BILLS_MODULE_ID, id, 'approve');
      if (!r.ok) return no(r.error ?? r.message ?? 'INVOICE_APPROVE_REFUSED');
      const bill = deps.registry.get(VENDOR_BILLS_MODULE_ID)?.store.get(id);
      // NO auto-rollback: an approved goods bill relieves GRNI / books AP — a real accounting effect
      // whose reversal is a governed operation, never a silent soft-delete. At-most-once is guaranteed
      // WITHOUT compensation: the non-draft status guard refuses any re-approve.
      return ok(
        { id, status: str(bill?.fields.approvedAt ? 'approved' : bill?.status) },
        { aggregateId: id, aggregateType: 'SupplierInvoice' },
      );
    }
    case 'PaySupplierInvoice': {
      // ERP Session 26 — pay an approved supplier invoice by RECORDING a cleared vendor payment
      // through the SAME governed create path. Reuses the vendor-payment engine verbatim: its
      // validate refuses overpayment (cumulative cleared + this > bill total), a duplicate
      // transaction ref, and paying a draft/cancelled bill; its `onChange` books Dr Accounts
      // Payable / Cr Cash and settles the bill (partials accumulate; `paidDate` when covered).
      // Deny-by-default: the payment is always `cleared` — a client cannot record a void/pending
      // "payment" via this command. No new AP/payment store, no invented settlement/discount policy.
      const r = (await call(IpcChannel.EnterpriseModuleCreate, {
        moduleId: VENDOR_PAYMENTS_MODULE_ID,
        fields: { ...cmd.payload, status: 'cleared' },
      })) as { ok: boolean; record?: { id: string } };
      if (!(r.ok && r.record)) return no('VALIDATION_FAILED');
      const id = r.record.id;
      // Compensation (case C): if the durable commit fails, soft-delete the payment — the payment
      // module's `onChange` reconciler then un-pays the bill and reverses the GL (its defined
      // "voiding un-pays" behavior), so this is a clean create-compensation, not a silent reversal.
      return ok(
        { id },
        {
          aggregateId: id,
          aggregateType: 'SupplierPayment',
          rollback: async () => { deps.registry.get(VENDOR_PAYMENTS_MODULE_ID)?.store.softDelete(id, { actor: who(), now: now() }); },
        },
      );
    }
    case 'ShipSalesOrder': {
      // ERP Session 27 — ship an EXISTING sales order through the SAME governed path. Reuses the
      // sales-order `ship` action: the order status machine (`orderActionPatch`) guards the transition
      // (a cancelled/already-shipped/closed order returns no patch → refused), then `shipOrderStock`
      // issues on-hand and releases any reservation via the shared movement seam. No new shipment/
      // inventory store, no `stock -= X`, no invented shipping/partial-shipment policy.
      const id = str(cmd.target?.id);
      const r = await moduleAction(ORDERS_MODULE_ID, id, 'ship');
      if (!r.ok) return no(r.error ?? r.message ?? 'SHIP_REFUSED');
      const so = deps.registry.get(ORDERS_MODULE_ID)?.store.get(id);
      // NO auto-rollback: shipping issues a real inventory movement; reversing it is a governed
      // operation, never a silent soft-delete. At-most-once is guaranteed by the status machine —
      // the order is now `shipped`, so a commit-failure retry is refused, not re-executed.
      return ok(
        { id, status: str(so?.fields.status) },
        { aggregateId: id, aggregateType: 'SalesOrder' },
      );
    }
    case 'InvoiceSalesOrder': {
      // ERP Session 28 — raise a customer invoice from an EXISTING shipped order through the SAME
      // governed path. Reuses the sales-order `convertToInvoice` action → `convertOrderToInvoice`:
      // eligibility guard (shipped/fulfilled/closed only — a pending/cancelled order is refused),
      // already-invoiced guard, Finance write authz, and a DRAFT invoice whose amount = the order
      // total (tax NOT re-applied — the order total is already final). No new invoice store, no
      // invented pricing/tax/numbering/terms policy. A DRAFT invoice posts NOTHING to the GL — AR is
      // booked only when the invoice is ISSUED (see IssueCustomerInvoice).
      const id = str(cmd.target?.id);
      const r = await moduleAction(ORDERS_MODULE_ID, id, 'convertToInvoice');
      if (!r.ok) return no(r.error ?? r.message ?? 'INVOICE_REFUSED');
      // The invoice id is stamped back onto the order by the conversion — read it for the event.
      const order = deps.registry.get(ORDERS_MODULE_ID)?.store.get(id);
      const invoiceId = str(order?.fields.convertedInvoice);
      // NO auto-rollback needed: a draft invoice carries no economic effect, and at-most-once is
      // guaranteed by the order's `convertedInvoice` guard — a commit-failure retry finds the order
      // already invoiced and is refused, not re-executed. (Reversal, if ever needed, is the invoice
      // `cancel` action, never a silent soft-delete.)
      return ok(
        { id, invoiceId, status: 'draft' },
        { aggregateId: id, aggregateType: 'SalesOrder' },
      );
    }
    case 'IssueCustomerInvoice': {
      // ERP Session 28 — issue an EXISTING draft customer invoice through the SAME governed path.
      // Reuses the finance-invoice `issue` action: the invoice status machine guards the transition
      // (a non-draft/cancelled invoice returns no patch → refused), then `onChange` →
      // `handleInvoiceChangeForGl` posts the DEFINED Dr Accounts Receivable (1100) / Cr Sales Revenue
      // (4000) journal (control accounts auto-seeded on an empty chart). No new AR/GL engine, no
      // invented revenue-recognition/tax/FX policy.
      const id = str(cmd.target?.id);
      const r = await moduleAction(FINANCE_MODULE_ID, id, 'issue');
      if (!r.ok) return no(r.error ?? r.message ?? 'INVOICE_ISSUE_REFUSED');
      const inv = deps.registry.get(FINANCE_MODULE_ID)?.store.get(id);
      // NO auto-rollback: issuing books a real Dr AR / Cr Revenue journal — reversing it is a governed
      // operation (the invoice `cancel` action revokes the GL), never a silent soft-delete. At-most-once
      // is guaranteed WITHOUT compensation — the status guard refuses any re-issue.
      return ok(
        { id, status: str(inv?.fields.status) },
        { aggregateId: id, aggregateType: 'CustomerInvoice' },
      );
    }
    case 'ReceiveCustomerPayment': {
      // ERP Session 29 — record a customer receipt against an invoice by RECORDING a cleared customer
      // payment through the SAME governed create path. Reuses the customer-payment engine verbatim:
      // its validate refuses a nonexistent invoice, a non-positive amount, a duplicate transaction
      // ref, and overpayment beyond the invoice balance; its `onChange` books Dr Cash / Cr Accounts
      // Receivable and reconciles the invoice's paid amount + status from the real payment ledger
      // (partials accumulate; the invoice settles to paid when covered). Deny-by-default: the payment
      // is always `cleared` — a client cannot record a void/pending "receipt" via this command. No new
      // receipt/AR/cash store, no invented settlement/cash-account/credit policy.
      const r = (await call(IpcChannel.EnterpriseModuleCreate, {
        moduleId: PAYMENTS_MODULE_ID,
        fields: { ...cmd.payload, status: 'cleared' },
      })) as { ok: boolean; record?: { id: string } };
      if (!(r.ok && r.record)) return no('VALIDATION_FAILED');
      const id = r.record.id;
      // Compensation (case C): if the durable commit fails, soft-delete the payment — the payment
      // module's `onChange` reconciler then un-applies it from the invoice and reverses the GL (its
      // defined "voiding un-pays" behavior), so this is a clean create-compensation, not a bespoke
      // reversal of a real Dr Cash / Cr AR effect.
      return ok(
        { id },
        {
          aggregateId: id,
          aggregateType: 'CustomerPayment',
          rollback: async () => { deps.registry.get(PAYMENTS_MODULE_ID)?.store.softDelete(id, { actor: who(), now: now() }); },
        },
      );
    }
    case 'ConvertQuoteToSalesOrder': {
      // ERP Session 45 — convert an accepted quote into a Sales Order through the SAME governed
      // path. Reuses the quote `convertToOrder` action verbatim: only an `accepted` quote converts
      // (a draft/expired/converted quote is refused by the action's own guard), the order is minted
      // `pending` with the same validate hook the governed create uses, and the quote is retained +
      // cross-linked (`convertedOrder`, status `converted`). This closes the S45 bypass where the
      // conversion ran ONLY through the legacy `enterprise:module.action` door — no journal,
      // idempotency, event, or outbox. Exact precedent: ConvertPurchaseRequestToPO.
      const id = str(cmd.target?.id);
      const r = await moduleAction(QUOTES_MODULE_ID, id, 'convertToOrder');
      if (!r.ok) return no(r.error ?? r.message ?? 'QUOTE_CONVERT_REFUSED');
      // The order id is stamped back onto the quote by the conversion — read it for the event.
      const quote = deps.registry.get(QUOTES_MODULE_ID)?.store.get(id);
      const orderId = str(quote?.fields.convertedOrder);
      // Compensation (case C): if the durable commit fails, revert the quote and soft-delete the
      // order — mirroring ConvertPurchaseRequestToPO. The order is still `pending` (no stock, no
      // GL), so the soft-delete reverses the full effect.
      return ok(
        { id, orderId },
        {
          aggregateId: id,
          aggregateType: 'Quote',
          rollback: async () => {
            deps.registry.get(QUOTES_MODULE_ID)?.store.update(id, { fields: { status: 'accepted', convertedOrder: '' }, actor: who(), now: now() });
            if (orderId) deps.registry.get(ORDERS_MODULE_ID)?.store.softDelete(orderId, { actor: who(), now: now() });
          },
        },
      );
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

  // AUTHORIZATION + the governed transaction, shared by both backends. Returns a
  // RouteOutcome; authorization failure is a fail-closed result, never an
  // exception. Runs INSIDE the idempotency boundary so a replay never re-authorizes
  // or re-executes.
  const authorizeAndRoute = async (): Promise<RouteOutcome> => {
    try {
      deps.ctx.authorize(PERMISSION_FOR_COMMAND[cmd.type]);
    } catch {
      return { result: fail(cmd, 'UNAUTHORIZED') };
    }
    const handlers = buildModuleHandlers(deps.registry, deps.ctx);
    const call: HandlerCall = (channel, payload) => {
      const def = handlers.find((d) => d.channel === channel);
      if (!def) throw new Error(`no handler for channel ${channel}`);
      return (def.handler as (p: unknown) => Promise<unknown>)(payload);
    };
    try {
      return await route(cmd, deps, call);
    } catch (err) {
      return { result: fail(cmd, err instanceof Error ? err.message : 'COMMAND_FAILED') };
    }
  };

  // DURABLE PATH (Session 18): the journal commits idempotency + event + outbox
  // as one atomic write and compensates the state on a failed commit.
  if (deps.journal) {
    return deps.journal.run({
      tenantId: scope.tenantId,
      idempotencyKey: cmd.idempotencyKey,
      commandId: cmd.commandId,
      commandType: cmd.type,
      correlationId: cmd.correlationId,
      causationId: cmd.commandId,
      actor: cmd.actor,
      source: cmd.source,
      execute: async (): Promise<TxExecuteResult> => {
        const routed = await authorizeAndRoute();
        if (!routed.result.ok) return { ok: false, error: routed.result.error };
        return {
          ok: true,
          data: routed.result.data,
          aggregateId: routed.aggregateId,
          aggregateType: routed.aggregateType,
          rollback: routed.rollback,
        };
      },
    });
  }

  // IN-MEMORY PATH (Session 17): idempotency wraps; the event is appended on success.
  if (!deps.idempotency || !deps.events) return fail(cmd, 'NO_IDEMPOTENCY_BACKEND');
  const events = deps.events;
  return deps.idempotency.run(scope.tenantId, cmd.idempotencyKey, async () => {
    const routed = await authorizeAndRoute();
    const result = routed.result;
    if (result.ok) {
      result.event = events.append({
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
