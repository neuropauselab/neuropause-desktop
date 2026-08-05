/**
 * Enterprise Module Certification v1.0 — the registry-wide descriptor lock.
 *
 * A QUALITY gate, not a feature: it runs every one of the 47 REAL registered module descriptors through the
 * framework's own `validateModuleDescriptor`, and locks the certified inventory (count, unique ids, family
 * distribution, RBAC scopes, title fields). Before this test the real descriptors were validated only
 * implicitly at construction; this makes the guarantee explicit.
 *
 * SCOPE (stated honestly): the lock is over the enumerated `CERTIFIED` list below. It catches a descriptor
 * REGRESSION (bad id, dup field, wrong group/scope, dup id/action) and a REMOVAL or RENAME of a `*_DESCRIPTOR`
 * export (the import breaks → the file goes red). It does NOT read the live runtime registry, so ADDING a new
 * (48th) registered module does not fail this test until this list is updated — which is the intended,
 * deliberate re-certification checkpoint for a new module.
 *
 * Reuse-only: it imports the standalone descriptor consts (Electron-free — no store, no app runtime) and the
 * existing shared validator. No new architecture.
 */
import { describe, expect, it } from 'vitest';
import { validateModuleDescriptor, type EnterpriseModuleDescriptor } from '@neuropause/shared';

// Finance (4)
import { INVOICE_DESCRIPTOR } from './finance/invoiceModule';
import { PAYMENT_DESCRIPTOR } from './finance/paymentModule';
import { LEDGER_ACCOUNT_DESCRIPTOR } from './finance/ledgerAccountModule';
import { JOURNAL_ENTRY_DESCRIPTOR } from './finance/journalEntryModule';
// Sales (2)
import { QUOTE_DESCRIPTOR } from './sales/quoteModule';
import { ORDER_DESCRIPTOR } from './sales/orderModule';
// CRM (3)
import { CONTACT_DESCRIPTOR } from './crm/contactModule';
import { LEAD_DESCRIPTOR } from './crm/leadModule';
import { CUSTOMER_DESCRIPTOR } from './crm/customerModule';
// Procurement (4)
import { SUPPLIER_DESCRIPTOR } from './procurement/supplierModule';
import { PURCHASE_REQUEST_DESCRIPTOR } from './procurement/purchaseRequestModule';
import { PURCHASE_ORDER_DESCRIPTOR } from './procurement/purchaseOrderModule';
import { GOODS_RECEIPT_DESCRIPTOR } from './procurement/goodsReceiptModule';
// Inventory (3)
import { PRODUCT_DESCRIPTOR } from './inventory/productModule';
import { WAREHOUSE_DESCRIPTOR } from './inventory/warehouseModule';
import { STOCK_MOVEMENT_DESCRIPTOR } from './inventory/stockMovementModule';
// Warehouse (8)
import { WAREHOUSE_ZONE_DESCRIPTOR } from './warehouse/zoneModule';
import { WAREHOUSE_BIN_DESCRIPTOR } from './warehouse/binModule';
import { TRANSFER_ORDER_DESCRIPTOR } from './warehouse/transferOrderModule';
import { PICK_LIST_DESCRIPTOR } from './warehouse/pickListModule';
import { PACKING_DESCRIPTOR } from './warehouse/packingModule';
import { SHIPPING_DESCRIPTOR } from './warehouse/shippingModule';
import { CYCLE_COUNT_DESCRIPTOR } from './warehouse/cycleCountModule';
import { STOCK_ADJUSTMENT_DESCRIPTOR } from './warehouse/stockAdjustmentModule';
// Manufacturing (11)
import { BOM_DESCRIPTOR } from './manufacturing/bomModule';
import { PRODUCTION_ORDER_DESCRIPTOR } from './manufacturing/productionOrderModule';
import { WORK_CENTER_DESCRIPTOR } from './manufacturing/workCenterModule';
import { MACHINE_DESCRIPTOR } from './manufacturing/machineModule';
import { PRODUCTION_SCHEDULE_DESCRIPTOR } from './manufacturing/scheduleModule';
import { ROUTING_DESCRIPTOR } from './manufacturing/routingModule';
import { MANUFACTURING_EVENT_DESCRIPTOR } from './manufacturing/manufacturingEventModule';
import { PRODUCTION_EXECUTION_DESCRIPTOR } from './manufacturing/executionModule';
import { QUALITY_INSPECTION_DESCRIPTOR } from './manufacturing/qualityModule';
import { PRODUCTION_COSTING_DESCRIPTOR } from './manufacturing/costingModule';
import { SCHEDULE_PROPOSAL_DESCRIPTOR } from './manufacturing/scheduleProposalModule';
// Maintenance (10)
import { ASSET_CATEGORY_DESCRIPTOR } from './maintenance/assetCategoryModule';
import { ASSET_DESCRIPTOR } from './maintenance/assetModule';
import { MAINTENANCE_PLAN_DESCRIPTOR } from './maintenance/maintenancePlanModule';
import { PREVENTIVE_MAINTENANCE_DESCRIPTOR } from './maintenance/preventiveMaintenanceModule';
import { CORRECTIVE_MAINTENANCE_DESCRIPTOR } from './maintenance/correctiveMaintenanceModule';
import { WORK_ORDER_DESCRIPTOR } from './maintenance/workOrderModule';
import { TECHNICIAN_DESCRIPTOR } from './maintenance/technicianModule';
import { MAINTENANCE_HISTORY_DESCRIPTOR } from './maintenance/maintenanceHistoryModule';
import { SPARE_PART_DESCRIPTOR } from './maintenance/sparePartModule';
import { DOWNTIME_EVENT_DESCRIPTOR } from './maintenance/downtimeEventModule';
// Executive (2)
import { EXECUTIVE_DECISION_DESCRIPTOR } from './executive/executiveDecisionModule';
import { EXECUTION_PROPOSAL_DESCRIPTOR } from './executive/executionProposalModule';

