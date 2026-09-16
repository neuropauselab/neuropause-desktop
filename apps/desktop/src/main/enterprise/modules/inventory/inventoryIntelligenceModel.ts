/**
 * S81 — Inventory Aging + Available-to-Promise (ATP) intelligence: the PURE model.
 *
 * This file computes NOTHING new about the physical world. It READS the authoritative
 * inventory ledger (stock movements) + the product master + open purchase orders and
 * DERIVES two read-only intelligence views. It never mutates a ledger, never invents a
 * quantity, and reuses the canonical stock semantics:
 *
 *   • On-hand / reserved / available come from the SAME movement deltas the product
 *     master already materializes (`movementFromRecord` + the on-hand / reserved rules).
 *     Available = on-hand − reserved (the product master's own definition, reused).
 *   • ATP = available + incoming, where incoming is the outstanding quantity on OPEN
 *     purchase orders (committed but not yet received). Received POs are already in
 *     on-hand via their receive movement, so they are never counted twice.
 *
 * AGING METHOD — FIFO physical layers (see DECISION-MEMO-S81-INVENTORY-AGING-ATP.md):
 *   Remaining on-hand is attributed to receipt layers oldest-first-consumed (standard
 *   FIFO physical flow). Each surviving layer carries the age of its receiving movement.
 *   This is the only way to age on-hand from an immutable movement ledger, and it is a
 *   universal convention, not a business-specific threshold. Cost method (standard cost)
 *   is orthogonal and untouched — this is physical-flow aging, not valuation.
 *
 * BUCKETS — adapted from the repo's existing AP-aging 30-day cadence (finance/apAgingModule:
 * current / 1–30 / 31–60 / 61–90 / 90+). Inventory age has no "due date", so the AP
 * "current vs past-due" split has no meaning here; the inventory buckets are the same
 * 30-day cadence with the same 90+ tail: 0–30 / 31–60 / 61–90 / 90+. No new threshold is
 * invented — the cadence is reused. See the memo.
 *
 * Electron-free and store-free: every input is a plain array, so it unit-tests directly.
 */
import type { StockMovement, MovementType } from '@neuropause/shared';
import { parsePurchaseOrderLines } from '../../../erp/procurementLines';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * PO statuses that count as INCOMING (committed but not yet received). Deliberately the
 * complement of the three unambiguous exclusions — `draft` (merely created), `received`
 * (already in on-hand via its receive movement) and `cancelled` (dead) — so no priority
 * or allocation policy is invented. See the decision memo.
 */
export const INCOMING_PO_STATUSES: ReadonlySet<string> = new Set(['approved', 'sent']);

/** The minimal open-order shape the incoming derivation needs (the instance adapts records). */
export interface OpenOrderInput {
  status: string;
  product: string;
  warehouse: string;
  quantity: number;
  /** Raw `lines` JSON field, if the PO is multi-line; overrides the header when present. */
  linesRaw?: unknown;
}

/**
 * Outstanding incoming quantity from OPEN purchase orders, per (sku, warehouse). Multi-line
 * POs use their `lines` (the authoritative content); single-product POs use the header. A PO
 * whose status is not incoming contributes nothing. Warehouse is the PO's destination.
 */
export function incomingFromOpenOrders(orders: OpenOrderInput[]): IncomingLine[] {
  const byPair = new Map<string, IncomingLine>();
  const add = (sku: string, warehouse: string, quantity: number): void => {
    if (!sku || !warehouse || quantity <= 0) return;
    const key = `${sku} ${warehouse}`;
    const existing = byPair.get(key);
    if (existing) existing.quantity += quantity;
    else byPair.set(key, { sku, warehouse, quantity });
  };
  for (const o of orders) {
    if (!INCOMING_PO_STATUSES.has(o.status) || !o.warehouse) continue;
    const lines = parsePurchaseOrderLines(o.linesRaw);
    if (lines.length > 0) {
      for (const l of lines) add(l.sku, o.warehouse, l.quantity);
    } else {
      add(o.product, o.warehouse, o.quantity);
    }
  }
  return [...byPair.values()];
}

