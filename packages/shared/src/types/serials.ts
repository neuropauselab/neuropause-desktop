/**
 * Inventory → Serial Units — per-unit serialized tracking on the Enterprise
 * Module Framework (W6-C2), completing Workstream C. Where a LOT is a batch of
 * many, a SERIAL is ONE physical unit with a unique identity followed through
 * its life: received → issued → (returned) → scrapped.
 *
 * Like lots, a serial's scannable identity is DETERMINISTIC data — the barcode
 * string IS the serial number and `codePayload` is canonical JSON any renderer
 * can draw. Lifecycle is the W1 marker pattern: `issuedAt` marks it out,
 * `return` clears it back to stock, `scrap` stamps the terminal `scrappedAt`
 * and the unit becomes immutable history. Serials REFERENCE stock — quantity
 * accounting stays the movement ledger's truth (each serial = one unit).
 *
 * Uniqueness note (stated honestly): the framework validates the MERGED field
 * set on update with no record id in the input, so serial-number uniqueness
 * cannot be hard-enforced at validate without breaking edits (the same reason
 * lots don't enforce lot-number uniqueness). Duplicates are DETECTED and
 * surfaced as a high risk instead — visible, not silently allowed.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity } from './enterpriseModule';

/** The Serial Units module id + record kind (the framework store key). */
export const SERIALS_MODULE_ID = 'inventory-serials';
export const SERIAL_KIND = 'serialUnit';

/** Marker-derived READ state — never stored stale. */
export type SerialRuntimeState = 'in_stock' | 'issued' | 'scrapped';

/** A typed view over a serial record's flat fields (+ envelope timestamps). */
export interface SerialUnit {
  id: string;
  serialNumber: string;
  product: string;
  warehouse: string;
  lotRef: string;
  receiptRef: string;
  issuedTo: string;
  codePayload: string;
  issuedAt: string | null;
  scrappedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Project a framework record into a typed serial unit. */
export function serialFromRecord(record: EnterpriseEntity): SerialUnit {
  const f = record.fields;
  return {
    id: record.id,
    serialNumber: str(f.serialNumber) || record.title,
    product: str(f.product),
    warehouse: str(f.warehouse),
    lotRef: str(f.lotRef),
    receiptRef: str(f.receiptRef),
    issuedTo: str(f.issuedTo),
    codePayload: str(f.codePayload),
    issuedAt: str(f.issuedAt) || null,
    scrappedAt: str(f.scrappedAt) || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * The canonical scannable payload — stable key order, so the same unit always
 * encodes the same bytes (a QR of this string is reproducible anywhere).
 */
export function serialCodePayload(fields: { serialNumber: string; product: string; warehouse: string }): string {
  return JSON.stringify({ sn: fields.serialNumber, sku: fields.product, wh: fields.warehouse });
}

/** The marker-derived runtime state — scrap wins, then issue, else in stock. */
export function serialRuntimeState(serial: SerialUnit): SerialRuntimeState {
  if (serial.scrappedAt) return 'scrapped';
  if (serial.issuedAt) return 'issued';
  return 'in_stock';
}
