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
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../tenancy/tenantMemo';
import type { EnterpriseModule } from './framework';
import { getRelationshipModel } from './relationshipProvider';
import { getProcessAssessment } from './processMiningProvider';
import { activeTenantScope } from './index';
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
      /**
       * P12 — the trust model is built from the ACTIVE tenant's audit trail.
       *
       * Unscoped, a tenant's trust score was computed partly from another
       * tenant's activity. Left as an explicit `undefined` would have meant
       * "every workspace", so the scope is passed through.
       */
      audit: governanceStore
        .auditEntries(2000, activeTenantScope())
        .map((a) => ({ target: a.target, action: a.action, at: a.at })),
      processMetrics: process.metrics.byType.map((m) => ({ processType: m.processType, completionRate: m.completionRate, reworkRate: m.reworkRate, caseCount: m.caseCount })),
      approval: (() => { const a = deriveApprovalInsights(decisions); return { recoverySuccessRate: a.recoverySuccessRate, averageVerificationAccuracy: a.averageVerificationAccuracy }; })(),
      handoff: (() => { const h = deriveHandoffInsights(proposals); return { executionReadiness: h.executionReadiness, proposalAcceptanceRate: h.proposalAcceptanceRate }; })(),
    },
    nowMs,
  );
}

/**
 * P13C ROUND 3 — H-2. KEYED BY TENANT, not merely expired.
 *
 * This was a keyless `let cache` behind a 2.5s TTL, flushed on workspace switch.
 * Both mitigations were real and both were insufficient, for a reason the switch
 * listener cannot see: `forEachTenant` runs scheduled work once per tenant, back
 * to back, under each tenant's own principal, announcing no switch. Tenant A's
 * pass built this model; tenant B's pass — microseconds later, inside the TTL,
 * with nothing to invalidate on — read it. The Executive Center source that
 * consumes `getTrustKpis()` is exactly such a fanned-out job.
 *
 * The TTL is retained at 2.5s because it still does its own job, which is
 * freshness. It is no longer asked to do isolation.
 */
const memo = new TenantMemo<EnterpriseTrustModel>('enterprise-trust-model', { ttlMs: 2500 });

/** Bind the tenant resolver. Called once by the enterprise composition root. */
export function bindTrustModelScope(source: () => TenantScope | null): void {
  memo.bindScope(source);
}

/** The read-only trust model (cached briefly, per tenant). */
export function getTrustModel(): EnterpriseTrustModel {
  return memo.state(() => buildTrustModelFromStores(Date.now()));
}

/** The nine trust KPIs (for the Executive Center source). Reuses the cached model. */
export function getTrustKpis(): EnterpriseTrustModel['kpis'] {
  return getTrustModel().kpis;
}

/**
 * Drop the memoized model (P13B).
 *
 * Kept, and still wired to the workspace switch, as defence in depth. It is no
 * longer the isolation mechanism — the cell is keyed — but it remains the right
 * response to the one moment the application KNOWS the tenant changed, and it
 * costs one recomposition.
 *
 * Why this mattered enough to keep: the graph projection reads this model and
 * STAMPS every node it produces with the reading tenant, then persists it. A
 * stale read there is not transient; it becomes a durable, correctly-owned-
 * looking record of another tenant's relationships.
 */
export function invalidateModelCache(): void {
  memo.invalidate();
}