/** Movement types that ADD to a warehouse's physical on-hand. */
const PHYSICAL_IN: ReadonlySet<MovementType> = new Set<MovementType>([
  'receive',
  'production_output',
  'return',
]);
/** Movement types that REMOVE from a warehouse's physical on-hand. */
const PHYSICAL_OUT: ReadonlySet<MovementType> = new Set<MovementType>([
  'issue',
  'production_consumption',
]);

/** The four inventory-aging buckets (AP 30-day cadence, adapted — no "current/past-due"). */
export type AgingBucketKey = 'days0to30' | 'days31to60' | 'days61to90' | 'days90plus';

export const AGING_BUCKET_KEYS: readonly AgingBucketKey[] = [
  'days0to30',
  'days31to60',
  'days61to90',
  'days90plus',
];

/**
 * Deterministic bucket for an age in whole days. Inclusive upper bounds at 30 / 60 / 90;
 * anything strictly older than 90 is the tail. A negative age (a future-dated movement)
 * is clamped into the freshest bucket rather than invented into its own.
 */
export function bucketForAgeDays(ageDays: number): AgingBucketKey {
  const a = Math.max(0, Math.floor(ageDays));
  if (a <= 30) return 'days0to30';
  if (a <= 60) return 'days31to60';
  if (a <= 90) return 'days61to90';
  return 'days90plus';
}

/** A surviving FIFO layer: some quantity received at some instant. */
interface FifoLayer {
  quantity: number;
  atMs: number;
}

function parseMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * The signed effect of a movement on ONE warehouse's physical on-hand. Transfers are the
 * reason this is warehouse-aware: a transfer credits its destination (`warehouse`) and
 * debits its source (`fromWarehouse`), which the product-total delta (net-zero) hides.
 * Reservations are holds, never physical, so they contribute zero here.
 */
function warehouseOnHandDelta(m: StockMovement, warehouse: string): number {
  if (m.status === 'void') return 0;
  const q = Math.abs(m.quantity);
  if (m.type === 'transfer') {
    if (m.warehouse === warehouse) return q; // transfer IN
    if (m.fromWarehouse === warehouse) return -q; // transfer OUT
    return 0;
  }
  if (m.warehouse !== warehouse) return 0;
  if (PHYSICAL_IN.has(m.type)) return q;
  if (PHYSICAL_OUT.has(m.type)) return -q;
  if (m.type === 'adjustment') return m.quantity; // signed adjustment
  return 0; // reservation / reservation_release
}

/**
 * Build the surviving FIFO layers for one (sku, warehouse) from the ledger. Positive
 * movements push a dated layer; negative movements consume the OLDEST layers first
 * (FIFO). A consumption larger than the stock on hand simply empties the layers — on-hand
 * never goes below zero physically, and a ledger that says otherwise ages nothing.
 * The sum of the returned layer quantities equals that warehouse's net on-hand.
 */
export function fifoLayersFor(
  movements: StockMovement[],
  sku: string,
  warehouse: string,
): { quantity: number; atMs: number }[] {
  const relevant = movements
    .filter((m) => m.product === sku && m.status !== 'void')
    .filter((m) => warehouseOnHandDelta(m, warehouse) !== 0)
    .slice()
    .sort((a, b) => parseMs(a.createdAt) - parseMs(b.createdAt));

  const layers: FifoLayer[] = [];
  for (const m of relevant) {
    const delta = warehouseOnHandDelta(m, warehouse);
    if (delta > 0) {
      layers.push({ quantity: delta, atMs: parseMs(m.createdAt) });
    } else {
      let toConsume = -delta;
      while (toConsume > 0 && layers.length > 0) {
        const oldest = layers[0]!;
        if (oldest.quantity > toConsume) {
          oldest.quantity -= toConsume;
          toConsume = 0;
        } else {
          toConsume -= oldest.quantity;
          layers.shift();
        }
      }
      // toConsume > 0 here means the ledger issued more than it held: no aged stock remains.
    }
  }
  return layers.filter((l) => l.quantity > 0).map((l) => ({ quantity: l.quantity, atMs: l.atMs }));
}

