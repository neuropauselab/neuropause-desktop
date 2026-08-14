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
  EnterpriseOrganizationCreateRequest as TOrgCreate,
  EnterpriseOrganizationSwitchRequest as TOrgSwitch,
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
  EnterpriseOrganizationCreateRequest,
  EnterpriseOrganizationSwitchRequest,
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
import { provisionOrganization } from './org/provisionOrganization';
import { announceWorkspaceSwitch } from '../tenancy/workspaceSwitchHub';
import { announceTenantRecovery } from '../tenancy/tenantRecoveryHub';
import { registerShutdownFlush } from '../shutdownFlush';
import { bindOrgIntelligenceScope } from './orgIntelligence';
import {
  firstEnterableWorkspace,
  visibleOrganizations,
  visibleWorkspaces,
  type TenantDirectoryDeps,
} from './org/tenantDirectory';
import {
  canDeleteMember,
  UNRESOLVED_TENANT,
  createAuthorize,
  createPermissionProbe,
  guardBuiltInRolePatch,
  guardOwnerUserPatch,
  withEnterpriseAuthz,
} from './authzGate';
import { createTenantContextResolver } from '../tenancy/tenantContext';
import { buildMigrationInventory, summarizeInventory } from '../tenancy/migrationInventory';
import type { MemoryViewer, TenantResolution, TenantScope } from '@neuropause/shared';
import {
  currentPrincipal,
  principalScope,
  resolveTenantScope,
  runAsPrincipal,
  tenantPrincipal,
  type BackgroundPrincipal,
} from '../tenancy/backgroundPrincipal';
import {
  forEachTenant,
  tenantRuns,
  type FanOutOptions,
  type FanOutOutcome,
  type TenantFanOutDeps,
  type TenantRun,
} from '../tenancy/backgroundFanOut';
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
import {
  bindingIsLive,
  decisionRecordStore,
  holdStore,
  incomingLinksFor,
} from '../decisions/instances';
import { createHoldRaiser } from '../decisions/raiseHold';
import { initOpportunities } from '../opportunities';
import { opportunityDecisionStore } from '../opportunities/instances';
import {
  MAX_ORDERS,
  findOpenRfq,
  purchaseOrdersAsObservations,
  rfqAsExecution,
  rfqFieldsFor,
} from '../opportunities/procurementSource';
import { outcomeRevisionStore } from '../outcomes/instances';
import { buildRelatedRecords } from '../crossDomain/relatedRecords';
import { relationshipEngineRef, relationshipStoreRef } from '../crossDomain/instances';
import { CrossDomainRelatedRequest } from '@neuropause/shared';
import type { EnterpriseEntity, RelatedRecordsView } from '@neuropause/shared';
import {
  holdFromAssessment,
  insufficientEvidenceHold,
  permissionMissingHold,
  policyConflictHold,
  verificationUnavailableHold,
} from '@neuropause/shared';
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
import {
  getProcessExplorerModel,
  getProcessCaseDetail,
  bindProcessMiningScope,
} from './processMiningProvider';
import { getScheduleExploreModel } from './scheduleExploreProvider';
import { getExecutionConsoleModel } from './executionConsoleProvider';
import { getRelationshipModel, bindRelationshipModelScope } from './relationshipProvider';
import { getTrustModel, bindTrustModelScope } from './trustProvider';
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
import { healthHistoryStore } from './healthHistoryInstance';
import { tenantAiPreferenceStore } from '../ai/tenantAiPreferenceInstance';
import { TenantDedupe } from '../tenancy/tenantDedupe';

const log = createLogger('enterprise');


/** P13C Round 24 — O-9. The identity every parked-reference retry pass carries. */
const REFERENCE_RETRY_JOB_ID = 'enterprise:reference-retry';

export interface EnterpriseDeps {
  broadcast: IpcBroadcaster;
  /** Platform event publisher → timeline + Executive Center (module lifecycle). */
  publish?: (input: PlatformEventInput) => void;
}

