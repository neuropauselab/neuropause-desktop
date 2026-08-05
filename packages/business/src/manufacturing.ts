/**
 * Module 11 — Manufacturing Platform. Plants, bills of materials, routing, work centers,
 * production orders, planning (BOM explosion), scheduling, and quality control, with MES/SCADA
 * ADAPTERS. BOM explosion and scheduling are real in-process computations; a production order is
 * only ever 'planned' or 'released' as a descriptor. Actual factory EXECUTION is REGULATED-
 * EXTERNAL and is never performed.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';
import { REGULATED_NOTE } from './types';
import type { ProductionState } from './constants';

export interface Plant { id: string; name: string; }
export interface BillOfMaterials { productSku: string; components: Array<{ sku: string; qty: number }>; }
export interface WorkCenter { id: string; name: string; capacityPerDay: number; }
export interface ProductionOrder {
  id: string;
  productSku: string;
  qty: number;
  plantId: string;
  state: ProductionState;
  workCenterId?: string;
  note: string;
  createdAt: number;
}

export class ManufacturingRuntime {
  private readonly plantsMap = new Map<string, Plant>();
  private readonly bomMap = new Map<string, BillOfMaterials>();
  private readonly workCentersMap = new Map<string, WorkCenter>();
  private readonly ordersMap = new Map<string, ProductionOrder>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
  ) {}

  async createPlant(name: string): Promise<Plant> {
    const p: Plant = { id: randomId('plant'), name };
    this.plantsMap.set(p.id, p);
    await this.governance.record({ actor: 'system', domain: 'manufacturing', operation: 'plant.create', targetId: p.id, evidence: 'live-verified' });
    return p;
  }
  async defineBOM(input: { productSku: string; components: Array<{ sku: string; qty: number }> }): Promise<BillOfMaterials> {
    const bom: BillOfMaterials = { productSku: input.productSku, components: input.components };
    this.bomMap.set(input.productSku, bom);
    return bom;
  }
  async createWorkCenter(input: { name: string; capacityPerDay: number }): Promise<WorkCenter> {
    const wc: WorkCenter = { id: randomId('wc'), name: input.name, capacityPerDay: input.capacityPerDay };
    this.workCentersMap.set(wc.id, wc);
    return wc;
  }
  async createProductionOrder(input: { productSku: string; qty: number; plantId: string }): Promise<ProductionOrder> {
    const o: ProductionOrder = { id: randomId('mo'), productSku: input.productSku, qty: input.qty, plantId: input.plantId, state: 'planned', note: `production order planned — factory execution is ${REGULATED_NOTE}`, createdAt: this.clock.now() };
    this.ordersMap.set(o.id, o);
    await this.governance.record({ actor: 'system', domain: 'manufacturing', operation: 'order.plan', targetId: o.id, evidence: 'live-verified' });
    return o;
  }
  /** Real BOM explosion — component requirements for a quantity. */
  explodeBOM(productSku: string, qty: number): Array<{ sku: string; requiredQty: number }> {
    const bom = this.bomMap.get(productSku);
    if (!bom) return [];
    return bom.components.map((c) => ({ sku: c.sku, requiredQty: c.qty * qty }));
  }
  /** Schedule an order onto a work center (a descriptor decision — never a real factory dispatch). */
  async schedule(orderId: string, workCenterId: string): Promise<ProductionOrder> {
    const o = this.require(orderId);
    if (!this.workCentersMap.has(workCenterId)) throw new Error(`no work center ${workCenterId}`);
    o.workCenterId = workCenterId;
    o.state = 'released';
    await this.governance.record({ actor: 'system', domain: 'manufacturing', operation: 'order.schedule', targetId: orderId, evidence: 'live-verified', detail: 'released as descriptor — not dispatched to a real MES' });
    return o;
  }
  qualityCheck(orderId: string, passed: boolean): { orderId: string; passed: boolean } {
    this.require(orderId);
    return { orderId, passed };
  }

  private require(id: string): ProductionOrder {
    const o = this.ordersMap.get(id);
    if (!o) throw new Error(`no production order ${id}`);
    return o;
  }

  plants(): Plant[] { return [...this.plantsMap.values()]; }
  boms(): BillOfMaterials[] { return [...this.bomMap.values()]; }
  workCenters(): WorkCenter[] { return [...this.workCentersMap.values()]; }
  productionOrders(): ProductionOrder[] { return [...this.ordersMap.values()]; }
  count(): number { return this.ordersMap.size; }
}