/** The certified inventory, grouped by family. Adding/removing a real module must update this + the counts. */
const CERTIFIED: Record<string, EnterpriseModuleDescriptor[]> = {
  Finance: [INVOICE_DESCRIPTOR, PAYMENT_DESCRIPTOR, LEDGER_ACCOUNT_DESCRIPTOR, JOURNAL_ENTRY_DESCRIPTOR],
  Sales: [QUOTE_DESCRIPTOR, ORDER_DESCRIPTOR],
  CRM: [CONTACT_DESCRIPTOR, LEAD_DESCRIPTOR, CUSTOMER_DESCRIPTOR],
  Procurement: [SUPPLIER_DESCRIPTOR, PURCHASE_REQUEST_DESCRIPTOR, PURCHASE_ORDER_DESCRIPTOR, GOODS_RECEIPT_DESCRIPTOR],
  Inventory: [PRODUCT_DESCRIPTOR, WAREHOUSE_DESCRIPTOR, STOCK_MOVEMENT_DESCRIPTOR],
  Warehouse: [
    WAREHOUSE_ZONE_DESCRIPTOR, WAREHOUSE_BIN_DESCRIPTOR, TRANSFER_ORDER_DESCRIPTOR, PICK_LIST_DESCRIPTOR,
    PACKING_DESCRIPTOR, SHIPPING_DESCRIPTOR, CYCLE_COUNT_DESCRIPTOR, STOCK_ADJUSTMENT_DESCRIPTOR,
  ],
  Manufacturing: [
    BOM_DESCRIPTOR, PRODUCTION_ORDER_DESCRIPTOR, WORK_CENTER_DESCRIPTOR, MACHINE_DESCRIPTOR, PRODUCTION_SCHEDULE_DESCRIPTOR,
    ROUTING_DESCRIPTOR, MANUFACTURING_EVENT_DESCRIPTOR, PRODUCTION_EXECUTION_DESCRIPTOR, QUALITY_INSPECTION_DESCRIPTOR,
    PRODUCTION_COSTING_DESCRIPTOR, SCHEDULE_PROPOSAL_DESCRIPTOR,
  ],
  Maintenance: [
    ASSET_CATEGORY_DESCRIPTOR, ASSET_DESCRIPTOR, MAINTENANCE_PLAN_DESCRIPTOR, PREVENTIVE_MAINTENANCE_DESCRIPTOR,
    CORRECTIVE_MAINTENANCE_DESCRIPTOR, WORK_ORDER_DESCRIPTOR, TECHNICIAN_DESCRIPTOR, MAINTENANCE_HISTORY_DESCRIPTOR,
    SPARE_PART_DESCRIPTOR, DOWNTIME_EVENT_DESCRIPTOR,
  ],
  Executive: [EXECUTIVE_DECISION_DESCRIPTOR, EXECUTION_PROPOSAL_DESCRIPTOR],
};

