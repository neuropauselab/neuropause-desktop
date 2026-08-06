/**
 * Enterprise Operating System composition root. Loads the organization runtime,
 * the workspace manager, and the governance store; binds the seeded owner to the
 * signed-in account; folds the live AI workforce into the org chart; and wires
 * every enterprise IPC channel behind the secure bridge.
 *
 * The org graph, compliance findings, and executive snapshot are *projections* —
 * recomputed on demand from the runtime plus the existing intelligence,
 * workforce, connector, and unified layers. Nothing here is fabricated.
 */
import type { EntityRef, ConnectorRef } from './graph/orgGraph';
import type {
  EnterpriseOrgCreateUnitRequest as TCreateUnit,
  EnterpriseOrgUpdateUnitRequest as TUpdateUnit,
  EnterpriseOrgDeleteUnitRequest as TDeleteUnit,
  EnterpriseOrgCreateUserRequest as TCreateUser,
  EnterpriseOrgUpdateUserRequest as TUpdateUser,
  EnterpriseOrgDeleteUserRequest as TDeleteUser,
  EnterpriseOrgCreateRoleRequest as TCreateRole,
  EnterpriseOrgUpdateRoleRequest as TUpdateRole,
  EnterpriseOrgDeleteRoleRequest as TDeleteRole,
  EnterpriseWorkspaceCreateRequest as TWsCreate,
  EnterpriseWorkspaceSwitchRequest as TWsSwitch,
  EnterpriseGraphNeighborsRequest as TNeighbors,
  EnterpriseGovernanceSetChainRequest as TSetChain,
  EnterpriseGovernanceSetRuleRequest as TSetRule,
  EnterpriseGovernanceAuditRequest as TAudit,
  EnterpriseProcessExploreRequest as TProcessExplore,
  EnterpriseProcessCaseRequest as TProcessCase,
  EnterpriseContextRequest as TContext,
  EnterprisePersonalizationFavoriteRequest as TPersFavorite,
  EnterprisePersonalizationRecentRequest as TPersRecent,
  EnterprisePersonalizationSaveViewRequest as TPersSaveView,
  EnterprisePersonalizationDeleteViewRequest as TPersDeleteView,
  EnterprisePersonalizationRenameViewRequest as TPersRenameView,
  AuthStatus,
  EnterprisePermission,
  Organization,
  PlatformEventInput,
  WorkspaceSummary,
  GovernanceConfig,
  BusinessActivitySummary,
  ComplianceFinding,
} from '@neuropause/shared';
import {
  IpcChannel,
  EmptyRequest,
  EnterpriseOrgCreateUnitRequest,
  EnterpriseOrgUpdateUnitRequest,
  EnterpriseOrgDeleteUnitRequest,
  EnterpriseOrgCreateUserRequest,
  EnterpriseOrgUpdateUserRequest,
  EnterpriseOrgDeleteUserRequest,
  EnterpriseOrgCreateRoleRequest,
  EnterpriseOrgUpdateRoleRequest,
  EnterpriseOrgDeleteRoleRequest,
  EnterpriseWorkspaceCreateRequest,
  EnterpriseWorkspaceSwitchRequest,
  EnterpriseGraphNeighborsRequest,
  EnterpriseGovernanceSetChainRequest,
  EnterpriseGovernanceSetRuleRequest,
  EnterpriseGovernanceAuditRequest,
  EnterpriseProcessExploreRequest,
  EnterpriseProcessCaseRequest,
  EnterpriseContextRequest,
  EnterprisePersonalizationFavoriteRequest,
  EnterprisePersonalizationRecentRequest,
  EnterprisePersonalizationSaveViewRequest,
  EnterprisePersonalizationDeleteViewRequest,
  EnterprisePersonalizationRenameViewRequest,
} from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { orgStore } from './org/orgInstance';
import { workspaceStore } from './workspace/workspaceInstance';
import { governanceStore } from './governance/governanceInstance';
import { OWNER_USER_ID, ROLE_TO_UNIT_ID } from './org/seed';
import {
  canDeleteMember,
  createAuthorize,
  decideOwnerClaim,
  guardBuiltInRolePatch,
  guardOwnerUserPatch,
  withEnterpriseAuthz,
} from './authzGate';
import { initEnterpriseModules, type EnterpriseModuleRegistry } from './framework';
import { invoiceModule } from './modules/finance/invoiceModuleInstance';
import { paymentModule } from './modules/finance/paymentModuleInstance';
import { ledgerAccountModule } from './modules/finance/ledgerAccountModuleInstance';
import { journalEntryModule } from './modules/finance/journalEntryModuleInstance';
import { accountingPeriodModule } from './modules/finance/accountingPeriodModuleInstance';
import { taxReportModule } from './modules/finance/taxReportModuleInstance';
import { arAgingModule } from './modules/finance/arAgingModuleInstance';
import { bankStatementModule } from './modules/finance/bankStatementModuleInstance';
import { budgetModule } from './modules/finance/budgetModuleInstance';
import { vendorBillModule } from './modules/finance/vendorBillModuleInstance';
import { apAgingModule } from './modules/finance/apAgingModuleInstance';
import { fixedAssetModule } from './modules/finance/fixedAssetModuleInstance';
import { creditNoteModule } from './modules/finance/creditNoteModuleInstance';
import { debitNoteModule } from './modules/finance/debitNoteModuleInstance';
import { vendorPaymentModule } from './modules/finance/vendorPaymentModuleInstance';
import { exchangeRateModule } from './modules/finance/exchangeRateModuleInstance';
import { financialRatiosModule } from './modules/finance/financialRatiosModuleInstance';
import { contactModule } from './modules/crm/contactModuleInstance';
import { leadModule } from './modules/crm/leadModuleInstance';
import { customerModule } from './modules/crm/customerModuleInstance';
import { opportunityModule } from './modules/crm/opportunityModuleInstance';
import { activityModule } from './modules/crm/activityModuleInstance';
import { customerHealthModule } from './modules/crm/customerHealthModuleInstance';
import { customerTimelineModule } from './modules/crm/customerTimelineModuleInstance';
import { quoteModule } from './modules/sales/quoteModuleInstance';
import { orderModule } from './modules/sales/orderModuleInstance';
import { contractModule } from './modules/sales/contractModuleInstance';
import { pricingRuleModule } from './modules/sales/pricingRuleModuleInstance';
import { commissionPlanModule } from './modules/sales/commissionPlanModuleInstance';
import { commissionStatementModule } from './modules/sales/commissionStatementModuleInstance';
import { revenueForecastModule } from './modules/sales/revenueForecastModuleInstance';
import { productModule } from './modules/inventory/productModuleInstance';
import { warehouseModule } from './modules/inventory/warehouseModuleInstance';
import { stockMovementModule } from './modules/inventory/stockMovementModuleInstance';
import { lotModule } from './modules/inventory/lotModuleInstance';
import { reservationModule } from './modules/inventory/reservationModuleInstance';
import { inventoryValuationModule } from './modules/inventory/inventoryValuationModuleInstance';
import { serialModule } from './modules/inventory/serialModuleInstance';
import {
  supplierModule,
  purchaseRequestModule,
  purchaseOrderModule,
  goodsReceiptModule,
  rfqModule,
  supplierPerformanceModule,
} from './modules/procurement/procurementInstances';
import {
  zoneModule,
  binModule,
  transferOrderModule,
  pickListModule,
  packingModule,
  shippingModule,
  cycleCountModule,
  stockAdjustmentModule,
} from './modules/warehouse/warehouseInstances';
import {
  bomModule,
  productionOrderModule,
  workCenterModule,
  machineModule,
  scheduleModule,
  routingModule,
  manufacturingEventModule,
  executionModule,
  qualityModule,
  costingModule,
  scheduleProposalModule,
} from './modules/manufacturing/manufacturingInstances';
import { bomExplosionModule } from './modules/manufacturing/bomExplosionModuleInstance';
import { billingRunModule, projectModule, projectTaskModule, timeEntryModule } from './modules/projects/projectsInstances';
import { employeeModule, payrollRegisterModule, payrollRunModule, payslipModule, salaryDisbursementModule, salaryStructureModule, statutoryFilingModule, statutoryRuleModule } from './modules/hr/hrInstances';
import { ticketModule } from './modules/helpdesk/helpdeskInstances';
import { campaignModule } from './modules/crm/campaignModuleInstance';
import { documentModule } from './modules/documents/documentsInstances';
import { biReportModule } from './modules/executive/biReportModuleInstance';
import {
  assetCategoryModule,
  assetModule,
  maintenancePlanModule,
  preventiveMaintenanceModule,
  correctiveMaintenanceModule,
  workOrderModule,
  technicianModule,
  maintenanceHistoryModule,
  sparePartModule,
  downtimeEventModule,
} from './modules/maintenance/maintenanceInstances';
import { executiveDecisionModule } from './modules/executive/executiveDecisionInstance';
import { executionProposalModule } from './modules/executive/executionProposalInstance';
import { getProcessExplorerModel, getProcessCaseDetail } from './processMiningProvider';
import { getScheduleExploreModel } from './scheduleExploreProvider';
import { getExecutionConsoleModel } from './executionConsoleProvider';
import { getRelationshipModel } from './relationshipProvider';
import { getTrustModel } from './trustProvider';
import { buildEnterpriseContext, type ContextEngineDeps } from './contextEngine';
import { graphStore } from '../graph/graphInstance';
import { memoryStore } from '../memory/memoryInstance';
import { personalizationStore } from './personalization/personalizationInstance';
import { notificationScheduler } from '../services/notificationScheduler';
import { buildOrgGraph, orgGraphNeighbors } from './graph/orgGraph';
import { evaluateCompliance, type ComplianceInput } from './governance/enterpriseGovernance';
import { computeExecutiveSnapshot } from './dashboard/executiveDashboard';
import { authService } from '../auth/authService';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { jobStore } from '../workforce/runtime/jobInstance';
import { auditLog } from '../workforce/governance/auditInstance';
import { unifiedStore } from '../unified/storeInstance';
import { getEnterpriseTimeline } from '../timeline';
import { connectorService } from '../connectors/connectorService';
import { registry } from '../registry/registry';
import { generateBriefing } from '../intelligence/briefingGenerator';
import { generateRecommendations } from '../recommendations/recommendationEngine';

