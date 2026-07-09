/**
 * Enterprise Process Mining Engine — reconstructs the REAL business processes the organization already
 * ran, purely from the production records the existing modules already persist. It is intelligence, not
 * automation: it discovers what happened, it never executes or changes anything. Nothing is fabricated —
 * every case, every stage, every timing is derived from real record ids, real cross-module link fields
 * (the same foreign keys the conversions already write), and real record timestamps. It owns no storage,
 * duplicates no Timeline / Audit / Search, and re-runs the existing reads.
 *
 * It reconstructs three end-to-end processes from their real FK backbones:
 *   • order_to_cash  — Lead → Contact → Customer → Quote → Order → Invoice → Payment
 *   • procure_to_pay — Purchase Request → Purchase Order → Goods Receipt → Inventory Movement
 *   • make_to_complete — Production Order → Production Schedule (completion)
 *
 * The process GRAPH is DISCOVERED, never hardcoded: cases are correlated by real links, then the
 * directly-follows relation (which activity actually preceded which, and how long the transition took)
 * is mined from the observed event ordering. Cycle / waiting / processing / idle / queue times,
 * bottlenecks, rework, approval delays, resource utilization, completion rate and automation coverage
 * are all computed deterministically from those real timings. The AI narrative composes the computed
 * numbers into an executive summary + risks + recommendations; it never invents a fact.
 *
 * Pure + linear: correlation is union-find (near-linear), discovery + metrics are single passes, so it
 * scales to 100,000+ events without rescanning. Types-only module — no I/O, no Electron.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import type { ExecutiveKpi, ExecutiveRecommendation, ExecRecoPriority } from './executiveCenter';

/* ── process taxonomy (which real process a record belongs to) ─────────────────── */

export type ProcessType = 'order_to_cash' | 'procure_to_pay' | 'make_to_complete';

export const PROCESS_TYPES: readonly ProcessType[] = ['order_to_cash', 'procure_to_pay', 'make_to_complete'];

export const PROCESS_TYPE_LABEL: Record<ProcessType, string> = {
  order_to_cash: 'Order-to-Cash',
  procure_to_pay: 'Procure-to-Pay',
  make_to_complete: 'Make-to-Complete',
};

/* ── a single reconstructed process event (one activity occurrence in a case) ──── */

export interface ProcessObservation {
  /** The responsible module (real). */
  moduleId: string;
  /** The real record id — the primary correlation key. */
  recordId: string;
  /** The record's human key (its title, e.g. SO-1) — used for display + deterministic name joins. */
  recordKey: string;
  processType: ProcessType;
  /** Canonical activity label (Quote, Order, …). */
  activity: string;
  /** Canonical position of the activity in its process (display ordering only — edges are discovered). */
  rank: number;
  /** Real stage-entry time (record.createdAt), ms epoch. */
  timestampMs: number;
  /** Real stage-closed time (record.updatedAt), ms epoch — the record's last activity. */
  closedAtMs: number;
  /** Real actor/owner. */
  resource: string;
  /** Real record status at read time. */
  status: string;
  /** Deterministic: was this stage produced by a system reconciler (vs. entered by a human)? */
  automated: boolean;
  /** This stage gates progression (needs approval) — e.g. Quote, Purchase Request, Production Order. */
  approvalGate: boolean;
  /** A terminal activity for its process (Payment, Movement, completed Schedule). */
  terminal: boolean;
  /** May be referenced by `recordKey` (name/number), not only by id — customers, production orders. */
  nameAddressable: boolean;
  /** Real FK values this record references (ids and/or names) — the correlation edges. */
  links: string[];
}

/* ── the input: the real record buckets (already read by the caller; no new stores) ── */

export interface ProcessMiningInput {
  leads?: EnterpriseEntity[];
  contacts?: EnterpriseEntity[];
  customers?: EnterpriseEntity[];
  quotes?: EnterpriseEntity[];
  orders?: EnterpriseEntity[];
  invoices?: EnterpriseEntity[];
  payments?: EnterpriseEntity[];
  purchaseRequests?: EnterpriseEntity[];
  purchaseOrders?: EnterpriseEntity[];
  goodsReceipts?: EnterpriseEntity[];
  movements?: EnterpriseEntity[];
  productionOrders?: EnterpriseEntity[];
  schedules?: EnterpriseEntity[];
}

