/**
 * Multi-line inventory transaction seam (ERP Session 7-Fix) — the ONE reusable
 * way any document posts N inventory lines as a single logical business
 * transaction with COMPENSATING all-or-nothing semantics.
 *
 * BUSINESS-LEVEL ATOMICITY, not database atomicity: the enterprise stores are
 * not a single DB transaction. The guarantee is that a multi-line post either
 * leaves ALL lines posted, or — if any line fails — voids every line already
 * posted (the Session 6 `MOV-<id>-REV` reversal), so no partial inventory/GL
 * effect and no orphaned partial document is ever left behind.
 *
 * Every line flows through the SAME `postStockMovement` seam, so it inherits the
 * Session 5-Fix standard-cost resolution and the seam #1 GL posting — there is no
 * second costing or GL path here. Movements are immutable (compensation marks
 * them void; it never mutates or deletes a posted movement's economic fields),
 * reversal entries are append-only, and compensation is idempotent.
 */
import type { MovementType } from '@neuropause/shared';
import { STOCK_MOVEMENTS_MODULE_ID } from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { postStockMovement } from './postMovement';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** One line of a multi-line inventory document. */
export interface MovementLineInput {
  sku: string;
  quantity: number;
  warehouse: string;
  /** Optional caller cost; otherwise standard cost is resolved at the seam. */
  unitCost?: number;
}

/** The document that owns the lines (for movement reference + numbering). */
export interface MultiLineDoc {
  module: string;
  recordId: string;
  number: string;
  type: MovementType;
  reason?: string;
}

export interface MultiLinePostResult {
  ok: boolean;
  /** Ids of the movements that are POSTED at the end (empty when compensated). */
  movementIds: string[];
  postedCount: number;
  failedIndex: number | null;
  compensated: boolean;
  message: string;
}

/**
 * Void an already-posted movement — reverses its inventory (the reconciler
 * excludes void) AND its GL (Session 6 `MOV-<id>-REV`). Idempotent: a movement
 * already void is left untouched. The movement record is retained (marked void),
 * never deleted or economically mutated.
 */
export async function voidPostedMovement(
  ctx: EnterpriseModuleActionContext,
  movementId: string,
): Promise<boolean> {
  const mv = ctx.moduleFor(STOCK_MOVEMENTS_MODULE_ID);
  if (!mv) return false;
  await mv.store.load();
  const rec = mv.store.get(movementId);
  if (!rec || str(rec.fields.status) === 'void') return false;
  const updated = mv.store.update(movementId, {
    fields: { status: 'void' },
    actor: ctx.actor(),
    now: ctx.now(),
  });
  if (!updated) return false;
  // Re-run the movement lifecycle: reconcile stock + post the GL reversal.
  await mv.hooks.onChange?.({ action: 'updated', record: updated }, ctx);
  ctx.emit(mv, 'updated', updated);
  return true;
}

/**
 * Post N inventory movements for one document with compensating all-or-nothing
 * semantics. Deterministic per-line movement numbers (`MV-<docNumber>-L<n>`).
 * On the first line that fails to post, every previously-posted line is voided
 * (compensated) and the result reports the failure — the document is left with no
 * net inventory/GL effect.
 */
export async function postMovementLinesAtomic(
  ctx: EnterpriseModuleActionContext,
  doc: MultiLineDoc,
  lines: readonly MovementLineInput[],
): Promise<MultiLinePostResult> {
  const movementIds: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const posted =
      line.sku && line.warehouse && line.quantity > 0
        ? await postStockMovement(ctx, {
            movementNumber: `MV-${doc.number}-L${i + 1}`,
            type: doc.type,
            product: line.sku,
            warehouse: line.warehouse,
            quantity: line.quantity,
            unitCost: line.unitCost,
            referenceModule: doc.module,
            referenceRecord: doc.recordId,
            reason: doc.reason ?? `${doc.number} line ${i + 1}`,
          })
        : null;
    if (!posted) {
      // Compensate every previously-posted line — business-level all-or-nothing.
      let compensated = 0;
      for (const id of movementIds) {
        if (await voidPostedMovement(ctx, id)) compensated += 1;
      }
      return {
        ok: false,
        movementIds: [],
        postedCount: 0,
        failedIndex: i,
        compensated: compensated > 0,
        message: `Line ${i + 1} (${line.sku || 'blank SKU'}) could not post — compensated ${compensated} prior line(s); no net effect.`,
      };
    }
    movementIds.push(posted.id);
  }
  return {
    ok: true,
    movementIds,
    postedCount: movementIds.length,
    failedIndex: null,
    compensated: false,
    message: `Posted ${movementIds.length} line(s).`,
  };
}
