/**
 * collectPlanningModel — the single, reusable read of the live operational model (the inputs the
 * planning / MRP / scheduling / Digital-Twin engines all consume). It reads the registered module
 * stores and maps them to the shared `PlanningInput` + `Routing[]`. Reused by the Executive Center
 * snapshot AND the Executive Decision verification action, so the model is assembled ONE way (no
 * duplicated construction). Pure read — it never mutates any store.
 */
import type { PlanningInput, Routing } from '@neuropause/shared';
import {
  bomFromRecord,
  invoiceFromRecord,
  machineFromRecord,
  orderFromRecord,
  productFromRecord,
  productionOrderFromRecord,
  purchaseOrderFromRecord,
  quoteFromRecord,
  routingFromRecord,
  shippingFromRecord,
  supplierFromRecord,
} from '@neuropause/shared';
import { productModule } from './modules/inventory/productModuleInstance';
import { orderModule } from './modules/sales/orderModuleInstance';
import { quoteModule } from './modules/sales/quoteModuleInstance';
import { invoiceModule } from './modules/finance/invoiceModuleInstance';
import { supplierModule, purchaseOrderModule } from './modules/procurement/procurementInstances';
import { shippingModule } from './modules/warehouse/warehouseInstances';
import { bomModule, productionOrderModule, machineModule, routingModule } from './modules/manufacturing/manufacturingInstances';

/** Assemble the live PlanningInput + Routings from the registered module stores. Read-only. */
export function collectPlanningModel(): { input: PlanningInput; routings: Routing[] } {
  return {
    input: {
      products: productModule.store.list({ status: 'active', limit: 5000 }).map(productFromRecord),
      salesOrders: orderModule.store.list({ status: 'active', limit: 5000 }).map(orderFromRecord),
      quotes: quoteModule.store.list({ status: 'active', limit: 5000 }).map(quoteFromRecord),
      shipments: shippingModule.store.list({ status: 'active', limit: 5000 }).map(shippingFromRecord),
      productionOrders: productionOrderModule.store.list({ status: 'active', limit: 5000 }).map(productionOrderFromRecord),
      purchaseOrders: purchaseOrderModule.store.list({ status: 'active', limit: 5000 }).map(purchaseOrderFromRecord),
      suppliers: supplierModule.store.list({ status: 'active', limit: 5000 }).map(supplierFromRecord),
      boms: bomModule.store.list({ status: 'active', limit: 5000 }).map(bomFromRecord),
      machines: machineModule.store.list({ status: 'active', limit: 5000 }).map(machineFromRecord),
      invoices: invoiceModule.store.list({ status: 'active', limit: 5000 }).map(invoiceFromRecord),
    },
    routings: routingModule.store.list({ status: 'active', limit: 5000 }).map(routingFromRecord),
  };
}
