/**
 * Manufacturing → Inventory movement helpers — the ONLY way production touches
 * stock. Every one routes through the shared `postStockMovement` seam (validate →
 * ledger → product reconcile → audit + Timeline), so the Inventory Ledger stays the
 * single source of truth and no manufacturing module writes stock directly.
 *
 *  • Component consumption posts a `production_consumption` movement (on-hand out).
 *  • Finished goods post a `production_output` movement (on-hand in).
 *  • Material reservation reuses Warehouse's reservation helpers (no duplication).
 */
import type { EnterpriseEntity } from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { postStockMovement } from '../inventory/postMovement';

// Reuse Warehouse's reservation machinery — it wraps the same postStockMovement seam.
export { netReserved, postReservation, postReservationRelease } from '../warehouse/warehouseMovements';

export interface ProductionMovementArgs {
  movementNumber: string;
  product: string;
  warehouse: string;
  quantity: number;
  unitCost?: number;
  referenceModule: string;
  referenceRecord: string;
  reason: string;
}

/** Consume a component into production (`production_consumption` — lowers on-hand). */
export async function postConsumption(
  ctx: EnterpriseModuleActionContext,
  args: ProductionMovementArgs,
): Promise<EnterpriseEntity | null> {
  return postStockMovement(ctx, { ...args, type: 'production_consumption' });
}

/** Yield finished goods from production (`production_output` — raises on-hand). */
export async function postOutput(
  ctx: EnterpriseModuleActionContext,
  args: ProductionMovementArgs,
): Promise<EnterpriseEntity | null> {
  return postStockMovement(ctx, { ...args, type: 'production_output' });
}
