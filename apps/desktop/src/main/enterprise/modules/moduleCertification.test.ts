/**
 * Enterprise Module Certification v1.0 — the registry-wide descriptor lock.
 *
 * A QUALITY gate, not a feature: it runs every one of the 93 REAL registered module descriptors through the
 * framework's own `validateModuleDescriptor`, and locks the certified inventory (count, unique ids, family
 * distribution, RBAC scopes, title fields). Before this test the real descriptors were validated only
 * implicitly at construction; this makes the guarantee explicit.
 *
 * SCOPE (stated honestly): the lock is over the enumerated `CERTIFIED` list below. It catches a descriptor
 * REGRESSION (bad id, dup field, wrong group/scope, dup id/action) and a REMOVAL or RENAME of a `*_DESCRIPTOR`
 * export (the import breaks → the file goes red). It does NOT read the live runtime registry, so ADDING a new
 * (84th) registered module does not fail this test until this list is updated — which is the intended,
 * deliberate re-certification checkpoint for a new module.
 *
 * Reuse-only: it imports the standalone descriptor consts (Electron-free — no store, no app runtime) and the
 * existing shared validator. No new architecture.
 */
import { describe, expect, it } from 'vitest';
import { validateModuleDescriptor, type EnterpriseModuleDescriptor } from '@neuropause/shared';

// Finance (18)
import { INVOICE_DESCRIPTOR } from './finance/invoiceModule';
import { PAYMENT_DESCRIPTOR } from './finance/paymentModule';
import { LEDGER_ACCOUNT_DESCRIPTOR } from './finance/ledgerAccountModule';
import { JOURNAL_ENTRY_DESCRIPTOR } from './finance/journalEntryModule';
import { ACCOUNTING_PERIOD_DESCRIPTOR } from './finance/accountingPeriodModule';
import { TAX_REPORT_DESCRIPTOR } from './finance/taxReportModule';
import { AR_AGING_DESCRIPTOR } from './finance/arAgingModule';
import { BANK_STATEMENT_DESCRIPTOR } from './finance/bankStatementModule';
import { BUDGET_DESCRIPTOR } from './finance/budgetModule';
import { VENDOR_BILL_DESCRIPTOR } from './finance/vendorBillModule';
import { AP_AGING_DESCRIPTOR } from './finance/apAgingModule';
import { FIXED_ASSET_DESCRIPTOR } from './finance/fixedAssetModule';
import { CREDIT_NOTE_DESCRIPTOR } from './finance/creditNoteModule';
import { DEBIT_NOTE_DESCRIPTOR } from './finance/debitNoteModule';
import { VENDOR_PAYMENT_DESCRIPTOR } from './finance/vendorPaymentModule';
import { EXCHANGE_RATE_DESCRIPTOR } from './finance/exchangeRateModule';
import { FINANCIAL_RATIOS_DESCRIPTOR } from './finance/financialRatiosModule';
import { CASH_FLOW_DESCRIPTOR } from './finance/cashFlowModule';
// Sales (7)
import { QUOTE_DESCRIPTOR } from './sales/quoteModule';
import { ORDER_DESCRIPTOR } from './sales/orderModule';
import { CONTRACT_DESCRIPTOR } from './sales/contractModule';
import { PRICING_RULE_DESCRIPTOR } from './sales/pricingRuleModule';
import { COMMISSION_PLAN_DESCRIPTOR } from './sales/commissionPlanModule';
import { COMMISSION_STATEMENT_DESCRIPTOR } from './sales/commissionStatementModule';
import { REVENUE_FORECAST_DESCRIPTOR } from './sales/revenueForecastModule';
// CRM (8)
import { CONTACT_DESCRIPTOR } from './crm/contactModule';
import { LEAD_DESCRIPTOR } from './crm/leadModule';
import { CUSTOMER_DESCRIPTOR } from './crm/customerModule';
import { OPPORTUNITY_DESCRIPTOR } from './crm/opportunityModule';
import { ACTIVITY_DESCRIPTOR } from './crm/activityModule';
import { CUSTOMER_HEALTH_DESCRIPTOR } from './crm/customerHealthModule';
import { CUSTOMER_TIMELINE_DESCRIPTOR } from './crm/customerTimelineModule';
import { CAMPAIGN_DESCRIPTOR } from './crm/campaignModule';
// Procurement (6)
import { SUPPLIER_DESCRIPTOR } from './procurement/supplierModule';
import { PURCHASE_REQUEST_DESCRIPTOR } from './procurement/purchaseRequestModule';
import { PURCHASE_ORDER_DESCRIPTOR } from './procurement/purchaseOrderModule';
import { GOODS_RECEIPT_DESCRIPTOR } from './procurement/goodsReceiptModule';
import { RFQ_DESCRIPTOR } from './procurement/rfqModule';
import { SUPPLIER_PERFORMANCE_DESCRIPTOR } from './procurement/supplierPerformanceModule';
// Inventory (7)
import { PRODUCT_DESCRIPTOR } from './inventory/productModule';
import { LOT_DESCRIPTOR } from './inventory/lotModule';
import { RESERVATION_DESCRIPTOR } from './inventory/reservationModule';
import { INVENTORY_VALUATION_DESCRIPTOR } from './inventory/inventoryValuationModule';
import { SERIAL_DESCRIPTOR } from './inventory/serialModule';
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
// Manufacturing (12)
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
import { BOM_EXPLOSION_DESCRIPTOR } from './manufacturing/bomExplosionModule';
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
// Projects (4)
import { PROJECT_DESCRIPTOR } from './projects/projectModule';
import { PROJECT_TASK_DESCRIPTOR } from './projects/projectTaskModule';
import { TIME_ENTRY_DESCRIPTOR } from './projects/timeEntryModule';
import { BILLING_RUN_DESCRIPTOR } from './projects/billingRunModule';
// HR (8)
import { TICKET_DESCRIPTOR } from './helpdesk/ticketModule';
import { EMPLOYEE_DESCRIPTOR } from './hr/employeeModule';
import { PAYROLL_RUN_DESCRIPTOR } from './hr/payrollRunModule';
import { SALARY_STRUCTURE_DESCRIPTOR } from './hr/salaryStructureModule';
import { STATUTORY_RULE_DESCRIPTOR } from './hr/statutoryRuleModule';
import { SALARY_DISBURSEMENT_DESCRIPTOR } from './hr/salaryDisbursementModule';
import { PAYSLIP_DESCRIPTOR } from './hr/payslipModule';
import { PAYROLL_REGISTER_DESCRIPTOR } from './hr/payrollRegisterModule';
import { STATUTORY_FILING_DESCRIPTOR } from './hr/statutoryFilingModule';
// Documents (1)
import { DOCUMENT_DESCRIPTOR } from './documents/documentModule';
// Executive (3)
import { EXECUTIVE_DECISION_DESCRIPTOR } from './executive/executiveDecisionModule';
import { EXECUTION_PROPOSAL_DESCRIPTOR } from './executive/executionProposalModule';
import { BI_REPORT_DESCRIPTOR } from './executive/biReportModule';

