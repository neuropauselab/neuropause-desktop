/**
 * Process Mining provider — the single, cached owner of the mined assessment. It reads the same
 * production record stores the modules already persist, runs the existing `assessProcessMining` engine
 * ONCE, and memoizes the result (plus the derived case summaries + facets) keyed by a cheap store-count
 * signature. The Executive Center KPIs AND the Process Explorer queries both read through here, so the
 * assessment is computed one way and reused — nothing is re-mined per request, and the Explorer pages /
 * filters over the cached summaries without rescanning. Read-only: it creates nothing and mutates
 * nothing. The cache re-mines when a process's record set changes (records added / removed).
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
} from '@neuropause/shared';
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

let cache: ProcessCache | null = null;

/** Cheap invalidation key — the active record count of each contributing store (no scan). */
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

/** Return the cached mining result, recomputing only when the contributing record set changed. */
function ensure(): ProcessCache {
  const sig = signature();
  if (cache && cache.signature === sig) return cache;
  const input = collectInput();
  const assessment = assessProcessMining(input);
  const summaries = buildProcessCaseSummaries(assessment, input);
  const facets = buildProcessExplorerFacets(summaries);
  cache = { signature: sig, input, assessment, summaries, facets };
  return cache;
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

/** Full detail for one case (every stage + the mined recommendations + a deterministic AI read). */
export function getProcessCaseDetail(caseId: string): ProcessCaseDetail | null {
  const c = ensure();
  return buildProcessCaseDetail(c.assessment, c.input, caseId, c.summaries);
}
