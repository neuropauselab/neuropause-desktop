/**
 * Inventory → Lots — batch/lot tracking domain types + deterministic code
 * payloads (W3.3).
 *
 * A Lot is one received batch of one product in one warehouse: the traceable
 * unit between a goods receipt and consumption. Products already carry a
 * product-level `barcode`; the LOT-level scannable identity added here is
 * DETERMINISTIC data, not artwork: the barcode string IS the lot number, and
 * `codePayload` is a canonical JSON string (lot, sku, warehouse, quantity,
 * expiry) any barcode/QR renderer can draw — generated at validate, identical
 * on every machine, no native dependencies.
 *
 * Lifecycle is the W1 marker pattern: `Consume` stamps `consumedAt` and the
 * lot becomes immutable history. EXPIRY is TIME-DERIVED at read (like W2.3
 * contracts) — an active lot past its expiry date reads `expired` without any
 * stored status going stale. Lots REFERENCE stock; they do not move it —
 * quantities remain the stock-movement ledger's truth.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity } from './enterpriseModule';

/** The Lots module id + record kind (the framework store key). */
export const LOTS_MODULE_ID = 'inventory-lots';
export const LOT_KIND = 'lot';

/** Time-derived READ state — expired computed against `nowMs`, never stored. */
export type LotRuntimeState = 'active' | 'expired' | 'consumed';

/** A typed view over a lot record's flat fields (+ envelope timestamps). */
export interface InventoryLot {
  id: string;
  lotNumber: string;
  product: string;
  warehouse: string;
  quantity: number;
  expiryDate: string | null;
  receiptRef: string;
  codePayload: string;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}

/** Project a framework record into a typed lot. */
export function lotFromRecord(record: EnterpriseEntity): InventoryLot {
  const f = record.fields;
  return {
    id: record.id,
    lotNumber: str(f.lotNumber) || record.title,
    product: str(f.product),
    warehouse: str(f.warehouse),
    quantity: num(f.quantity),
    expiryDate: str(f.expiryDate) || null,
    receiptRef: str(f.receiptRef),
    codePayload: str(f.codePayload),
    consumedAt: str(f.consumedAt) || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * The canonical scannable payload — stable key order, so the same lot always
 * encodes the same bytes (a QR of this string is reproducible anywhere).
 */
export function lotCodePayload(fields: {
  lotNumber: string;
  product: string;
  warehouse: string;
  quantity: number;
  expiryDate: string | null;
}): string {
  return JSON.stringify({
    lot: fields.lotNumber,
    sku: fields.product,
    wh: fields.warehouse,
    qty: fields.quantity,
    exp: fields.expiryDate ?? '',
  });
}

/** The time-derived runtime state — consumption wins, then the expiry clock. */
export function lotRuntimeState(lot: InventoryLot, nowMs: number): LotRuntimeState {
  if (lot.consumedAt) return 'consumed';
  const expMs = lot.expiryDate ? Date.parse(lot.expiryDate) : NaN;
  if (Number.isFinite(expMs) && expMs < nowMs) return 'expired';
  return 'active';
}