const log = createLogger('enterprise');

export interface EnterpriseDeps {
  broadcast: IpcBroadcaster;
  /** Platform event publisher → timeline + Executive Center (module lifecycle). */
  publish?: (input: PlatformEventInput) => void;
}

export interface EnterpriseSubsystem {
  handlers: SecureHandlerDef[];
  /** RBAC gate for the secure bridge — resolves the session actor and asserts. */
  authorize: (permission: EnterprisePermission) => void;
  /** The ERP module registry — future modules register into this at boot. */
  modules: EnterpriseModuleRegistry;
  /**
   * Phase 6 Stage 9 — a READ-ONLY accessor over the EXISTING compliance
   * evaluation (the same computation the EnterpriseCompliance channel serves),
   * for the Operations Platform's readiness composition. Additive; no channel,
   * no mutation, no new state.
   */
  complianceFindings: () => ComplianceFinding[];
}

export async function initEnterprise(deps: EnterpriseDeps): Promise<EnterpriseSubsystem> {
  await orgStore.load();
  await workspaceStore.load();
  await governanceStore.load();

  // First-claim-wins ownership: the seeded owner ships unclaimed (email:null).
  // The first account to sign in claims it; the SAME account later only refreshes
  // a changed display name; a DIFFERENT account never rebinds it (it resolves to
  // no actor and fails closed). Ownership handoff is an explicit admin action.
  // Runs at boot (restored session) and on every later sign-in.
  const bindOwner = (status: AuthStatus): void => {
    if (status.state !== 'authenticated') return;
    const u = status.session.user;
    const owner = orgStore.user(OWNER_USER_ID);
    const claim = decideOwnerClaim(
      owner ? { name: owner.name, email: owner.email } : null,
      { name: u.displayName ?? u.email, email: u.email },
    );
    if (claim) orgStore.setOwnerIdentity(claim.name, claim.email);
  };
  bindOwner(authService.getStatus());
  authService.on('statusChanged', bindOwner);

  // Fold the live AI workforce into the org chart, and keep it in sync.
  const syncWorkers = (): void => {
    const refs = workerRegistry.summaries().map((w) => ({ id: w.id, name: w.name, role: w.role }));
    orgStore.syncWorkers(refs, ROLE_TO_UNIT_ID);
  };
  syncWorkers();
  workerRegistry.on('changed', syncWorkers);

  // Bridge store changes to the renderer as one enterprise event.
  const emit = (kind: string): void =>
    deps.broadcast(IpcChannel.EnterpriseEventBroadcast, { kind, at: new Date().toISOString() });
  orgStore.on('changed', () => emit('org'));
  workspaceStore.on('changed', () => emit('workspace'));
  governanceStore.on('changed', () => emit('governance'));

  log.info('Enterprise OS ready', {
    org: orgStore.defaultOrg().name,
    units: orgStore.unitsFor(orgStore.defaultOrg().id).length,
    members: orgStore.usersFor(orgStore.defaultOrg().id).length,
    workspaces: workspaceStore.list().length,
  });

  // RBAC: resolve the signed-in session to an org member and enforce the
  // per-channel permissions declared in authzGate on every enterprise call.
  const sessionEmail = (): string | null => {
    const st = authService.getStatus();
    return st.state === 'authenticated' ? st.session.user.email : null;
  };
  const authorize = createAuthorize({
    sessionEmail,
    activeOrgId: () => activeOrg().id,
    usersFor: (orgId) => orgStore.usersFor(orgId),
    rolesFor: (orgId) => orgStore.rolesFor(orgId),
    ownerMember: () => orgStore.user(OWNER_USER_ID),
  });

  // Enterprise Module Framework: the reusable ERP foundation. Every module
  // registered into this registry inherits RBAC, audit, timeline events,
  // renderer broadcasts, and the generic CRUD IPC surface — nothing per-module.
  const modules = initEnterpriseModules({
    authorize,
    audit: (e) => audit(e.action, e.target, e.summary),
    publish: deps.publish,
    broadcast: deps.broadcast,
    notify: (title, body) => notificationScheduler.notifyNow(title, body),
    actor: sessionEmail,
    now: () => new Date().toISOString(),
  });
  // ERP modules built on the foundation (each: descriptor + store + AI hook).
  modules.registry.register(invoiceModule); // Finance → Invoices
  modules.registry.register(contactModule); // CRM → Contacts
  modules.registry.register(leadModule); // CRM → Leads
  modules.registry.register(customerModule); // CRM → Customers
  modules.registry.register(opportunityModule); // CRM → Opportunities (qualified-deal pipeline)
  modules.registry.register(activityModule); // CRM → Activities (calls/emails/meetings/tasks/notes stream)
  modules.registry.register(customerHealthModule); // CRM → Customer Health (cross-module registers)
  modules.registry.register(customerTimelineModule); // CRM → Customer Timelines (one-account chronologies)
  modules.registry.register(quoteModule); // Sales → Quotes
  modules.registry.register(orderModule); // Sales → Orders (conversion target)
  modules.registry.register(contractModule); // Sales → Contracts (activate/terminate/renew lifecycle)
  modules.registry.register(pricingRuleModule); // Sales → Pricing Rules (the discount-policy rule book)
  modules.registry.register(commissionPlanModule); // Sales → Commission Plans (the commission rule book)
  modules.registry.register(commissionStatementModule); // Sales → Commission Statements (immutable per-period payouts)
  modules.registry.register(revenueForecastModule); // Sales → Revenue Forecast (immutable pipeline snapshots)
  modules.registry.register(paymentModule); // Finance → Payments
  modules.registry.register(ledgerAccountModule); // Finance → Chart of Accounts (GL)
  modules.registry.register(journalEntryModule); // Finance → Journal (GL double-entry)
  modules.registry.register(accountingPeriodModule); // Finance → Accounting Periods (close guard)
  modules.registry.register(taxReportModule); // Finance → Tax Reports (GST snapshots from posted books)
  modules.registry.register(arAgingModule); // Finance → Receivables Aging (open AR bucketed by days past due)
  modules.registry.register(bankStatementModule); // Finance → Bank Statements (deterministic reconciliation)
  modules.registry.register(budgetModule); // Finance → Budgets (measured against posted books only)
  modules.registry.register(vendorBillModule); // Finance → Vendor Bills (payable mirror; books AP via GL seam)
  modules.registry.register(apAgingModule); // Finance → Payables Aging (open AP bucketed by days past due)
  modules.registry.register(fixedAssetModule); // Finance → Fixed Assets (capitalization, depreciation, disposal)
  modules.registry.register(creditNoteModule); // Finance → Credit Notes (invoice adjustments, revenue/tax reversal)
  modules.registry.register(debitNoteModule); // Finance → Debit Notes (bill adjustments, AP/input-credit reversal)
  modules.registry.register(vendorPaymentModule); // Finance → Vendor Payments (partial-capable AP settlement)
  modules.registry.register(exchangeRateModule); // Finance → Exchange Rates (effective-dated FX rate table)
  modules.registry.register(financialRatiosModule); // Finance → Financial Ratios (GL-derived ratio registers)
  modules.registry.register(productModule); // Inventory → Products
  modules.registry.register(warehouseModule); // Inventory → Warehouses
  modules.registry.register(stockMovementModule); // Inventory → Stock Movements (ledger)
  modules.registry.register(lotModule); // Inventory → Lots (batch traceability + code payloads)
  modules.registry.register(reservationModule); // Inventory → Reservations (holds posting ledger movements)
  modules.registry.register(inventoryValuationModule); // Inventory → Valuation (standard-cost registers)
  modules.registry.register(serialModule); // Inventory → Serial Units (per-unit serialized tracking)
  modules.registry.register(supplierModule); // Procurement → Suppliers
  modules.registry.register(purchaseRequestModule); // Procurement → Purchase Requests
  modules.registry.register(purchaseOrderModule); // Procurement → Purchase Orders
  modules.registry.register(goodsReceiptModule); // Procurement → Goods Receipts
  modules.registry.register(rfqModule); // Procurement → RFQs (quotation cycle → PO award)
  modules.registry.register(supplierPerformanceModule); // Procurement → Supplier Performance (scorecard registers)
  modules.registry.register(zoneModule); // Warehouse → Zones
  modules.registry.register(binModule); // Warehouse → Bins
  modules.registry.register(transferOrderModule); // Warehouse → Transfer Orders
  modules.registry.register(pickListModule); // Warehouse → Pick Lists
  modules.registry.register(packingModule); // Warehouse → Packing
  modules.registry.register(shippingModule); // Warehouse → Shipping
  modules.registry.register(cycleCountModule); // Warehouse → Cycle Counts
  modules.registry.register(stockAdjustmentModule); // Warehouse → Stock Adjustments
  modules.registry.register(bomModule); // Manufacturing → Bill of Materials
  modules.registry.register(bomExplosionModule); // Manufacturing → BOM Explosions (multi-level requirements)
  modules.registry.register(projectModule); // Projects → Projects (delivery containers)
  modules.registry.register(projectTaskModule); // Projects → Tasks (the kanban board)
  modules.registry.register(timeEntryModule); // Projects → Time Entries (billable record)
  modules.registry.register(billingRunModule); // Projects → Billing Runs (time → real W1 invoices)
  modules.registry.register(employeeModule); // HR → Employees (work-scoped, cycle-guarded org chain)
  modules.registry.register(payrollRunModule); // HR → Payroll Runs (GL-posted accruals)
  modules.registry.register(salaryStructureModule); // HR → Salary Structures (templates + statutory wage bases)
  modules.registry.register(statutoryRuleModule); // HR → Statutory Rules (effective-dated PF/ESI/PT/TDS tables)
  modules.registry.register(salaryDisbursementModule); // HR → Salary Disbursements (net-pay clearing + bank advice)
  modules.registry.register(payslipModule); // HR → Payslips (immutable per-employee statements from posted runs)
  modules.registry.register(payrollRegisterModule); // HR → Payroll Register (immutable period summary over posted runs)
  modules.registry.register(statutoryFilingModule); // HR → Statutory Filings (ECR/ESI/PT/24Q filing data)
  modules.registry.register(ticketModule); // Helpdesk → Tickets (SLA service desk)
  modules.registry.register(campaignModule); // CRM → Campaigns (live lead attribution)
  modules.registry.register(documentModule); // Documents → Registry (append-only versioning)
  modules.registry.register(biReportModule); // Executive → BI Reports (saved aggregations)
  modules.registry.register(productionOrderModule); // Manufacturing → Production Orders
  modules.registry.register(workCenterModule); // Manufacturing → Work Centers
  modules.registry.register(machineModule); // Manufacturing → Machines
  modules.registry.register(scheduleModule); // Manufacturing → Production Scheduling
  modules.registry.register(routingModule); // Manufacturing → Routings
  modules.registry.register(manufacturingEventModule); // Manufacturing → Shop-Floor Event Ledger
  modules.registry.register(executionModule); // Manufacturing → Production Execution
  modules.registry.register(qualityModule); // Manufacturing → Quality Inspection
  modules.registry.register(costingModule); // Manufacturing → Production Costing
  modules.registry.register(scheduleProposalModule); // Manufacturing → Schedule Proposals (governance + commit)
  modules.registry.register(assetCategoryModule); // Maintenance → Asset Categories
  modules.registry.register(assetModule); // Maintenance → Assets
  modules.registry.register(maintenancePlanModule); // Maintenance → Maintenance Plans
  modules.registry.register(preventiveMaintenanceModule); // Maintenance → Preventive
  modules.registry.register(correctiveMaintenanceModule); // Maintenance → Corrective
  modules.registry.register(workOrderModule); // Maintenance → Work Orders
  modules.registry.register(technicianModule); // Maintenance → Technicians
  modules.registry.register(maintenanceHistoryModule); // Maintenance → History
  modules.registry.register(sparePartModule); // Maintenance → Spare Parts
  modules.registry.register(downtimeEventModule); // Maintenance → Downtime Events
  modules.registry.register(executiveDecisionModule); // Executive → Decision Approval (governance)
  modules.registry.register(executionProposalModule); // Executive → Execution Proposals (controlled handoff)
  await Promise.all([
    invoiceModule.store.load(),
    contactModule.store.load(),
    leadModule.store.load(),
    customerModule.store.load(),
    quoteModule.store.load(),
    orderModule.store.load(),
    paymentModule.store.load(),
    productModule.store.load(),
    warehouseModule.store.load(),
    stockMovementModule.store.load(),
    supplierModule.store.load(),
    purchaseRequestModule.store.load(),
    purchaseOrderModule.store.load(),
    goodsReceiptModule.store.load(),
    zoneModule.store.load(),
    binModule.store.load(),
    transferOrderModule.store.load(),
    pickListModule.store.load(),
    packingModule.store.load(),
    shippingModule.store.load(),
    cycleCountModule.store.load(),
    stockAdjustmentModule.store.load(),
    bomModule.store.load(),
    productionOrderModule.store.load(),
    workCenterModule.store.load(),
    machineModule.store.load(),
    scheduleModule.store.load(),
    routingModule.store.load(),
    manufacturingEventModule.store.load(),
    executionModule.store.load(),
    qualityModule.store.load(),
    costingModule.store.load(),
    scheduleProposalModule.store.load(),
    assetCategoryModule.store.load(),
    assetModule.store.load(),
    maintenancePlanModule.store.load(),
    preventiveMaintenanceModule.store.load(),
    correctiveMaintenanceModule.store.load(),
    workOrderModule.store.load(),
    technicianModule.store.load(),
    maintenanceHistoryModule.store.load(),
    sparePartModule.store.load(),
    downtimeEventModule.store.load(),
    executiveDecisionModule.store.load(),
    executionProposalModule.store.load(),
    personalizationStore.load(),
  ]);

  return {
    handlers: [...withEnterpriseAuthz(buildHandlers()), ...modules.handlers],
    authorize,
    modules: modules.registry,
    complianceFindings: () => evaluateCompliance(governanceStore.rules(), buildComplianceInput()),
  };
}

