/**
 * Process Mining provider — the single, cached owner of the mined assessment. It reads the same
 * production record stores the modules already persist, runs the existing `assessProcessMining` engine
 * ONCE, and memoizes the result (plus the derived case summaries + facets). The Executive Center KPIs
 * AND the Process Explorer queries both read through here, so the assessment is computed one way and
 * reused — nothing is re-mined per request, and the Explorer pages / filters over the cached summaries
 * without rescanning. Read-only: it creates nothing and mutates nothing.
 *
 * P13C ROUND 3 — H-1. THE CACHE IS KEYED BY TENANT.
 *
 * This cache holds the materialised records of THIRTEEN tenant-scoped module stores — leads, contacts,
 * customers, quotes, orders, invoices, payments, purchase requests and orders, goods receipts, stock
 * movements, production orders, schedules. Its inputs were already scoped, so a cache built while tenant
 * A was active held A's data. It was then handed to whoever asked next.
 *
 * The only thing standing between two tenants was a CACHE INVALIDATION KEY being mistaken for an
 * authorization check: `signature()` is the active record count of each contributing store joined with
 * colons, and a cache hit required the counts to match. Two tenants with the same thirteen counts —
 * trivially arranged, and the overwhelmingly likely case on a fresh or lightly-used second
 * organization, where every count is zero — shared one assessment. `getProcessCaseDetail` then resolved
 * a payload `caseId` against it with no ownership check at all.
 *
 * A count signature is a freshness heuristic. It answers "did the records change?", which is a question
 * about staleness, and it CANNOT answer "whose records are these?" because a count carries no identity.
 * It is retained below for the job it can do, inside a cell that is already keyed by tenant.
 */
import type {
  ExecutiveKpi,
  ProcessCaseSummary,
  ProcessExplorerFacets,
  ProcessExplorerFilter,
  ProcessExplorerModel,
  ProcessCaseDetail,
  ProcessMiningAssessment,
  ProcessMiningInput,
  TenantScope,
} from '@neuropause/shared';
import { TenantMemo } from '../tenancy/tenantMemo';
import {
  assessProcessMining,
  buildProcessCaseDetail,
  buildProcessCaseSummaries,
  buildProcessExplorerFacets,
  deriveProcessExplorerKpis,
  filterProcessCases,
  processInsightsToKpis,
} from '@neuropause/shared';
import { leadModule } from './modules/crm/leadModuleInstance';
import { contactModule } from './modules/crm/contactModuleInstance';
import { customerModule } from './modules/crm/customerModuleInstance';
import { quoteModule } from './modules/sales/quoteModuleInstance';
import { orderModule } from './modules/sales/orderModuleInstance';
import { invoiceModule } from './modules/finance/invoiceModuleInstance';
import { paymentModule } from './modules/finance/paymentModuleInstance';
import { purchaseRequestModule, purchaseOrderModule, goodsReceiptModule } from './modules/procurement/procurementInstances';
import { stockMovementModule } from './modules/inventory/stockMovementModuleInstance';
import { productionOrderModule, scheduleModule } from './modules/manufacturing/manufacturingInstances';

/** Read window per module — the engine itself is linear beyond this; kept bounded for a live snapshot. */
const READ_LIMIT = 20000;

const MODULES = [
  leadModule, contactModule, customerModule, quoteModule, orderModule, invoiceModule, paymentModule,
  purchaseRequestModule, purchaseOrderModule, goodsReceiptModule, stockMovementModule, productionOrderModule, scheduleModule,
];

interface ProcessCache {
  signature: string;
  input: ProcessMiningInput;
  assessment: ProcessMiningAssessment;
  summaries: ProcessCaseSummary[];
  facets: ProcessExplorerFacets;
}

/**
 * THE TENANT BOUNDARY.
 *
 * A `TenantMemo` rather than a `let`, so the cell carries the tenant it was composed for and a foreign
 * caller recomposes instead of reading. Registered with the startup gate by construction: if nothing
 * ever calls `bindProcessMiningScope`, the application refuses to start rather than mining across
 * tenants.
 *
 * The TTL is effectively disabled (a day) because this cache has its own, better freshness signal in
 * `signature()` — the point of the memo here is the KEY, and pretending a TTL contributes to isolation
 * is the exact mistake this round exists to remove.
 */
const memo = new TenantMemo<ProcessCache>('enterprise-process-mining', { ttlMs: 24 * 60 * 60 * 1000 });

