/**
 * Enterprise Trust Engine provider — the READ-ONLY model the desktop Trust Center reads, and the source of
 * the nine Executive trust KPIs. It COMPOSES existing subsystem outputs (never recomputing them): the
 * Relationship graph (per-entity health/risk, via getRelationshipModel), Process Mining metrics
 * (getProcessAssessment), the Decision governance insights (deriveApprovalInsights / deriveHandoffInsights),
 * the Governance audit trail (governanceStore), Knowledge/AI-memory (memoryStore), and the Quality /
 * Maintenance / Finance / Sales / Procurement / Execution projections — and hands them to the pure,
 * deterministic `buildTrustModel`. It writes nothing and owns no store. A short TTL cache lets the Executive
 * snapshot and a subsequent explore request within a couple seconds share one build.
 */
import type { EnterpriseEntity } from '@neuropause/shared';
import {
  buildTrustModel,
  mesExecutionFromRecord,
  qualityInspectionFromRecord,
  invoiceFromRecord,
  paymentFromRecord,
  orderFromRecord,
  purchaseOrderFromRecord,
  goodsReceiptFromRecord,
  machineFromRecord,
  downtimeEventFromRecord,
  workOrderFromRecord,
  preventiveMaintenanceFromRecord,
  executiveDecisionFromRecord,
  executionProposalFromRecord,
  deriveApprovalInsights,
  deriveHandoffInsights,
  type EnterpriseTrustModel,
} from '@neuropause/shared';
import type { EnterpriseModule } from './framework';
import { getRelationshipModel } from './relationshipProvider';
import { getProcessAssessment } from './processMiningProvider';
import { governanceStore } from './governance/governanceInstance';
import { memoryStore } from '../memory/memoryInstance';
import { invoiceModule } from './modules/finance/invoiceModuleInstance';
import { paymentModule } from './modules/finance/paymentModuleInstance';
import { orderModule } from './modules/sales/orderModuleInstance';
import { purchaseOrderModule, goodsReceiptModule } from './modules/procurement/procurementInstances';
import { machineModule, executionModule, qualityModule } from './modules/manufacturing/manufacturingInstances';
import { downtimeEventModule, workOrderModule, preventiveMaintenanceModule } from './modules/maintenance/maintenanceInstances';
import { executiveDecisionModule } from './modules/executive/executiveDecisionInstance';
import { executionProposalModule } from './modules/executive/executionProposalInstance';

/** Project a module's active records, stamping envelope timestamps (for deterministic recency/trend). */
function stamp<T>(mod: EnterpriseModule, fn: (r: EnterpriseEntity) => T, limit = 5000): Array<T & { updatedAt: string; createdAt: string }> {
  return mod.store.list({ status: 'active', limit }).map((r) => ({ ...fn(r), updatedAt: r.updatedAt, createdAt: r.createdAt }));
}

/** Read all trust signals and build the read-only trust model. Pure read; no writes. */
export function buildTrustModelFromStores(nowMs: number): EnterpriseTrustModel {
  const relationship = getRelationshipModel();
  const process = getProcessAssessment();
  const decisions = executiveDecisionModule.store.list({ status: 'active', limit: 5000 }).map(executiveDecisionFromRecord);
  const proposals = executionProposalModule.store.list({ status: 'active', limit: 5000 }).map(executionProposalFromRecord);

  return buildTrustModel(
    {
      relationshipNodes: relationship.nodes.map((n) => ({ id: n.id, kind: n.kind, key: n.key, label: n.label, health: n.health, risk: n.risk, degree: n.degree, resolved: n.resolved })),
      executions: stamp(executionModule, mesExecutionFromRecord),
      inspections: qualityModule.store.list({ status: 'active', limit: 5000 }).map(qualityInspectionFromRecord),
      invoices: invoiceModule.store.list({ status: 'active', limit: 5000 }).map(invoiceFromRecord),
      payments: stamp(paymentModule, paymentFromRecord),
      orders: stamp(orderModule, orderFromRecord),
      purchaseOrders: stamp(purchaseOrderModule, purchaseOrderFromRecord),
      goodsReceipts: stamp(goodsReceiptModule, goodsReceiptFromRecord),
      machines: machineModule.store.list({ status: 'active', limit: 5000 }).map(machineFromRecord),
      downtime: downtimeEventModule.store.list({ status: 'active', limit: 5000 }).map(downtimeEventFromRecord),
      workOrders: stamp(workOrderModule, workOrderFromRecord),
      preventives: preventiveMaintenanceModule.store.list({ status: 'active', limit: 5000 }).map(preventiveMaintenanceFromRecord),
      decisions,
      proposals,
      memories: memoryStore.allItems().map((m) => ({ id: m.id, kind: m.kind, title: m.title, content: m.content, origin: m.origin, entityRefs: m.entityRefs, updatedAt: m.updatedAt, occurredAt: m.occurredAt })),
      audit: governanceStore.auditEntries(2000).map((a) => ({ target: a.target, action: a.action, at: a.at })),
      processMetrics: process.metrics.byType.map((m) => ({ processType: m.processType, completionRate: m.completionRate, reworkRate: m.reworkRate, caseCount: m.caseCount })),
      approval: (() => { const a = deriveApprovalInsights(decisions); return { recoverySuccessRate: a.recoverySuccessRate, averageVerificationAccuracy: a.averageVerificationAccuracy }; })(),
      handoff: (() => { const h = deriveHandoffInsights(proposals); return { executionReadiness: h.executionReadiness, proposalAcceptanceRate: h.proposalAcceptanceRate }; })(),
    },
    nowMs,
  );
}

/* short TTL cache */
let cache: { model: EnterpriseTrustModel; atMs: number } | null = null;
const TTL_MS = 2500;

/** The read-only trust model (cached briefly). */
export function getTrustModel(): EnterpriseTrustModel {
  const nowMs = Date.now();
  if (cache && nowMs - cache.atMs < TTL_MS) return cache.model;
  const model = buildTrustModelFromStores(nowMs);
  cache = { model, atMs: nowMs };
  return model;
}

/** The nine trust KPIs (for the Executive Center source). Reuses the cached model. */
export function getTrustKpis(): EnterpriseTrustModel['kpis'] {
  return getTrustModel().kpis;
}