/** The certified inventory, grouped by family. Adding/removing a real module must update this + the counts. */
const CERTIFIED: Record<string, EnterpriseModuleDescriptor[]> = {
  Finance: [
    INVOICE_DESCRIPTOR, PAYMENT_DESCRIPTOR, LEDGER_ACCOUNT_DESCRIPTOR, JOURNAL_ENTRY_DESCRIPTOR,
    ACCOUNTING_PERIOD_DESCRIPTOR, TAX_REPORT_DESCRIPTOR, AR_AGING_DESCRIPTOR,
    BANK_STATEMENT_DESCRIPTOR, BUDGET_DESCRIPTOR, VENDOR_BILL_DESCRIPTOR, AP_AGING_DESCRIPTOR,
    FIXED_ASSET_DESCRIPTOR, CREDIT_NOTE_DESCRIPTOR, DEBIT_NOTE_DESCRIPTOR, VENDOR_PAYMENT_DESCRIPTOR,
    EXCHANGE_RATE_DESCRIPTOR, FINANCIAL_RATIOS_DESCRIPTOR, CASH_FLOW_DESCRIPTOR,
  ],
  Sales: [
    QUOTE_DESCRIPTOR, ORDER_DESCRIPTOR, CONTRACT_DESCRIPTOR, PRICING_RULE_DESCRIPTOR,
    COMMISSION_PLAN_DESCRIPTOR, COMMISSION_STATEMENT_DESCRIPTOR, REVENUE_FORECAST_DESCRIPTOR,
  ],
  CRM: [
    CONTACT_DESCRIPTOR, LEAD_DESCRIPTOR, CUSTOMER_DESCRIPTOR, OPPORTUNITY_DESCRIPTOR, ACTIVITY_DESCRIPTOR,
    CUSTOMER_HEALTH_DESCRIPTOR, CUSTOMER_TIMELINE_DESCRIPTOR, CAMPAIGN_DESCRIPTOR,
  ],
  Procurement: [
    SUPPLIER_DESCRIPTOR, PURCHASE_REQUEST_DESCRIPTOR, PURCHASE_ORDER_DESCRIPTOR, GOODS_RECEIPT_DESCRIPTOR,
    RFQ_DESCRIPTOR, SUPPLIER_PERFORMANCE_DESCRIPTOR,
  ],
  Inventory: [
    PRODUCT_DESCRIPTOR, WAREHOUSE_DESCRIPTOR, STOCK_MOVEMENT_DESCRIPTOR,
    LOT_DESCRIPTOR, RESERVATION_DESCRIPTOR, INVENTORY_VALUATION_DESCRIPTOR, SERIAL_DESCRIPTOR,
  ],
  Warehouse: [
    WAREHOUSE_ZONE_DESCRIPTOR, WAREHOUSE_BIN_DESCRIPTOR, TRANSFER_ORDER_DESCRIPTOR, PICK_LIST_DESCRIPTOR,
    PACKING_DESCRIPTOR, SHIPPING_DESCRIPTOR, CYCLE_COUNT_DESCRIPTOR, STOCK_ADJUSTMENT_DESCRIPTOR,
  ],
  Manufacturing: [
    BOM_DESCRIPTOR, PRODUCTION_ORDER_DESCRIPTOR, WORK_CENTER_DESCRIPTOR, MACHINE_DESCRIPTOR, PRODUCTION_SCHEDULE_DESCRIPTOR,
    ROUTING_DESCRIPTOR, MANUFACTURING_EVENT_DESCRIPTOR, PRODUCTION_EXECUTION_DESCRIPTOR, QUALITY_INSPECTION_DESCRIPTOR,
    PRODUCTION_COSTING_DESCRIPTOR, SCHEDULE_PROPOSAL_DESCRIPTOR, BOM_EXPLOSION_DESCRIPTOR,
  ],
  Maintenance: [
    ASSET_CATEGORY_DESCRIPTOR, ASSET_DESCRIPTOR, MAINTENANCE_PLAN_DESCRIPTOR, PREVENTIVE_MAINTENANCE_DESCRIPTOR,
    CORRECTIVE_MAINTENANCE_DESCRIPTOR, WORK_ORDER_DESCRIPTOR, TECHNICIAN_DESCRIPTOR, MAINTENANCE_HISTORY_DESCRIPTOR,
    SPARE_PART_DESCRIPTOR, DOWNTIME_EVENT_DESCRIPTOR,
  ],
  Projects: [PROJECT_DESCRIPTOR, PROJECT_TASK_DESCRIPTOR, TIME_ENTRY_DESCRIPTOR, BILLING_RUN_DESCRIPTOR],
  HR: [EMPLOYEE_DESCRIPTOR, PAYROLL_RUN_DESCRIPTOR, SALARY_STRUCTURE_DESCRIPTOR, STATUTORY_RULE_DESCRIPTOR, SALARY_DISBURSEMENT_DESCRIPTOR, PAYSLIP_DESCRIPTOR, PAYROLL_REGISTER_DESCRIPTOR, STATUTORY_FILING_DESCRIPTOR],
  Helpdesk: [TICKET_DESCRIPTOR],
  Documents: [DOCUMENT_DESCRIPTOR],
  Executive: [EXECUTIVE_DECISION_DESCRIPTOR, EXECUTION_PROPOSAL_DESCRIPTOR, BI_REPORT_DESCRIPTOR],
};