/* ── coercion helpers ──────────────────────────────────────────────────────────── */

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const ms = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};
const HOUR = 60 * 60 * 1000;
function round(n: number): number {
  return Math.round(n);
}
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/* ── adapter: real records → process observations (deterministic, no fabrication) ─── */

interface ActivitySpec {
  processType: ProcessType;
  activity: string;
  rank: number;
  approvalGate?: boolean;
  terminal?: boolean;
  nameAddressable?: boolean;
}

/** Build one observation from a real record + its activity spec + the FK values it references. */
function toObservation(record: EnterpriseEntity, moduleId: string, spec: ActivitySpec, links: string[]): ProcessObservation {
  const created = ms(record.createdAt);
  const updated = Math.max(created, ms(record.updatedAt));
  return {
    moduleId,
    recordId: record.id,
    recordKey: record.title,
    processType: spec.processType,
    activity: spec.activity,
    rank: spec.rank,
    timestampMs: created,
    closedAtMs: updated,
    resource: str(record.createdBy) || str(record.updatedBy),
    status: record.status,
    automated: false,
    approvalGate: Boolean(spec.approvalGate),
    terminal: Boolean(spec.terminal),
    nameAddressable: Boolean(spec.nameAddressable),
    links: links.filter((l) => l !== ''),
  };
}

/**
 * Map every provided real record into a process observation, using ONLY the cross-module link fields the
 * modules already write (order.sourceQuote, invoice.sourceOrder, payment.invoiceRef, po.sourceRequest,
 * gr.purchaseOrder, movement.referenceRecord, schedule.productionOrder, contact/customer.sourceLead) and
 * the one deterministic name bridge (quote.customer → customer title). Inert artifacts are excluded: a
 * `void` stock movement (an inert proposal/reversal) is skipped so it never pollutes a real process.
 */
export function buildProcessObservations(input: ProcessMiningInput): ProcessObservation[] {
  const out: ProcessObservation[] = [];
  const f = (r: EnterpriseEntity, k: string): string => str(r.fields[k]);

  for (const r of input.leads ?? []) out.push(toObservation(r, 'crm-leads', { processType: 'order_to_cash', activity: 'Lead', rank: 0, approvalGate: true }, []));
  for (const r of input.contacts ?? []) out.push(toObservation(r, 'crm-contacts', { processType: 'order_to_cash', activity: 'Contact', rank: 1 }, [f(r, 'sourceLead')]));
  for (const r of input.customers ?? [])
    out.push(toObservation(r, 'crm-customers', { processType: 'order_to_cash', activity: 'Customer', rank: 2, nameAddressable: true }, [f(r, 'sourceLead')]));
  for (const r of input.quotes ?? [])
    out.push(toObservation(r, 'sales-quotes', { processType: 'order_to_cash', activity: 'Quote', rank: 3, approvalGate: true }, [f(r, 'customer')]));
  for (const r of input.orders ?? []) out.push(toObservation(r, 'sales-orders', { processType: 'order_to_cash', activity: 'Order', rank: 4 }, [f(r, 'sourceQuote')]));
  for (const r of input.invoices ?? []) out.push(toObservation(r, 'finance', { processType: 'order_to_cash', activity: 'Invoice', rank: 5 }, [f(r, 'sourceOrder')]));
  for (const r of input.payments ?? [])
    out.push(toObservation(r, 'finance-payments', { processType: 'order_to_cash', activity: 'Payment', rank: 6, terminal: true }, [f(r, 'invoiceRef')]));

  for (const r of input.purchaseRequests ?? [])
    out.push(toObservation(r, 'procurement-requests', { processType: 'procure_to_pay', activity: 'Purchase Request', rank: 0, approvalGate: true }, []));
  for (const r of input.purchaseOrders ?? [])
    out.push(toObservation(r, 'procurement-orders', { processType: 'procure_to_pay', activity: 'Purchase Order', rank: 1 }, [f(r, 'sourceRequest')]));
  for (const r of input.goodsReceipts ?? [])
    out.push(toObservation(r, 'procurement-receipts', { processType: 'procure_to_pay', activity: 'Goods Receipt', rank: 2 }, [f(r, 'purchaseOrder')]));
  for (const r of input.movements ?? []) {
    if (str(r.fields.status) === 'void') continue; // inert (proposal / reversal) — never a real process step
    const auto = f(r, 'referenceModule') !== '';
    const obsv = toObservation(r, 'inventory-movements', { processType: 'procure_to_pay', activity: 'Inventory Movement', rank: 3, terminal: true }, [f(r, 'referenceRecord')]);
    obsv.automated = auto; // a movement posted by another module's reconciler is system-generated
    out.push(obsv);
  }

  for (const r of input.productionOrders ?? [])
    out.push(toObservation(r, 'manufacturing-orders', { processType: 'make_to_complete', activity: 'Production Order', rank: 0, approvalGate: true, nameAddressable: true }, []));
  for (const r of input.schedules ?? [])
    out.push(toObservation(r, 'manufacturing-schedules', { processType: 'make_to_complete', activity: 'Production Schedule', rank: 1, terminal: true }, [f(r, 'productionOrder')]));

  return out;
}