/* ── shared helpers ── */

function activeOrg(): Organization {
  const ws = workspaceStore.active();
  return orgStore.organization(ws.organizationId) ?? orgStore.defaultOrg();
}

function orgBundle(): {
  organization: Organization;
  units: ReturnType<typeof orgStore.unitsFor>;
  roles: ReturnType<typeof orgStore.rolesFor>;
  users: ReturnType<typeof orgStore.usersFor>;
} {
  const org = activeOrg();
  return {
    organization: org,
    units: orgStore.unitsFor(org.id),
    roles: orgStore.rolesFor(org.id),
    users: orgStore.usersFor(org.id),
  };
}

function actorName(): string {
  const st = authService.getStatus();
  return st.state === 'authenticated'
    ? (st.session.user.displayName ?? st.session.user.email)
    : 'owner';
}

/** The stable per-user key for personalization — the signed-in account (never a renderer-supplied id). */
function currentActorId(): string {
  const st = authService.getStatus();
  return st.state === 'authenticated' ? st.session.user.email : 'owner';
}

function audit(action: string, target: string, summary: string): void {
  governanceStore.record({
    actor: actorName(),
    action,
    target,
    summary,
    workspaceId: workspaceStore.activeWorkspaceId(),
  });
}

function mapEntities(): EntityRef[] {
  const items = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
  const out: EntityRef[] = [];
  for (const e of items) {
    if (e.kind === 'project')
      out.push({ id: e.id, kind: 'project', title: e.title, connectorId: e.connectorId });
    else if (e.kind === 'document' || e.kind === 'file')
      out.push({ id: e.id, kind: 'document', title: e.title, connectorId: e.connectorId });
    else if (e.kind === 'organization' || e.kind === 'contact')
      out.push({ id: e.id, kind: 'customer', title: e.title, connectorId: e.connectorId });
  }
  return out;
}