export interface EnterpriseSubsystem {
  handlers: SecureHandlerDef[];
  /**
   * A PURE permission check, with none of `authorize`'s side effects.
   *
   * `authorize` throws AND, on refusal, opens a HOLD and writes a Decision
   * Record — right for a person's request, wrong for a machine-triggered one
   * running every fifteen minutes.
   */
  allows: (permission: EnterprisePermission) => boolean;
  /** RBAC gate for the secure bridge — resolves the session actor and asserts. */
  authorize: (permission: EnterprisePermission) => void;
  /**
   * Bind the platform-operator predicate, once the registry has loaded.
   *
   * P13C ROUND 10: `createAuthorize` has always accepted this dep and NOTHING
   * EVER PASSED IT, so `cloud:operate` refused everyone — fail-closed, and the
   * reason four rounds of platform-authority work were never exercised.
   */
  bindPlatformOperator: (isOperator: (email: string) => boolean) => void;
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

/**
 * P11 — THE authoritative tenant resolver.
 *
 * One object, consulted by everything that needs to know which tenant a request
 * belongs to. Before this there was no request context at all: fifteen call
 * sites each derived the workspace themselves and eight derived the actor
 * themselves, which is twenty-three chances for one of them to disagree — and
 * eleven of the fifteen fed audit stamps, so disagreeing was invisible.
 *
 * Module-level, like the three singletons it reads (`authService`, `orgStore`,
 * `workspaceStore`). It is deliberately NOT constructed inside `initEnterprise`:
 * `buildHandlers()` is module-level and needs it, and threading it through would
 * mean either a second resolver or a mutable global set at boot. One authority,
 * at the same scope as its inputs.
 *
 * Every input is server-side. Nothing here reads a payload. It is safe to build
 * before the stores load because `isLoaded()` is the first thing it checks — an
 * unread store refuses rather than answering from empty maps.
 */
/**
 * P13C ROUND 31 — W-10. HOW OFTEN THE REFUSAL DIAGNOSTIC IS ALLOWED TO SPEAK.
 *
 * `resolveFull()` is on the read path of every scoped store, so an install that
 * cannot resolve its tenant refuses hundreds of times a minute. Logging each one
 * would bury the line that matters under its own repetitions and turn a support
 * bundle into a 200 MB file nobody opens.
 *
 * The policy: the TRANSITION always prints, because that is the measurement —
 * the moment resolution stopped working and how long it had been working. After
 * that, one line per reason per minute, each carrying how many it stands for, so
 * the log says "still refusing, 4 100 times since the last line" rather than
 * saying it 4 100 times. Recovery always prints, because it closes the bracket.
 */
const REFUSAL_LOG_INTERVAL_MS = 60_000;
const refusalLogState = new Map<string, { lastAtMs: number; suppressed: number }>();

const tenantContext = createTenantContextResolver({
  sessionEmail: () => {
    const st = authService.getStatus();
    return st.state === 'authenticated' ? st.session.user.email : null;
  },
  isLoaded: () => workspaceStore.isLoaded(),
  activeWorkspaceId: () => workspaceStore.activeWorkspaceIdOrNull(),
  workspace: (id) => workspaceStore.get(id),
  organization: (id) => orgStore.organization(id),
  usersFor: (orgId) => orgStore.usersFor(orgId),
  rolesFor: (orgId) => orgStore.rolesFor(orgId),
  ownerMember: () => orgStore.user(OWNER_USER_ID),
  /**
   * WHY THIS MOVED HERE FROM THE AUTHORIZATION GATE.
   *
   * Round 28 wired the same diagnostic into `createAuthorize`, and on the
   * machine it was written for it printed nothing at all while five screens
   * were showing the refusal. `livesync:status` takes the refusal from
   * `resolveFull()` and throws it; it never reaches the gate. Neither does any
   * caller that reads `scope()`, sees null, and gives up. Instrumenting a
   * caller measures that caller — and there are many callers and one resolver.
   *
   * The payload is redacted inside the resolver, so no address can reach this
   * function to be logged by accident.
   */
  onRefusal: (d) => {
    const nowMs = Date.now();
    const state = refusalLogState.get(d.reason);
    if (!d.firstRefusalAfterSuccess && state !== undefined) {
      if (nowMs - state.lastAtMs < REFUSAL_LOG_INTERVAL_MS) {
        state.suppressed += 1;
        return;
      }
    }
    const suppressed = state?.suppressed ?? 0;
    refusalLogState.set(d.reason, { lastAtMs: nowMs, suppressed: 0 });
    log.warn(
      d.firstRefusalAfterSuccess
        ? 'Tenant resolution LOST — first refusal after a working session'
        : 'Tenant refused',
      { ...d, suppressedSinceLastLine: suppressed },
    );
  },
  /**
   * The other end of the interval. Today a restart is what produces this; when
   * the root cause is fixed it will stop appearing, which is the regression
   * signal.
   */
  onRecovered: (r) => {
    refusalLogState.clear();
    log.warn('Tenant resolution RECOVERED', r);
    // Round 39 (Gate 26): subsystems that built tenant-derived plans during
    // the refused window (the AI engine's boot-time router above all) rebuild
    // now that resolution is real. Announced here because this resolver is the
    // one place a recovery is decided — same ownership rule as the switch hub.
    announceTenantRecovery();
  },
});

/**
 * Things to forget when the active workspace changes.
 *
 * A list rather than a hard-coded sequence so a subsystem declares its own
 * residue at composition. The alternative — this file importing the live-sync
 * instance, the Data Plane's plan cache and three provider caches — would make
 * the enterprise root depend on half the app to do one thing.
 */
/**
 * P13C Round 2 — the list moved to `tenancy/workspaceSwitchHub`, which has no
 * dependencies. This root still OWNS the switch — it is the only thing that may
 * decide one happened — and now announces it through the hub, so seven platform
 * subsystems can register a cache flush without importing a module that reaches
 * `app.getPath` and drags Electron into their pure-model tests.
 */
export { onWorkspaceSwitch } from '../tenancy/workspaceSwitchHub';

/**
 * The tenant scope, or null. The shape every scoped store accepts.
 *
 * P13C — A BACKGROUND PRINCIPAL WINS OVER THE SESSION.
 *
 * This function is read by every scoped store in the system, which is exactly
 * why the background fix belongs here rather than in each store: a job that
 * runs under a principal makes all of them correct at once, with no change to
 * any of them.
 *
 * The order matters and is not arbitrary. Inside a job, the session is the
 * WRONG answer — the user may have switched organizations, or signed out,
 * while the job was awaiting a network call. The principal was captured when
 * the job was scheduled and travels with its async execution, so it still
 * describes the tenant the work was started for. Outside a job there is no
 * principal and the session is the only authority, unchanged since P11.
 */
export function activeTenantScope(): TenantScope | null {
  // Precedence lives in `resolveTenantScope` — one opinion, three consumers.
  return resolveTenantScope(() => tenantContext.scope());
}

/**
 * The fan-out's view of the install: every organization, every workspace.
 *
 * DELIBERATELY NOT SCOPED, and that is not a hole. A fan-out asks "who exists?"
 * so it can then run separately AS each of them; answering it through
 * `activeTenantScope` would return the caller's own tenant and reintroduce
 * exactly the single-tenant timer this replaces. Nothing here reads a record —
 * it reads the tenant ROSTER, which is install-level state, and every read that
 * follows happens inside a principal.
 *
 * Kept private to this module. The exported surface is the fan-out itself, so
 * "list every organization" is not a capability any other subsystem acquires.
 */
const fanOutDeps: TenantFanOutDeps = {
  organizations: () => orgStore.listOrganizations(),
  workspaces: () => workspaceStore.list(),
};

/**
 * Run background work once per operable tenant, each under its own principal.
 *
 * THE ENTRY POINT EVERY TENANT-SENSITIVE TIMER USES. One implementation, so the
 * question "does this job run for tenant B?" has the same answer everywhere
 * instead of being re-decided by each scheduler.
 */
export function forEachTenantBackground(
  jobId: string,
  fn: (run: TenantRun) => void | Promise<void>,
  options: FanOutOptions = {},
): Promise<FanOutOutcome[]> {
  return forEachTenant(jobId, fanOutDeps, fn, options);
}

/** The runs a job WOULD perform, without performing them. For tests and probes. */
export function backgroundTenantRuns(jobId: string, options: FanOutOptions = {}): TenantRun[] {
  return tenantRuns(jobId, fanOutDeps, options);
}

/**
 * The memory viewer, or null (P13A). The shape the memory store accepts.
 *
 * Deliberately derived from the SAME `tenantContext.resolveFull()` that
 * produces `activeTenantScope`, rather than from `runtimeIdentity`. The two are
 * not interchangeable: `runtimeIdentity` is a published snapshot of who signed
 * in, updated by lifecycle code, and it answers "who is this device acting as".
 * The resolver answers "does this account currently have the right to act in
 * this workspace", and only the second question is an authorization. Memory
 * reads must be gated on the second, or a suspended member and a member in good
 * standing would read the same memories.
 *
 * `userId` carries through so PERSONAL memory can be enforced; it is null for a
 * service principal, which correctly denies a background job access to any
 * individual's private memories.
 */
export function activeMemoryViewer(): MemoryViewer | null {
  /**
   * P13C — same precedence as `activeTenantScope`, and note what a background
   * principal does NOT get: a `userId`. A job has no human identity, so it
   * cannot read anyone's PERSONAL memories — which is the correct authority for
   * a scheduled task acting on behalf of an organization.
   */
  const p = currentPrincipal();
  if (p !== null) {
    const scope = principalScope();
    return scope === null
      ? null
      : { tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId: null };
  }
  const res = tenantContext.resolveFull();
  if (!res.ok) return null;
  const ctx = res.value.context;
  return { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, userId: ctx.userId };
}

/** The full resolution, for callers that need the reason for a refusal. */
export function resolveTenantContext(): TenantResolution {
  return tenantContext.resolve();
}

export async function initEnterprise(deps: EnterpriseDeps): Promise<EnterpriseSubsystem> {
  /**
   * P13C ROUND 10 — NEW-H6. The organization directory's ownership seam.
   *
   * `activeTenantScope`, not `tenantContext.scope` — the Round 9 lesson, applied
   * where it is load-bearing. The two differ only inside a background job, and
   * the companion gateway and sandbox executor both run this store's mutations
   * under a job principal.
   *
   * BOUND BEFORE `load()`. `load()` seeds on a fresh install, and while the seed
   * writes straight into the Maps rather than through the guarded mutators, a
   * store that is briefly unbound while reachable is the ordering mistake this
   * program keeps finding. Binding first costs nothing and removes the window.
   */
  orgStore.bindScope(activeTenantScope);
  await orgStore.load();
  await workspaceStore.load();
  // P13C Round 5 — bind before load: the seed stamps chains and rules.
  governanceStore
    .bindScope(activeTenantScope)
    // Legacy audit rows only — see `bindOrganizationCount`. Read live, never
    // captured: the count must fall out of scope the moment a second org exists.
    .bindOrganizationCount(() => orgStore.listOrganizations().length);
  healthHistoryStore.bindScope(activeTenantScope);
  /**
   * P13C ROUND 17 · D-5. Bound here, beside the other tenant stores, which runs
   * BELOW the startup gates after Round 17 relocated them. An unbound preference
   * store now refuses the boot rather than answering `unowned-install`.
   */
  tenantAiPreferenceStore.bindScope(activeTenantScope);
  await governanceStore.load();

  /**
   * P13C ROUND 37 — GATE 16. The enterprise crown jewels join the shutdown
   * flush barrier: each uses the coalesced background writer, so a quit that
   * raced `schedulePersist` lost the last edit — an org-chart change, a
   * governance toggle, the tenant AI preference — silently. The module-record
   * stores register once via the registry below (after it exists).
   */
  registerShutdownFlush('org-store', () => orgStore.flush());
  registerShutdownFlush('workspace-store', () => workspaceStore.flush());
  registerShutdownFlush('governance-store', () => governanceStore.flush());
  // (tenantAiPreferenceStore is write-through — setMine awaits persist — so it
  // has nothing pending at quit and registers no flush.)


  // First-claim-wins ownership: the seeded owner ships unclaimed (email:null).
  // The first account to sign in claims it; the SAME account later only refreshes
  // a changed display name; a DIFFERENT account never rebinds it. P13C ROUND 32
  // (O-12): the decision now lives INSIDE `claimOwnerIdentity`, under its own
  // narrow authority, so the claim no longer depends on the caller's resolved
  // tenant — it runs at boot, on every later sign-in, and (critically) while
  // tenant resolution is refusing, which is when the self-heal is needed.
  const bindOwner = (status: AuthStatus): void => {
    if (status.state !== 'authenticated') return;
    const u = status.session.user;
    const claimed = orgStore.claimOwnerIdentity({ name: u.displayName ?? u.email, email: u.email });
    if (claimed) log.info('Seeded owner bound to the signed-in account');
  };
  bindOwner(authService.getStatus());
  authService.on('statusChanged', bindOwner);

  /**
   * Fold the live AI workforce into EVERY tenant's org chart, and keep it in
   * sync.
   *
   * P13C REMEDIATION — FINDING 1. This ran once, against the first-inserted
   * organization, at boot and on every registry change. See `OrgStore.syncWorkers`
   * for the three defects that produced — including a cross-tenant DELETE.
   *
   * The registry is an install-level catalogue with no tenant of its own, so
   * the correct number of syncs is one PER ORGANIZATION, each writing that
   * organization's own member rows. `backgroundTenantRuns` is the same roster
   * the scheduled jobs fan out over, which is what makes a suspended tenant
   * stop receiving worker rows here too, for the same reason and in one place.
   *
   * No tenant resolvable means NO SYNC — not a sync against whichever
   * organization happens to be first.
   */
  /**
   * P13C REMEDIATION — FINDING 4. Bind the org-intelligence scope.
   *
   * `collectOrgHealthInputs` resolved its organization with `defaultOrg()` and
   * feeds a SCHEDULED DELIVERY source, so every tenant was sent an assessment of
   * the first tenant's licence and headcount. Bound to the same resolver
   * everything else reads, which means inside the delivery engine's per-tenant
   * pass it answers for that tenant.
   */
  bindOrgIntelligenceScope(activeTenantScope);

  /**
   * P13C ROUND 3 — H-1 and H-2. Bind the three composed-model caches.
   *
   * All three memoise a snapshot fanned out across dozens of tenant-scoped
   * stores and held in a module-level variable. Process mining was keyed by a
   * record-count signature, which two tenants can trivially match; trust and
   * relationship were keyed by nothing at all and relied on a 2.5s TTL plus a
   * switch listener. None of those is a tenant boundary. Bound to the same
   * resolver every store reads, so the cell now carries an owner.
   */
  bindProcessMiningScope(activeTenantScope);
  bindTrustModelScope(activeTenantScope);
  bindRelationshipModelScope(activeTenantScope);

  const syncWorkers = (): void => {
    const refs = workerRegistry.summaries().map((w) => ({ id: w.id, name: w.name, role: w.role }));
    for (const run of backgroundTenantRuns('org-worker-sync')) {
      orgStore.syncWorkers(run.scope.tenantId, refs, ROLE_TO_UNIT_ID);
    }
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
  /**
   * The organization RBAC is evaluated against. STRICT.
   *
   * Returns a value that matches no organization when the tenant cannot be
   * resolved, so `usersFor` yields an empty list, `resolveActor` finds no
   * member, and the gate refuses with the message it already used for that
   * case. Fail-closed without inventing a new error path.
   */
  /**
   * P13C ROUND 10, FRESH RED TEAM — HIGH. AUTHORITY MUST FOLLOW THE PRINCIPAL,
   * NOT THE SESSION.
   *
   * This read `tenantContext.resolveFull()` — the RAW resolver, which answers
   * from the active workspace and knows nothing about background principals.
   * Every STORE in this subsystem resolves through `activeTenantScope`, which
   * prefers a principal when one is in scope. So inside `runAsPrincipal`:
   *
   *     DATA resolved to the principal's organization.
   *     AUTHORITY resolved to the session's.
   *
   * The companion gateway runs every LAN request under a principal derived from
   * the device's `boundTenantId`, and dispatches `EnterpriseModuleUpdate` and
   * `EnterpriseModuleAction` through it. So a person who is Admin in org A and
   * read-only in org B could, from a B-bound phone while A was on screen,
   * perform a write in B that B had explicitly denied them — B's revocation
   * simply was not the thing being consulted. The refusal-side HOLD and Decision
   * Record were then filed under B while describing A's permission set.
   *
   * THIS IS ROUND 9's H5 ONE LAYER OUT. That finding was a STORE bound to the
   * session-only resolver while its siblings were principal-aware; this is the
   * AUTHORIZATION path with the same defect. The resolver was taught about
   * principals for data and never for permissions, and no invariant asked.
   *
   * `activeTenantScope()` is `resolveTenantScope(() => tenantContext.scope())`,
   * so on the UI path this is the same organization it always was — and inside a
   * job it is the organization the work belongs to. The fail-closed shape is
   * unchanged: no resolvable tenant still yields `UNRESOLVED_TENANT`, which
   * matches no organization, so `usersFor` is empty and the gate refuses.
   */
  const authorizationOrgId = (): string => {
    return activeTenantScope()?.tenantId ?? UNRESOLVED_TENANT;
  };

  /**
   * The platform-operator predicate, LATE BOUND. P13C ROUND 10, fresh red team.
   *
   * `createAuthorize` has accepted an `isPlatformOperator` dep since the platform
   * authority model was built, and `authzGate.ts:188` is the ONLY line that can
   * satisfy a `cloud:operate` permission. NOTHING EVER PASSED IT. The registry
   * was wired into `createPlatformAuthorizer` — a different object — so
   * `deps.isPlatformOperator?.(email)` was `undefined` and every `cloud:operate`
   * channel refused everyone, operators included.
   *
   * That failed CLOSED, which is why ten rounds of isolation testing never saw
   * it: nothing leaked. What it meant is that the ~40 install-wide channels this
   * program has spent four rounds moving onto platform authority had never once
   * been exercised through it — and that `marketplace:install` on
   * `workforce:manage` was, until the line above, the only working door to the
   * install-wide worker registry.
   *
   * Late-bound because `PlatformOperatorRegistry` is constructed after
   * `initEnterprise` in the composition root. Unbound answers false, which is
   * the same fail-closed behaviour as before — this makes the operator path
   * REACHABLE, it does not make it default.
   */
  let isPlatformOperatorFn: (email: string) => boolean = () => false;

  const authorize = createAuthorize({
    sessionEmail,
    isPlatformOperator: (email) => isPlatformOperatorFn(email),
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
    /**
     * P13C ROUND 25 — W-1. The hold above needs an owner, so on an install with
     * no resolvable tenant it throws. That exception used to escape in place of
     * the authorization error and tell the user the app could not record a hold,
     * which is true and useless — the fact they needed was that no organization
     * member is bound to their account.
     *
     * Swallowed at the gate, surfaced HERE, at warn: the refusal still reaches
     * the renderer intact, and the fact that governance recording is degraded is
     * in the log where an engineer reading a support bundle will find it.
     */
    onRefusalRecordFailed: ({ permission, error }) => {
      log.warn('Permission refusal could not be recorded as a hold', {
        permission,
        message: error instanceof Error ? error.message : String(error),
      });
    },
    /**
     * P13C ROUND 26 — W-5. The gate reports WHICH refusal, not a generic one.
     *
     * `resolveFull()` already decided this and its answer was being discarded,
     * so eight distinct conditions reached the renderer as one sentence.
     * Consulted only on the refusal path, so the extra store read costs nothing
     * on a request that succeeds.
     */
    tenantRefusal: () => {
      /**
       * P13C ROUND 31 — W-10. The Round 28 diagnostic that used to live here is
       * gone, and its removal is the point rather than a tidy-up.
       *
       * It re-read `authService.getStatus()`, the org store and the workspace
       * store AFTER `resolveFull()` had already returned — a second sample of
       * four mutable singletons. If any of them changed in between, the log
       * described a state that had not produced the refusal it claimed to
       * explain, and there would have been no way to tell from the output. It
       * also only fired for callers that came through this gate, which the
       * failing caller did not.
       *
       * The resolver now reports from the values it actually used, on every
       * path. This function is back to one job: pass the refusal through.
       */
      const resolved = tenantContext.resolveFull();
      return resolved.ok ? null : resolved.refusal;
    },
    activeOrgId: authorizationOrgId,
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
    const org = activeOrgOrNull();
    if (org === null) return null;
    const member = orgStore
      .usersFor(org.id)
      .find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!member || member.status !== 'active') return null;
    const roleNames = orgStore
      .rolesFor(org.id)
      .filter((r) => member.roleIds.includes(r.id))
      .map((r) => r.name.toLowerCase());
    return {
      userId: member.email ?? member.id,
      roles: roleNames,
      ...(member.unitId ? { department: member.unitId } : {}),
    };
  };

  /**
   * The shared HOLD raiser: open → paired Decision Record → audit, deduped by
   * subject. Every producer in this file goes through it so the hold/record
   * pairing that makes reconstruction work cannot be forgotten at one of them.
   */
  const raiseHold = createHoldRaiser({
    holds: holdStore,
    decisions: decisionRecordStore,
    actor: sessionEmail,
    audit: (action, target, summary) => audit(action, target, summary),
  });

  /**
   * HOLD producer #9: `verification_unavailable`.
   *
   * A document changed and its accounting impact did NOT post — the derivation
   * refused because it could not compute a defensible number. The document is
   * real, the books are not updated, and reporting that as a clean save is how
   * a system loses the right to be believed about any of its saves.
   *
   * Polled after posting attempts rather than pushed, because the refusal is
   * recorded inside the adapter; `seenRefusals` keeps one hold per reference.
   */
  /**
   * P13C ROUND 6 — one hold per refused reference, PER TENANT.
   *
   * A document reference like `INV-1001` is a tenant's own numbering, and two
   * organizations routinely use the same one. So the first tenant whose posting
   * was refused claimed the reference and the second tenant never got the hold
   * saying its accounting impact had not posted — a governance signal about
   * money, silently dropped.
   */
  const seenRefusals = new TenantDedupe('erp-posting-refusals');
  const raiseVerificationHolds = (): void => {
    for (const refusal of documentIntegration.refusedPostings()) {
      if (!seenRefusals.claim(activeTenantScope(), refusal.reference)) continue;
      raiseHold({
        ...verificationUnavailableHold({
          action: `The accounting impact of ${refusal.reference}`,
          expected: 'a balanced journal entry for this document',
          because: refusal.reason,
        }),
        title: `${refusal.reference}: accounting impact not posted`,
        subject: `posting/${refusal.reference}`,
        requestedAction: `Post the accounting impact of ${refusal.reference}`,
        executed: 'The document was saved; its journal entry was not posted.',
      });
    }
  };

  // The ERP document layer becomes reachable here. Everything it exposes —
  // line items, derived totals, the approval policy engine and its SoD rules —
  // shipped registered but with no caller; this is the joint that connects it
  // to the module registry, and through the registry to IPC and the UI.
  approvalStore.bindScope(activeTenantScope);
  await approvalStore.load();
  const documents = createDocumentBridge({
    integration: documentIntegration,
    approvals: approvalStore,
    currentApprover,
  });

  // Enterprise Module Framework: the reusable ERP foundation. Every module
  // registered into this registry inherits RBAC, audit, timeline events,
  // renderer broadcasts, and the generic CRUD IPC surface — nothing per-module.
  // Round 37 — Gate 16: one barrier entry drains all ~106 module stores.
  // (Registered right after construction below via modules.registry.)
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
    assessDelete: (moduleId, record) => {
      /**
       * HOLD producer #7: `insufficient_evidence`.
       *
       * If the dependency assessor is not bound to the real relationship
       * store, it finds no links — which on screen is indistinguishable from
       * "nothing depends on this". Deleting on that basis is a consequential
       * decision made with no evidence, and the honest answer is to say so
       * rather than let the absence read as an all-clear.
       */
      if (!bindingIsLive()) {
        const subject = `${moduleId}/${record.id} (${record.title})`;
        raiseHold({
          ...insufficientEvidenceHold({
            objective: `judge whether deleting "${record.title}" is safe`,
            available: [`The record itself: ${subject}.`],
            missing: [
              'Dependency assessment is not active in this session, so NeuroPause cannot tell whether other records point at this one.',
            ],
            resolution:
              'Restart NeuroPause so dependency assessment binds, then retry. Until then this delete is unassessed, not approved.',
          }),
          title: `Cannot assess deleting "${record.title}"`,
          subject,
          requestedAction: `Delete ${record.title}`,
          executed: 'Nothing — the delete was not assessed, so it was not offered.',
        });
        // Refuse by returning an assessment the framework will gate on: an
        // unassessable delete must not fall through to "no links, go ahead".
        return {
          risk: 'insufficient_evidence',
          recommendation:
            'Dependency assessment is unavailable — NeuroPause cannot confirm that nothing depends on this record.',
          evidence: [
            {
              label: 'Assessment',
              detail: 'The relationship reader is not bound in this session.',
              count: null,
            },
          ],
          alternative: 'Archive this record instead; archiving breaks nothing either way.',
        };
      }
      return assessDeleteAgainstLinks(record.title, incomingLinksFor(record.id));
    },
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
    /**
     * HOLD producer #8: `policy_conflict`.
     *
     * A rule no authority overrides — posting into a closed accounting period
     * is the live case. Unlike a permission, the fix is to change the world
     * (reopen the period, move the date), not the actor.
     */
    /**
     * Every module change is a chance for a posting derivation to have
     * refused. Checked here rather than inside the adapter so the adapter
     * stays Electron-free and unaware of the hold subsystem.
     */
    onAfterChange: (changed) => {
      raiseVerificationHolds();
      // Program 6: resolve this record's declared references NOW.
      //
      // Until this existed, `resolveRecords` was called from exactly one place
      // — the Data Plane import — so a record typed into the app had no links,
      // ever, and its Related Records panel said "nothing links to this
      // record". Fire-and-forget and error-swallowing on purpose: a
      // relationship that fails to resolve must never fail the save that
      // produced it, and an unresolved reference simply parks for review.
      if (changed) void resolveReferencesFor(changed.moduleId, changed.record);
    },
    onPolicyConflict: ({ moduleId, record, action, policy }) => {
      const subject = `${moduleId}/${record.id}/${action}`;
      raiseHold({
        ...policyConflictHold({
          action: `${action} on ${record.title}`,
          policy: policy.name,
          facts: policy.facts,
          resolution: policy.resolution,
        }),
        title: `${record.title}: blocked by ${policy.name}`,
        subject,
        requestedAction: `${action} ${record.title}`,
        executed: 'Nothing — the action conflicts with a policy.',
        risk: 'questionable',
      });
    },
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
  /**
   * P11 — the tenant boundary, bound once for all 106 module stores.
   *
   * `bindScope` on the registry hands the same source to every store that
   * registers, and re-binds any that registered earlier. Before the modules are
   * added, so no store is ever briefly unbound while reachable — and an unbound
   * store denies anyway, so the ordering mistake would be loud.
   */
  /**
   * P13C ROUND 9 — FRESH RED TEAM, HIGH. THE BOUNDARY WAS BOUND TO THE WRONG
   * RESOLVER, WHICH IS WHY EVERY "IS IT BOUND?" INVARIANT PASSED.
   *
   * This read `() => tenantContext.scope()`. That resolver answers from the
   * ACTIVE WORKSPACE only — it is not principal-aware. `activeTenantScope`,
   * defined in this same file and used by every other store here
   * (`healthHistoryStore`, `approvalStore`, and the rest), routes through
   * `resolveTenantScope`, which prefers a background principal when one is in
   * scope. One line out of step, covering the largest data surface in the
   * product: all 106 ERP, CRM, HR and finance module stores.
   *
   * WHAT IT COST, both reachable and both cross-tenant WRITES:
   *
   *   COMPANION GATEWAY — `gatewayServer` listens on the LAN and wraps every
   *   operation in `runAsPrincipal` for the tenant the phone was PAIRED to,
   *   with a comment stating that this exists precisely so a phone paired to A
   *   cannot act in B after the desktop user switches. That principal never
   *   reached these stores, so `approvals.act` from A's phone mutated B's
   *   records.
   *
   *   SANDBOX EXECUTION — `executionEngine` runs each scenario under its owning
   *   tenant's principal and its comment claims "every scoped store it reaches
   *   answers for that tenant without any of them changing". These 106 did not.
   *
   * `scopeOrDeny()` fails closed on the ABSENCE of a scope and never on the
   * WRONG one, and `assertEveryModuleScoped` below asserts that a boundary
   * EXISTS, not that it is the right boundary. A store handed a session
   * resolver answers it faithfully. That is the lesson: an invariant that
   * checks for a seam cannot check what the seam is attached to.
   */
  modules.registry.bindScope(activeTenantScope);
  registerShutdownFlush('enterprise-module-stores', () => modules.registry.flushAll());

  const registerModule = (m: EnterpriseModule): void => {
    modules.registry.register(documentIntegration.attach(m));
  };

  /**
   * BOOT INVARIANT: every module store has a tenant boundary.
   *
   * Checked after all 106 register, in the same spirit as
   * `assertAllChannelsClassified`. An unbound store denies rather than leaking,
   * so this cannot be a security hole — but it WOULD be a module that silently
   * shows nothing, which is a bug a user reports as "my data is gone". Logged as
   * an error so it is visible in the log rather than discovered from a support
   * ticket.
   */
  const assertEveryModuleScoped = (): void => {
    const unscoped = modules.registry.unscopedModules();
    if (unscoped.length > 0) {
      /**
       * P12 — THROWS, where P11 only logged.
       *
       * `assertAllChannelsClassified` throws for the same reason: a boot
       * invariant that logs is an invariant that ships. An unbound store denies
       * rather than leaking, so this is not a security hole — it is a module that
       * silently shows nothing, which a user reports as "my data is gone" and
       * nobody connects to a log line from three releases ago.
       */
      log.error('Enterprise modules have no tenant boundary and will return nothing', {
        count: unscoped.length,
        modules: unscoped.slice(0, 20),
      });
      throw new Error(
        `${unscoped.length} enterprise module(s) have no tenant boundary: ${unscoped.slice(0, 5).join(', ')}`,
      );
    }
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
  assertEveryModuleScoped();

  /**
   * P11 — report the migration state at boot.
   *
   * The inventory's own header claims it is code rather than a document so the
   * answer is produced by the objects that enforce the boundary. That was only
   * true once something called it — before this it had zero callers, which made
   * the claim exactly the kind of assertion it was written to replace.
   *
   * Logged rather than surfaced on a screen: it is an operator artefact, and the
   * counts are the honest headline for "how far did P11 actually get".
   */
  void buildMigrationInventory({ registry: modules.registry, now: () => new Date().toISOString() })
    .then((inventory) => {
      log.info('Tenant migration inventory', {
        ...summarizeInventory(inventory),
        records: inventory.totals.records,
        assigned: inventory.totals.assigned,
        unresolved: inventory.totals.unresolved,
      });
    })
    .catch((err: unknown) => {
      log.warn('Could not build the tenant migration inventory', {
        err: err instanceof Error ? err.message : String(err),
      });
    });

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
    auditEntries: (limit) => governanceStore.auditEntries(limit, tenantContext.scope()),
  });

  /* ── Opportunity Center (Program 4) ──────────────────────────────────────
   *
   * Composed here rather than in `runtimeCore` because everything it needs is
   * already in scope and correctly wired: the purchase-order store it reads,
   * the RFQ module it writes, the RBAC gate, the shared HOLD raiser, and the
   * one action context that makes a cross-module write audited and broadcast
   * exactly like a hand-entered one. Reaching for any of those from the
   * runtime root would mean a second path to them.
   */
  const permissions = createPermissionProbe({
    sessionEmail,
    activeOrgId: authorizationOrgId,
    usersFor: (orgId) => orgStore.usersFor(orgId),
    rolesFor: (orgId) => orgStore.rolesFor(orgId),
    ownerMember: () => orgStore.user(OWNER_USER_ID),
  });
  await Promise.all([opportunityDecisionStore.load(), outcomeRevisionStore.load()]);
  const opportunities = initOpportunities({
    orders: () => purchaseOrdersAsObservations(purchaseOrderModule.store),
    readCeiling: MAX_ORDERS,
    decisions: opportunityDecisionStore,
    raiseHold,
    decisionRecords: decisionRecordStore,
    canExecute: () => permissions.allows('procurement:manage'),
    heldPermissions: () => permissions.held(),
    actorLabel: () => permissions.label(),
    actor: sessionEmail,
    rfqModuleAvailable: () => modules.registry.get(rfqModule.descriptor.id) !== null,
    openRfqFor: (product) => findOpenRfq(rfqModule.store, product),
    createRfq: async (input) => {
      // The SECOND gate. The handler already refused a caller without
      // `procurement:manage` with an explainable hold; this is the same check
      // the module's own CRUD path applies, kept so the write cannot become
      // reachable by any route that skips the first one.
      authorize('procurement:manage');
      const { title, fields } = rfqFieldsFor(rfqModule.store, input);
      const created = rfqModule.store.create({
        title,
        fields,
        actor: sessionEmail(),
        now: new Date().toISOString(),
      });
      // Full lifecycle fan-out: audit, timeline, renderer broadcast, and the
      // module's own onChange — identical to a person typing it in.
      modules.actionContext.emit(rfqModule, 'created', created);
      await rfqModule.store.flush();
      return { recordId: created.id, label: title };
    },
    readRfq: (recordId) => {
      const record = rfqModule.store.get(recordId);
      return record
        ? { recordId: record.id, label: String(record.fields.rfqNumber ?? record.title) }
        : null;
    },
    executionFor: (recordId) => rfqAsExecution(rfqModule.store, recordId),
    outcomeRevisions: outcomeRevisionStore,
    audit: (action, target, summary) => audit(action, target, summary),
    now: () => new Date().toISOString(),
  });

  /**
   * Resolve one record's declared references, and let anything parked waiting
   * for it try again.
   *
   * Two halves, because a link has two ends. Creating an invoice that names
   * "Acme Ltd" needs its OWN references resolved; creating the customer "Acme
   * Ltd" needs the invoices that parked waiting for it to be retried. Without
   * the second half, import-order independence — the property the parking
   * queue exists for — would hold for imports and not for anything typed in.
   *
   * The retry is coalesced behind a short timer: a bulk conversion can fan out
   * dozens of changes in a tick, and re-running the whole pending queue for
   * each of them would be quadratic.
   */
  /**
   * P13C ROUND 24 — O-9. THE CALL SITE ROUND 10 MISSED.
   *
   * This was ONE shared `retryTimer`, cleared and re-armed on every save on the
   * install, with `engine.retryPending(null)` inside the callback. Both halves
   * of that are the NEW-M10 defect `graph/index.ts` and `memory/index.ts` were
   * fixed for, in a file that was never re-read against them:
   *
   *   1. WHOSE QUEUE RUNS WAS DECIDED AT FIRE TIME. `retryPending` reaches
   *      `RelationshipStore.retryable()`, which filters through `onlyMine` —
   *      i.e. through `activeTenantScope()` as it reads 400 ms LATER. A save by
   *      A followed by a workspace switch ran A's retry pass over B's parked
   *      references, and A's own parked references were never retried at all.
   *      Nothing crosses: the store is owner-scoped on both the read and the
   *      write, so this is the quiet failure — work that silently does not
   *      happen — and not a disclosure.
   *
   *   2. ONE TENANT'S SAVE CANCELLED ANOTHER'S PENDING RETRY. `clearTimeout`
   *      then re-arm means a second save always destroys the first save's
   *      scheduled pass. Under sustained activity — a bulk conversion, an
   *      import, two people working — the 400 ms window never elapses and the
   *      parking queue is not drained by this path at all.
   *
   * The fix is the shape Round 10 established and is deliberately not a new
   * one: capture the principal at ENQUEUE, key the pending set by owner so a
   * debounce coalesces WITHIN a tenant and never ACROSS one, and never re-arm
   * an armed timer. An unresolvable tenant is dropped rather than run as
   * whoever is on screen.
   */
  const pendingReferenceRetries = new Map<string, BackgroundPrincipal>();
  let retryTimer: NodeJS.Timeout | null = null;
  const drainReferenceRetries = (): void => {
    const engine = relationshipEngineRef();
    const owners = [...pendingReferenceRetries.values()];
    pendingReferenceRetries.clear();
    if (!engine) return;
    for (const principal of owners) {
      void runAsPrincipal(principal, () => engine.retryPending(null)).catch(() => undefined);
    }
  };
  const resolveReferencesFor = async (
    moduleId: string,
    record: EnterpriseEntity,
  ): Promise<void> => {
    const engine = relationshipEngineRef();
    if (!engine) return; // Data Plane not up yet; the next import pass covers it.
    try {
      await engine.resolveRecords(moduleId, [record], null);
    } catch {
      // A failed resolution must never fail the save that produced it.
    }
    // Resolved HERE, in the saving caller's own context, which is the only
    // moment at which the answer is knowable.
    const principal = tenantPrincipal({ jobId: REFERENCE_RETRY_JOB_ID, scope: activeTenantScope() });
    if (principal === null) return;
    const key = `${principal.tenantId}::${principal.workspaceId ?? ''}`;
    if (!pendingReferenceRetries.has(key)) pendingReferenceRetries.set(key, principal);
    if (retryTimer) return; // armed already — re-arming is how a busy tenant starves everyone
    retryTimer = setTimeout(() => {
      retryTimer = null;
      drainReferenceRetries();
    }, 400);
  };

  /* ── Cross-domain related records (Program 6) ────────────────────────────
   *
   * Composed here because this is where the two halves already meet: the
   * module registry (which record stores exist, and the scope each needs) and
   * the permission probe. The traversal itself reuses the Data Plane
   * relationship store — the only one of the repo's four relationship systems
   * keyed on real record ids — through a late-bound reader, because the Data
   * Plane initializes after this subsystem.
   */
  const relatedRecordsHandler: SecureHandlerDef = {
    channel: IpcChannel.CrossDomainRelated,
    schema: CrossDomainRelatedRequest,
    // Stamped explicitly because this def is appended raw rather than passed
    // through `withEnterpriseAuthz` (it authorizes dynamically, from the
    // payload). Without it the bridge's auth gate never runs for this channel.
    requireAuth: true,
    handler: async (p): Promise<RelatedRecordsView> => {
      const req = p as CrossDomainRelatedRequest;
      const store = relationshipStoreRef();
      if (!store) {
        // The Data Plane has not initialized. An empty result would read as
        // "nothing is connected", so the honest answer is an empty view whose
        // root is null — the UI says the link engine is not running.
        return {
          root: null,
          groups: [],
          total: 0,
          depth: 0,
          hiddenByPermission: false,
          brokenLinks: 0,
          truncated: false,
        };
      }
      // The root's own scope, enforced by THROWING before anything is walked.
      // Asking for the neighbourhood of a record you cannot read is a refusal,
      // not an empty list — and checking it first means the traversal never
      // touches a store on behalf of someone who should not have got here.
      //
      // An UNKNOWN module throws too. `moduleId` is caller-supplied, so making
      // the check conditional on the module resolving would let anyone skip
      // authorization entirely by naming a module that does not exist.
      const rootModule = modules.registry.get(req.moduleId);
      if (!rootModule) throw new Error(`No module "${req.moduleId}" is registered.`);
      authorize(rootModule.descriptor.permissions.read);

      const view = await buildRelatedRecords(
        {
          relationships: store,
          storeFor: (moduleId) => modules.registry.get(moduleId)?.store ?? null,
          describe: (moduleId) => {
            const descriptor = modules.registry.get(moduleId)?.descriptor;
            return descriptor
              ? { plural: descriptor.plural, read: descriptor.permissions.read }
              : null;
          },
          allows: (permission) => permissions.allows(permission),
        },
        {
          recordId: req.recordId,
          moduleId: req.moduleId,
          ...(req.depth === undefined ? {} : { depth: req.depth }),
        },
      );
      return view;
    },
  };

  /**
   * Annotated, not inferred.
   *
   * Left to infer, TypeScript widens this into a union of every concrete
   * handler shape across five arrays, and the compiler gives up with
   * "expression produces a union type that is too complex to represent" once
   * enough channels exist. The annotation collapses it to the one type these
   * all satisfy — no behaviour change, and the check stays real because each
   * source array is itself typed.
   */
  const handlers: SecureHandlerDef[] = [
    ...withEnterpriseAuthz(buildHandlers()),
    ...modules.handlers,
    ...medicalDeviceHandlers,
    ...opportunities.handlers,
    relatedRecordsHandler,
  ];

  return {
    handlers,
    /**
     * A PURE permission check, alongside the throwing `authorize`.
     *
     * A machine-triggered path (a scheduled connector sync) must be able to
     * ask "may this be written?" without the side effects `authorize` has on
     * refusal — it opens a HOLD and writes a Decision Record, which is right
     * for a person's request and wrong every fifteen minutes for a background
     * one.
     */
    allows: (permission: EnterprisePermission) => permissions.allows(permission),
    authorize,
    /**
     * Bind the platform-operator predicate. P13C ROUND 10, fresh red team.
     *
     * Called by the composition root once `PlatformOperatorRegistry` has loaded.
     * Until then — and if a future refactor forgets the call — the predicate
     * answers false and every `cloud:operate` channel refuses, which is the
     * behaviour that shipped for four rounds and is fail-closed. This makes the
     * operator path REACHABLE; it grants nothing by default.
     */
    bindPlatformOperator: (isOperator: (email: string) => boolean): void => {
      isPlatformOperatorFn = isOperator;
    },
    modules: modules.registry,
    complianceFindings: () => evaluateCompliance(governanceStore.rules(), buildComplianceInput()),
    notifyImported: modules.notifyImported,
  };
}

/* ── shared helpers ── */

/**
 * The organization behind the active workspace, for DISPLAY.
 *
 * The `?? defaultOrg()` fallback is retained here and ONLY here, deliberately,
 * because every caller below it renders a name, a member count or an org-chart
 * panel — and a screen that renders nothing at boot because the stores are half
 * a millisecond from ready is a worse product than one that shows the default
 * organization's name.
 *
 * It is NOT an authorization input any more. That was the bug: `activeOrgId` was
 * wired from this function into `createAuthorize`, so any `organizationId` at
 * all resolved to a real org, which is why `Workspace.organizationId` could
 * never deny anything and why a renderer that could set it chose the domain its
 * own RBAC was evaluated in. Authorization now goes through
 * `authorizationOrgId()` below, which has no fallback.
 */
/**
 * The organization this call is acting in, or NULL.
 *
 * P13C REMEDIATION — FINDING 2. This used to be:
 *
 *   const ws = workspaceStore.active();
 *   return orgStore.organization(ws.organizationId) ?? orgStore.defaultOrg();
 *
 * and it was documented as display-only, which it had stopped being. Both
 * halves were unsafe. `workspaceStore.active()` falls back to the first
 * workspace on the install, and `?? orgStore.defaultOrg()` falls back to the
 * first organization — so a caller with no resolvable tenant silently got a
 * real organization, and one that was somebody's.
 *
 * That mattered because `activeOrg()` reached WRITES: it was stamped as `orgId`
 * on unit, user and role creation, so a create with no resolved tenant landed
 * in the seeded organization. It also fed `orgBundle()`, whose response
 * includes that organization's USERS.
 *
 * Now resolved through `activeTenantScope()` — the one resolver, which prefers
 * a BackgroundPrincipal and falls back to the session. Two consequences worth
 * naming: a background job resolves the tenant it is running FOR rather than
 * the one on screen, and an unresolved caller gets null rather than a stranger.
 *
 * Returning null instead of throwing keeps the choice at the call site: a READ
 * degrades to empty, a WRITE refuses. Those are different behaviours and a
 * single throwing accessor could not express both.
 */
function activeOrgOrNull(): Organization | null {
  const scope = activeTenantScope();
  if (scope === null) return null;
  return orgStore.organization(scope.tenantId);
}

/**
 * The organization this call is acting in. Throws when none resolves.
 *
 * For WRITE paths and for reads whose response shape has no empty form. The
 * secure bridge surfaces a thrown message to the renderer, so a refusal reaches
 * the user as a refusal rather than as a confusingly empty screen.
 */
function requireActiveOrg(): Organization {
  const org = activeOrgOrNull();
  if (org === null) {
    throw new Error('No organization is active, so this action has no owner.');
  }
  return org;
}

function orgBundle(): {
  organization: Organization;
  units: ReturnType<typeof orgStore.unitsFor>;
  roles: ReturnType<typeof orgStore.rolesFor>;
  users: ReturnType<typeof orgStore.usersFor>;
} {
  const org = requireActiveOrg();
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
    workspaceId: workspaceStore.activeWorkspaceIdForDisplay(),
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
  const org = requireActiveOrg();
  return buildOrgGraph({
    org,
    units: orgStore.unitsFor(org.id),
    users: orgStore.usersFor(org.id),
    entities: mapEntities(),
    connectors: connectorRefs(),
  });
}

function buildComplianceInput(): ComplianceInput {
  const org = requireActiveOrg();
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
    auditCount: auditLog.size() + governanceStore.auditCount(tenantContext.scope()),
    jobsRun: jobStore.size(),
    approvalChains: governanceStore.chains(),
  };
}