/* ── correlation: union-find over the real links → process cases (traces) ────────── */

export interface ProcessStage {
  activity: string;
  moduleId: string;
  recordId: string;
  recordKey: string;
  enteredAtMs: number;
  closedAtMs: number;
  processingMs: number;
  resource: string;
  status: string;
  automated: boolean;
  approvalGate: boolean;
  terminal: boolean;
  rank: number;
}

export interface ProcessTrace {
  caseId: string;
  processType: ProcessType;
  stages: ProcessStage[];
  startedAtMs: number;
  endedAtMs: number;
  cycleTimeMs: number;
  processingMs: number;
  waitingMs: number;
  reworkCount: number;
  completed: boolean;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r];
    while (this.parent[x] !== r) {
      const next = this.parent[x];
      this.parent[x] = r;
      x = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/**
 * Correlate observations into process cases by following the real links, then assemble each case's
 * time-ordered stages + deterministic timings. A link matches its target by record id (primary) or, for
 * name-addressable targets only, by record key — so the one by-name bridge (quote → customer) works
 * without risking accidental cross-module title collisions. Near-linear: union-find + one sort per case.
 */
export function correlateProcessCases(observations: ProcessObservation[]): ProcessTrace[] {
  const n = observations.length;
  if (n === 0) return [];

  const byId = new Map<string, number>();
  const byKey = new Map<string, number>();
  observations.forEach((o, i) => {
    byId.set(o.recordId, i);
    if (o.nameAddressable && !byKey.has(o.recordKey)) byKey.set(o.recordKey, i);
  });

  const uf = new UnionFind(n);
  observations.forEach((o, i) => {
    for (const link of o.links) {
      const target = byId.get(link) ?? byKey.get(link);
      if (target !== undefined && target !== i) uf.union(i, target);
    }
  });

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = uf.find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }

  const traces: ProcessTrace[] = [];
  for (const idxs of groups.values()) {
    const stages: ProcessStage[] = idxs
      .map((i) => observations[i])
      .sort((a, b) => a.timestampMs - b.timestampMs || a.rank - b.rank)
      .map((o) => ({
        activity: o.activity,
        moduleId: o.moduleId,
        recordId: o.recordId,
        recordKey: o.recordKey,
        enteredAtMs: o.timestampMs,
        closedAtMs: o.closedAtMs,
        processingMs: Math.max(0, o.closedAtMs - o.timestampMs),
        resource: o.resource,
        status: o.status,
        automated: o.automated,
        approvalGate: o.approvalGate,
        terminal: o.terminal,
        rank: o.rank,
      }));

    const startedAtMs = stages[0].enteredAtMs;
    const endedAtMs = stages[stages.length - 1].enteredAtMs;
    const cycleTimeMs = Math.max(0, endedAtMs - startedAtMs);
    const processingMs = stages.reduce((s, st) => s + st.processingMs, 0);
    const waitingMs = Math.max(0, cycleTimeMs - processingMs);
    const seen = new Set<string>();
    let reworkCount = 0;
    for (const st of stages) {
      if (seen.has(st.activity)) reworkCount += 1;
      else seen.add(st.activity);
    }
    const last = stages[stages.length - 1];
    const completed = stages.some((s) => s.terminal) || last.status === 'done' || last.status === 'completed' || last.status === 'paid' || last.status === 'cleared';
    const processType = observations[idxs[0]].processType;

    traces.push({
      caseId: `${processType}:${stages[0].recordId}`,
      processType,
      stages,
      startedAtMs,
      endedAtMs,
      cycleTimeMs,
      processingMs,
      waitingMs,
      reworkCount,
      completed,
    });
  }

  return traces;
}