function connectorRefs(): ConnectorRef[] {
  return connectorService.list().map((c) => ({ id: c.id, name: c.name }));
}

function buildGraph(): ReturnType<typeof buildOrgGraph> {
  const org = activeOrg();
  return buildOrgGraph({
    org,
    units: orgStore.unitsFor(org.id),
    users: orgStore.usersFor(org.id),
    entities: mapEntities(),
    connectors: connectorRefs(),
  });
}

function buildComplianceInput(): ComplianceInput {
  const org = activeOrg();
  const jobs = jobStore.page({ limit: 500 }).jobs;
  return {
    units: orgStore.unitsFor(org.id),
    users: orgStore.usersFor(org.id),
    workers: workerRegistry
      .summaries()
      .map((w) => ({ id: w.id, name: w.name, healthState: w.healthState })),
    jobs: jobs.map((j) => ({
      id: j.id,
      proposals: j.proposals.map((p) => ({
        id: p.id,
        verdict: { decision: p.verdict.decision },
        approval: p.approval,
      })),
    })),
    auditCount: auditLog.size() + governanceStore.auditCount(),
    jobsRun: jobStore.size(),
    approvalChains: governanceStore.chains(),
  };
}

function governanceConfig(): GovernanceConfig {
  const org = activeOrg();
  return {
    roles: orgStore.rolesFor(org.id),
    approvalChains: governanceStore.chains(),
    complianceRules: governanceStore.rules(),
  };
}

