/**
 * Inventory → Reservations — the reservation DOCUMENT domain (W3.4).
 *
 * The stock-movement ledger ALREADY understands reservations — the
 * `reservation` / `reservation_release` movement types feed the reserved
 * column of `deriveStockLedger`. What was missing is the DOCUMENT: who
 * reserved what, for which order, with a lifecycle. This module adds exactly
 * that, and quantities stay the ledger's truth: creating a reservation POSTS
 * a `reservation` movement through the existing Stock Movements module (the
 * W1 GL-seam pattern applied to stock), releasing or fulfilling posts the
 * matching `reservation_release`. Nothing re-implements ledger math.
 *
 * DETERMINISTIC availability guard at validate: a reservation must fit inside
 * the ledger's AVAILABLE quantity for its product + warehouse (on-hand minus
 * already-reserved), refused with the available amount stated. Movement
 * numbers are derived from the reservation number (`MV-RES-*` /
 * `MV-RESREL-*`) and each lifecycle step posts at most once, guarded by its
 * marker. Fulfilment releases the reservation only — the physical `issue`
 * movement belongs to shipping/fulfilment, stated on the action result.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity } from './enterpriseModule';

/** The Reservations module id + record kind (the framework store key). */
export const RESERVATIONS_MODULE_ID = 'inventory-reservations';
export const RESERVATION_KIND = 'stockReservation';

export type ReservationStatus = 'active' | 'released' | 'fulfilled';

/** A typed view over a reservation record's flat fields (+ envelope timestamps). */
export interface StockReservation {
  id: string;
  reservationNumber: string;
  product: string;
  warehouse: string;
  quantity: number;
  referenceModule: string;
  referenceRecord: string;
  reason: string;
  status: ReservationStatus;
  reservedMovement: string;
  releaseMovement: string;
  releasedAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}

/** The marker-derived status — fulfilment wins, then release, else active. */
export function deriveReservationStatus(fields: {
  fulfilledAt?: unknown;
  releasedAt?: unknown;
}): ReservationStatus {
  if (str(fields.fulfilledAt)) return 'fulfilled';
  if (str(fields.releasedAt)) return 'released';
  return 'active';
}

/** Project a framework record into a typed reservation. */
export function reservationFromRecord(record: EnterpriseEntity): StockReservation {
  const f = record.fields;
  return {
    id: record.id,
    reservationNumber: str(f.reservationNumber) || record.title,
    product: str(f.product),
    warehouse: str(f.warehouse),
    quantity: num(f.quantity),
    referenceModule: str(f.referenceModule),
    referenceRecord: str(f.referenceRecord),
    reason: str(f.reason),
    status: deriveReservationStatus(f),
    reservedMovement: str(f.reservedMovement),
    releaseMovement: str(f.releaseMovement),
    releasedAt: str(f.releasedAt) || null,
    fulfilledAt: str(f.fulfilledAt) || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The deterministic movement numbers a reservation's lifecycle posts. */
export function reservationMovementNumber(reservationNumber: string): string {
  return `MV-RES-${reservationNumber}`;
}
export function reservationReleaseMovementNumber(reservationNumber: string): string {
  return `MV-RESREL-${reservationNumber}`;
}