/* ── discovery: the directly-follows process graph (mined, never hardcoded) ──────── */

export interface ProcessGraphNode {
  activity: string;
  processType: ProcessType;
  count: number;
}
export interface ProcessGraphEdge {
  from: string;
  to: string;
  processType: ProcessType;
  count: number;
  meanDurationMs: number;
}
export interface ProcessGraph {
  nodes: ProcessGraphNode[];
  edges: ProcessGraphEdge[];
}

/**
 * Discover the process model by mining the directly-follows relation from the correlated traces: for
 * every consecutive (a → b) pair of stages actually observed in a case, count the transition and
 * accumulate its real duration. Nothing about the order is assumed — it is read from the data.
 */
export function discoverProcessGraph(traces: ProcessTrace[]): ProcessGraph {
  const nodes = new Map<string, ProcessGraphNode>();
  const edges = new Map<string, { edge: ProcessGraphEdge; totalMs: number }>();

  for (const trace of traces) {
    for (const st of trace.stages) {
      const nk = `${trace.processType}:${st.activity}`;
      const node = nodes.get(nk);
      if (node) node.count += 1;
      else nodes.set(nk, { activity: st.activity, processType: trace.processType, count: 1 });
    }
    for (let i = 0; i < trace.stages.length - 1; i += 1) {
      const a = trace.stages[i];
      const b = trace.stages[i + 1];
      if (a.activity === b.activity) continue; // self-loop (rework noise) not a transition
      const ek = `${trace.processType}:${a.activity}→${b.activity}`;
      const dur = Math.max(0, b.enteredAtMs - a.enteredAtMs);
      const found = edges.get(ek);
      if (found) {
        found.edge.count += 1;
        found.totalMs += dur;
        found.edge.meanDurationMs = round(found.totalMs / found.edge.count);
      } else {
        edges.set(ek, { edge: { from: a.activity, to: b.activity, processType: trace.processType, count: 1, meanDurationMs: dur }, totalMs: dur });
      }
    }
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => b.count - a.count),
    edges: [...edges.values()].map((e) => e.edge).sort((a, b) => b.meanDurationMs - a.meanDurationMs),
  };
}

/* ── metrics: deterministic process performance per process type + overall ───────── */

export interface ProcessMetrics {
  processType: ProcessType | 'all';
  caseCount: number;
  completedCount: number;
  completionRate: number;
  avgCycleHours: number;
  medianCycleHours: number;
  avgWaitingHours: number;
  avgProcessingHours: number;
  idleHours: number;
  queueHours: number;
  bottleneckActivity: string;
  bottleneckWaitHours: number;
  reworkRate: number;
  approvalDelayHours: number;
  resourceUtilization: number;
  automationCoverage: number;
}

