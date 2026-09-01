/**
 * Multi-line transaction recovery + reconciliation (ERP Session 8).
 *
 * The multi-line seam (Session 7-Fix) posts movements first and finalizes the
 * document status LAST, so a crash mid-transaction can leave orphaned posted
 * movements while the document is still `draft` (interrupted post), or leave a
 * `failed` document with un-voided movements (interrupted compensation). Nothing
 * reconciled these after a restart.
 *
 * This module recovers deterministically from EXISTING durable state — the
 * document (status + lines) and its movements (found by `referenceRecord`), plus
 * the Session 6 `MOV-<id>-REV` reversal — with NO new accounting policy: it
 * enforces the all-or-nothing semantics already chosen (Option A, #104):
 *
 *   • declared success (received/dispatched/running) → trusted (a later manual
 *     void is a legitimate reversal, not a crash) — untouched.
 *   • declared rollback (failed) with posted movements → finish the compensation.
 *   • interrupted (non-terminal) with posted movements:
 *       - all lines valid AND every line posted → the posting phase completed,
 *         only the status write was lost → COMPLETE (finalize status).
 *       - otherwise (partial, or any invalid line that must fail) → COMPENSATE
 *         (void every posted line) and mark rolled-back.
 *
 * Idempotent: re-running finds a now-consistent state and does nothing. Bounded:
 * it scans the (small) document stores, never the full ledger. Compensation
 * reuses the Session 6 reversal, so it can never post a duplicate reversal.
 */
import type { EnterpriseEntity } from '@neuropause/shared';
import { PRODUCTION_ORDERS_MODULE_ID, STOCK_MOVEMENTS_MODULE_ID } from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { voidPostedMovement } from './multiLineMovements';

// Local ids (avoid an inventory→procurement/sales import cycle; ids are stable).
const MULTILINE_RECEIPTS_ID = 'procurement-multiline-receipts';
const MULTILINE_DISPATCHES_ID = 'sales-multiline-dispatches';
/** Production statuses at/after START — a running/finished order is trusted, not recovered. */
const PRODUCTION_STARTED_STATUSES = ['running', 'completed', 'cancelled'];

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export type RecoveryState =
  | 'NOT_STARTED'
  | 'COMPLETED'
  | 'COMPENSATED'
  | 'RECOVERED_COMPLETED'
  | 'RECOVERED_COMPENSATED';

export interface RecoveryResult {
  docId: string;
  state: RecoveryState;
  changed: boolean;
  posted: number;
  voided: number;
  expected: number;
}

/** The stock movements that belong to one document (found by its reference). */
export async function movementsForDocument(
  ctx: EnterpriseModuleActionContext,
  docModuleId: string,
  docId: string,
): Promise<EnterpriseEntity[]> {
  const mv = ctx.moduleFor(STOCK_MOVEMENTS_MODULE_ID);
  if (!mv) return [];
  await mv.store.load();
  return mv.store
    .list()
    .filter((r) => r.status !== 'deleted' && str(r.fields.referenceModule) === docModuleId && str(r.fields.referenceRecord) === docId);
}

async function setDocStatus(
  ctx: EnterpriseModuleActionContext,
  docModuleId: string,
  docId: string,
  status: string,
): Promise<void> {
  const module = ctx.moduleFor(docModuleId);
  if (!module) return;
  await module.store.load();
  const updated = module.store.update(docId, { fields: { status }, actor: ctx.actor(), now: ctx.now() });
  if (updated) ctx.emit(module, 'updated', updated);
}

export interface ReconcileOptions {
  docModuleId: string;
  doc: EnterpriseEntity;
  /** Total lines the document declares. */
  expectedLineCount: number;
  /** True when EVERY line is valid (so the transaction could legitimately succeed). */
  allLinesValid: boolean;
  /** The status a successful transaction ends in (e.g. 'received'). */
  successStatus: string;
  /** The status a rolled-back transaction ends in (e.g. 'failed'). */
  rollbackStatus: string;
  /** Statuses that mean "declared success — trust it" (never recover a legitimate later void). */
  successTerminal: readonly string[];
}

/**
 * Reconcile ONE multi-line document to a consistent all-or-nothing state.
 * Deterministic + idempotent. Returns what it observed and whether it changed
 * anything.
 */
export async function reconcileTransaction(
  ctx: EnterpriseModuleActionContext,
  opts: ReconcileOptions,
): Promise<RecoveryResult> {
  const movements = await movementsForDocument(ctx, opts.docModuleId, opts.doc.id);
  const posted = movements.filter((m) => str(m.fields.status) === 'posted');
  const voided = movements.filter((m) => str(m.fields.status) === 'void');
  const status = str(opts.doc.fields.status);
  const base = { docId: opts.doc.id, posted: posted.length, voided: voided.length, expected: opts.expectedLineCount };

  // Declared success — a later manual void is a legitimate reversal, not a crash.
  if (opts.successTerminal.includes(status)) {
    return { ...base, state: 'COMPLETED', changed: false };
  }

  // Declared rollback — ensure every posted line is compensated (finish an
  // interrupted compensation).
  if (status === opts.rollbackStatus) {
    if (posted.length === 0) return { ...base, state: 'COMPENSATED', changed: false };
    for (const m of posted) await voidPostedMovement(ctx, m.id);
    return { ...base, state: 'RECOVERED_COMPENSATED', changed: true, posted: 0, voided: voided.length + posted.length };
  }

  // Non-terminal (draft): nothing posted → never started.
  if (posted.length === 0) return { ...base, state: 'NOT_STARTED', changed: false };

  // Interrupted transaction. Only COMPLETE when the posting phase provably
  // finished: every line valid and every line posted. Otherwise roll back.
  if (opts.allLinesValid && opts.expectedLineCount > 0 && posted.length === opts.expectedLineCount) {
    await setDocStatus(ctx, opts.docModuleId, opts.doc.id, opts.successStatus);
    return { ...base, state: 'RECOVERED_COMPLETED', changed: true };
  }
  for (const m of posted) await voidPostedMovement(ctx, m.id);
  await setDocStatus(ctx, opts.docModuleId, opts.doc.id, opts.rollbackStatus);
  return { ...base, state: 'RECOVERED_COMPENSATED', changed: true, posted: 0, voided: voided.length + posted.length };
}

