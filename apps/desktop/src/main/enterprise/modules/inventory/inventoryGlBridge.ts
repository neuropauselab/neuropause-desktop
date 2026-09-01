/**
 * ERP seam #1 — the operational inventory ledger → General Ledger bridge.
 *
 * The two ERP spines were each real but only weakly joined: the append-only
 * stock-movement ledger (`stockMovementModule`) moved physical stock and derived
 * on-hand/value, while the Phase-6 posting rules (`erp/postingRules.ts`) could
 * derive balanced Dr/Cr entries — but only from hand-entered document lines that
 * nothing populated. So stock could move with NO general-ledger effect, leaving
 * the balance sheet and gross margin unobtainable from the books.
 *
 * This bridge closes that seam at the point stock actually moves: for a valued
 * movement it derives the matching balanced journal entry from the movement's OWN
 * quantity × unit cost (never a separate document), and posts it through the one
 * accounting engine via `applyGlDerivedEntries` (the same idempotent, balance-
 * guarded seam invoice/payment already use).
 *
 * Discipline this bridge keeps:
 *  - REUSE, not reinvent: account mapping + balanced-line logic come from the
 *    existing `postingRules.ts` derivations; posting stays in the journal module.
 *  - IDEMPOTENT: the journal entry is keyed `MOV-<movementId>`, so the same
 *    movement can never post twice (applyGlDerivedEntries skips an existing
 *    entry number, and the derivation reference is stable).
 *  - NON-BLOCKING / ADVISORY: the physical movement and its product reconcile
 *    already stand before this runs; a GL failure must never unwind them, so the
 *    caller contains it (mirrors the auto-reorder seam's discipline).
 *  - HONEST or SILENT: a movement with no resolvable value produces NO entry
 *    (the derivations refuse rather than post a plausible-wrong number); an
 *    internal move (transfer) or a commitment (reservation) has no GL effect and
 *    is intentionally skipped.
 *  - TENANT-SCOPED: it posts through `ctx`, which carries the resolved scope; the
 *    journal store denies an unscoped write, so nothing crosses a tenant.
 */
import type { GlDerivedEntry, StockMovement } from '@neuropause/shared';
import { STOCK_MOVEMENTS_MODULE_ID } from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework/enterpriseModule';
import {
  STOCK_ACCOUNTS,
  deriveCogsPosting,
  deriveGoodsReceiptPosting,
  deriveInventoryAdjustmentPosting,
  deriveMaterialIssuePosting,
  deriveProductionCompletionPosting,
  type PostingDerivation,
} from '../../../erp/postingRules';
import { ensureStockAccounts } from '../../../erp/stockAccounts';
import { applyGlDerivedEntries, reverseGlEntry } from '../finance/glPosting';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Derive the balanced GL entry for a single stock movement, keyed on the
 * movement id so it is idempotent. Returns `[]` for a movement that has no
 * general-ledger consequence (transfer / reservation / reservation_release), no
 * resolvable value, or whose derivation refuses.
 *
 * PURE — no I/O, no store access — so it is fully unit-testable on its own.
 */