function metricsFor(processType: ProcessType | 'all', traces: ProcessTrace[], graph: ProcessGraph): ProcessMetrics {
  const caseCount = traces.length;
  if (caseCount === 0) {
    return {
      processType, caseCount: 0, completedCount: 0, completionRate: 100, avgCycleHours: 0, medianCycleHours: 0,
      avgWaitingHours: 0, avgProcessingHours: 0, idleHours: 0, queueHours: 0, bottleneckActivity: '—',
      bottleneckWaitHours: 0, reworkRate: 0, approvalDelayHours: 0, resourceUtilization: 100, automationCoverage: 0,
    };
  }

  const cycles = traces.map((t) => t.cycleTimeMs);
  const completedCount = traces.filter((t) => t.completed).length;
  const totalProcessing = traces.reduce((s, t) => s + t.processingMs, 0);
  const totalWaiting = traces.reduce((s, t) => s + t.waitingMs, 0);
  const totalCycle = traces.reduce((s, t) => s + t.cycleTimeMs, 0);

  // Approval delay: mean duration of the transitions LEAVING an approval-gate stage (real waits).
  const approvalGaps: number[] = [];
  for (const t of traces) {
    for (let i = 0; i < t.stages.length - 1; i += 1) {
      if (t.stages[i].approvalGate) approvalGaps.push(t.stages[i + 1].enteredAtMs - t.stages[i].enteredAtMs);
    }
  }

  // Bottleneck: the slowest discovered transition for this scope (the activity you wait longest to leave).
  const scopedEdges = graph.edges.filter((e) => processType === 'all' || e.processType === processType);
  const bottleneck = scopedEdges.reduce<ProcessGraphEdge | null>((max, e) => (max === null || e.meanDurationMs > max.meanDurationMs ? e : max), null);

  const automatedStages = traces.reduce((s, t) => s + t.stages.filter((st) => st.automated).length, 0);
  const totalStages = traces.reduce((s, t) => s + t.stages.length, 0);
  const reworkCases = traces.filter((t) => t.reworkCount > 0).length;

  return {
    processType,
    caseCount,
    completedCount,
    completionRate: round((completedCount / caseCount) * 100),
    avgCycleHours: round(mean(cycles) / HOUR),
    medianCycleHours: round(median(cycles) / HOUR),
    avgWaitingHours: round(mean(traces.map((t) => t.waitingMs)) / HOUR),
    avgProcessingHours: round(mean(traces.map((t) => t.processingMs)) / HOUR),
    idleHours: round(totalWaiting / HOUR),
    queueHours: round(mean(traces.map((t) => t.waitingMs)) / HOUR),
    bottleneckActivity: bottleneck ? `${bottleneck.from} → ${bottleneck.to}` : '—',
    bottleneckWaitHours: bottleneck ? round(bottleneck.meanDurationMs / HOUR) : 0,
    reworkRate: round((reworkCases / caseCount) * 100),
    approvalDelayHours: round(mean(approvalGaps) / HOUR),
    // Resource utilization = share of elapsed cycle time that was active processing vs. idle waiting.
    resourceUtilization: totalCycle > 0 ? clamp(round((totalProcessing / totalCycle) * 100), 0, 100) : 100,
    automationCoverage: totalStages > 0 ? clamp(round((automatedStages / totalStages) * 100), 0, 100) : 0,
  };
}

/** Compute per-process-type metrics + an overall 'all' aggregate. Deterministic. */
export function computeProcessMetrics(traces: ProcessTrace[], graph: ProcessGraph): { byType: ProcessMetrics[]; overall: ProcessMetrics } {
  const byType = PROCESS_TYPES.map((pt) => metricsFor(pt, traces.filter((t) => t.processType === pt), graph)).filter((m) => m.caseCount > 0);
  return { byType, overall: metricsFor('all', traces, graph) };
}

/* ── executive insights + KPIs ───────────────────────────────────────────────────── */

export interface ProcessInsights {
  totalCases: number;
  avgProcessCycleHours: number;
  longestWaitingProcess: string;
  longestWaitingHours: number;
  fastestProcess: string;
  fastestHours: number;
  approvalDelayHours: number;
  productionDelayHours: number;
  purchaseDelayHours: number;
  revenueDelayHours: number;
  processHealth: number;
  automationCoverage: number;
}

/** A specific stage-to-stage delay averaged over the cases that contain both stages. Real timings only. */
function stageDelayHours(traces: ProcessTrace[], processType: ProcessType, fromActivity: string, toActivity: string): number {
  const gaps: number[] = [];
  for (const t of traces) {
    if (t.processType !== processType) continue;
    const from = t.stages.find((s) => s.activity === fromActivity);
    const to = [...t.stages].reverse().find((s) => s.activity === toActivity);
    if (from && to && to.enteredAtMs >= from.enteredAtMs) gaps.push(to.enteredAtMs - from.enteredAtMs);
  }
  return round(mean(gaps) / HOUR);
}

/** Roll traces + metrics into the executive process KPIs. Pure. */
export function deriveProcessInsights(traces: ProcessTrace[], metrics: { byType: ProcessMetrics[]; overall: ProcessMetrics }): ProcessInsights {
  const withCases = metrics.byType;
  const longest = withCases.reduce<ProcessMetrics | null>((max, m) => (max === null || m.avgWaitingHours > max.avgWaitingHours ? m : max), null);
  const fastest = withCases.reduce<ProcessMetrics | null>((min, m) => (min === null || m.avgCycleHours < min.avgCycleHours ? m : min), null);

  const completion = metrics.overall.completionRate;
  const automation = metrics.overall.automationCoverage;
  const util = metrics.overall.resourceUtilization;
  // Process health blends real completion, active-time utilization, and automation. Deterministic.
  const processHealth = clamp(round(0.5 * completion + 0.25 * util + 0.25 * automation), 0, 100);

  return {
    totalCases: traces.length,
    avgProcessCycleHours: metrics.overall.avgCycleHours,
    longestWaitingProcess: longest ? PROCESS_TYPE_LABEL[longest.processType as ProcessType] : '—',
    longestWaitingHours: longest ? longest.avgWaitingHours : 0,
    fastestProcess: fastest ? PROCESS_TYPE_LABEL[fastest.processType as ProcessType] : '—',
    fastestHours: fastest ? fastest.avgCycleHours : 0,
    approvalDelayHours: metrics.overall.approvalDelayHours,
    productionDelayHours: stageDelayHours(traces, 'make_to_complete', 'Production Order', 'Production Schedule'),
    purchaseDelayHours: stageDelayHours(traces, 'procure_to_pay', 'Purchase Request', 'Goods Receipt'),
    revenueDelayHours: stageDelayHours(traces, 'order_to_cash', 'Order', 'Payment'),
    processHealth,
    automationCoverage: automation,
  };
}

