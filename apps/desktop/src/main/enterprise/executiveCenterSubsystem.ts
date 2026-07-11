/**
 * Executive Intelligence Center — subsystem wiring.
 *
 * Connects the pure composer to the REAL existing producers and exposes one IPC
 * handler the renderer calls. No new intelligence; it calls V2.2/V2.3 build
 * functions and the V2.3 health model.
 */
import { EmptyRequest, IpcChannel, type ExecutiveCenterSnapshot } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { buildFounderProactiveItems } from '../ai/founderProactive';
import { buildOrgIntelligenceItems, collectOrgHealthInputs } from './orgIntelligence';
import { composeExecutiveSnapshot, type TimelineEntryLite } from './executiveCenter';
import { getEnterpriseTimeline } from '../timeline';
import { healthHistoryStore } from './healthHistoryInstance';
import { decisionStore } from './decisionInstance';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { summarizeWorkforceHealth } from './workforceHealth';
import { workforceIntelligence } from '../workforce/intelligence/workforceIntelligence';
import { knowledgeHealth } from '../knowledge/knowledgeHealth';
import { enterpriseRecommendations } from './intelligence/enterpriseRecommendations';
import { memoryStore } from '../memory/memoryInstance';
import { jobStore } from '../workforce/runtime/jobInstance';
import {
  buildUnifiedTimeline,
  deriveCrmInsights,
  deriveCustomerInsights,
  deriveInventoryInsights,
  deriveInvoiceInsights,
  deriveLeadInsights,
  deriveOrderInsights,
  derivePaymentInsights,
  deriveProcurementInsights,
  deriveQuoteInsights,
  deriveWarehouseInsights,
  deriveManufacturingInsights,
  deriveMaintenanceInsights,
  deriveFulfillmentInsights,
  derivePlanningInsights,
  planningRecommendations,
  deriveMrpInsights,
  mrpRecommendations,
  deriveTimePhasedInsights,
  timePhasedRecommendations,
  computeCapacitySchedule,
  deriveCapacityInsights,
  capacityRecommendations,
  computeRoutingSchedule,
  deriveRoutingInsights,
  routingRecommendations,
  deriveMesInsights,
  mesSupplementalKpis,
  mesRecommendations,
  mesExecutionFromRecord,
  deriveEventInsights,
  eventRecommendations,
  manufacturingEventFromRecord,
  assessDigitalTwin,
  assessDecisionEngine,
  deriveApprovalInsights,
  executiveDecisionFromRecord,
  deriveHandoffInsights,
  executionProposalFromRecord,
  deriveProcessExplorerKpis,
  deriveSchedulingInsights,
  schedulingInsightsToKpis,
  contactFromRecord,
  customerFromRecord,
  goodsReceiptFromRecord,
  invoiceFromRecord,
  leadFromRecord,
  orderFromRecord,
  paymentFromRecord,
  productFromRecord,
  purchaseOrderFromRecord,
  quoteFromRecord,
  supplierFromRecord,
  warehouseFromRecord,
  binFromRecord,
  transferOrderFromRecord,
  pickListFromRecord,
  packingFromRecord,
  shippingFromRecord,
  cycleCountFromRecord,
  stockAdjustmentFromRecord,
  productionOrderFromRecord,
  machineFromRecord,
  workCenterFromRecord,
  qualityInspectionFromRecord,
  productionCostingFromRecord,
  assetFromRecord,
  workOrderFromRecord,
  preventiveMaintenanceFromRecord,
  downtimeEventFromRecord,
  technicianFromRecord,
  type UnifiedItemLite,
} from '@neuropause/shared';
import { contactModule } from './modules/crm/contactModuleInstance';
import { leadModule } from './modules/crm/leadModuleInstance';
import { customerModule } from './modules/crm/customerModuleInstance';
import { quoteModule } from './modules/sales/quoteModuleInstance';
import { orderModule } from './modules/sales/orderModuleInstance';
import { invoiceModule } from './modules/finance/invoiceModuleInstance';
import { paymentModule } from './modules/finance/paymentModuleInstance';
import { productModule } from './modules/inventory/productModuleInstance';
import { warehouseModule } from './modules/inventory/warehouseModuleInstance';
import {
  supplierModule,
  purchaseOrderModule,
  goodsReceiptModule,
} from './modules/procurement/procurementInstances';
import {
  binModule,
  transferOrderModule,
  pickListModule,
  packingModule,
  shippingModule,
  cycleCountModule,
  stockAdjustmentModule,
} from './modules/warehouse/warehouseInstances';
import {
  productionOrderModule,
  machineModule,
  workCenterModule,
  qualityModule,
  costingModule,
  executionModule,
  manufacturingEventModule,
} from './modules/manufacturing/manufacturingInstances';
import {
  assetModule,
  workOrderModule,
  preventiveMaintenanceModule,
  downtimeEventModule,
  technicianModule,
} from './modules/maintenance/maintenanceInstances';
import { buildExecutiveRecommendations, buildExecutiveSummary } from './executiveRecommendations';
import { collectPlanningModel } from './planningModel';
import { getRelationshipKpis } from './relationshipProvider';
import { getTrustKpis } from './trustProvider';
import { getAutomationMonitor } from './automationSubsystem';
import { graphStore } from '../graph/graphInstance';
import { executiveDecisionModule } from './modules/executive/executiveDecisionInstance';
import { executionProposalModule } from './modules/executive/executionProposalInstance';
import { getProcessAssessment } from './processMiningProvider';
import type { MonthlyTrend } from '@neuropause/shared';