/** One (sku, warehouse) aging row: on-hand split across the four buckets. */
export interface AgingRow {
  sku: string;
  warehouse: string;
  onHand: number;
  days0to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  oldestAgeDays: number;
}

export interface AgingSnapshot {
  asOfDate: string;
  totalOnHand: number;
  days0to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  rows: AgingRow[];
  skuWarehouseCount: number;
  over90Count: number;
}

/**
 * Derive an inventory-aging snapshot from the ledger for a set of (sku, warehouse) pairs.
 * The pairs come from the movements themselves — a product+warehouse that never moved has
 * no on-hand to age. Deterministic; read-only; empty in → honestly empty out.
 */
export function deriveAgingSnapshot(
  movements: StockMovement[],
  asOfMs: number,
  asOfDate: string,
): AgingSnapshot {
  const pairs = new Map<string, { sku: string; warehouse: string }>();
  for (const m of movements) {
    if (m.status === 'void' || !m.product) continue;
    for (const wh of [m.warehouse, m.fromWarehouse]) {
      if (!wh) continue;
      const key = `${m.product} ${wh}`;
      if (!pairs.has(key)) pairs.set(key, { sku: m.product, warehouse: wh });
    }
  }

  const rows: AgingRow[] = [];
  for (const { sku, warehouse } of pairs.values()) {
    const layers = fifoLayersFor(movements, sku, warehouse);
    if (layers.length === 0) continue; // net zero on-hand here — nothing to age
    const row: AgingRow = {
      sku,
      warehouse,
      onHand: 0,
      days0to30: 0,
      days31to60: 0,
      days61to90: 0,
      days90plus: 0,
      oldestAgeDays: 0,
    };
    for (const layer of layers) {
      const ageDays = Math.max(0, Math.floor((asOfMs - layer.atMs) / DAY_MS));
      row.onHand += layer.quantity;
      row[bucketForAgeDays(ageDays)] += layer.quantity;
      if (ageDays > row.oldestAgeDays) row.oldestAgeDays = ageDays;
    }
    rows.push(row);
  }
  rows.sort((a, b) =>
    a.sku === b.sku ? a.warehouse.localeCompare(b.warehouse) : a.sku.localeCompare(b.sku),
  );

  const snap: AgingSnapshot = {
    asOfDate,
    totalOnHand: 0,
    days0to30: 0,
    days31to60: 0,
    days61to90: 0,
    days90plus: 0,
    rows,
    skuWarehouseCount: rows.length,
    over90Count: 0,
  };
  for (const r of rows) {
    snap.totalOnHand += r.onHand;
    snap.days0to30 += r.days0to30;
    snap.days31to60 += r.days31to60;
    snap.days61to90 += r.days61to90;
    snap.days90plus += r.days90plus;
    if (r.days90plus > 0) snap.over90Count += 1;
  }
  return snap;
}

/** An open-PO incoming line: outstanding quantity expected into a warehouse. */
export interface IncomingLine {
  sku: string;
  warehouse: string;
  quantity: number;
}

/**
 * The ATP inputs already computed elsewhere, keyed per (sku, warehouse). `available` must
 * already be on-hand − reserved (the product master's own definition). Incoming is added
 * here; nothing is double-counted because incoming is open-PO quantity that has NOT been
 * received into on-hand.
 */
export interface AtpInput {
  sku: string;
  warehouse: string;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
}

export interface AtpRow extends AtpInput {
  atp: number;
}

export interface AtpSnapshot {
  asOfDate: string;
  rows: AtpRow[];
  totalOnHand: number;
  totalReserved: number;
  totalAvailable: number;
  totalIncoming: number;
  totalAtp: number;
  shortfallCount: number;
}