function governanceConfig(): GovernanceConfig {
  const org = requireActiveOrg();
  return {
    roles: orgStore.rolesFor(org.id),
    approvalChains: governanceStore.chains(),
    complianceRules: governanceStore.rules(),
  };
}

/**
 * The live directory deps. Every input server-side; nothing reads a payload.
 *
 * P13C Part 3 — the decisions themselves live in `org/tenantDirectory`, so who
 * may see whom can be read and tested end-to-end rather than inlined among two
 * hundred handlers. See that file for what was disclosed before it existed.
 */
const directoryDeps: TenantDirectoryDeps = {
  sessionEmail: () => {
    const st = authService.getStatus();
    return st.state === 'authenticated' ? st.session.user.email : null;
  },
  organizations: () => orgStore.listOrganizations(),
  workspaces: () => workspaceStore.list(),
  usersFor: (orgId) => orgStore.usersFor(orgId),
  rolesFor: (orgId) => orgStore.rolesFor(orgId),
  ownerMember: () => orgStore.user(OWNER_USER_ID),
  activeOrganizationId: () => {
    // From the RESOLVER, so "the organization the switcher highlights" and "the
    // organization every read is scoped to" are the same fact. A UI that
    // highlights an organization the resolver refuses shows an empty screen and
    // no reason.
    const resolved = tenantContext.resolveFull();
    return resolved.ok ? resolved.value.organization.id : null;
  },
  activeWorkspaceId: () => workspaceStore.activeWorkspaceIdOrNull(),
  unitCountFor: (orgId) => orgStore.unitsFor(orgId).length,
};