const log = createLogger('executive-center');

export interface ExecutiveCenterSubsystem {
  handlers: SecureHandlerDef[];
  snapshot: () => ExecutiveCenterSnapshot;
}

/** Read recent timeline entries in the composer's minimal shape (reuses the store). */
function recentTimeline(): TimelineEntryLite[] {
  const tl = getEnterpriseTimeline();
  if (!tl) return [];
  return tl.query({ limit: 200, order: 'desc' }).entries.map((e) => ({
    id: e.id,
    at: e.at,
    kind: e.kind,
    category: e.category,
    title: e.title,
    summary: e.summary,
  }));
}

/** Derive a MonthlyTrend for one metric from the store's 30-day windowStats. Pure. */
function monthlyTrendFor(
  key: MonthlyTrend['key'],
  label: string,
  metric: 'overall' | 'engineering',
  current: number,
): MonthlyTrend | null {
  const s = healthHistoryStore.windowStats(30, metric);
  if (!s) return null;
  const monthAgo = s.windowStart;
  const delta = current - monthAgo;
  const percentChange = monthAgo === 0 ? 0 : Math.round((delta / monthAgo) * 100);
  const direction: MonthlyTrend['direction'] = delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat';
  // Stability: low spread relative to the average ⇒ stable.
  const stability: MonthlyTrend['stability'] = s.stddev <= 5 ? 'stable' : 'volatile';
  // Confidence grows with datapoint count over the window.
  const confidence: MonthlyTrend['confidence'] =
    s.count >= 20 ? 'high' : s.count >= 7 ? 'medium' : 'low';
  return {
    key,
    label,
    current,
    monthAgo,
    delta,
    percentChange,
    direction,
    movingAverage: s.movingAverage,
    highest: s.highest,
    lowest: s.lowest,
    stability,
    sparkline: s.values,
    confidence,
  };
}