/** The certified per-family module counts (verified from the registration site, enterprise/index.ts). */
const CERTIFIED_COUNTS: Record<string, number> = {
  Finance: 18, Sales: 7, CRM: 8, Procurement: 6, Inventory: 7, Warehouse: 8, Manufacturing: 12, Maintenance: 10, Projects: 4, HR: 8, Helpdesk: 1, Documents: 1, Executive: 3,
};

const ALL = Object.values(CERTIFIED).flat();
const KNOWN_FAMILIES = Object.keys(CERTIFIED_COUNTS);
/** The RBAC scopes each family's modules are certified to enforce (Finance deliberately reuses operations:*). */
const FAMILY_WRITE_SCOPE: Record<string, string> = {
  Finance: 'operations:manage', Sales: 'sales:manage', CRM: 'crm:manage', Procurement: 'procurement:manage',
  Inventory: 'inventory:manage', Warehouse: 'warehouse:manage', Manufacturing: 'manufacturing:manage',
  Maintenance: 'maintenance:manage', Projects: 'operations:manage', HR: 'operations:manage', Helpdesk: 'operations:manage', Documents: 'operations:manage', // Projects/HR/Helpdesk/Documents deliberately reuse operations:* (the Finance precedent)
  Executive: 'executive:', // approve OR execute — asserted as a prefix
};

describe('Enterprise Module Certification — registry lock', () => {
  it('certifies exactly 93 modules across the 13 production families', () => {
    expect(ALL).toHaveLength(93);
    for (const fam of KNOWN_FAMILIES) {
      expect(CERTIFIED[fam]).toHaveLength(CERTIFIED_COUNTS[fam]);
    }
    const total = Object.values(CERTIFIED_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(93);
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