function workspaceSummaries(): WorkspaceSummary[] {
  const active = workspaceStore.activeWorkspaceId();
  return workspaceStore.list().map((ws) => {
    const org = orgStore.organization(ws.organizationId);
    const orgId = org?.id ?? ws.organizationId;
    return {
      id: ws.id,
      name: ws.name,
      organizationId: ws.organizationId,
      orgName: org?.name ?? 'Unknown',
      userCount: orgStore.usersFor(orgId).length,
      unitCount: orgStore.unitsFor(orgId).length,
      active: ws.id === active,
    };
  });
}

function computeActivity(now: string): BusinessActivitySummary {
  const items = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
  let projects = 0;
  let tasks = 0;
  let documents = 0;
  let customers = 0;
  let events = 0;
  for (const e of items) {
    if (e.kind === 'project') projects += 1;
    else if (e.kind === 'task') tasks += 1;
    else if (e.kind === 'document' || e.kind === 'file') documents += 1;
    else if (e.kind === 'organization' || e.kind === 'contact') customers += 1;
    else if (e.kind === 'event' || e.kind === 'calendar_event') events += 1;
  }
  const tl = getEnterpriseTimeline();
  const timeline = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
  const cutoff = new Date(now).getTime() - 24 * 60 * 60 * 1000;
  const recentEvents = timeline.filter((t) => new Date(t.at).getTime() >= cutoff).length;
  return { projects, tasks, documents, customers, events, recentEvents };
}

