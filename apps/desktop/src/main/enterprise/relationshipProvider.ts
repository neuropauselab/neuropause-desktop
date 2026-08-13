/**
 * Enterprise Relationship Intelligence provider — the READ-ONLY model the desktop Relationship screen
 * reads, and the source of the eight relationship KPIs on the Executive Center. It reads every ERP module
 * store the SAME way the Executive Center already reads them (`store.list({status:'active'}).map(xFromRecord)`),
 * stamps each projection with its record timestamps, and hands them to the pure `buildRelationshipGraph`
 * engine. It writes nothing, owns no store, and derives no synthetic edges — every relationship is a real
 * foreign-key link already on the records. A short TTL cache means the Executive snapshot and a subsequent
 * explore request within a couple of seconds reuse one build.
 */
import type { EnterpriseEntity } from '@neuropause/shared';
import {
  buildRelationshipGraph,
  customerFromRecord,
  orderFromRecord,
  quoteFromRecord,
  invoiceFromRecord,
  paymentFromRecord,
  supplierFromRecord,
  purchaseOrderFromRecord,
  goodsReceiptFromRecord,
  productFromRecord,
  warehouseFromRecord,
  movementFromRecord,
  bomFromRecord,
  productionOrderFromRecord,
  machineFromRecord,
  workCenterFromRecord,
  productionScheduleFromRecord,
  mesExecutionFromRecord,
  qualityInspectionFromRecord,
  assetFromRecord,
  workOrderFromRecord,
  downtimeEventFromRecord,
  technicianFromRecord,
  executiveDecisionFromRecord,
  executionProposalFromRecord,
  type RelationshipGraphModel,
} from '@neuropause/shared';
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../tenancy/tenantMemo';
import type { EnterpriseModule } from './framework';
import { customerModule } from './modules/crm/customerModuleInstance';
import { quoteModule } from './modules/sales/quoteModuleInstance';
import { orderModule } from './modules/sales/orderModuleInstance';
import { invoiceModule } from './modules/finance/invoiceModuleInstance';
import { paymentModule } from './modules/finance/paymentModuleInstance';
import { productModule } from './modules/inventory/productModuleInstance';
import { warehouseModule } from './modules/inventory/warehouseModuleInstance';
import { stockMovementModule } from './modules/inventory/stockMovementModuleInstance';
import { supplierModule, purchaseOrderModule, goodsReceiptModule } from './modules/procurement/procurementInstances';
import {
  bomModule,
  productionOrderModule,
  machineModule,
  workCenterModule,
  scheduleModule,
  executionModule,
  qualityModule,
} from './modules/manufacturing/manufacturingInstances';
import { assetModule, workOrderModule, downtimeEventModule, technicianModule } from './modules/maintenance/maintenanceInstances';
import { executiveDecisionModule } from './modules/executive/executiveDecisionInstance';
import { executionProposalModule } from './modules/executive/executionProposalInstance';

/** Project a module's active records, stamping each with the record id + timestamps (for id-based link
 * resolution and recency scoring). The spread id/updatedAt/createdAt override any projection-supplied values. */
function list<T>(mod: EnterpriseModule, fn: (r: EnterpriseEntity) => T, limit = 5000): Array<T & { id: string; updatedAt: string; createdAt: string }> {
  return mod.store.list({ status: 'active', limit }).map((r) => ({ ...fn(r), id: r.id, updatedAt: r.updatedAt, createdAt: r.createdAt }));
}

/** Read all ERP stores and build the read-only relationship graph. Pure read; no writes. */
export function buildRelationshipModel(nowMs: number): RelationshipGraphModel {
  return buildRelationshipGraph(
    {
      customers: list(customerModule, customerFromRecord),
      suppliers: list(supplierModule, supplierFromRecord),
      products: list(productModule, productFromRecord),
      warehouses: list(warehouseModule, warehouseFromRecord),
      machines: list(machineModule, machineFromRecord),
      workCenters: list(workCenterModule, workCenterFromRecord),
      technicians: list(technicianModule, technicianFromRecord),
      assets: list(assetModule, assetFromRecord),
      boms: list(bomModule, bomFromRecord),
      productionOrders: list(productionOrderModule, productionOrderFromRecord),
      schedules: list(scheduleModule, productionScheduleFromRecord),
      executions: list(executionModule, mesExecutionFromRecord),
      quality: list(qualityModule, qualityInspectionFromRecord),
      orders: list(orderModule, orderFromRecord),
      quotes: list(quoteModule, quoteFromRecord),
      invoices: list(invoiceModule, invoiceFromRecord),
      payments: list(paymentModule, paymentFromRecord),
      purchaseOrders: list(purchaseOrderModule, purchaseOrderFromRecord),
      goodsReceipts: list(goodsReceiptModule, goodsReceiptFromRecord),
      workOrders: list(workOrderModule, workOrderFromRecord),
      downtime: list(downtimeEventModule, downtimeEventFromRecord),
      decisions: list(executiveDecisionModule, executiveDecisionFromRecord),
      proposals: list(executionProposalModule, executionProposalFromRecord),
      movements: list(stockMovementModule, movementFromRecord, 20000),
    },
    nowMs,
  );
}

/**
 * P13C ROUND 3 — H-2. KEYED BY TENANT, not merely expired.
 *
 * Keyless `let cache` + 2.5s TTL + switch listener. The switch listener cannot
 * see the case that matters: `forEachTenant` runs scheduled work once per
 * tenant, back to back, under each tenant's own principal, announcing no switch.
 * A model built during tenant A's pass was still inside the TTL when tenant B's
 * pass began. Sequencing those passes — which `backgroundFanOut` does, citing
 * these caches as the reason — stops two tenants interleaving inside one build
 * and does nothing about a build surviving between them.
 *
 * The short TTL is retained for the job it can do: this model is fanned out over
 * dozens of stores, and the exec snapshot plus an explore call within a couple
 * of seconds should reuse one build.
 */
const memo = new TenantMemo<RelationshipGraphModel>('enterprise-relationship-model', { ttlMs: 2500 });

/** Bind the tenant resolver. Called once by the enterprise composition root. */
export function bindRelationshipModelScope(source: () => TenantScope | null): void {
  memo.bindScope(source);
}

/** The read-only relationship graph model (cached briefly, per tenant). */
export function getRelationshipModel(): RelationshipGraphModel {
  return memo.state(() => buildRelationshipModel(Date.now()));
}

/** The eight relationship KPIs (for the Executive Center source). Reuses the cached model. */
export function getRelationshipKpis(): RelationshipGraphModel['kpis'] {
  return getRelationshipModel().kpis;
}

/**
 * Drop the memoized model (P13B).
 *
 * Kept, and still wired to the workspace switch, as defence in depth. It is no
 * longer the isolation mechanism — the cell is keyed — but it remains the right
 * response to the one moment the application KNOWS the tenant changed.
 *
 * Why this mattered enough to keep: the graph projection reads this model and
 * STAMPS every node it produces with the reading tenant, then persists it. A
 * stale read there is not transient; it becomes a durable, correctly-owned-
 * looking record of another tenant's relationships.
 */
export function invalidateModelCache(): void {
  memo.invalidate();
}
