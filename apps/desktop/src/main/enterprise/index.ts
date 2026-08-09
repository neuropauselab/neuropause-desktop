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
import type { EnterpriseModule } from './framework';
import { documentIntegration } from '../erp/documentIntegrationInstance';
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
import {
  initEnterpriseModules,
  type EnterpriseModuleRegistry,
  type EnterpriseModulesSubsystem,
} from './framework';
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
import { cashFlowModule } from './modules/finance/cashFlowModuleInstance';
import { fxRevaluationModule } from './modules/finance/fxRevaluationModuleInstance';
import { fxExposureModule } from './modules/finance/fxExposureModuleInstance';
import { treasuryPositionModule } from './modules/finance/treasuryPositionModuleInstance';
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
// ── Medical Device Manufacturing Pack (Industry Pack layer) ──
import {
  LotService,
  TraceService,
  buildMedicalDeviceHandlers,
  registerMedicalDevicePack,
} from '../medicalDevice';
import {
  deviceLotModule,
  deviceProductModule,
  deviceTenantId,
  traceEdgeStore,
} from '../medicalDevice/instances';
import { assessDeleteAgainstLinks } from '../decisions/decisionService';
import { createDocumentBridge } from '../erp/documentBridge';
import { approvalStore } from '../erp/documentIntegrationInstance';
import type { Approver } from '../erp/approvalEngine';
import { decisionRecordStore, holdStore, incomingLinksFor } from '../decisions/instances';
import { holdFromAssessment, permissionMissingHold } from '@neuropause/shared';
import { reservationModule } from './modules/inventory/reservationModuleInstance';
import { inventoryValuationModule } from './modules/inventory/inventoryValuationModuleInstance';
import { serialModule } from './modules/inventory/serialModuleInstance';
import {
  supplierModule,
  vendorContractModule,
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
import { attendanceModule, candidateModule, employeeModule, okrModule, expenseClaimModule, holidayModule, leaveModule, shiftModule, payrollRegisterModule, payrollRunModule, payslipModule, salaryDisbursementModule, salaryStructureModule, statutoryFilingModule, statutoryRuleModule } from './modules/hr/hrInstances';
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
  /**
   * Phase 6 — replay Data Plane imports through the module lifecycle, so an
   * imported record is audited, broadcast to open views and seen by every
   * `onChange` reconciler exactly as a hand-created one is.
   */
  notifyImported: EnterpriseModulesSubsystem['notifyImported'];
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
    /**
     * HOLD producer #3: `insufficient_permission`.
     *
     * Deduplicated by subject inside `holdStore.open`, so a user who clicks a
     * forbidden action five times gets one item, not five. The scope name is
     * carried verbatim because it is the thing an administrator must grant.
     */
    onPermissionRefused: ({ permission, held, actorLabel }) => {
      const subject = `permission/${permission}`;
      const view = permissionMissingHold({
        action: 'this operation',
        permission,
        heldPermissions: held,
        actorLabel,
      });
      const hold = holdStore.open({
        ...view,
        title: `Permission needed: ${permission}`,
        subject,
        actor: sessionEmail(),
      });
      decisionRecordStore.record({
        actor: sessionEmail(),
        requestedAction: `Act with "${permission}"`,
        subject,
        assessment: {
          risk: 'insufficient_evidence',
          recommendation: view.resolution,
          evidence: view.known.map((detail) => ({ label: 'Access control', detail, count: null })),
          alternative: null,
        },
        outcome: 'cancelled',
        executed: 'Nothing — the operation was refused for want of permission.',
        holdId: hold.id,
      });
    },
    activeOrgId: () => activeOrg().id,
    usersFor: (orgId) => orgStore.usersFor(orgId),
    rolesFor: (orgId) => orgStore.rolesFor(orgId),
    ownerMember: () => orgStore.user(OWNER_USER_ID),
  });

  /**
   * The signed-in person as the APPROVAL engine needs to see them.
   *
   * Distinct from `authorize`, and deliberately so. RBAC answers "may this
   * user act on this module at all"; the approval engine answers "may this
   * user approve THIS document" — which turns on the roles they hold, the
   * department they sit in, and whether they raised the thing themselves.
   * Without real roles here, segregation of duties silently disqualifies
   * everyone, and the integration previously passed `actor: () => null`.
   *
   * Returns null when nobody is signed in or the session is not an org member.
   * Null means "cannot approve", never "approve anyway".
   */
  const currentApprover = (): Approver | null => {
    const email = sessionEmail();
    if (!email) return null;
    const member = orgStore
      .usersFor(activeOrg().id)
      .find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!member || member.status !== 'active') return null;
    const roleNames = orgStore
      .rolesFor(activeOrg().id)
      .filter((r) => member.roleIds.includes(r.id))
      .map((r) => r.name.toLowerCase());
    return {
      userId: member.email ?? member.id,
      roles: roleNames,
      ...(member.unitId ? { department: member.unitId } : {}),
    };
  };

  // The ERP document layer becomes reachable here. Everything it exposes —
  // line items, derived totals, the approval policy engine and its SoD rules —
  // shipped registered but with no caller; this is the joint that connects it
  // to the module registry, and through the registry to IPC and the UI.
  await approvalStore.load();
  const documents = createDocumentBridge({
    integration: documentIntegration,
    approvals: approvalStore,
    currentApprover,
  });

  // Enterprise Module Framework: the reusable ERP foundation. Every module
  // registered into this registry inherits RBAC, audit, timeline events,
  // renderer broadcasts, and the generic CRUD IPC surface — nothing per-module.
  const modules = initEnterpriseModules({
    authorize,
    documents,
    // The approval gate on status changes. `canEnterStatus` is the engine's
    // own verdict, read through the live decision history.
    canEnterStatus: (moduleId, record, status) =>
      documentIntegration.canEnterStatus(
        moduleId,
        record,
        status,
        approvalStore.forDocument(moduleId, record.id),
      ),
    audit: (e) => audit(e.action, e.target, e.summary),
    publish: deps.publish,
    broadcast: deps.broadcast,
    notify: (title, body) => notificationScheduler.notifyNow(title, body),
    actor: sessionEmail,
    now: () => new Date().toISOString(),
    // Governed delete: assess against the REAL resolved relationship links
    // (late-bound — before the Data Plane exists, no links exist to break).
    assessDelete: (_moduleId, record) =>
      assessDeleteAgainstLinks(record.title, incomingLinksFor(record.id)),
    // The policy half of governed delete lives here, not in the framework:
    // a REFUSAL opens a durable Hold (the pause has to outlive the dialog),
    // and any outcome that actually resolves the situation closes it. A hold
    // that survives its own answer is worse than no hold — it trains people
    // to ignore the list.
    recordDecision: (entry) => {
      const actor = sessionEmail();
      let holdId: string | null = null;
      if (entry.outcome === 'cancelled') {
        holdId = holdStore.open({
          ...holdFromAssessment(entry.assessment, entry.requestedAction.replace(/^Delete /, '')),
          title: entry.requestedAction,
          subject: entry.subject,
          actor,
        }).id;
      } else {
        holdId =
          holdStore.resolveSubject(
            entry.subject,
            entry.outcome,
            entry.executed,
          )?.id ?? null;
      }
      const record = decisionRecordStore.record({ ...entry, actor, holdId });
      audit(
        'decision.recorded',
        entry.subject,
        `${entry.requestedAction}: ${entry.outcome} (${entry.assessment.risk})`,
      );
      return { decisionId: record.id, holdId };
    },
    /**
     * HOLD producer #2: `approval_required`.
     *
     * A status change refused for want of approval is the textbook hold — the
     * request is understood and legitimate, it simply is not authorised yet.
     * Returning a bare error would make it vanish with the toast; raising a
     * hold makes it an item someone with the right role can find and clear.
     *
     * The five questions are answered from the POLICY, not from prose: what we
     * know is the amount and the steps already satisfied, what we don't know
     * is whether the outstanding approver agrees, and what resolves it is the
     * named next step.
     */
    onApprovalRequired: ({ moduleId, record, status, reason }) => {
      const view = documents.approvalView(moduleId, record);
      const subject = `${moduleId}/${record.id} (${record.title})`;
      const known = [
        `Amount evaluated by the policy: ${view.amount.toLocaleString()}.`,
        view.satisfiedStepIds.length > 0
          ? `Approved so far: ${view.satisfiedStepIds.join(', ')}.`
          : 'No approval step has been satisfied yet.',
        ...view.reasons,
      ];
      const hold = holdStore.open({
        reason: 'approval_required',
        why: reason,
        known,
        unknown: [
          view.nextStep
            ? `Whether ${view.nextStep.label} approves — nobody eligible has decided yet.`
            : 'Which step is outstanding — the policy resolved no next step.',
        ],
        resolution: view.nextStep
          ? `Have someone with one of these roles record a decision on "${view.nextStep.label}": ${view.nextStep.roles.join(', ')}.`
          : 'Review the approval policy for this document type.',
        // Deliberately empty: unlike a dangerous delete, there is no "proceed
        // anyway". Approval is not an acknowledgement the actor can waive.
        ifProceeding: '',
        title: `Approve ${record.title} to move it to "${status}"`,
        subject,
        actor: sessionEmail(),
      });
      decisionRecordStore.record({
        actor: sessionEmail(),
        requestedAction: `Move ${record.title} to "${status}"`,
        subject,
        assessment: {
          risk: 'questionable',
          recommendation: reason,
          evidence: known.map((detail) => ({ label: 'Approval policy', detail, count: null })),
          alternative: null,
        },
        outcome: 'cancelled',
        executed: 'Nothing — the status change is held pending approval.',
        holdId: hold.id,
      });
      audit('approval.required', subject, `${record.title} → "${status}" held: ${reason}`);
      return { holdId: hold.id };
    },
  });
  /**
   * Phase 6 — every module is registered THROUGH the ERP document integration.
   *
   * `attach()` returns a module with no `DocumentSpec` by identity, so this is a
   * literal no-op for the ~96 non-document modules. The 8 transactional
   * documents gain line items, derived totals, approval/SoD gating and
   * accounting composed ONTO their existing `onChange` — Finance's GL posting,
   * Procurement's budget/contract gates and Sales' inventory reservation all
   * keep running first and unchanged.
   */
  const registerModule = (m: EnterpriseModule): void => {
    modules.registry.register(documentIntegration.attach(m));
  };

  // ERP modules built on the foundation (each: descriptor + store + AI hook).
  registerModule(invoiceModule); // Finance → Invoices
  registerModule(contactModule); // CRM → Contacts
  registerModule(leadModule); // CRM → Leads
  registerModule(customerModule); // CRM → Customers
  registerModule(opportunityModule); // CRM → Opportunities (qualified-deal pipeline)
  registerModule(activityModule); // CRM → Activities (calls/emails/meetings/tasks/notes stream)
  registerModule(customerHealthModule); // CRM → Customer Health (cross-module registers)
  registerModule(customerTimelineModule); // CRM → Customer Timelines (one-account chronologies)
  registerModule(quoteModule); // Sales → Quotes
  registerModule(orderModule); // Sales → Orders (conversion target)
  registerModule(contractModule); // Sales → Contracts (activate/terminate/renew lifecycle)
  registerModule(pricingRuleModule); // Sales → Pricing Rules (the discount-policy rule book)
  registerModule(commissionPlanModule); // Sales → Commission Plans (the commission rule book)
  registerModule(commissionStatementModule); // Sales → Commission Statements (immutable per-period payouts)
  registerModule(revenueForecastModule); // Sales → Revenue Forecast (immutable pipeline snapshots)
  registerModule(paymentModule); // Finance → Payments
  registerModule(ledgerAccountModule); // Finance → Chart of Accounts (GL)
  registerModule(journalEntryModule); // Finance → Journal (GL double-entry)
  registerModule(accountingPeriodModule); // Finance → Accounting Periods (close guard)
  registerModule(taxReportModule); // Finance → Tax Reports (GST snapshots from posted books)
  registerModule(arAgingModule); // Finance → Receivables Aging (open AR bucketed by days past due)
  registerModule(bankStatementModule); // Finance → Bank Statements (deterministic reconciliation)
  registerModule(budgetModule); // Finance → Budgets (measured against posted books only)
  registerModule(vendorBillModule); // Finance → Vendor Bills (payable mirror; books AP via GL seam)
  registerModule(apAgingModule); // Finance → Payables Aging (open AP bucketed by days past due)
  registerModule(fixedAssetModule); // Finance → Fixed Assets (capitalization, depreciation, disposal)
  registerModule(creditNoteModule); // Finance → Credit Notes (invoice adjustments, revenue/tax reversal)
  registerModule(debitNoteModule); // Finance → Debit Notes (bill adjustments, AP/input-credit reversal)
  registerModule(vendorPaymentModule); // Finance → Vendor Payments (partial-capable AP settlement)
  registerModule(exchangeRateModule); // Finance → Exchange Rates (effective-dated FX rate table)
  registerModule(financialRatiosModule); // Finance → Financial Ratios (GL-derived ratio registers)
  registerModule(cashFlowModule); // Finance → Cash Flow Statement (direct-method over posted GL entries)
  registerModule(fxRevaluationModule); // Finance → FX Revaluation (period-end unrealized revaluation, reversing entries)
  registerModule(fxExposureModule); // Finance → FX Exposure (immutable point-in-time open-position exposure snapshots)
  registerModule(treasuryPositionModule); // Finance → Treasury Positions (FW-12: derived cash + AR − AP — 104th registered module)
  registerModule(productModule); // Inventory → Products
  registerModule(warehouseModule); // Inventory → Warehouses
  registerModule(stockMovementModule); // Inventory → Stock Movements (ledger)
  registerModule(lotModule); // Inventory → Lots (batch traceability + code payloads)
  registerModule(reservationModule); // Inventory → Reservations (holds posting ledger movements)
  registerModule(inventoryValuationModule); // Inventory → Valuation (standard-cost registers)
  registerModule(serialModule); // Inventory → Serial Units (per-unit serialized tracking)
  registerModule(supplierModule); // Procurement → Suppliers
  registerModule(vendorContractModule); // Procurement → Vendor Contracts (FW-7: dated agreements gate PO approval — 101st registered module)
  registerModule(purchaseRequestModule); // Procurement → Purchase Requests
  registerModule(purchaseOrderModule); // Procurement → Purchase Orders
  registerModule(goodsReceiptModule); // Procurement → Goods Receipts
  registerModule(rfqModule); // Procurement → RFQs (quotation cycle → PO award)
  registerModule(supplierPerformanceModule); // Procurement → Supplier Performance (scorecard registers)
  registerModule(zoneModule); // Warehouse → Zones
  registerModule(binModule); // Warehouse → Bins
  registerModule(transferOrderModule); // Warehouse → Transfer Orders
  registerModule(pickListModule); // Warehouse → Pick Lists
  registerModule(packingModule); // Warehouse → Packing
  registerModule(shippingModule); // Warehouse → Shipping
  registerModule(cycleCountModule); // Warehouse → Cycle Counts
  registerModule(stockAdjustmentModule); // Warehouse → Stock Adjustments
  registerModule(bomModule); // Manufacturing → Bill of Materials
  registerModule(bomExplosionModule); // Manufacturing → BOM Explosions (multi-level requirements)
  registerModule(projectModule); // Projects → Projects (delivery containers)
  registerModule(projectTaskModule); // Projects → Tasks (the kanban board)
  registerModule(timeEntryModule); // Projects → Time Entries (billable record)
  registerModule(billingRunModule); // Projects → Billing Runs (time → real W1 invoices)
  registerModule(employeeModule); // HR → Employees (work-scoped, cycle-guarded org chain)
  registerModule(payrollRunModule); // HR → Payroll Runs (GL-posted accruals)
  registerModule(salaryStructureModule); // HR → Salary Structures (templates + statutory wage bases)
  registerModule(statutoryRuleModule); // HR → Statutory Rules (effective-dated PF/ESI/PT/TDS tables)
  registerModule(salaryDisbursementModule); // HR → Salary Disbursements (net-pay clearing + bank advice)
  registerModule(payslipModule); // HR → Payslips (immutable per-employee statements from posted runs)
  registerModule(payrollRegisterModule); // HR → Payroll Register (immutable period summary over posted runs)
  registerModule(statutoryFilingModule); // HR → Statutory Filings (ECR/ESI/PT/24Q filing data)
  registerModule(attendanceModule); // HR → Attendance Periods (confirmed LOP → payroll proration + ECR NCP)
  registerModule(leaveModule); // HR → Leave Requests (human-approved; unpaid → LOP via attendance import)
  registerModule(holidayModule); // HR → Holiday Calendar (declared holidays never dock pay)
  registerModule(candidateModule); // HR → Candidates (FW-10: recruitment pipeline; hire creates the employee — 102nd registered module)
  registerModule(okrModule); // HR → OKRs (FW-11: derived-progress objectives per owner + quarter — 103rd registered module)
  registerModule(expenseClaimModule); // HR → Expense Claims (approval books Dr 5330 / Cr 2260, idempotent)
  registerModule(shiftModule); // HR → Shifts (working patterns → attendance present-day prefill)
  registerModule(ticketModule); // Helpdesk → Tickets (SLA service desk)
  registerModule(campaignModule); // CRM → Campaigns (live lead attribution)
  registerModule(documentModule); // Documents → Registry (append-only versioning)
  registerModule(biReportModule); // Executive → BI Reports (saved aggregations)
  registerModule(productionOrderModule); // Manufacturing → Production Orders
  registerModule(workCenterModule); // Manufacturing → Work Centers
  registerModule(machineModule); // Manufacturing → Machines
  registerModule(scheduleModule); // Manufacturing → Production Scheduling
  registerModule(routingModule); // Manufacturing → Routings
  registerModule(manufacturingEventModule); // Manufacturing → Shop-Floor Event Ledger
  registerModule(executionModule); // Manufacturing → Production Execution
  registerModule(qualityModule); // Manufacturing → Quality Inspection
  registerModule(costingModule); // Manufacturing → Production Costing
  registerModule(scheduleProposalModule); // Manufacturing → Schedule Proposals (governance + commit)
  registerModule(assetCategoryModule); // Maintenance → Asset Categories
  registerModule(assetModule); // Maintenance → Assets
  registerModule(maintenancePlanModule); // Maintenance → Maintenance Plans
  registerModule(preventiveMaintenanceModule); // Maintenance → Preventive
  registerModule(correctiveMaintenanceModule); // Maintenance → Corrective
  registerModule(workOrderModule); // Maintenance → Work Orders
  registerModule(technicianModule); // Maintenance → Technicians
  registerModule(maintenanceHistoryModule); // Maintenance → History
  registerModule(sparePartModule); // Maintenance → Spare Parts
  registerModule(downtimeEventModule); // Maintenance → Downtime Events
  registerModule(executiveDecisionModule); // Executive → Decision Approval (governance)
  registerModule(executionProposalModule); // Executive → Execution Proposals (controlled handoff)
  // ── Medical Device Manufacturing Pack. Registered through the SAME seam as
  // every core module, so it inherits RBAC, audit, timeline, broadcasts and the
  // generic read surface. The pack adds a vocabulary and two modules; it does
  // not fork the framework, and it contains no tenant-specific rule. ──
  registerModule(deviceProductModule); // Medical Devices → Products
  registerModule(deviceLotModule); // Medical Devices → Batch/Lot
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
    deviceProductModule.store.load(),
    deviceLotModule.store.load(),
    traceEdgeStore.load(),
    personalizationStore.load(),
  ]);

  // ── Medical Device Pack composition ──
  registerMedicalDevicePack();
  const lotService = new LotService({
    lots: deviceLotModule,
    products: deviceProductModule,
    edges: traceEdgeStore,
    tenantId: deviceTenantId,
    actor: sessionEmail,
    now: () => new Date().toISOString(),
    authorize,
    audit: (e) => audit(e.action, e.target, e.summary),
    // The ONE shared action context — the same identity and RBAC gate the CRUD
    // handlers use, so a lot's inventory posting is authorized exactly as a
    // hand-entered movement would be.
    moduleContext: () => modules.actionContext,
  });
  const traceService = new TraceService({
    lots: deviceLotModule,
    products: deviceProductModule,
    edges: traceEdgeStore,
    tenantId: deviceTenantId,
    authorize,
  });
  const medicalDeviceHandlers = buildMedicalDeviceHandlers({
    products: deviceProductModule,
    lots: deviceLotModule,
    edges: traceEdgeStore,
    lotService,
    traceService,
    tenantId: deviceTenantId,
    authorize,
    auditEntries: (limit) => governanceStore.auditEntries(limit),
  });

  return {
    handlers: [...withEnterpriseAuthz(buildHandlers()), ...modules.handlers, ...medicalDeviceHandlers],
    authorize,
    modules: modules.registry,
    complianceFindings: () => evaluateCompliance(governanceStore.rules(), buildComplianceInput()),
    notifyImported: modules.notifyImported,
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