export function deriveMovementGlPostings(movement: StockMovement, movementId: string): GlDerivedEntry[] {
  const entryNumber = `MOV-${movementId}`;
  const qty = Math.abs(movement.quantity);
  const unitCost = movement.unitCost;
  const value = round2(qty * unitCost);

  const wrap = (d: PostingDerivation): GlDerivedEntry[] =>
    d.ok
      ? [{ entryNumber, memo: d.memo, lines: d.lines, sourceModule: STOCK_MOVEMENTS_MODULE_ID, sourceRef: movementId }]
      : [];

  const direct = (memo: string, drAccount: string, crAccount: string): GlDerivedEntry[] => {
    if (value <= 0) return [];
    return [
      {
        entryNumber,
        memo,
        sourceModule: STOCK_MOVEMENTS_MODULE_ID,
        sourceRef: movementId,
        lines: [
          { account: drAccount, debit: value, credit: 0, memo },
          { account: crAccount, debit: 0, credit: value, memo },
        ],
      },
    ];
  };

  switch (movement.type) {
    case 'receive':
      // Stock arrives, a liability accrues before the invoice: Dr Inventory / Cr GRNI.
      return wrap(
        deriveGoodsReceiptPosting({
          receiptId: movementId,
          lines: [{ productId: movement.product, quantity: qty, unitPrice: unitCost }],
        }),
      );
    case 'issue':
      // Stock leaves as a sale: Dr COGS / Cr Inventory. Refuses (no entry) with
      // no unit cost — a half-costed dispatch would silently overstate margin.
      return wrap(
        deriveCogsPosting({
          dispatchId: movementId,
          lines: [{ productId: movement.product, quantity: qty, unitCost: unitCost > 0 ? unitCost : null }],
          // Costing basis is standard cost (Session 5-Fix): postMovement resolves
          // the movement's unit cost from the product's standardCost. Labelled
          // truthfully so no report claims a weighted-average it does not compute.
          method: 'standard',
        }),
      );
    case 'production_consumption':
      // Raw material issued to a production order: Dr WIP / Cr Inventory.
      return wrap(
        deriveMaterialIssuePosting({
          productionOrderId: movementId,
          lines: [{ productId: movement.product, quantity: qty, unitCost: unitCost > 0 ? unitCost : null }],
        }),
      );
    case 'production_output':
      // Finished goods produced: WIP becomes finished goods at the output value
      // (Dr Finished Goods / Cr WIP). Variance settlement is a separate seam; at
      // movement level wip == standard, so this posts the balanced FG↔WIP move.
      return wrap(
        deriveProductionCompletionPosting({
          productionOrderId: movementId,
          wipAccumulated: value,
          standardCostOfOutput: value,
        }),
      );
    case 'return':
      // Customer return to stock reverses the cost of sale: Dr Inventory / Cr COGS.
      return direct('Customer return to stock', STOCK_ACCOUNTS.inventory, STOCK_ACCOUNTS.cogs);
    case 'adjustment':
      // Counted truth reaches the ledger. Sign follows the movement quantity:
      // positive = written up (Dr Inventory), negative = written down.
      return wrap(
        deriveInventoryAdjustmentPosting({
          adjustmentId: movementId,
          valueDelta: round2(movement.quantity * unitCost),
          reason: 'Inventory adjustment',
        }),
      );
    case 'transfer':
    case 'reservation':
    case 'reservation_release':
      // Internal move or a commitment — no general-ledger effect.
      return [];
    default:
      return [];
  }
}

/**
 * Post a movement's derived entry into the GL. Best-effort by contract: the
 * caller (the movement onChange reconciler) has already committed the physical
 * ledger + product reconcile, so this must never throw into that path.
 *
 * Ensures the stock/production control accounts exist first (idempotent), then
 * posts through the journal via `applyGlDerivedEntries` (which no-ops if the GL
 * module is not wired, and skips an already-posted entry number).
 *
 * VOID (ERP Session 6): a voided movement REVERSES its posted `MOV-<id>` entry —
 * an explicit, append-only `MOV-<id>-REV` that negates the original, so the GL
 * follows the inventory reconciler (which already excludes void from balances).
 * Idempotent, so a duplicate/replayed void never double-reverses. Void is read
 * from the MOVEMENT's own status (posted|void), not the record's lifecycle status.
 */
export async function postMovementToGl(
  movement: StockMovement,
  movementId: string,
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  if (movement.status === 'void') {
    await reverseGlEntry(ctx, `MOV-${movementId}`, {
      reason: `Reversal of MOV-${movementId} (movement voided)`,
      sourceModule: STOCK_MOVEMENTS_MODULE_ID,
      sourceRef: movementId,
    });
    return;
  }
  const entries = deriveMovementGlPostings(movement, movementId);
  if (entries.length === 0) return;
  await ensureStockAccounts(ctx);
  await applyGlDerivedEntries(entries, ctx);
}