/** The certified per-family module counts (verified from the registration site, enterprise/index.ts). */
const CERTIFIED_COUNTS: Record<string, number> = {
  Finance: 4, Sales: 2, CRM: 3, Procurement: 4, Inventory: 3, Warehouse: 8, Manufacturing: 11, Maintenance: 10, Executive: 2,
};

const ALL = Object.values(CERTIFIED).flat();
const KNOWN_FAMILIES = Object.keys(CERTIFIED_COUNTS);
/** The RBAC scopes each family's modules are certified to enforce (Finance deliberately reuses operations:*). */
const FAMILY_WRITE_SCOPE: Record<string, string> = {
  Finance: 'operations:manage', Sales: 'sales:manage', CRM: 'crm:manage', Procurement: 'procurement:manage',
  Inventory: 'inventory:manage', Warehouse: 'warehouse:manage', Manufacturing: 'manufacturing:manage',
  Maintenance: 'maintenance:manage', Executive: 'executive:', // approve OR execute — asserted as a prefix
};

describe('Enterprise Module Certification — registry lock', () => {
  it('certifies exactly 47 modules across the 9 production families', () => {
    expect(ALL).toHaveLength(47);
    for (const fam of KNOWN_FAMILIES) {
      expect(CERTIFIED[fam]).toHaveLength(CERTIFIED_COUNTS[fam]);
    }
    const total = Object.values(CERTIFIED_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(47);
  });

  it('every real descriptor passes the framework validator (validateModuleDescriptor)', () => {
    for (const d of ALL) {
      const problems = validateModuleDescriptor(d);
      // Surface the offending module id in the failure message if any descriptor regresses.
      expect(problems, `${d.id}: ${problems.join('; ')}`).toEqual([]);
    }
  });

  it('module ids are unique across the whole suite', () => {
    const ids = ALL.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every module declares a real family, RBAC read+write scopes, a title, and a titleField that exists', () => {
    for (const [fam, mods] of Object.entries(CERTIFIED)) {
      for (const d of mods) {
        expect(d.group).toBe(fam); // the descriptor's own group matches the family it is certified under
        expect(KNOWN_FAMILIES).toContain(d.group);
        expect(d.title.length).toBeGreaterThan(0);
        expect(d.singular.length).toBeGreaterThan(0);
        expect(d.plural.length).toBeGreaterThan(0);
        expect(d.permissions.read.length).toBeGreaterThan(0);
        expect(d.permissions.write.length).toBeGreaterThan(0);
        expect(d.fields.length).toBeGreaterThan(0);
        // titleField must reference a declared field (also checked by the validator; explicit here).
        expect(d.fields.some((f) => f.key === d.titleField)).toBe(true);
      }
    }
  });

  it('each family enforces its certified write scope (Finance = operations:*, Executive = executive:*)', () => {
    for (const [fam, mods] of Object.entries(CERTIFIED)) {
      const expected = FAMILY_WRITE_SCOPE[fam];
      for (const d of mods) {
        if (fam === 'Executive') {
          expect(d.permissions.write.startsWith(expected)).toBe(true); // approve | execute
        } else {
          expect(d.permissions.write).toBe(expected);
        }
      }
    }
  });

  it('declared record actions are unique per module (no duplicate action keys)', () => {
    for (const d of ALL) {
      const keys = (d.actions ?? []).map((a) => a.key);
      expect(new Set(keys).size, `${d.id} has duplicate action keys`).toBe(keys.length);
    }
  });
});
