/**
 * Production variance settlement (ERP Session 5-Fix) — the once-per-order,
 * VARIANCE-ONLY completion posting under the standard-cost model.
 *
 * After a production order completes, its consumption movements have debited WIP
 * with the actual (standard-costed) material consumed, and its output movement
 * has credited WIP with the standard cost of finished goods. The residual WIP is
 * the production variance:
 *
 *     Σ(consumption value)  −  Σ(output value)   =   production variance
 *     └── actual accumulated WIP ──┘   └─ standard output ─┘
 *
 * This seam clears that residual to account 5910 (production variance) ONLY — it
 * never re-posts the FG↔WIP move (the per-movement GL bridge already owns that),
 * so it can never double-book finished goods or inventory. It is:
 *   • variance-only (Dr/Cr 5910 vs WIP for exactly the residual);
 *   • idempotent — a deterministic `VAR-<orderId>` entry number, so a replayed
 *     completion (or a later order update) never posts a second variance;
 *   • best-effort — a GL failure never unwinds the physical completion;
 *   • tenant-scoped — it posts through the shared action context, whose stores
 *     are bound to the active scope.
 *
 * Cost comes ONLY from the order's own movements (no independent costing here);
 * the standard-cost basis is resolved centrally in `postStockMovement`.
 */
import type { EnterpriseEntity, EnterpriseModuleActionResult } from '@neuropause/shared';
import {
  JOURNAL_ENTRIES_MODULE_ID,
  PRODUCTION_EXECUTIONS_MODULE_ID,
  PRODUCTION_ORDERS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  movementFromRecord,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { applyGlDerivedEntries } from '../finance/glPosting';
import { STOCK_ACCOUNTS } from '../../../erp/postingRules';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The deterministic variance-settlement entry number — the idempotency key. */
export function productionVarianceEntryNumber(orderId: string): string {
  return `VAR-${orderId}`;
}

export interface ProductionVarianceOutcome extends EnterpriseModuleActionResult {
  posted: boolean;
  variance: number;
  wipAccumulated: number;
  standardCostOfOutput: number;
}

/**
 * Settle the production variance for one completed order. Gathers the order's own
 * production movements — classic path (movement `referenceRecord` == order id)
 * and MES path (movement `referenceRecord` ∈ the order's execution ids) — sums
 * consumption vs output value, and clears the residual WIP to 5910.
 */
export async function settleProductionVariance(
  order: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<ProductionVarianceOutcome> {
  const none = (message: string, extra: Partial<ProductionVarianceOutcome> = {}): ProductionVarianceOutcome => ({
    ok: true,
    posted: false,
    variance: 0,
    wipAccumulated: 0,
    standardCostOfOutput: 0,
    message,
    ...extra,
  });

  const movementsModule = ctx.moduleFor(STOCK_MOVEMENTS_MODULE_ID);
  const journal = ctx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
  if (!movementsModule || !journal) return none('GL not wired — no variance settled.');
  await movementsModule.store.load();

  const orderNumber = str(order.fields.orderNumber);

  // MES path: the order's execution ids (movements reference the execution).
  const executionIds = new Set<string>();
  const execModule = ctx.moduleFor(PRODUCTION_EXECUTIONS_MODULE_ID);
  if (execModule) {
    await execModule.store.load();
    for (const e of execModule.store.list()) {
      if (e.status !== 'deleted' && str(e.fields.productionOrder) === orderNumber) executionIds.add(e.id);
    }
  }

  const belongs = (record: EnterpriseEntity): boolean => {
    const refModule = str(record.fields.referenceModule);
    const refRecord = str(record.fields.referenceRecord);
    if (refModule === PRODUCTION_ORDERS_MODULE_ID && refRecord === order.id) return true;
    if (refModule === PRODUCTION_EXECUTIONS_MODULE_ID && executionIds.has(refRecord)) return true;
    return false;
  };

  let wipAccumulated = 0;
  let standardCostOfOutput = 0;
  for (const record of movementsModule.store.list()) {
    if (record.status === 'deleted') continue;
    if (!belongs(record)) continue;
    const m = movementFromRecord(record);
    if (m.status === 'void') continue;
    const value = round2(Math.abs(m.quantity) * (m.unitCost || 0));
    if (m.type === 'production_consumption') wipAccumulated += value;
    else if (m.type === 'production_output') standardCostOfOutput += value;
  }
  wipAccumulated = round2(wipAccumulated);
  standardCostOfOutput = round2(standardCostOfOutput);
  const variance = round2(wipAccumulated - standardCostOfOutput);

  if (variance === 0) {
    return none('No production variance to settle.', { wipAccumulated, standardCostOfOutput });
  }

  // Variance-only entry: clear the residual WIP to 5910. NEVER re-post FG/WIP —
  // the per-movement bridge already owns the FG↔WIP completion move.
  const entryNumber = productionVarianceEntryNumber(order.id);
  const abs = Math.abs(variance);
  const lines =
    variance > 0
      ? [
          { account: STOCK_ACCOUNTS.productionVariance, debit: abs, credit: 0, memo: 'Unfavourable production variance' },
          { account: STOCK_ACCOUNTS.wip, debit: 0, credit: abs, memo: 'WIP settled to variance' },
        ]
      : [
          { account: STOCK_ACCOUNTS.wip, debit: abs, credit: 0, memo: 'WIP settled to variance' },
          { account: STOCK_ACCOUNTS.productionVariance, debit: 0, credit: abs, memo: 'Favourable production variance' },
        ];

  await applyGlDerivedEntries(
    [
      {
        entryNumber,
        memo: `Production variance ${orderNumber || order.id}`,
        lines,
        sourceModule: PRODUCTION_ORDERS_MODULE_ID,
        sourceRef: order.id,
      },
    ],
    ctx,
  );

  return {
    ok: true,
    posted: true,
    variance,
    wipAccumulated,
    standardCostOfOutput,
    message: `Settled production variance ${variance} for ${orderNumber || order.id}.`,
  };
}