export function initExecutiveCenter(): ExecutiveCenterSubsystem {
  const snapshot = (): ExecutiveCenterSnapshot => {
    // Record today's datapoint FIRST (one per calendar day; last write wins) so the
    // monthly-trends source sees today's value as "current". Compute the current
    // scores once from the same inputs the composer will use.
    const nowMs = Date.now();
    const curInputs = collectOrgHealthInputs(nowMs);
    // Enterprise Planning — read-mostly cross-domain intelligence computed once from the operational
    // stores (assembled the ONE way, via the shared collector, also used by decision verification).
    const { input: planningInput, routings } = collectPlanningModel();
    const planningInsights = derivePlanningInsights(planningInput);
    // Finite Capacity Scheduling (APS) — load the time-phased production plan onto the REAL
    // machines (Manufacturing status + Maintenance windows). Computed ONCE here and reused for
    // both the capacity KPIs and the scheduling recommendations (no duplicate scheduling pass).
    const capacitySchedule = computeCapacitySchedule(planningInput, nowMs);
    // Routing-Aware Scheduling (APS) — route each planned production order through its product's
    // active routing onto QUALIFIED machines (work center + eligibility + availability). `routings`
    // comes from the shared collector above; computed ONCE and reused for KPIs + recommendations.
    const routingSchedule = computeRoutingSchedule(planningInput, routings, nowMs);
    // Manufacturing Execution (MES) — the shop-floor execution records (dispatched from committed
    // schedules). Read once and reused for the execution KPIs + recommendations. Real records only.
    const mesExecutions = executionModule.store.list({ status: 'active', limit: 5000 }).map(mesExecutionFromRecord);
    // Shop-Floor Event Ledger — the immutable telemetry source of truth. Read once; execution
    // telemetry, machine/operator timelines, OEE, KPIs + recommendations all derive from these events.
    const manufacturingEvents = manufacturingEventModule.store.list({ status: 'active', limit: 20000 }).map(manufacturingEventFromRecord);
    // Manufacturing Digital Twin — read-only what-if simulation over the REAL model. Runs the standard
    // stress battery ONCE against a baseline computed ONCE (reuses the existing pure engines), for the
    // resilience KPIs + the highest-impact what-if recommendations. Never mutates production data.
    const digitalTwin = assessDigitalTwin(planningInput, routings, nowMs);
    // Enterprise Decision Engine — analyzes the Twin's predictions into ranked, PENDING recovery plans
    // + six executive scores. Reuses the Twin's cached baseline (no duplicate scheduling). Read-only;
    // nothing executes — human approval remains mandatory.
    const decisionEngine = assessDecisionEngine(planningInput, routings, nowMs, digitalTwin);
    // Enterprise Process Mining — the REAL end-to-end processes (order-to-cash, procure-to-pay,
    // make-to-complete) reconstructed from the production records. Read through the CACHED provider so the
    // assessment is computed one way and reused by both these KPIs and the Process Explorer queries — no
    // duplicate mining, no rescanning. Read-only, deterministic.
    const processMining = getProcessAssessment();
    // computeOrgHealth is what the composer uses; import lazily via the composer's
    // own path would duplicate — instead record after compose but read current from
    // the freshly-composed snapshot (below), and expose monthly via a closure that
    // captures it. Simpler: compose first, then the monthly source reads the snap.
    let composed: ExecutiveCenterSnapshot | null = null;
    const snap = composeExecutiveSnapshot({
      now: () => new Date(nowMs),
      founderItems: () => buildFounderProactiveItems('morning'),
      orgItems: () => buildOrgIntelligenceItems(),
      orgHealthInputs: () => curInputs,
      timelineEntries: () => recentTimeline(),
      workforceHealth: () => summarizeWorkforceHealth(workerRegistry.healthSummaries()),
      workforceIntelligence: () => workforceIntelligence(jobStore.page({ limit: 2000 }).jobs),
      knowledgeHealth: () => knowledgeHealth(memoryStore.allItems()),
      memoryCounts: () => memoryStore.counts(),
      // CRM KPIs: read the registered CRM module's contacts (same pattern as the
      // other domain sources above) and roll them into Active Contacts / New
      // Leads / Customer Health / Follow-up Risk / High-Value Accounts.
      crmInsights: () =>
        deriveCrmInsights(
          contactModule.store.list({ status: 'active', limit: 5000 }).map(contactFromRecord),
          nowMs,
        ),
      // CRM lead-pipeline KPIs from the registered Leads module.
      leadInsights: () =>
        deriveLeadInsights(
          leadModule.store.list({ status: 'active', limit: 5000 }).map(leadFromRecord),
          nowMs,
        ),
      // CRM customer-account KPIs from the registered Customers module.
      customerInsights: () =>
        deriveCustomerInsights(
          customerModule.store.list({ status: 'active', limit: 5000 }).map(customerFromRecord),
          nowMs,
        ),
      // Sales quote-pipeline KPIs from the registered Quotes module.
      quoteInsights: () =>
        deriveQuoteInsights(
          quoteModule.store.list({ status: 'active', limit: 5000 }).map(quoteFromRecord),
          nowMs,
        ),
      // Sales order-fulfillment KPIs from the registered Orders module.
      orderInsights: () =>
        deriveOrderInsights(
          orderModule.store.list({ status: 'active', limit: 5000 }).map(orderFromRecord),
          nowMs,
        ),
      // Finance receivables KPIs from the registered Invoices module.
      invoiceInsights: () =>
        deriveInvoiceInsights(
          invoiceModule.store.list({ status: 'active', limit: 5000 }).map(invoiceFromRecord),
          nowMs,
        ),
      // Finance collection KPIs — the payment ledger joined to invoices.
      paymentInsights: () =>
        derivePaymentInsights(
          paymentModule.store.list({ status: 'active', limit: 5000 }).map(paymentFromRecord),
          invoiceModule.store.list({ status: 'active', limit: 5000 }).map(invoiceFromRecord),
          nowMs,
        ),
      // Inventory KPIs — products (derived stock) + warehouses (capacity).
      inventoryInsights: () =>
        deriveInventoryInsights(
          productModule.store.list({ status: 'active', limit: 5000 }).map(productFromRecord),
          warehouseModule.store.list({ status: 'active', limit: 5000 }).map(warehouseFromRecord),
        ),
      // Procurement KPIs — suppliers + purchase orders + goods receipts.
      procurementInsights: () =>
        deriveProcurementInsights(
          supplierModule.store.list({ status: 'active', limit: 5000 }).map(supplierFromRecord),
          purchaseOrderModule.store.list({ status: 'active', limit: 5000 }).map(purchaseOrderFromRecord),
          goodsReceiptModule.store.list({ status: 'active', limit: 5000 }).map(goodsReceiptFromRecord),
        ),
      // Warehouse KPIs — the execution layer's operational metrics (reuses inventory
      // engine for utilization + turnover; products supply average on-hand).
      warehouseInsights: () =>
        deriveWarehouseInsights({
          bins: binModule.store.list({ status: 'active', limit: 5000 }).map(binFromRecord),
          transfers: transferOrderModule.store.list({ status: 'active', limit: 5000 }).map(transferOrderFromRecord),
          picks: pickListModule.store.list({ status: 'active', limit: 5000 }).map(pickListFromRecord),
          packings: packingModule.store.list({ status: 'active', limit: 5000 }).map(packingFromRecord),
          shippings: shippingModule.store.list({ status: 'active', limit: 5000 }).map(shippingFromRecord),
          cycleCounts: cycleCountModule.store.list({ status: 'active', limit: 5000 }).map(cycleCountFromRecord),
          adjustments: stockAdjustmentModule.store.list({ status: 'active', limit: 5000 }).map(stockAdjustmentFromRecord),
          products: productModule.store.list({ status: 'active', limit: 5000 }).map(productFromRecord),
        }),
      // Manufacturing KPIs — production orders + machines + quality + costing + work
      // centers (finished goods + component consumption flow through the ledger).
      manufacturingInsights: () =>
        deriveManufacturingInsights({
          orders: productionOrderModule.store.list({ status: 'active', limit: 5000 }).map(productionOrderFromRecord),
          machines: machineModule.store.list({ status: 'active', limit: 5000 }).map(machineFromRecord),
          qualityInspections: qualityModule.store.list({ status: 'active', limit: 5000 }).map(qualityInspectionFromRecord),
          costings: costingModule.store.list({ status: 'active', limit: 5000 }).map(productionCostingFromRecord),
          workCenters: workCenterModule.store.list({ status: 'active', limit: 5000 }).map(workCenterFromRecord),
        }),
      // Maintenance KPIs — assets + work orders + preventive + downtime + technicians.
      // Reuses the AUTHORITATIVE machine records (Manufacturing) for availability, so
      // maintenance downtime flows into both Maintenance and Manufacturing KPIs.
      maintenanceInsights: () =>
        deriveMaintenanceInsights({
          machines: machineModule.store.list({ status: 'active', limit: 5000 }).map(machineFromRecord),
          assets: assetModule.store.list({ status: 'active', limit: 5000 }).map(assetFromRecord),
          workOrders: workOrderModule.store.list({ status: 'active', limit: 5000 }).map(workOrderFromRecord),
          preventives: preventiveMaintenanceModule.store.list({ status: 'active', limit: 5000 }).map(preventiveMaintenanceFromRecord),
          downtimeEvents: downtimeEventModule.store.list({ status: 'active', limit: 5000 }).map(downtimeEventFromRecord),
          technicians: technicianModule.store.list({ status: 'active', limit: 5000 }).map(technicianFromRecord),
        }),
      // Fulfillment KPIs — the make → move → sell loop. Pure cross-domain analytics
      // over products + production orders + sales orders + pick lists + shipments;
      // owns no records and reads the single Inventory Ledger (no duplicate stock).
      fulfillmentInsights: () =>
        deriveFulfillmentInsights({
          products: productModule.store.list({ status: 'active', limit: 5000 }).map(productFromRecord),
          productionOrders: productionOrderModule.store.list({ status: 'active', limit: 5000 }).map(productionOrderFromRecord),
          orders: orderModule.store.list({ status: 'active', limit: 5000 }).map(orderFromRecord),
          pickLists: pickListModule.store.list({ status: 'active', limit: 5000 }).map(pickListFromRecord),
          shipments: shippingModule.store.list({ status: 'active', limit: 5000 }).map(shippingFromRecord),
        }),
      // Enterprise Planning KPIs — deterministic cross-domain intelligence (precomputed).
      planningInsights: () => planningInsights,
      // Multi-level MRP KPIs — recursive BOM explosion over the same planning input.
      mrpInsights: () => deriveMrpInsights(planningInput),
      // Time-phased MRP KPIs — backward scheduling of the same plan against the clock.
      timePhasedInsights: () => deriveTimePhasedInsights(planningInput, nowMs),
      // Finite-capacity (APS) KPIs — the time-phased plan loaded onto real machines (precomputed).
      capacityInsights: () => deriveCapacityInsights(capacitySchedule),
      // Routing-aware (APS) KPIs — operations routed onto qualified machines (precomputed).
      routingInsights: () => deriveRoutingInsights(routingSchedule),
      // Production-schedule KPIs — the eight scheduling tiles (schedule/machine utilization, avg queue,
      // avg setup, efficiency, late ops, idle capacity, routing violations) from the SAME routing schedule.
      schedulingKpis: () => schedulingInsightsToKpis(deriveSchedulingInsights(routingSchedule)),
      // Manufacturing Execution (MES) KPIs — real shop-floor execution records (precomputed).
      mesInsights: () => deriveMesInsights(mesExecutions),
      // Supplemental MES KPIs — Availability / Performance / Rework Rate (additive; the twelve-key
      // mesInsights source is never disturbed). Same execution snapshot; pre-built tiles.
      mesSupplementalKpis: () => mesSupplementalKpis(mesExecutions),
      // Relationship-intelligence KPIs — the eight cross-domain relationship tiles (health, critical,
      // disconnected, high-risk + supplier/customer/machine dependency, connectivity). Read-only; cached.
      relationshipKpis: () => getRelationshipKpis(),
      // Trust KPIs — the nine deterministic trust tiles (enterprise + customer/supplier/machine/knowledge/
      // decision/process/operational/compliance trust), composed from existing signals. Read-only; cached.
      trustKpis: () => getTrustKpis(),
      // P2.5 — Enterprise Work Intelligence KPIs. Confirmed automation success rate (live monitor rollup) +
      // unified knowledge-graph size/connectivity (graph store counts). Grounded in existing subsystems.
      automationMonitor: () => getAutomationMonitor(),
      graphCounts: () => graphStore.counts(),
      // Shop-Floor Event Ledger KPIs — telemetry derived from the immutable event stream (precomputed).
      eventInsights: () => deriveEventInsights(manufacturingEvents, nowMs),
      // Digital-twin resilience KPIs — what-if stress battery over the real model (precomputed).
      resilienceInsights: () => digitalTwin.resilience,
      // Enterprise Decision Engine KPIs — recovery-plan readiness + strategic scores (precomputed).
      decisionInsights: () => decisionEngine.insights,
      // Executive Decision Approval KPIs — governance state of the persisted recovery-plan records.
      approvalInsights: () =>
        deriveApprovalInsights(executiveDecisionModule.store.list({ status: 'active', limit: 5000 }).map(executiveDecisionFromRecord)),
      // Decision Execution Handoff KPIs — the controlled proposal pipeline (pending / accepted /
      // rejected / execution readiness / approval time / acceptance rate). Read-only over proposal records.
      handoffInsights: () =>
        deriveHandoffInsights(executionProposalModule.store.list({ status: 'active', limit: 5000 }).map(executionProposalFromRecord)),
      // Process Mining KPIs — reconstructed process cycle / waiting / approval-production-purchase-revenue
      // delays / health / automation coverage (precomputed; read-only over real records).
      processInsights: () => processMining.insights,
      // Process Explorer KPIs — top bottleneck / slowest / fastest case / most-automated / delayed-approval
      // / highest-rework, derived from the SAME cached assessment (nothing re-mined).
      processExplorerKpis: () => deriveProcessExplorerKpis(processMining),
      // V2.9: feed last week's health from the persisted history store so Weekly
      // Trends is live. Returns null until ≥1 older datapoint exists.
      previousWeek: () => {
        const p = healthHistoryStore.valueAround(7, nowMs);
        return p ? { overall: p.overall, engineering: p.engineering } : null;
      },
      // V3.1: rich 30-day trends from the SAME store (no new persistence). Uses the
      // current composed scores as "current" and the store window for history.
      monthlyTrends: () => {
        const cur = composed?.orgHealth;
        const trends = [
          monthlyTrendFor('overall', 'Organization Health', 'overall', cur?.overall ?? 0),
          monthlyTrendFor(
            'engineering',
            'Engineering Health',
            'engineering',
            cur?.engineering ?? 0,
          ),
        ].filter((t): t is MonthlyTrend => t !== null);
        return trends.length > 0 ? trends : undefined;
      },
    });
    composed = snap;
    // V3.2: derive ranked recommendations + executive summary from the composed
    // snapshot (pure; explains existing metrics — no new intelligence).
    const recommendations = [
      ...buildExecutiveRecommendations(snap),
      ...(snap.enterprise ? enterpriseRecommendations(snap.enterprise) : []),
      // Planning recommendations (MRP shortages, safety-stock, capacity) — deterministic,
      // surfaced through the existing recommendation + timeline system.
      ...planningRecommendations(planningInput),
      // Multi-level MRP recommendations (dependent purchase/production, BOM cycles).
      ...mrpRecommendations(planningInput),
      // Time-phased recommendations (release-now, late-risk, delay, bottleneck).
      ...timePhasedRecommendations(planningInput, nowMs),
      // Finite-capacity (APS) recommendations (overloaded, move-to-machine, second-shift,
      // split, avoid-maintenance-window, reschedule-queue, delay, capacity-available).
      ...capacityRecommendations(capacitySchedule),
      // Routing-aware (APS) recommendations (alternate-machine, blocked-by-maintenance,
      // routing-conflict, capability-mismatch, split-routing, reduce-queue, resequence).
      ...routingRecommendations(routingSchedule),
      // MES execution recommendations (dispatch-delayed, machine-overloaded, inspection-backlog,
      // material-shortage, high-scrap, operator-unavailable, maintenance-conflict, routing-violation).
      ...mesRecommendations(mesExecutions),
      // Shop-floor event-ledger recommendations (machine-idle, running-without-operator, high-downtime,
      // inspection-backlog, repeated-failures, long-pause, bottleneck, operator-overload, late-completion).
      ...eventRecommendations(manufacturingEvents, nowMs),
      // Digital-twin what-if recommendations (highest-impact stress scenarios, each with predicted impact).
      ...digitalTwin.recommendations,
      // Enterprise Decision Engine recovery plans (PENDING) surfaced as ranked executive recommendations.
      ...decisionEngine.recommendations,
      // Process Mining — the slowest real transitions, rework loops, and stalled cases as recommendations.
      ...processMining.recommendations,
    ];
    snap.recommendations = recommendations;
    snap.executiveSummary = buildExecutiveSummary(snap, recommendations);
    // V3.3: attach the persisted decisions overview (read-only view; no new logic).
    snap.decisions = decisionStore.summary();
    // V3.8: compose the unified executive event stream from sources already in the
    // snapshot + decision history. Pure; no new persistence. Wrapped so a malformed
    // item can never reject the whole executive snapshot (V5.2.2 hardening).
    try {
      const toLite = (card: typeof snap.executiveTimeline): UnifiedItemLite[] =>
        (card?.items ?? []).map((it) => ({
          id: it.id,
          title: it.title,
          body: it.body,
          priority: (it.priority === 'normal'
            ? 'medium'
            : it.priority) as UnifiedItemLite['priority'],
          producedAt: it.producedAt,
          deepLink: it.deepLink,
          evidenceCount: it.governance?.evidence?.length ?? 0,
        }));
      snap.unifiedTimeline = buildUnifiedTimeline({
        decisions: decisionStore.all(),
        organization: toLite(snap.executiveTimeline),
        delivery: toLite(snap.recentDeliveries),
        recommendations: (snap.recommendations ?? []).map((r) => ({
          id: r.id,
          title: r.problem,
          body: r.recommendedAction,
          priority: r.priority,
          producedAt: snap.generatedAt,
          deepLink: 'enterprise/executive',
          evidenceCount: r.evidence?.length ?? 0,
          owner: r.owner,
        })),
      });
    } catch (err) {
      log.warn('unified timeline compose failed; returning snapshot without it', {
        err: String(err),
      });
      snap.unifiedTimeline = [];
    }
    // Record today's datapoint. Fire-and-forget — persistence failure must never
    // break the snapshot response.
    void healthHistoryStore
      .record(snap.orgHealth.overall, snap.orgHealth.engineering, nowMs)
      .catch((err) => log.warn('health-history record failed', { err: String(err) }));
    return snap;
  };

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.ExecutiveCenterSnapshot,
      schema: EmptyRequest,
      handler: () => snapshot(),
    },
  ];

  log.info('Executive Intelligence Center initialized');
  return { handlers, snapshot };
}