/** Net physical on-hand for one (sku, warehouse) from the ledger (transfer-aware). */
export function warehouseOnHand(movements: StockMovement[], sku: string, warehouse: string): number {
  return Math.round(
    movements
      .filter((m) => m.product === sku)
      .reduce((s, m) => s + warehouseOnHandDelta(m, warehouse), 0),
  );
}

/**
 * Reserved quantity held at one (sku, warehouse): reservation movements add, releases
 * subtract, clamped at zero. Same rule the product master uses, scoped to a warehouse.
 */
export function warehouseReserved(movements: StockMovement[], sku: string, warehouse: string): number {
  const n = movements
    .filter((m) => m.product === sku && m.warehouse === warehouse && m.status !== 'void')
    .reduce((s, m) => {
      if (m.type === 'reservation') return s + Math.abs(m.quantity);
      if (m.type === 'reservation_release') return s - Math.abs(m.quantity);
      return s;
    }, 0);
  return Math.max(0, Math.round(n));
}

/**
 * Assemble ATP inputs per (sku, warehouse) from the ledger + open-PO incoming lines.
 * The pair set is the UNION of everything the ledger has moved and everything a PO expects,
 * so a location that only has incoming stock (no movements yet) still appears with ATP =
 * its incoming. available = max(0, on-hand − reserved); nothing is counted twice.
 */
export function assembleAtpInputs(
  movements: StockMovement[],
  incoming: IncomingLine[],
): AtpInput[] {
  const pairs = new Map<string, { sku: string; warehouse: string }>();
  const add = (sku: string, wh: string): void => {
    if (!sku || !wh) return;
    const key = `${sku} ${wh}`;
    if (!pairs.has(key)) pairs.set(key, { sku, warehouse: wh });
  };
  for (const m of movements) {
    if (m.status === 'void') continue;
    add(m.product, m.warehouse);
    add(m.product, m.fromWarehouse);
  }
  for (const i of incoming) add(i.sku, i.warehouse);

  const incomingByPair = new Map<string, number>();
  for (const i of incoming) {
    if (!i.sku || !i.warehouse || i.quantity <= 0) continue;
    const key = `${i.sku} ${i.warehouse}`;
    incomingByPair.set(key, (incomingByPair.get(key) ?? 0) + i.quantity);
  }

  const inputs: AtpInput[] = [];
  for (const { sku, warehouse } of pairs.values()) {
    const onHand = warehouseOnHand(movements, sku, warehouse);
    const reserved = warehouseReserved(movements, sku, warehouse);
    const available = Math.max(0, onHand - reserved);
    const inc = incomingByPair.get(`${sku} ${warehouse}`) ?? 0;
    if (onHand === 0 && reserved === 0 && inc === 0) continue; // nothing to say here
    inputs.push({ sku, warehouse, onHand, reserved, available, incoming: inc });
  }
  return inputs;
}

/** ATP = available + incoming, per row. Deterministic; adds no policy beyond that identity. */
export function deriveAtpSnapshot(inputs: AtpInput[], asOfDate: string): AtpSnapshot {
  const rows: AtpRow[] = inputs
    .map((i) => ({ ...i, atp: i.available + i.incoming }))
    .sort((a, b) =>
      a.sku === b.sku ? a.warehouse.localeCompare(b.warehouse) : a.sku.localeCompare(b.sku),
    );
  const snap: AtpSnapshot = {
    asOfDate,
    rows,
    totalOnHand: 0,
    totalReserved: 0,
    totalAvailable: 0,
    totalIncoming: 0,
    totalAtp: 0,
    shortfallCount: 0,
  };
  for (const r of rows) {
    snap.totalOnHand += r.onHand;
    snap.totalReserved += r.reserved;
    snap.totalAvailable += r.available;
    snap.totalIncoming += r.incoming;
    snap.totalAtp += r.atp;
    // A "shortfall" is an operational signal, not a policy: reserved demand exceeds
    // available on-hand at this location (the row leans on incoming to be promisable).
    if (r.reserved > r.available) snap.shortfallCount += 1;
  }
  return snap;
}