/**
 * Bind the tenant resolver. Called once by the enterprise composition root.
 *
 * Injected rather than imported because `enterprise/index.ts` imports THIS file, so importing
 * `activeTenantScope` back out of it would be a cycle. Same shape as `bindOrgIntelligenceScope`.
 */
export function bindProcessMiningScope(source: () => TenantScope | null): void {
  memo.bindScope(source);
}

/** Test seam: forget the cached assessment. */
export function invalidateProcessMiningCache(): void {
  memo.invalidate();
}

/**
 * Cheap FRESHNESS key — the active record count of each contributing store (no scan).
 *
 * Scoped, because `count()` is scoped: this is the caller's own thirteen counts. It detects "my records
 * changed" and nothing else. It is deliberately no longer the only thing separating two tenants.
 */
function signature(): string {
  return MODULES.map((m) => m.store.count('active')).join(':');
}

function collectInput(): ProcessMiningInput {
  const read = (m: (typeof MODULES)[number]) => m.store.list({ status: 'active', limit: READ_LIMIT });
  return {
    leads: read(leadModule),
    contacts: read(contactModule),
    customers: read(customerModule),
    quotes: read(quoteModule),
    orders: read(orderModule),
    invoices: read(invoiceModule),
    payments: read(paymentModule),
    purchaseRequests: read(purchaseRequestModule),
    purchaseOrders: read(purchaseOrderModule),
    goodsReceipts: read(goodsReceiptModule),
    movements: read(stockMovementModule),
    productionOrders: read(productionOrderModule),
    schedules: read(scheduleModule),
  };
}

function mine(): ProcessCache {
  const input = collectInput();
  const assessment = assessProcessMining(input);
  const summaries = buildProcessCaseSummaries(assessment, input);
  const facets = buildProcessExplorerFacets(summaries);
  return { signature: signature(), input, assessment, summaries, facets };
}

/**
 * The CALLER'S mining result, recomputing when their contributing record set changed.
 *
 * Two conditions now, and they are different in kind. `TenantMemo.state` answers "is this cell MINE?" —
 * an ownership question, and the one that had no answer before. The signature comparison answers "is it
 * still current?" — a freshness question. Conflating them is what let a matching count serve another
 * tenant's assessment.
 */
function ensure(): ProcessCache {
  const cached = memo.state(mine);
  if (cached.signature === signature()) return cached;
  memo.invalidate();
  return memo.state(mine);
}

/** The mined assessment (Executive Center KPIs + recommendations read this). Cached. */
export function getProcessAssessment(): ProcessMiningAssessment {
  return ensure().assessment;
}

/** The six Process Explorer KPIs, derived from the cached assessment. */
export function getProcessExplorerKpis(): ExecutiveKpi[] {
  return deriveProcessExplorerKpis(ensure().assessment);
}

/** The Process Explorer model: discovered graph + metrics + facets + filtered, paginated case list. */
export function getProcessExplorerModel(filter: ProcessExplorerFilter = {}): ProcessExplorerModel {
  const c = ensure();
  const filtered = filterProcessCases(c.summaries, filter).sort((a, b) => b.cycleHours - a.cycleHours || b.startedAtMs - a.startedAtMs);
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 1000));
  return {
    graph: c.assessment.graph,
    metrics: c.assessment.metrics,
    insights: c.assessment.insights,
    kpis: processInsightsToKpis(c.assessment.insights),
    explorerKpis: deriveProcessExplorerKpis(c.assessment),
    narrative: c.assessment.narrative,
    facets: c.facets,
    cases: filtered.slice(offset, offset + limit),
    totalCases: filtered.length,
  };
}

/**
 * Full detail for one case (every stage + the mined recommendations + a deterministic AI read).
 *
 * `caseId` ARRIVES IN A PAYLOAD, so it is an assertion by the caller and nothing more. The tenant-keyed
 * cell already means a foreign id cannot be found — the assessment being searched is composed from the
 * caller's own scoped reads — but the ownership check is written out rather than left implied, because
 * "it cannot be in there" is a property of code somewhere else, and this is the line that would have to
 * change for it to stop being true.
 *
 * A foreign case and an invented case are the same answer: `null`. A refusal that distinguished them
 * would turn this channel into an existence oracle over another tenant's process ids.
 */
export function getProcessCaseDetail(caseId: string): ProcessCaseDetail | null {
  const c = ensure();
  if (!c.summaries.some((s) => s.caseId === caseId)) return null;
  return buildProcessCaseDetail(c.assessment, c.input, caseId, c.summaries);
}