function workspaceSummaries(): WorkspaceSummary[] {
  return visibleWorkspaces(directoryDeps);
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
  const org = requireActiveOrg();
  const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
  const tl = getEnterpriseTimeline();
  const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
  const briefing = generateBriefing('morning', { entities, events, now });
  const recommendations = generateRecommendations({ entities, events, now });
  const rules = governanceStore.rules();
  const stats = connectorService.stats();
  return computeExecutiveSnapshot({
    workspaceId: workspaceStore.activeWorkspaceIdForDisplay(),
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
      auditEntries: auditLog.size() + governanceStore.auditCount(tenantContext.scope()),
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
          orgId: requireActiveOrg().id,
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
          orgId: requireActiveOrg().id,
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
          orgId: requireActiveOrg().id,
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
      /**
       * P13C N9 — REFUSE rather than substitute.
       *
       * `active()` now returns null when the active id misses, where it used to
       * return the first workspace on the install — a foreign tenant's name and
       * organizationId, over a channel with no permission. The response
       * contract is a `Workspace`, so a refusal is thrown; the secure bridge
       * surfaces the message, and the renderer shows an error instead of
       * silently displaying somebody else's workspace.
       */
      handler: () => {
        const ws = workspaceStore.active();
        if (ws === null) throw new Error('No workspace is active.');
        return ws;
      },
    },
    {
      channel: IpcChannel.EnterpriseWorkspaceCreate,
      schema: EnterpriseWorkspaceCreateRequest,
      audit: true,
      handler: (p) => {
        const r = p as TWsCreate;
        /**
         * P11 — THE TENANT COMES FROM THE SESSION, NOT THE PAYLOAD.
         *
         * `EnterpriseWorkspaceCreateRequest` still accepts `organizationId`
         * (removing it from the contract would break older renderers), but it is
         * now used ONLY as an assertion the server checks, never as authority.
         *
         * What it used to be: `r.organizationId ?? activeOrg().id`, passed
         * through unvalidated. Because the active workspace's org is what RBAC
         * resolves against, a renderer holding `workspace:manage` could name any
         * organization — real or invented — and select the authorization domain
         * its own permissions were evaluated in. An unknown value silently
         * became the default org, which re-pointed every subsequent audit stamp
         * and credential lookup.
         */
        const resolved = tenantContext.resolveFull();
        // Thrown, not returned: this channel's response type is the workspace
        // list, and the secure bridge already surfaces a thrown message to the
        // renderer. Returning a shape the contract does not describe would be a
        // second error convention on one surface.
        if (!resolved.ok) throw new Error(resolved.refusal.message);
        const tenantId = resolved.value.organization.id;
        if (r.organizationId !== undefined && r.organizationId !== tenantId) {
          // Named a different tenant. Refused without confirming whether it
          // exists — a distinct "no such organization" would be a probe.
          throw new Error(
            'A workspace can only be created in the organization you are signed in to.',
          );
        }
        const ws = workspaceStore.create(r.name, tenantId);
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
        /**
         * P11 — MEMBERSHIP IS CHECKED BEFORE THE SWITCH.
         *
         * `workspaceStore.switch` checks existence in a local Map and nothing
         * else, so before this a caller could switch into any workspace on disk
         * — including one belonging to an organization they are not a member of
         * — and every subsequent read would resolve against that tenant.
         *
         * Verified server-side, against the same resolver everything else uses,
         * so there is one answer to "may I be here" rather than two.
         */
        const target = workspaceStore.get(r.id);
        if (target === null) throw new Error('That workspace does not exist.');
        const decision = tenantContext.canSwitchTo(target);
        if (!decision.ok) {
          audit('workspace.switch.refused', r.id, `Refused: ${decision.refusal.reason}`);
          throw new Error(decision.refusal.message);
        }
        const ws = workspaceStore.switch(r.id);
        if (ws) {
          /**
           * P11 — DROP WHAT THE PREVIOUS TENANT LEFT BEHIND.
           *
           * The store reads its scope on every call, so records re-scope for
           * free. Three things do not, and each is a real residue:
           *
           *  · The live-sync push loop holds the org it was last pointed at in
           *    module state. Left alone it keeps pushing to the workspace you
           *    just left, every sixty seconds, with no actor and no permission.
           *  · The import plan cache is keyed by plan id with no owner and
           *    survives the switch — so a file analyzed in one workspace can be
           *    executed in the next, and the rows land under the NEW scope.
           *  · The keyless TTL model caches serve whoever asks within ~2.5s.
           *
           * Announced through the existing subscriber seam rather than reached
           * into directly, so a subsystem that needs to forget something
           * registers here instead of this function growing an import per
           * subsystem.
           */
          announceWorkspaceSwitch(ws.id);
          audit('workspace.switch', ws.id, `Switched to workspace "${ws.name}"`);
        }
        const active = workspaceStore.active();
        if (active === null) throw new Error('No workspace is active.');
        return active;
      },
    },

    /* ── P13C Part 3: multi-organization ──────────────────────────────── */
    {
      channel: IpcChannel.EnterpriseOrganizationList,
      schema: EmptyRequest,
      handler: () => visibleOrganizations(directoryDeps),
    },
    {
      channel: IpcChannel.EnterpriseOrganizationCreate,
      schema: EnterpriseOrganizationCreateRequest,
      audit: true,
      handler: (p) => {
        const r = p as TOrgCreate;
        /**
         * THE OWNER IS THE SESSION, and the session is read server-side.
         *
         * Not `resolveFull()` — that resolves the CURRENT tenant, and a person
         * creating their second organization is by definition not yet a member
         * of it. What is required is only that somebody is signed in, because
         * that identity becomes the new tenant's owner. Requiring current-tenant
         * membership would make the first organization a permanent gate on
         * creating any other, and requiring nothing would let an anonymous
         * caller mint a tenant nobody can enter.
         */
        const status = authService.getStatus();
        const email = status.state === 'authenticated' ? status.session.user.email : null;
        if (email === null || email.trim() === '') {
          throw new Error('Sign in before creating an organization.');
        }

        const result = provisionOrganization(
          {
            createOrganization: (name, description) =>
              orgStore.createOrganization(name, description),
            createRole: (input) => orgStore.createRole(input),
            createUser: (input) => orgStore.createUser(input),
            createWorkspace: (name, organizationId) => workspaceStore.create(name, organizationId),
          },
          {
            name: r.name,
            description: r.description,
            workspaceName: r.workspaceName,
            ownerEmail: email,
            ...(status.state === 'authenticated' && status.session.user.displayName
              ? { ownerName: status.session.user.displayName }
              : {}),
          },
        );

        /**
         * Audited against the NEW organization, naming its workspace and owner.
         *
         * The audit log is scoped, so this entry belongs to the tenant that was
         * created — the only tenant it describes. Writing it against the
         * creator's PREVIOUS organization would put a record of one customer's
         * existence into another customer's log.
         */
        audit(
          'organization.create',
          result.organization.id,
          `Created organization "${result.organization.name}" with workspace "${result.workspace.name}"`,
        );
        log.info('Organization provisioned', {
          organizationId: result.organization.id,
          workspaceId: result.workspace.id,
          roles: result.roles.length,
        });
        return visibleOrganizations(directoryDeps);
      },
    },
    {
      channel: IpcChannel.EnterpriseOrganizationSwitch,
      schema: EnterpriseOrganizationSwitchRequest,
      audit: true,
      handler: (p) => {
        const r = p as TOrgSwitch;
        /**
         * SWITCHING ORGANIZATION IS SWITCHING WORKSPACE, deliberately.
         *
         * There is no separate "active organization" anywhere in this system —
         * `tenantContext` derives the tenant FROM the active workspace, and that
         * single derivation is why a renderer cannot name its own tenant. Adding
         * an independent org pointer would create a second authorization path
         * that could disagree with the first, and the disagreement would be
         * invisible: the UI would show one organization while every read
         * resolved another.
         *
         * So this resolves an entry workspace inside the target organization and
         * commits through the SAME `canSwitchTo` chain the workspace switch
         * uses. One gate, two entry points.
         */
        const entry = firstEnterableWorkspace(directoryDeps, r.id);
        if (entry === null) {
          /**
           * One message for "no such organization", "not a member", "suspended"
           * and "no workspace you may enter". Distinguishing them would confirm
           * which organizations exist — the enumeration this channel is meant to
           * withhold — and the caller's remedy is identical in every case.
           */
          audit('organization.switch.refused', r.id, 'Refused');
          throw new Error('That organization is not available to you.');
        }
        const decision = tenantContext.canSwitchTo(entry);
        if (!decision.ok) {
          audit('organization.switch.refused', r.id, `Refused: ${decision.refusal.reason}`);
          throw new Error('That organization is not available to you.');
        }
        const ws = workspaceStore.switch(entry.id);
        if (ws) {
          // The same residue listeners a workspace switch fires. An organization
          // switch is a strictly larger change, so skipping them would leave the
          // previous TENANT's caches live — see the workspace-switch note.
          announceWorkspaceSwitch(ws.id);
          audit('organization.switch', r.id, `Switched to organization "${r.id}"`);
        }
        return visibleOrganizations(directoryDeps);
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
      // P12 — the caller's own scope. `activeTenantScope()` returns null when
      // no tenant resolves, and a null scope reads nothing.
      handler: (p) => governanceStore.auditEntries((p as TAudit).limit ?? 100, tenantContext.scope()),
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