function hoursDisplay(h: number): string {
  if (h <= 0) return '0h';
  if (h < 48) return `${h}h`;
  return `${round(h / 24)}d`;
}
function delayBand(h: number): ExecutiveKpi['band'] {
  if (h <= 24) return 'healthy';
  if (h <= 72) return 'watch';
  if (h <= 168) return 'at-risk';
  return 'critical';
}
function pctBand(v: number): ExecutiveKpi['band'] {
  return v >= 90 ? 'healthy' : v >= 75 ? 'watch' : v >= 50 ? 'at-risk' : 'critical';
}

/** Map process insights to the nine Executive Center KPI tiles. Reuses the existing KPI type. */
export function processInsightsToKpis(insights: ProcessInsights): ExecutiveKpi[] {
  return [
    { key: 'proc-avg-cycle', label: 'Average Process Cycle', value: insights.avgProcessCycleHours, display: hoursDisplay(insights.avgProcessCycleHours), band: delayBand(insights.avgProcessCycleHours), deepLink: 'enterprise/executive' },
    { key: 'proc-longest-wait', label: 'Longest Waiting Process', value: insights.longestWaitingHours, display: `${insights.longestWaitingProcess} · ${hoursDisplay(insights.longestWaitingHours)}`, band: delayBand(insights.longestWaitingHours), deepLink: 'enterprise/executive' },
    { key: 'proc-fastest', label: 'Fastest Process', value: insights.fastestHours, display: `${insights.fastestProcess} · ${hoursDisplay(insights.fastestHours)}`, band: 'healthy', deepLink: 'enterprise/executive' },
    { key: 'proc-approval-delay', label: 'Approval Delay', value: insights.approvalDelayHours, display: hoursDisplay(insights.approvalDelayHours), band: delayBand(insights.approvalDelayHours), deepLink: 'enterprise/executive' },
    { key: 'proc-production-delay', label: 'Production Delay', value: insights.productionDelayHours, display: hoursDisplay(insights.productionDelayHours), band: delayBand(insights.productionDelayHours), deepLink: 'enterprise/executive' },
    { key: 'proc-purchase-delay', label: 'Purchase Delay', value: insights.purchaseDelayHours, display: hoursDisplay(insights.purchaseDelayHours), band: delayBand(insights.purchaseDelayHours), deepLink: 'enterprise/executive' },
    { key: 'proc-revenue-delay', label: 'Revenue Delay', value: insights.revenueDelayHours, display: hoursDisplay(insights.revenueDelayHours), band: delayBand(insights.revenueDelayHours), deepLink: 'enterprise/executive' },
    { key: 'proc-health', label: 'Process Health', value: insights.processHealth, display: `${insights.processHealth}%`, band: pctBand(insights.processHealth), deepLink: 'enterprise/executive' },
    { key: 'proc-automation', label: 'Automation Coverage', value: insights.automationCoverage, display: `${insights.automationCoverage}%`, band: pctBand(insights.automationCoverage), deepLink: 'enterprise/executive' },
  ];
}

/* ── recommendations (deterministic, from real bottlenecks) ──────────────────────── */

function rank(priority: ExecRecoPriority, confidence: number): number {
  const base: Record<ExecRecoPriority, number> = { critical: 1000, high: 700, medium: 400, low: 100 };
  return round(base[priority] + confidence * 100);
}

