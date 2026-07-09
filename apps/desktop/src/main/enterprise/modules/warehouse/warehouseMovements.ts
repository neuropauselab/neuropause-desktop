/**
 * Warehouse → Inventory movement helpers — the ONLY way warehouse operations touch
 * stock. Every one routes through the shared `postStockMovement` seam (validate →
 * ledger → product reconcile → audit + Timeline), so the Inventory Ledger stays the
 * single source of truth and no warehouse module writes stock directly.
 *
 *  • Transfers post a PAIRED pair of `transfer` movements (out: source → IN-TRANSIT,
 *    in: IN-TRANSIT → destination) — net-zero on the product total, relocated per
 *    location by the existing ledger projection.
 *  • Cycle counts + stock adjustments post a signed `adjustment` movement.
 *  • Picks/shipments reserve + issue exactly like Sales, on their own reference chain.
 */
import type { EnterpriseEntity } from '@neuropause/shared';
import {
  IN_TRANSIT_LOCATION,
  STOCK_MOVEMENTS_MODULE_ID,
  movementFromRecord,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { postStockMovement } from '../inventory/postMovement';

/** Net quantity currently reserved in the ledger for a given warehouse reference. */
export function netReserved(
  ctx: EnterpriseModuleActionContext,
  referenceModule: string,
  referenceRecord: string,
): number {
  const mv = ctx.moduleFor(STOCK_MOVEMENTS_MODULE_ID);
  if (!mv) return 0;
  return mv.store
    .list()
    .map(movementFromRecord)
    .filter((m) => m.referenceModule === referenceModule && m.referenceRecord === referenceRecord)
    .reduce((s, m) => {
      if (m.status === 'void') return s;
      if (m.type === 'reservation') return s + Math.abs(m.quantity);
      if (m.type === 'reservation_release') return s - Math.abs(m.quantity);
      return s;
    }, 0);
}

export interface TransferPairArgs {
  transferNumber: string;
  transferId: string;
  product: string;
  quantity: number;
  fromWarehouse: string;
  toWarehouse: string;
  referenceModule: string;
}

/** Post the Transfer-Out leg (source → IN-TRANSIT). Returns the movement or null. */
export async function postTransferOut(
  ctx: EnterpriseModuleActionContext,
  args: TransferPairArgs,
): Promise<EnterpriseEntity | null> {
  return postStockMovement(ctx, {
    movementNumber: `MV-${args.transferNumber}-OUT`,
    type: 'transfer',
    product: args.product,
    warehouse: IN_TRANSIT_LOCATION,
    fromWarehouse: args.fromWarehouse,
    quantity: args.quantity,
    referenceModule: args.referenceModule,
    referenceRecord: args.transferId,
    reason: `Transfer ${args.transferNumber} out of ${args.fromWarehouse}`,
  });
}

/** Post the Transfer-In leg (IN-TRANSIT → destination). Returns the movement or null. */
export async function postTransferIn(
  ctx: EnterpriseModuleActionContext,
  args: TransferPairArgs,
): Promise<EnterpriseEntity | null> {
  return postStockMovement(ctx, {
    movementNumber: `MV-${args.transferNumber}-IN`,
    type: 'transfer',
    product: args.product,
    warehouse: args.toWarehouse,
    fromWarehouse: IN_TRANSIT_LOCATION,
    quantity: args.quantity,
    referenceModule: args.referenceModule,
    referenceRecord: args.transferId,
    reason: `Transfer ${args.transferNumber} into ${args.toWarehouse}`,
  });
}

export interface AdjustmentMovementArgs {
  movementNumber: string;
  product: string;
  warehouse: string;
  /** Signed quantity — positive adds stock, negative removes it. */
  quantity: number;
  unitCost?: number;
  referenceModule: string;
  referenceRecord: string;
  reason: string;
}

/** Post a signed `adjustment` movement (cycle-count variance / stock adjustment). */
export async function postAdjustmentMovement(
  ctx: EnterpriseModuleActionContext,
  args: AdjustmentMovementArgs,
): Promise<EnterpriseEntity | null> {
  return postStockMovement(ctx, {
    movementNumber: args.movementNumber,
    type: 'adjustment',
    product: args.product,
    warehouse: args.warehouse,
    quantity: args.quantity,
    unitCost: args.unitCost,
    referenceModule: args.referenceModule,
    referenceRecord: args.referenceRecord,
    reason: args.reason,
  });
}

export interface SimpleMovementArgs {
  movementNumber: string;
  product: string;
  warehouse: string;
  quantity: number;
  referenceModule: string;
  referenceRecord: string;
  reason: string;
}

/** Reserve stock (reservation movement) for a warehouse pick. */
export async function postReservation(
  ctx: EnterpriseModuleActionContext,
  args: SimpleMovementArgs,
): Promise<EnterpriseEntity | null> {
  return postStockMovement(ctx, { ...args, type: 'reservation' });
}

/** Release a reservation (reservation_release movement). */
export async function postReservationRelease(
  ctx: EnterpriseModuleActionContext,
  args: SimpleMovementArgs,
): Promise<EnterpriseEntity | null> {
  return postStockMovement(ctx, { ...args, type: 'reservation_release' });
}

/** Issue stock out of the ledger (goods physically leave on shipment). */
export async function postIssue(
  ctx: EnterpriseModuleActionContext,
  args: SimpleMovementArgs,
): Promise<EnterpriseEntity | null> {
  return postStockMovement(ctx, { ...args, type: 'issue' });
}