/** Count a document's declared lines: total + how many are valid. */
export function lineCounts(linesJson: string): { total: number; valid: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(linesJson || '[]');
  } catch {
    return { total: 0, valid: 0 };
  }
  if (!Array.isArray(raw)) return { total: 0, valid: 0 };
  let valid = 0;
  for (const l of raw) {
    const line = (l ?? {}) as Record<string, unknown>;
    if (str(line.sku) && (Number(line.quantity ?? 0) || 0) > 0) valid += 1;
  }
  return { total: raw.length, valid };
}

/**
 * Recover every multi-line document in a store (bounded scan of the document
 * store, never the ledger). `successStatus`/`rollbackStatus`/`successTerminal`
 * describe that document type's status machine.
 */
export async function recoverDocumentStore(
  ctx: EnterpriseModuleActionContext,
  module: EnterpriseModule,
  cfg: { successStatus: string; rollbackStatus: string; successTerminal: readonly string[] },
): Promise<RecoveryResult[]> {
  await module.store.load();
  const results: RecoveryResult[] = [];
  for (const doc of module.store.list()) {
    if (doc.status === 'deleted') continue;
    const { total, valid } = lineCounts(str(doc.fields.lines));
    results.push(
      await reconcileTransaction(ctx, {
        docModuleId: module.descriptor.id,
        doc,
        expectedLineCount: total,
        allLinesValid: total > 0 && valid === total,
        successStatus: cfg.successStatus,
        rollbackStatus: cfg.rollbackStatus,
        successTerminal: cfg.successTerminal,
      }),
    );
  }
  return results;
}

/**
 * Reconcile an interrupted production START. Production's status machine uses
 * `released` for both "material allocated, not yet consumed" and the roll-back
 * target, so it is reconciled on its own: a pre-`running` order that already has
 * posted consumption movements was interrupted mid-START — roll it back (void the
 * consumptions; the order stays `released` and can be re-started). A running or
 * finished order is trusted (a later manual void is a legitimate reversal).
 * Deterministic + idempotent.
 */
export async function reconcileProductionStart(
  ctx: EnterpriseModuleActionContext,
  order: EnterpriseEntity,
): Promise<RecoveryResult> {
  const status = str(order.fields.status);
  const cons = (await movementsForDocument(ctx, PRODUCTION_ORDERS_MODULE_ID, order.id)).filter(
    (m) => str(m.fields.type) === 'production_consumption',
  );
  const posted = cons.filter((m) => str(m.fields.status) === 'posted');
  const base = { docId: order.id, posted: posted.length, voided: cons.length - posted.length, expected: cons.length };
  if (PRODUCTION_STARTED_STATUSES.includes(status)) return { ...base, state: 'COMPLETED', changed: false };
  if (posted.length === 0) return { ...base, state: 'NOT_STARTED', changed: false };
  for (const m of posted) await voidPostedMovement(ctx, m.id);
  return { ...base, state: 'RECOVERED_COMPENSATED', changed: true, posted: 0, voided: cons.length };
}

/**
 * Recover every multi-line transaction reachable in the active tenant scope —
 * bounded (it scans the small document/order stores, never the full ledger).
 * Runs within whatever scope the caller has bound, so it is tenant-safe: it only
 * ever touches the active tenant's documents. Idempotent.
 */
export async function recoverAllMultiLineTransactions(
  ctx: EnterpriseModuleActionContext,
): Promise<RecoveryResult[]> {
  const out: RecoveryResult[] = [];
  const receipts = ctx.moduleFor(MULTILINE_RECEIPTS_ID);
  if (receipts) out.push(...(await recoverDocumentStore(ctx, receipts, { successStatus: 'received', rollbackStatus: 'failed', successTerminal: ['received'] })));
  const dispatches = ctx.moduleFor(MULTILINE_DISPATCHES_ID);
  if (dispatches) out.push(...(await recoverDocumentStore(ctx, dispatches, { successStatus: 'dispatched', rollbackStatus: 'failed', successTerminal: ['dispatched'] })));
  const orders = ctx.moduleFor(PRODUCTION_ORDERS_MODULE_ID);
  if (orders) {
    await orders.store.load();
    for (const o of orders.store.list()) {
      if (o.status !== 'deleted') out.push(await reconcileProductionStart(ctx, o));
    }
  }
  return out;
}