/** Surface the slowest real transitions + rework as ranked executive recommendations. Never fabricated. */
export function buildProcessRecommendations(metrics: { byType: ProcessMetrics[]; overall: ProcessMetrics }): ExecutiveRecommendation[] {
  const recs: ExecutiveRecommendation[] = [];

  for (const m of metrics.byType) {
    if (m.bottleneckWaitHours > 24 && m.bottleneckActivity !== '—') {
      const priority: ExecRecoPriority = m.bottleneckWaitHours > 168 ? 'critical' : m.bottleneckWaitHours > 72 ? 'high' : 'medium';
      recs.push({
        id: `proc:bottleneck:${m.processType}`,
        metric: 'process',
        icon: 'clock',
        problem: `${PROCESS_TYPE_LABEL[m.processType as ProcessType]} bottleneck — the "${m.bottleneckActivity}" transition averages ${hoursDisplay(m.bottleneckWaitHours)}.`,
        businessImpact: 'The slowest hand-off sets the pace of the whole process; every case waits here.',
        rootCause: `Discovered directly-follows analysis: "${m.bottleneckActivity}" is the longest real transition across ${m.caseCount} case(s).`,
        priority,
        confidence: 0.9,
        expectedOutcome: `Cutting the "${m.bottleneckActivity}" wait shortens the ${PROCESS_TYPE_LABEL[m.processType as ProcessType]} cycle (${hoursDisplay(m.avgCycleHours)} today).`,
        evidence: [`bottleneck=${m.bottleneckActivity}`, `wait=${m.bottleneckWaitHours}h`, `avgCycle=${m.avgCycleHours}h`, `cases=${m.caseCount}`],
        sourceSystems: ['timeline', 'enterprise-records'],
        recommendedAction: `Review the "${m.bottleneckActivity}" hand-off in ${PROCESS_TYPE_LABEL[m.processType as ProcessType]}.`,
        owner: 'Operations Lead',
        eta: priority === 'critical' ? 'today' : 'this week',
        status: 'open',
        score: rank(priority, 0.9),
      });
    }
    if (m.reworkRate >= 20) {
      recs.push({
        id: `proc:rework:${m.processType}`,
        metric: 'process',
        icon: 'refresh-cw',
        problem: `${PROCESS_TYPE_LABEL[m.processType as ProcessType]} rework — ${m.reworkRate}% of cases repeat a stage.`,
        businessImpact: 'Rework loops add cycle time and cost without adding value.',
        rootCause: `${m.reworkRate}% of ${m.caseCount} case(s) re-entered an activity already visited.`,
        priority: m.reworkRate >= 40 ? 'high' : 'medium',
        confidence: 0.85,
        expectedOutcome: 'Eliminating repeated stages removes non-value-adding cycle time.',
        evidence: [`reworkRate=${m.reworkRate}%`, `cases=${m.caseCount}`],
        sourceSystems: ['timeline', 'enterprise-records'],
        recommendedAction: `Trace the repeated stages in ${PROCESS_TYPE_LABEL[m.processType as ProcessType]} and fix the upstream cause.`,
        owner: 'Operations Lead',
        eta: 'this week',
        status: 'open',
        score: rank(m.reworkRate >= 40 ? 'high' : 'medium', 0.85),
      });
    }
  }

  if (metrics.overall.caseCount > 0 && metrics.overall.completionRate < 75) {
    recs.push({
      id: 'proc:completion',
      metric: 'process',
      icon: 'alert-triangle',
      problem: `Only ${metrics.overall.completionRate}% of reconstructed processes reached a terminal stage.`,
      businessImpact: 'Cases stalling before completion tie up revenue, inventory, and capacity.',
      rootCause: `${metrics.overall.caseCount - metrics.overall.completedCount} of ${metrics.overall.caseCount} case(s) have no terminal event.`,
      priority: metrics.overall.completionRate < 50 ? 'high' : 'medium',
      confidence: 0.8,
      expectedOutcome: 'Closing stalled cases lifts completion rate and frees working capital.',
      evidence: [`completion=${metrics.overall.completionRate}%`, `open=${metrics.overall.caseCount - metrics.overall.completedCount}`],
      sourceSystems: ['timeline', 'enterprise-records'],
      recommendedAction: 'Review the open cases that never reached a terminal stage.',
      owner: 'Operations Lead',
      eta: 'this week',
      status: 'open',
      score: rank(metrics.overall.completionRate < 50 ? 'high' : 'medium', 0.8),
    });
  }

  return recs.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/* ── deterministic AI narrative (composes the computed numbers; invents nothing) ──── */

export interface ProcessMiningNarrative {
  executiveSummary: string;
  operationalRisks: string[];
  delayCauses: string[];
  recommendations: string[];
  bestPractices: string[];
  grounded: boolean;
}

export function summarizeProcessMining(insights: ProcessInsights, metrics: { byType: ProcessMetrics[]; overall: ProcessMetrics }): ProcessMiningNarrative {
  const o = metrics.overall;
  const executiveSummary =
    insights.totalCases === 0
      ? 'No end-to-end processes could be reconstructed yet — there are not enough linked records across modules.'
      : `Reconstructed ${insights.totalCases} process case(s) across ${metrics.byType.length} process type(s) from real records. ` +
        `Average cycle ${hoursDisplay(insights.avgProcessCycleHours)}, completion ${o.completionRate}%, automation ${o.automationCoverage}%, health ${insights.processHealth}%. ` +
        `The slowest process is ${insights.longestWaitingProcess} (avg wait ${hoursDisplay(insights.longestWaitingHours)}); the fastest is ${insights.fastestProcess} (${hoursDisplay(insights.fastestHours)}).`;

  const operationalRisks: string[] = [];
  if (o.completionRate < 75) operationalRisks.push(`Completion at ${o.completionRate}% — cases are stalling before a terminal stage.`);
  if (insights.approvalDelayHours > 48) operationalRisks.push(`Approvals average ${hoursDisplay(insights.approvalDelayHours)} — governance is on the critical path.`);
  if (o.reworkRate >= 20) operationalRisks.push(`${o.reworkRate}% of cases contain rework loops.`);
  if (o.resourceUtilization < 40) operationalRisks.push(`Only ${o.resourceUtilization}% of cycle time is active work — the rest is waiting/queue.`);

  const delayCauses = metrics.byType
    .filter((m) => m.bottleneckActivity !== '—' && m.bottleneckWaitHours > 0)
    .map((m) => `${PROCESS_TYPE_LABEL[m.processType as ProcessType]}: the "${m.bottleneckActivity}" transition is the bottleneck (${hoursDisplay(m.bottleneckWaitHours)}).`);

  const recommendations: string[] = [];
  if (insights.revenueDelayHours > 24) recommendations.push(`Shorten Order→Payment (${hoursDisplay(insights.revenueDelayHours)}) to accelerate cash.`);
  if (insights.purchaseDelayHours > 24) recommendations.push(`Shorten Request→Goods-Receipt (${hoursDisplay(insights.purchaseDelayHours)}) to speed procurement.`);
  if (insights.productionDelayHours > 24) recommendations.push(`Shorten Production-Order→Schedule (${hoursDisplay(insights.productionDelayHours)}) to release work sooner.`);
  if (o.automationCoverage < 50) recommendations.push(`Automation coverage is ${o.automationCoverage}% — more system-posted steps would cut manual latency.`);

  const bestPractices = [
    'Correlate every case by real record links — never infer a flow that the data does not show.',
    'Track the directly-follows bottleneck per process; it sets the achievable cycle time.',
    'Keep terminal events explicit so completion rate stays trustworthy.',
  ];

  return { executiveSummary, operationalRisks, delayCauses, recommendations, bestPractices, grounded: true };
}

/* ── one-call assessment (the entry point the Executive Center subsystem uses) ────── */

export interface ProcessMiningAssessment {
  traces: ProcessTrace[];
  graph: ProcessGraph;
  metrics: { byType: ProcessMetrics[]; overall: ProcessMetrics };
  insights: ProcessInsights;
  recommendations: ExecutiveRecommendation[];
  narrative: ProcessMiningNarrative;
}

/**
 * Reconstruct → discover → measure → explain, in one deterministic pass over the real records. Read-only:
 * it creates no records and mutates no input. Linear in the number of observations (single correlation +
 * single discovery + single metrics pass), so it scales to 100,000+ events without rescanning.
 */
export function assessProcessMining(input: ProcessMiningInput): ProcessMiningAssessment {
  const observations = buildProcessObservations(input);
  const traces = correlateProcessCases(observations);
  const graph = discoverProcessGraph(traces);
  const metrics = computeProcessMetrics(traces, graph);
  const insights = deriveProcessInsights(traces, metrics);
  const recommendations = buildProcessRecommendations(metrics);
  const narrative = summarizeProcessMining(insights, metrics);
  return { traces, graph, metrics, insights, recommendations, narrative };
}
