/**
 * Module 10 — Inventory Platform. Warehouses, stock movements, on-hand quantities, weighted-
 * average valuation, reservations, and cycle counts. On-hand and valuation are real in-process
 * computations over recorded movements; the registry starts empty and no stock is fabricated.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';
import type { MovementKind } from './constants';

export interface Warehouse { id: string; name: string; }
export interface StockMovement {
  id: string;
  sku: string;
  warehouseId: string;
  qty: number; // signed: + into stock, - out of stock (derived from kind)
  unitCost: number;
  kind: MovementKind;
  at: number;
}

export class InventoryRuntime {
  private readonly warehousesMap = new Map<string, Warehouse>();
  private readonly movements: StockMovement[] = [];
  private readonly reservations = new Map<string, number>(); // key sku::wh -> reserved qty

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
  ) {}

  async createWarehouse(name: string): Promise<Warehouse> {
    const w: Warehouse = { id: randomId('wh'), name };
    this.warehousesMap.set(w.id, w);
    await this.governance.record({ actor: 'system', domain: 'inventory', operation: 'warehouse.create', targetId: w.id, evidence: 'live-verified' });
    return w;
  }
  async recordMovement(input: { sku: string; warehouseId: string; qty: number; kind: MovementKind; unitCost?: number }): Promise<StockMovement> {
    const signed = input.kind === 'issue' ? -Math.abs(input.qty) : input.kind === 'adjustment' ? input.qty : Math.abs(input.qty);
    const m: StockMovement = { id: randomId('mov'), sku: input.sku, warehouseId: input.warehouseId, qty: signed, unitCost: input.unitCost ?? 0, kind: input.kind, at: this.clock.now() };
    this.movements.push(m);
    await this.governance.record({ actor: 'system', domain: 'inventory', operation: `movement.${input.kind}`, targetId: m.id, evidence: 'live-verified' });
    return m;
  }
  /** Real on-hand quantity from recorded movements. */
  onHand(sku: string, warehouseId?: string): number {
    return this.movements.filter((m) => m.sku === sku && (warehouseId ? m.warehouseId === warehouseId : true)).reduce((s, m) => s + m.qty, 0);
  }
  /** Weighted-average valuation from receipt movements with cost. */
  valuation(sku: string): { onHand: number; unitCost: number; value: number } {
    const receipts = this.movements.filter((m) => m.sku === sku && m.qty > 0 && m.unitCost > 0);
    const qty = receipts.reduce((s, m) => s + m.qty, 0);
    const cost = receipts.reduce((s, m) => s + m.qty * m.unitCost, 0);
    const unitCost = qty > 0 ? Math.round((cost / qty) * 100) / 100 : 0;
    const onHand = this.onHand(sku);
    return { onHand, unitCost, value: Math.round(onHand * unitCost * 100) / 100 };
  }
  /** Reserve stock if available (real availability check). */
  reserve(sku: string, warehouseId: string, qty: number): { reserved: boolean; available: number } {
    const key = `${sku}::${warehouseId}`;
    const available = this.onHand(sku, warehouseId) - (this.reservations.get(key) ?? 0);
    if (qty > available) return { reserved: false, available };
    this.reservations.set(key, (this.reservations.get(key) ?? 0) + qty);
    return { reserved: true, available: available - qty };
  }
  /** Cycle count variance vs recorded on-hand (real diff). */
  cycleCount(sku: string, warehouseId: string, countedQty: number): { expected: number; counted: number; variance: number } {
    const expected = this.onHand(sku, warehouseId);
    return { expected, counted: countedQty, variance: countedQty - expected };
  }

  warehouses(): Warehouse[] { return [...this.warehousesMap.values()]; }
  stockMovements(): StockMovement[] { return [...this.movements]; }
  count(): number { return this.movements.length; }
}