function buildSnapshot(): ReturnType<typeof computeExecutiveSnapshot> {
  const now = new Date().toISOString();
  const org = activeOrg();
  const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
  const tl = getEnterpriseTimeline();
  const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
  const briefing = generateBriefing('morning', { entities, events, now });
  const recommendations = generateRecommendations({ entities, events, now });
  const rules = governanceStore.rules();
  const stats = connectorService.stats();
  return computeExecutiveSnapshot({
    workspaceId: workspaceStore.activeWorkspaceId(),
    org,
    units: orgStore.unitsFor(org.id),
    users: orgStore.usersFor(org.id),
    workers: workerRegistry.summaries(),
    jobs: jobStore.page({ limit: 500 }).jobs,
    findings: evaluateCompliance(rules, buildComplianceInput()),
    recommendations,
    briefingHeadline: briefing.headline,
    briefingGrounded: briefing.grounded,
    activity: computeActivity(now),
    operations: {
      connectors: stats.total,
      connectedAccounts: stats.accounts,
      installedApps: registry.list().length,
      auditEntries: auditLog.size() + governanceStore.auditCount(),
    },
    now,
  });
}

/**
 * Wire the Context Engine to the live read-only sources. The relationship model
 * is guarded so a not-yet-ready ERP layer degrades to graph+timeline+memory
 * rather than throwing; the timeline is optional at boot (returns []).
 */
function contextEngineDeps(): ContextEngineDeps {
  return {
    getNode: (id) => graphStore.getNode(id),
    neighbors: (q) => graphStore.neighbors(q),
    relationshipModel: () => {
      try {
        return getRelationshipModel();
      } catch {
        return null;
      }
    },
    timeline: (entityRef, limit) => {
      const tl = getEnterpriseTimeline();
      return tl ? tl.query({ entityRef, limit, order: 'desc' }).entries : [];
    },
    memories: (entityRef, limit) => memoryStore.recall({ entityRef, limit }).hits.map((h) => h.item),
    now: () => new Date().toISOString(),
  };
}

/* ── handlers ── */

function buildHandlers(): SecureHandlerDef[] {
  return [
    { channel: IpcChannel.EnterpriseOrgGet, schema: EmptyRequest, handler: () => orgBundle() },

    {
      channel: IpcChannel.EnterpriseOrgCreateUnit,
      schema: EnterpriseOrgCreateUnitRequest,
      audit: true,
      handler: (p) => {
        const r = p as TCreateUnit;
        const unit = orgStore.createUnit({
          orgId: activeOrg().id,
          kind: r.kind,
          name: r.name,
          parentId: r.parentId ?? null,
          leadUserId: r.leadUserId ?? null,
        });
        audit('unit.create', unit.id, `Created ${r.kind.replace('_', ' ')} "${r.name}"`);
        return orgBundle();
      },
    },
    {
      channel: IpcChannel.EnterpriseOrgUpdateUnit,
      schema: EnterpriseOrgUpdateUnitRequest,
      audit: true,
      handler: (p) => {
        const r = p as TUpdateUnit;
        const unit = orgStore.updateUnit(r.id, {
          name: r.name,
          parentId: r.parentId,
          leadUserId: r.leadUserId,
        });
        if (unit) audit('unit.update', unit.id, `Updated unit "${unit.name}"`);
        return orgBundle();
      },
    },
    {
      channel: IpcChannel.EnterpriseOrgDeleteUnit,
      schema: EnterpriseOrgDeleteUnitRequest,
      audit: true,
      handler: (p) => {
        const r = p as TDeleteUnit;
        const ok = orgStore.deleteUnit(r.id);
        if (ok) audit('unit.delete', r.id, 'Deleted unit');
        return orgBundle();
      },
    },

    {
      channel: IpcChannel.EnterpriseOrgCreateUser,
      schema: EnterpriseOrgCreateUserRequest,
      audit: true,
      handler: (p) => {
        const r = p as TCreateUser;
        const user = orgStore.createUser({
          orgId: activeOrg().id,
          name: r.name,
          email: r.email ?? null,
          title: r.title ?? 'Member',
          unitId: r.unitId ?? null,
          roleIds: r.roleIds ?? [],
        });
        audit('user.create', user.id, `Added member "${r.name}"`);
        return orgBundle();
      },
    },
    {
      channel: IpcChannel.EnterpriseOrgUpdateUser,
      schema: EnterpriseOrgUpdateUserRequest,
      audit: true,
      handler: (p) => {
        const r = p as TUpdateUser;
        // Root of trust: the seeded owner's roles/status are immutable.
        const patch = guardOwnerUserPatch(r.id, OWNER_USER_ID, {
          name: r.name,
          email: r.email,
          title: r.title,
          unitId: r.unitId,
          roleIds: r.roleIds,
          status: r.status,
        });
        const user = orgStore.updateUser(r.id, patch);
        if (user) audit('user.update', user.id, `Updated member "${user.name}"`);
        return orgBundle();
      },
    },
    {
      channel: IpcChannel.EnterpriseOrgDeleteUser,
      schema: EnterpriseOrgDeleteUserRequest,
      audit: true,
      handler: (p) => {
        const r = p as TDeleteUser;
        // Root of trust: the seeded owner can never be removed.
        const ok = canDeleteMember(r.id, OWNER_USER_ID) && orgStore.deleteUser(r.id);
        if (ok) audit('user.delete', r.id, 'Removed member');
        return orgBundle();
      },
    },

    {
      channel: IpcChannel.EnterpriseOrgCreateRole,
      schema: EnterpriseOrgCreateRoleRequest,
      audit: true,
      handler: (p) => {
        const r = p as TCreateRole;
        const role = orgStore.createRole({
          orgId: activeOrg().id,
          name: r.name,
          description: r.description ?? '',
          permissions: r.permissions,
        });
        audit('role.create', role.id, `Created role "${r.name}"`);
        return orgBundle();
      },
    },
    {
      channel: IpcChannel.EnterpriseOrgUpdateRole,
      schema: EnterpriseOrgUpdateRoleRequest,
      audit: true,
      handler: (p) => {
        const r = p as TUpdateRole;
        // Built-in roles keep their calibrated permissions (Owner = all).
        const patch = guardBuiltInRolePatch(orgStore.role(r.id), {
          name: r.name,
          description: r.description,
          permissions: r.permissions,
        });
        const role = orgStore.updateRole(r.id, patch);
        if (role) audit('role.update', role.id, `Updated role "${role.name}"`);
        return orgBundle();
      },
    },
    {
      channel: IpcChannel.EnterpriseOrgDeleteRole,
      schema: EnterpriseOrgDeleteRoleRequest,
      audit: true,
      handler: (p) => {
        const r = p as TDeleteRole;
        const ok = orgStore.deleteRole(r.id);
        if (ok) audit('role.delete', r.id, 'Deleted role');
        return orgBundle();
      },
    },

    {
      channel: IpcChannel.EnterpriseWorkspaceList,
      schema: EmptyRequest,
      handler: () => workspaceSummaries(),
    },
    {
      channel: IpcChannel.EnterpriseWorkspaceActive,
      schema: EmptyRequest,
      handler: () => workspaceStore.active(),
    },
    {
      channel: IpcChannel.EnterpriseWorkspaceCreate,
      schema: EnterpriseWorkspaceCreateRequest,
      audit: true,
      handler: (p) => {
        const r = p as TWsCreate;
        const ws = workspaceStore.create(r.name, r.organizationId ?? activeOrg().id);
        audit('workspace.create', ws.id, `Created workspace "${r.name}"`);
        return workspaceSummaries();
      },
    },
    {
      channel: IpcChannel.EnterpriseWorkspaceSwitch,
      schema: EnterpriseWorkspaceSwitchRequest,
      audit: true,
      handler: (p) => {
        const r = p as TWsSwitch;
        const ws = workspaceStore.switch(r.id);
        if (ws) audit('workspace.switch', ws.id, `Switched to workspace "${ws.name}"`);
        return workspaceStore.active();
      },
    },

    { channel: IpcChannel.EnterpriseGraph, schema: EmptyRequest, handler: () => buildGraph() },
    {
      channel: IpcChannel.EnterpriseGraphNeighbors,
      schema: EnterpriseGraphNeighborsRequest,
      handler: (p) => orgGraphNeighbors(buildGraph(), (p as TNeighbors).id),
    },

    {
      channel: IpcChannel.EnterpriseGovernanceConfig,
      schema: EmptyRequest,
      handler: () => governanceConfig(),
    },
    {
      channel: IpcChannel.EnterpriseGovernanceCompliance,
      schema: EmptyRequest,
      handler: () => evaluateCompliance(governanceStore.rules(), buildComplianceInput()),
    },
    {
      channel: IpcChannel.EnterpriseGovernanceSetChain,
      schema: EnterpriseGovernanceSetChainRequest,
      audit: true,
      handler: (p) => {
        const r = p as TSetChain;
        const c = governanceStore.setChainEnabled(r.id, r.enabled);
        if (c)
          audit(
            'governance.chain',
            c.id,
            `${r.enabled ? 'Enabled' : 'Disabled'} approval chain "${c.name}"`,
          );
        return governanceStore.chains();
      },
    },
    {
      channel: IpcChannel.EnterpriseGovernanceSetRule,
      schema: EnterpriseGovernanceSetRuleRequest,
      audit: true,
      handler: (p) => {
        const r = p as TSetRule;
        const rule = governanceStore.setRuleEnabled(r.id, r.enabled);
        if (rule)
          audit(
            'governance.rule',
            rule.id,
            `${r.enabled ? 'Enabled' : 'Disabled'} compliance rule "${rule.name}"`,
          );
        return governanceStore.rules();
      },
    },
    {
      channel: IpcChannel.EnterpriseGovernanceAudit,
      schema: EnterpriseGovernanceAuditRequest,
      handler: (p) => governanceStore.auditEntries((p as TAudit).limit ?? 100),
    },

    {
      channel: IpcChannel.EnterpriseDashboard,
      schema: EmptyRequest,
      handler: () => buildSnapshot(),
    },

    // Process Explorer — read-only projections of the mined processes. No mining, no writes: both
    // read through the cached Process Mining provider (reuses the one assessment; never rescans).
    {
      channel: IpcChannel.EnterpriseProcessExplore,
      schema: EnterpriseProcessExploreRequest,
      handler: (p) => getProcessExplorerModel(p as TProcessExplore),
    },
    {
      channel: IpcChannel.EnterpriseProcessCase,
      schema: EnterpriseProcessCaseRequest,
      handler: (p) => getProcessCaseDetail((p as TProcessCase).id),
    },

    // Production Schedule — read-only routing schedule (Gantt + KPIs + violations + governance proposals).
    // No mining, no writes: commit happens only through the approved Schedule Proposal lifecycle.
    {
      channel: IpcChannel.EnterpriseScheduleExplore,
      schema: EmptyRequest,
      handler: () => getScheduleExploreModel(),
    },

    // Operator Console (MES) — read-only shop-floor execution model (executions + operators + machines +
    // quality + timeline + KPIs + narrative). No writes: lifecycle mutations go through the module actions.
    {
      channel: IpcChannel.EnterpriseExecutionExplore,
      schema: EmptyRequest,
      handler: () => getExecutionConsoleModel(),
    },

    // Relationship Intelligence — read-only ERP entity relationship graph (nodes + typed edges + health/risk +
    // KPIs + narrative). No writes: every edge is a foreign-key link already present on the records.
    {
      channel: IpcChannel.EnterpriseRelationshipExplore,
      schema: EmptyRequest,
      handler: () => getRelationshipModel(),
    },

    // Trust Engine — read-only per-entity deterministic trust model (profiles + factors + trend + KPIs +
    // narrative). No writes: trust is composed from existing subsystem outputs; AI only explains.
    {
      channel: IpcChannel.EnterpriseTrustExplore,
      schema: EmptyRequest,
      handler: () => getTrustModel(),
    },

    // Context Engine (P2.5) — entity-360 for any unified-graph / ERP entity: immediate graph neighbors
    // (UDM + bridged ERP), transitive ERP impact/blast-radius, related timeline activity, and citing AI
    // memories. Pure read: composes existing subsystems, derives nothing new, stores nothing.
    {
      channel: IpcChannel.EnterpriseContext,
      schema: EnterpriseContextRequest,
      handler: (p) => buildEnterpriseContext(contextEngineDeps(), p as TContext),
    },

    // Personalization — per-user Favorites / Recently-Opened / Saved Views. Every mutation is applied to the
    // CALLER's own actor-scoped document (resolved server-side), persisted under userData, and returns the
    // fresh state. Deterministic list operations are reused from the shared engine; nothing is duplicated.
    {
      channel: IpcChannel.EnterprisePersonalizationGet,
      schema: EmptyRequest,
      handler: () => personalizationStore.forActor(currentActorId()),
    },
    {
      channel: IpcChannel.EnterprisePersonalizationFavorite,
      schema: EnterprisePersonalizationFavoriteRequest,
      handler: (p) => personalizationStore.toggleFavorite(currentActorId(), p as TPersFavorite),
    },
    {
      channel: IpcChannel.EnterprisePersonalizationRecent,
      schema: EnterprisePersonalizationRecentRequest,
      handler: (p) => personalizationStore.pushRecent(currentActorId(), p as TPersRecent),
    },
    {
      channel: IpcChannel.EnterprisePersonalizationClearRecents,
      schema: EmptyRequest,
      handler: () => personalizationStore.clearRecents(currentActorId()),
    },
    {
      channel: IpcChannel.EnterprisePersonalizationSaveView,
      schema: EnterprisePersonalizationSaveViewRequest,
      handler: (p) => personalizationStore.saveView(currentActorId(), p as TPersSaveView),
    },
    {
      channel: IpcChannel.EnterprisePersonalizationDeleteView,
      schema: EnterprisePersonalizationDeleteViewRequest,
      handler: (p) => personalizationStore.deleteView(currentActorId(), (p as TPersDeleteView).id),
    },
    {
      channel: IpcChannel.EnterprisePersonalizationRenameView,
      schema: EnterprisePersonalizationRenameViewRequest,
      handler: (p) => { const r = p as TPersRenameView; return personalizationStore.renameView(currentActorId(), r.id, r.label); },
    },
  ];
}
