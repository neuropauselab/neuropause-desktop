/**
 * Enterprise Trust Engine — a DETERMINISTIC per-entity trust score composed from the platform's existing
 * signals. It EXTENDS (never duplicates) Relationship Intelligence, Audit/Governance, Process Mining,
 * Quality, Maintenance, Finance, Sales, Procurement, Decision Engine and Knowledge: it reads their
 * already-computed outputs and joins them per entity into a Trust Profile. Trust is NEVER AI-generated
 * and NEVER random — every score is a weighted average of deterministic factors, each derived from real
 * records, and a factor with NO evidence is EXCLUDED (never defaulted to 100) so a score always reflects
 * real signal. The AI layer only explains; it never calculates.
 *
 * Inputs → factors: Relationship Health, Quality Pass Rate, Payment History, Delivery Reliability (late
 * deliveries), Machine Reliability (+ downtime), Maintenance Compliance, Execution Accuracy, Decision
 * Success, Knowledge Freshness, Document Completeness, Process Compliance, and Policy/Audit Compliance.
 * Output: per-entity {score 0..100, level, factors, deterministic trend + sparkline, risk, coverage},
 * nine Executive trust KPIs, a level distribution, and a grounded narrative. Pure (no I/O); the clock
 * (`nowMs`) is injected so recency + trend are deterministic.
 */
import type { ExecutiveKpi } from './executiveCenter';

/* ── minimal structural inputs (satisfied by the real projections + reused models) ── */

interface Ts { updatedAt?: string; createdAt?: string; }

export interface TrustRelNode { id: string; kind: string; key: string; label: string; health: string; risk: number; degree: number; resolved: boolean; }
export interface TrustExecution extends Ts { executionNumber?: string; machine?: string; operator?: string; product?: string; productionOrder?: string; schedule?: string; status?: string; inspectionResult?: string; goodQuantity?: number; scrapQuantity?: number; }
export interface TrustInspection { productionOrder?: string; inspector?: string; result?: string; passedQuantity?: number; failedQuantity?: number; reworkQuantity?: number; }
export interface TrustInvoice { number: string; customer?: string; amount?: number; amountPaid?: number; status?: string; dueDate?: string | null; }
export interface TrustPayment extends Ts { paymentNumber: string; invoiceRef?: string; customer?: string; amount?: number; status?: string; receivedDate?: string; }
export interface TrustOrder extends Ts { orderNumber: string; customer?: string; status?: string; expectedDeliveryDate?: string; deliveredDate?: string; }
export interface TrustPurchaseOrder extends Ts { poNumber: string; supplier?: string; status?: string; }
export interface TrustGoodsReceipt extends Ts { grNumber: string; supplier?: string; purchaseOrder?: string; status?: string; expectedDate?: string; receiptDate?: string; quantityOrdered?: number; quantityReceived?: number; }
export interface TrustMachine { name: string; status?: string; runtime?: number; downtime?: number; }
export interface TrustDowntime { machine?: string; type?: string; durationHours?: number; }
export interface TrustWorkOrder extends Ts { workOrderNumber: string; machine?: string; asset?: string; technician?: string; type?: string; status?: string; result?: string; scheduledDate?: string; completedDate?: string; }
export interface TrustPreventive { machine?: string; status?: string; }
export interface TrustDecision { decisionId: string; status?: string; affectedMachines?: string[]; affectedCustomers?: string[]; affectedOrders?: string[]; verifiedBy?: string; }
export interface TrustProposal { proposalNumber: string; status?: string; sourceDecisionId?: string; }
export interface TrustMemory { id: string; kind?: string; title?: string; content?: string; origin?: string; entityRefs?: string[]; updatedAt?: string; occurredAt?: string | null; }
export interface TrustAuditEntry { target?: string; action?: string; at?: string; }
export interface TrustComplianceFinding { category?: string; status?: string; severity?: string; evidence?: string[]; }
export interface TrustProcessMetric { processType: string; completionRate?: number; reworkRate?: number; caseCount?: number; }

export interface TrustEngineInput {
  relationshipNodes?: TrustRelNode[];
  executions?: TrustExecution[];
  inspections?: TrustInspection[];
  invoices?: TrustInvoice[];
  payments?: TrustPayment[];
  orders?: TrustOrder[];
  purchaseOrders?: TrustPurchaseOrder[];
  goodsReceipts?: TrustGoodsReceipt[];
  machines?: TrustMachine[];
  downtime?: TrustDowntime[];
  workOrders?: TrustWorkOrder[];
  preventives?: TrustPreventive[];
  decisions?: TrustDecision[];
  proposals?: TrustProposal[];
  memories?: TrustMemory[];
  audit?: TrustAuditEntry[];
  compliance?: TrustComplianceFinding[];
  processMetrics?: TrustProcessMetric[];
  /** Global decision governance (from deriveApprovalInsights / deriveHandoffInsights). */
  approval?: { recoverySuccessRate?: number; averageVerificationAccuracy?: number };
  handoff?: { executionReadiness?: number; proposalAcceptanceRate?: number };
}

/* ── output vocabulary ─────────────────────────────────────────────────────────── */

export type EntityTrustLevel = 'excellent' | 'good' | 'moderate' | 'low' | 'critical';
export type TrustEntityKind =
  | 'customer' | 'supplier' | 'employee' | 'machine' | 'product' | 'warehouse' | 'workCenter' | 'asset'
  | 'process' | 'decision' | 'proposal' | 'knowledge' | 'document'
  | 'productionOrder' | 'schedule' | 'execution' | 'quality' | 'workOrder' | 'downtime'
  | 'payment' | 'invoice' | 'purchaseOrder' | 'goodsReceipt' | 'order' | 'quote' | 'bom';
export type TrustFactorKey =
  | 'relationship_health' | 'quality_pass_rate' | 'payment_history' | 'delivery_reliability'
  | 'machine_reliability' | 'maintenance_compliance' | 'execution_accuracy' | 'decision_success'
  | 'knowledge_freshness' | 'document_completeness' | 'process_compliance' | 'policy_compliance';
export type TrustTrendDirection = 'up' | 'down' | 'flat';

export interface TrustFactor { key: TrustFactorKey; label: string; value: number; weight: number; contribution: number; detail: string; }
export interface TrustTrend { direction: TrustTrendDirection; delta: number; sparkline: number[]; }
export interface TrustProfile {
  id: string;
  kind: TrustEntityKind;
  key: string;
  label: string;
  score: number;
  level: EntityTrustLevel;
  risk: number;
  coverage: number;
  factors: TrustFactor[];
  trend: TrustTrend;
  updatedAt: string;
}

export interface TrustInsights {
  totalProfiles: number;
  enterpriseTrust: number;
  averageScore: number;
  byLevel: Record<EntityTrustLevel, number>;
  excellentCount: number;
  criticalCount: number;
  lowTrustCount: number;
  highRiskCount: number;
  customerTrust: number;
  supplierTrust: number;
  machineTrust: number;
  knowledgeTrust: number;
  decisionTrust: number;
  processTrust: number;
  operationalTrust: number;
  complianceTrust: number;
}

export interface TrustNarrative {
  summary: string;
  executiveExplanation: string;
  improvementRecommendations: string[];
  rootCauseExplanation: string;
  complianceSummary: string;
  grounded: boolean;
}

export interface EnterpriseTrustModel {
  generatedAtMs: number;
  profiles: TrustProfile[];
  insights: TrustInsights;
  kpis: ExecutiveKpi[];
  counts: { profiles: number; byKind: Record<string, number>; byLevel: Record<string, number> };
  atRisk: TrustProfile[];
  topTrusted: TrustProfile[];
  trend: TrustTrend;
  narrative: TrustNarrative;
}

/* ── helpers ───────────────────────────────────────────────────────────────────── */

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round = (n: number): number => Math.round(n);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : round(xs.reduce((a, b) => a + b, 0) / xs.length));
function parseMs(s: string | null | undefined): number { if (!s) return 0; const ms = Date.parse(s); return Number.isFinite(ms) ? ms : 0; }

export function trustLevel(score: number): EntityTrustLevel {
  return score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 55 ? 'moderate' : score >= 35 ? 'low' : 'critical';
}

const HEALTH_BASE: Record<string, number> = { strong: 100, healthy: 85, weak: 55, dormant: 45, broken: 20, critical: 12 };

const FACTOR_LABELS: Record<TrustFactorKey, string> = {
  relationship_health: 'Relationship Health',
  quality_pass_rate: 'Quality Pass Rate',
  payment_history: 'Payment History',
  delivery_reliability: 'Delivery Reliability',
  machine_reliability: 'Machine Reliability',
  maintenance_compliance: 'Maintenance Compliance',
  execution_accuracy: 'Execution Accuracy',
  decision_success: 'Decision Success',
  knowledge_freshness: 'Knowledge Freshness',
  document_completeness: 'Document Completeness',
  process_compliance: 'Process Compliance',
  policy_compliance: 'Policy & Audit Compliance',
};

/** Which factors (and relative weights) apply to each entity kind. */
const FACTORS_BY_KIND: Partial<Record<TrustEntityKind, Partial<Record<TrustFactorKey, number>>>> = {
  customer: { relationship_health: 2, payment_history: 3, delivery_reliability: 2, policy_compliance: 1 },
  supplier: { relationship_health: 2, delivery_reliability: 3, policy_compliance: 1 },
  employee: { quality_pass_rate: 2, maintenance_compliance: 2, execution_accuracy: 2 },
  machine: { relationship_health: 1, machine_reliability: 3, maintenance_compliance: 2, quality_pass_rate: 1 },
  product: { relationship_health: 1, quality_pass_rate: 3 },
  warehouse: { relationship_health: 2, policy_compliance: 1 },
  workCenter: { relationship_health: 2 },
  asset: { relationship_health: 1, maintenance_compliance: 2 },
  process: { process_compliance: 3 },
  decision: { relationship_health: 1, decision_success: 3, policy_compliance: 1 },
  proposal: { relationship_health: 1, execution_accuracy: 2 },
  knowledge: { knowledge_freshness: 3, document_completeness: 2 },
  document: { document_completeness: 3, knowledge_freshness: 2 },
  productionOrder: { relationship_health: 1, execution_accuracy: 2, quality_pass_rate: 2 },
  schedule: { relationship_health: 1, execution_accuracy: 2 },
  execution: { relationship_health: 1, execution_accuracy: 2, quality_pass_rate: 1 },
  quality: { relationship_health: 1, quality_pass_rate: 3 },
  workOrder: { relationship_health: 1, maintenance_compliance: 3 },
  downtime: { relationship_health: 1 },
  payment: { relationship_health: 1, payment_history: 3 },
  invoice: { relationship_health: 1, payment_history: 3 },
  purchaseOrder: { relationship_health: 1, delivery_reliability: 2 },
  goodsReceipt: { relationship_health: 1, delivery_reliability: 2 },
  order: { relationship_health: 1, delivery_reliability: 3 },
  quote: { relationship_health: 2 },
  bom: { relationship_health: 2 },
};

function relKindToTrustKind(k: string): TrustEntityKind {
  return k === 'technician' ? 'employee' : (k as TrustEntityKind);
}

/* ── deterministic trend (bucketed success rate over the last 6 windows) ────────── */

interface DatedFlag { ms: number; good: boolean; }
const BUCKETS = 6;
const BUCKET_MS = 30 * 86_400_000;

/** Deterministic trend from dated success/failure events: 6 monthly buckets of success-rate. Pure. */
function windowedTrend(events: DatedFlag[], fallback: number, nowMs: number): TrustTrend {
  if (events.length === 0) return { direction: 'flat', delta: 0, sparkline: [fallback, fallback] };
  const good = new Array(BUCKETS).fill(0);
  const total = new Array(BUCKETS).fill(0);
  for (const e of events) {
    if (e.ms <= 0) continue;
    const idx = Math.floor((nowMs - e.ms) / BUCKET_MS);
    if (idx < 0 || idx >= BUCKETS) continue;
    total[idx] += 1;
    if (e.good) good[idx] += 1;
  }
  // Oldest → newest; empty buckets carry the overall rate so the line stays grounded (never invented).
  const overall = round((events.filter((e) => e.good).length / events.length) * 100);
  const sparkline: number[] = [];
  for (let b = BUCKETS - 1; b >= 0; b -= 1) sparkline.push(total[b] > 0 ? round((good[b] / total[b]) * 100) : overall);
  const first = sparkline[0];
  const last = sparkline[sparkline.length - 1];
  const delta = last - first;
  return { direction: delta > 4 ? 'up' : delta < -4 ? 'down' : 'flat', delta, sparkline };
}

/* ── the builder ───────────────────────────────────────────────────────────────── */

/** Compose the deterministic per-entity trust model from the existing subsystem signals. Pure. */
export function buildTrustModel(input: TrustEngineInput, nowMs: number): EnterpriseTrustModel {
  // ── aggregate signals into per-entity maps (deterministic, evidence-gated) ──
  const qualityByKey = new Map<string, { good: number; scrap: number; pass: number; fail: number; events: DatedFlag[] }>();
  const bumpQuality = (mapKey: string, good: number, scrap: number, passed: boolean, ms: number): void => {
    const q = qualityByKey.get(mapKey) ?? { good: 0, scrap: 0, pass: 0, fail: 0, events: [] };
    q.good += Math.max(0, good); q.scrap += Math.max(0, scrap);
    if (passed) q.pass += 1; else q.fail += 1;
    if (ms > 0) q.events.push({ ms, good: passed });
    qualityByKey.set(mapKey, q);
  };
  for (const e of input.executions ?? []) {
    const ms = parseMs(e.updatedAt || e.createdAt);
    const passed = e.inspectionResult === 'pass' || (e.inspectionResult !== 'fail' && e.inspectionResult !== 'rework' && Math.max(0, e.scrapQuantity ?? 0) === 0 && (e.goodQuantity ?? 0) > 0);
    const g = Math.max(0, e.goodQuantity ?? 0); const s = Math.max(0, e.scrapQuantity ?? 0);
    if (g + s === 0 && !e.inspectionResult) continue; // no quality evidence
    for (const [dim, key] of [['product', e.product], ['machine', e.machine], ['employee', e.operator], ['productionOrder', e.productionOrder]] as const) {
      if (key) bumpQuality(`${dim}:${key}`, g, s, passed, ms);
    }
  }
  for (const q of input.inspections ?? []) {
    if (!q.productionOrder && !q.inspector) continue;
    const passed = q.result === 'pass';
    const good = Math.max(0, q.passedQuantity ?? 0); const scrap = Math.max(0, (q.failedQuantity ?? 0) + (q.reworkQuantity ?? 0));
    if (q.productionOrder) bumpQuality(`productionOrder:${q.productionOrder}`, good, scrap, passed, 0);
    if (q.inspector) bumpQuality(`employee:${q.inspector}`, good, scrap, passed, 0);
  }

  // execution accuracy per productionOrder / schedule / execution
  const execByKey = new Map<string, { ok: number; bad: number; events: DatedFlag[] }>();
  const bumpExec = (mapKey: string, ok: boolean, ms: number): void => {
    const x = execByKey.get(mapKey) ?? { ok: 0, bad: 0, events: [] };
    if (ok) x.ok += 1; else x.bad += 1;
    if (ms > 0) x.events.push({ ms, good: ok });
    execByKey.set(mapKey, x);
  };
  for (const e of input.executions ?? []) {
    const ms = parseMs(e.updatedAt || e.createdAt);
    const ok = e.status === 'completed';
    const bad = e.status === 'blocked' || e.status === 'cancelled';
    if (!ok && !bad && e.status !== 'paused') continue; // in-flight neutral states give no accuracy evidence
    for (const [dim, key] of [['productionOrder', e.productionOrder], ['schedule', e.schedule], ['execution', e.executionNumber], ['machine', e.machine]] as const) {
      if (key) bumpExec(`${dim}:${key}`, ok, ms);
    }
  }

  // payment history per customer + per invoice
  const invoiceById = new Map<string, TrustInvoice>();
  for (const i of input.invoices ?? []) invoiceById.set(i.number, i);
  const paymentByCustomer = new Map<string, { onTime: number; late: number; overdueAmt: number; events: DatedFlag[] }>();
  const invoiceState = new Map<string, { overdue: boolean; paidShare: number }>();
  for (const i of input.invoices ?? []) {
    const total = Math.max(0, i.amount ?? 0);
    const paid = clamp(i.amountPaid ?? 0, 0, total || (i.amountPaid ?? 0));
    const outstanding = Math.max(0, total - paid);
    const overdue = i.status === 'overdue' || (!!i.dueDate && parseMs(i.dueDate) > 0 && parseMs(i.dueDate) < nowMs && outstanding > 0);
    invoiceState.set(i.number, { overdue, paidShare: total > 0 ? clamp(round((paid / total) * 100), 0, 100) : i.status === 'paid' ? 100 : 0 });
    if (i.customer) {
      const c = paymentByCustomer.get(i.customer) ?? { onTime: 0, late: 0, overdueAmt: 0, events: [] };
      if (overdue) { c.late += 1; c.overdueAmt += outstanding; } else if (i.status === 'paid') c.onTime += 1;
      paymentByCustomer.set(i.customer, c);
    }
  }
  for (const p of input.payments ?? []) {
    if (!p.customer) continue;
    const inv = p.invoiceRef ? invoiceById.get(p.invoiceRef) : undefined;
    const late = !!inv?.dueDate && !!p.receivedDate && parseMs(p.receivedDate) > parseMs(inv.dueDate);
    const c = paymentByCustomer.get(p.customer) ?? { onTime: 0, late: 0, overdueAmt: 0, events: [] };
    const ms = parseMs(p.receivedDate || p.updatedAt);
    if (p.status !== 'void') { if (late) c.late += 1; else c.onTime += 1; if (ms > 0) c.events.push({ ms, good: !late }); }
    paymentByCustomer.set(p.customer, c);
  }

  // delivery reliability per customer (orders) + per supplier (receipts)
  const deliveryByKey = new Map<string, { onTime: number; late: number; events: DatedFlag[] }>();
  const bumpDelivery = (mapKey: string, onTime: boolean, ms: number): void => {
    const d = deliveryByKey.get(mapKey) ?? { onTime: 0, late: 0, events: [] };
    if (onTime) d.onTime += 1; else d.late += 1;
    if (ms > 0) d.events.push({ ms, good: onTime });
    deliveryByKey.set(mapKey, d);
  };
  for (const o of input.orders ?? []) {
    const delivered = o.status === 'fulfilled' || o.status === 'closed';
    const open = o.status === 'pending' || o.status === 'shipped';
    const exp = parseMs(o.expectedDeliveryDate);
    if (delivered && o.deliveredDate && exp > 0) { const ms = parseMs(o.deliveredDate); if (o.customer) bumpDelivery(`customer:${o.customer}`, ms <= exp, ms); }
    else if (open && exp > 0 && exp < nowMs && o.customer) bumpDelivery(`customer:${o.customer}`, false, parseMs(o.updatedAt)); // late & undelivered
  }
  for (const gr of input.goodsReceipts ?? []) {
    if (gr.status === 'rejected' && gr.supplier) { bumpDelivery(`supplier:${gr.supplier}`, false, parseMs(gr.receiptDate || gr.updatedAt)); continue; }
    if (gr.status !== 'received') continue;
    const exp = parseMs(gr.expectedDate); const rec = parseMs(gr.receiptDate);
    if (exp > 0 && rec > 0 && gr.supplier) bumpDelivery(`supplier:${gr.supplier}`, rec <= exp, rec);
  }

  // machine reliability + maintenance compliance per machine / employee(technician)
  const downtimeByMachine = new Map<string, { hours: number; unplanned: number; events: number }>();
  for (const d of input.downtime ?? []) {
    if (!d.machine) continue;
    const m = downtimeByMachine.get(d.machine) ?? { hours: 0, unplanned: 0, events: 0 };
    m.hours += Math.max(0, d.durationHours ?? 0); m.events += 1; if (d.type === 'unplanned') m.unplanned += 1;
    downtimeByMachine.set(d.machine, m);
  }
  const machineByName = new Map<string, TrustMachine>();
  for (const m of input.machines ?? []) machineByName.set(m.name, m);
  const maintByKey = new Map<string, { onTime: number; total: number; events: DatedFlag[] }>();
  for (const wo of input.workOrders ?? []) {
    const done = wo.status === 'completed' || wo.status === 'verified';
    const sched = parseMs(wo.scheduledDate); const comp = parseMs(wo.completedDate);
    const onTime = done && (sched <= 0 || (comp > 0 && comp <= sched + 86_400_000));
    const ms = parseMs(wo.completedDate || wo.updatedAt);
    if (!done && wo.status !== 'cancelled') continue; // only closed WOs give compliance evidence
    if (wo.status === 'cancelled') continue;
    for (const key of [wo.machine ? `machine:${wo.machine}` : '', wo.technician ? `employee:${wo.technician}` : '', wo.asset ? `asset:${wo.asset}` : '']) {
      if (!key) continue;
      const k = maintByKey.get(key) ?? { onTime: 0, total: 0, events: [] };
      k.total += 1; if (onTime) k.onTime += 1; if (ms > 0) k.events.push({ ms, good: onTime });
      maintByKey.set(key, k);
    }
  }
  const pmByMachine = new Map<string, { done: number; total: number }>();
  for (const pm of input.preventives ?? []) {
    if (!pm.machine || pm.status === 'skipped') continue;
    const p = pmByMachine.get(pm.machine) ?? { done: 0, total: 0 };
    p.total += 1; if (pm.status === 'completed') p.done += 1;
    pmByMachine.set(pm.machine, p);
  }

  // policy / audit compliance: audit coverage per target + compliance findings per evidence id
  const auditByTarget = new Map<string, number>();
  for (const a of input.audit ?? []) { if (a.target) auditByTarget.set(a.target, (auditByTarget.get(a.target) ?? 0) + 1); }
  const failByEvidence = new Map<string, { fail: number; warn: number; pass: number }>();
  for (const f of input.compliance ?? []) {
    for (const ev of f.evidence ?? []) {
      const c = failByEvidence.get(ev) ?? { fail: 0, warn: 0, pass: 0 };
      if (f.status === 'fail') c.fail += 1; else if (f.status === 'warn') c.warn += 1; else c.pass += 1;
      failByEvidence.set(ev, c);
    }
  }
  const complianceGlobal = (() => {
    const fs = input.compliance ?? [];
    if (fs.length === 0) return 100;
    const pass = fs.filter((f) => f.status === 'pass').length;
    const warn = fs.filter((f) => f.status === 'warn').length;
    return clamp(round(((pass + warn * 0.5) / fs.length) * 100), 0, 100);
  })();

  // decision success (global)
  const decisionGlobal = (() => {
    const ds = input.decisions ?? [];
    const parts: number[] = [];
    if (ds.length > 0) parts.push(clamp(round((ds.filter((d) => d.status === 'verified' || d.status === 'approved').length / ds.length) * 100), 0, 100));
    if (typeof input.approval?.recoverySuccessRate === 'number') parts.push(clamp(input.approval.recoverySuccessRate, 0, 100));
    if (typeof input.approval?.averageVerificationAccuracy === 'number') parts.push(clamp(input.approval.averageVerificationAccuracy, 0, 100));
    if (typeof input.handoff?.executionReadiness === 'number') parts.push(clamp(input.handoff.executionReadiness, 0, 100));
    return parts.length === 0 ? 60 : mean(parts);
  })();

  // knowledge freshness helper (per memory, deterministic recency)
  const freshnessOf = (ms: number): number => {
    if (ms <= 0) return 30;
    const days = (nowMs - ms) / 86_400_000;
    return days <= 30 ? 100 : days <= 90 ? 80 : days <= 180 ? 55 : days <= 365 ? 35 : 15;
  };

  // ── factor computation ──
  const factorFns: Record<TrustFactorKey, (kind: TrustEntityKind, key: string) => { value: number; detail: string; events?: DatedFlag[] } | null> = {
    relationship_health: () => null, // resolved from the node directly below
    quality_pass_rate: (_k, key) => {
      const q = qualityByKey.get(`${_k}:${key}`);
      if (!q || q.good + q.scrap + q.pass + q.fail === 0) return null;
      const yieldPct = q.good + q.scrap > 0 ? round((q.good / (q.good + q.scrap)) * 100) : round((q.pass / Math.max(1, q.pass + q.fail)) * 100);
      return { value: clamp(yieldPct, 0, 100), detail: `${q.good} good / ${q.scrap} scrap, ${q.pass} pass / ${q.fail} fail`, events: q.events };
    },
    payment_history: (kind, key) => {
      if (kind === 'invoice') { const s = invoiceState.get(key); if (!s) return null; return { value: s.overdue ? clamp(30 - 0, 0, 100) : clamp(50 + s.paidShare / 2, 0, 100), detail: s.overdue ? 'overdue' : `${s.paidShare}% paid` }; }
      const c = paymentByCustomer.get(key);
      if (!c || c.onTime + c.late === 0) return null;
      const value = clamp(round((c.onTime / (c.onTime + c.late)) * 100) - (c.overdueAmt > 0 ? 10 : 0), 0, 100);
      return { value, detail: `${c.onTime} on-time / ${c.late} late`, events: c.events };
    },
    delivery_reliability: (kind, key) => {
      const d = deliveryByKey.get(`${kind === 'purchaseOrder' || kind === 'goodsReceipt' ? 'supplier' : kind === 'order' ? 'customer' : kind}:${key}`);
      if (!d || d.onTime + d.late === 0) return null;
      return { value: clamp(round((d.onTime / (d.onTime + d.late)) * 100), 0, 100), detail: `${d.onTime} on-time / ${d.late} late`, events: d.events };
    },
    machine_reliability: (_k, key) => {
      const m = machineByName.get(key); const dt = downtimeByMachine.get(key);
      if (!m && !dt) return null;
      const runtime = Math.max(0, m?.runtime ?? 0); const downtime = Math.max(0, m?.downtime ?? 0) + (dt?.hours ?? 0);
      const avail = runtime + downtime > 0 ? clamp(round((runtime / (runtime + downtime)) * 100), 0, 100) : m ? (m.status === 'running' ? 90 : m.status === 'idle' ? 70 : 30) : 50;
      const statusPenalty = m?.status === 'down' || m?.status === 'breakdown' || m?.status === 'offline' ? 40 : m?.status === 'maintenance' ? 20 : 0;
      const unplannedPenalty = dt ? Math.min(25, dt.unplanned * 8) : 0;
      return { value: clamp(avail - statusPenalty - unplannedPenalty, 0, 100), detail: `availability ${avail}%${m?.status ? ` · ${m.status}` : ''}${dt ? ` · ${dt.unplanned} unplanned` : ''}` };
    },
    maintenance_compliance: (kind, key) => {
      const wo = maintByKey.get(`${kind}:${key}`);
      const pm = kind === 'machine' ? pmByMachine.get(key) : undefined;
      if (!wo && !pm) return null;
      const parts: number[] = [];
      if (wo && wo.total > 0) parts.push(round((wo.onTime / wo.total) * 100));
      if (pm && pm.total > 0) parts.push(round((pm.done / pm.total) * 100));
      if (parts.length === 0) return null;
      return { value: clamp(mean(parts), 0, 100), detail: `${wo ? `${wo.onTime}/${wo.total} WO on-time` : ''}${pm ? ` · ${pm.done}/${pm.total} PM done` : ''}`.trim(), events: wo?.events };
    },
    execution_accuracy: (kind, key) => {
      const x = execByKey.get(`${kind}:${key}`);
      if (!x || x.ok + x.bad === 0) return null;
      return { value: clamp(round((x.ok / (x.ok + x.bad)) * 100), 0, 100), detail: `${x.ok} completed / ${x.bad} blocked-or-cancelled`, events: x.events };
    },
    decision_success: () => ({ value: clamp(round(decisionGlobal), 0, 100), detail: `decision success ${round(decisionGlobal)}%` }),
    knowledge_freshness: () => null, // resolved on knowledge/document profiles directly
    document_completeness: () => null, // resolved on knowledge/document profiles directly
    process_compliance: () => null, // resolved on process profiles directly
    policy_compliance: (_k, key) => {
      const fe = failByEvidence.get(key);
      const audits = auditByTarget.get(key) ?? 0;
      if (!fe && audits === 0) return null;
      let value = complianceGlobal;
      if (fe) { const t = fe.fail + fe.warn + fe.pass; if (t > 0) value = clamp(round(((fe.pass + fe.warn * 0.5) / t) * 100), 0, 100); }
      const auditBonus = Math.min(10, audits * 3);
      return { value: clamp(value + auditBonus, 0, 100), detail: `${fe ? `${fe.fail} fail / ${fe.warn} warn` : 'no findings'} · ${audits} audit entr${audits === 1 ? 'y' : 'ies'}` };
    },
  };

  // ── build a profile from a kind + key + label + relationship node (if any) ──
  const profiles: TrustProfile[] = [];
  function buildProfile(kind: TrustEntityKind, key: string, label: string, node: TrustRelNode | undefined, updatedAt: string, extra?: TrustFactor[]): void {
    const weights = FACTORS_BY_KIND[kind] ?? { relationship_health: 1 };
    const factors: TrustFactor[] = [];
    let totalApplicable = 0;
    let dominantEvents: DatedFlag[] | undefined;
    for (const [fk, w] of Object.entries(weights) as [TrustFactorKey, number][]) {
      totalApplicable += w;
      if (fk === 'relationship_health') {
        if (!node) continue;
        const base = HEALTH_BASE[node.health] ?? 50;
        const value = clamp(round(0.5 * base + 0.5 * (100 - clamp(node.risk, 0, 100))), 0, 100);
        factors.push({ key: fk, label: FACTOR_LABELS[fk], value, weight: w, contribution: 0, detail: `${node.health} · risk ${node.risk} · ${node.degree} link(s)` });
        continue;
      }
      const r = factorFns[fk](kind, key);
      if (!r) continue;
      factors.push({ key: fk, label: FACTOR_LABELS[fk], value: r.value, weight: w, contribution: 0, detail: r.detail });
      if (r.events && r.events.length > (dominantEvents?.length ?? 0)) dominantEvents = r.events;
    }
    for (const f of extra ?? []) { factors.push(f); totalApplicable += f.weight; }
    if (factors.length === 0) return;
    const wsum = factors.reduce((s, f) => s + f.weight, 0);
    const score = clamp(round(factors.reduce((s, f) => s + f.value * f.weight, 0) / wsum), 0, 100);
    for (const f of factors) f.contribution = round((f.value * f.weight) / wsum);
    const worst = Math.min(...factors.map((f) => f.value));
    const risk = clamp(worst < 35 ? Math.max(100 - score, 70) : 100 - score, 0, 100);
    const coverage = clamp(round((wsum / Math.max(wsum, totalApplicable)) * 100), 0, 100);
    const trend = windowedTrend(dominantEvents ?? [], score, nowMs);
    profiles.push({ id: `${kind}:${key}`, kind, key, label, score, level: trustLevel(score), risk, coverage, factors, trend, updatedAt });
  }

  // entities from the relationship graph (every resolved ERP entity)
  const nodeById = new Map<string, TrustRelNode>();
  for (const n of input.relationshipNodes ?? []) {
    if (!n.resolved) continue;
    nodeById.set(n.id, n);
    buildProfile(relKindToTrustKind(n.kind), n.key, n.label, n, '');
  }

  // knowledge / document / AI-memory profiles
  for (const m of input.memories ?? []) {
    const kind: TrustEntityKind = m.kind === 'document' ? 'document' : 'knowledge';
    const ms = parseMs(m.updatedAt || m.occurredAt);
    const fresh = freshnessOf(ms);
    const links = (m.entityRefs ?? []).length;
    const complete = clamp((m.content && m.content.trim().length > 40 ? 60 : 20) + Math.min(30, links * 10) + (m.origin === 'explicit' ? 10 : 0), 0, 100);
    const extra: TrustFactor[] = [
      { key: 'knowledge_freshness', label: FACTOR_LABELS.knowledge_freshness, value: fresh, weight: kind === 'document' ? 2 : 3, contribution: 0, detail: ms > 0 ? `updated ${Math.round((nowMs - ms) / 86_400_000)}d ago` : 'undated' },
      { key: 'document_completeness', label: FACTOR_LABELS.document_completeness, value: complete, weight: kind === 'document' ? 3 : 2, contribution: 0, detail: `${links} linked entit${links === 1 ? 'y' : 'ies'} · ${m.origin ?? 'projected'}` },
    ];
    const wsum = extra.reduce((s, f) => s + f.weight, 0);
    const score = clamp(round(extra.reduce((s, f) => s + f.value * f.weight, 0) / wsum), 0, 100);
    for (const f of extra) f.contribution = round((f.value * f.weight) / wsum);
    const risk = clamp(100 - score, 0, 100);
    profiles.push({ id: `${kind}:${m.id}`, kind, key: m.id, label: m.title || m.id, score, level: trustLevel(score), risk, coverage: 100, factors: extra, trend: { direction: 'flat', delta: 0, sparkline: [score, score] }, updatedAt: m.updatedAt || '' });
  }

  // process profiles (one per mined process type)
  for (const pm of input.processMetrics ?? []) {
    const completion = clamp(pm.completionRate ?? 0, 0, 100);
    const conformance = clamp(100 - (pm.reworkRate ?? 0), 0, 100);
    const value = clamp(round(0.6 * completion + 0.4 * conformance), 0, 100);
    const factors: TrustFactor[] = [{ key: 'process_compliance', label: FACTOR_LABELS.process_compliance, value, weight: 3, contribution: value, detail: `${completion}% completion · ${round(pm.reworkRate ?? 0)}% rework · ${pm.caseCount ?? 0} case(s)` }];
    profiles.push({ id: `process:${pm.processType}`, kind: 'process', key: pm.processType, label: pm.processType, score: value, level: trustLevel(value), risk: clamp(100 - value, 0, 100), coverage: 100, factors, trend: { direction: 'flat', delta: 0, sparkline: [value, value] }, updatedAt: '' });
  }

  const insights = deriveTrustInsights(profiles);
  const kpis = trustInsightsToKpis(insights);
  const byKind: Record<string, number> = {};
  for (const p of profiles) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  const byLevel: Record<string, number> = { ...insights.byLevel };
  const atRisk = [...profiles].filter((p) => p.level === 'critical' || p.level === 'low').sort((a, b) => a.score - b.score).slice(0, 50);
  const topTrusted = [...profiles].sort((a, b) => b.score - a.score).slice(0, 25);
  const enterpriseEvents: DatedFlag[] = profiles.flatMap((p) => p.trend.sparkline.length > 2 ? p.trend.sparkline.map((v, i) => ({ ms: nowMs - (BUCKETS - 1 - i) * BUCKET_MS, good: v >= 60 })) : []);
  const trend = windowedTrend(enterpriseEvents, insights.enterpriseTrust, nowMs);
  const narrative = buildTrustNarrative(insights, profiles, atRisk);

  return {
    generatedAtMs: nowMs,
    profiles,
    insights,
    kpis,
    counts: { profiles: profiles.length, byKind, byLevel },
    atRisk,
    topTrusted,
    trend,
    narrative,
  };
}

/* ── insights + KPIs ───────────────────────────────────────────────────────────── */

const avgScore = (ps: TrustProfile[]): number => (ps.length === 0 ? 0 : mean(ps.map((p) => p.score)));

/** Roll the trust profiles into the deterministic trust insights. Pure. */
export function deriveTrustInsights(profiles: TrustProfile[]): TrustInsights {
  const byLevel: Record<EntityTrustLevel, number> = { excellent: 0, good: 0, moderate: 0, low: 0, critical: 0 };
  for (const p of profiles) byLevel[p.level] += 1;
  const of = (...kinds: TrustEntityKind[]): TrustProfile[] => profiles.filter((p) => kinds.includes(p.kind));
  return {
    totalProfiles: profiles.length,
    enterpriseTrust: avgScore(profiles),
    averageScore: avgScore(profiles),
    byLevel,
    excellentCount: byLevel.excellent,
    criticalCount: byLevel.critical,
    lowTrustCount: byLevel.critical + byLevel.low,
    highRiskCount: profiles.filter((p) => p.risk >= 60).length,
    customerTrust: avgScore(of('customer')),
    supplierTrust: avgScore(of('supplier')),
    machineTrust: avgScore(of('machine')),
    knowledgeTrust: avgScore(of('knowledge', 'document')),
    decisionTrust: avgScore(of('decision', 'proposal')),
    processTrust: avgScore(of('process')),
    operationalTrust: avgScore(of('machine', 'productionOrder', 'execution', 'schedule', 'quality', 'workOrder')),
    complianceTrust: avgScore(of('customer', 'supplier', 'decision', 'warehouse')) || avgScore(profiles),
  };
}

/** Map trust insights to the nine Executive Center trust KPI tiles. Pure. */
export function trustInsightsToKpis(insights: TrustInsights): ExecutiveKpi[] {
  const dl = 'enterprise/trust';
  const band = (v: number): ExecutiveKpi['band'] => (v >= 80 ? 'healthy' : v >= 60 ? 'watch' : 'at-risk');
  const tile = (key: string, label: string, v: number): ExecutiveKpi => ({ key, label, value: v, display: `${v}%`, band: band(v), deepLink: dl });
  return [
    tile('trust-enterprise', 'Enterprise Trust Score', insights.enterpriseTrust),
    tile('trust-customer', 'Customer Trust', insights.customerTrust),
    tile('trust-supplier', 'Supplier Trust', insights.supplierTrust),
    tile('trust-machine', 'Machine Trust', insights.machineTrust),
    tile('trust-knowledge', 'Knowledge Trust', insights.knowledgeTrust),
    tile('trust-decision', 'Decision Trust', insights.decisionTrust),
    tile('trust-process', 'Process Trust', insights.processTrust),
    tile('trust-operational', 'Operational Trust', insights.operationalTrust),
    tile('trust-compliance', 'Compliance Trust', insights.complianceTrust),
  ];
}

/* ── narrative (explains trust; never calculates it) ──────────────────────────────── */

function buildTrustNarrative(insights: TrustInsights, profiles: TrustProfile[], atRisk: TrustProfile[]): TrustNarrative {
  const summary =
    insights.totalProfiles === 0
      ? 'No enterprise entities are present yet, so there is no trust to measure.'
      : `Enterprise Trust is ${insights.enterpriseTrust} across ${insights.totalProfiles} entities: ${insights.byLevel.excellent} excellent, ${insights.byLevel.good} good, ${insights.byLevel.moderate} moderate, ${insights.byLevel.low} low, ${insights.byLevel.critical} critical.`;

  const executiveExplanation =
    `Trust is a deterministic weighted average of evidence-backed factors — relationship health, quality, payment + delivery reliability, machine reliability, maintenance, execution accuracy, decision success, knowledge freshness and policy compliance. ` +
    `Customer ${insights.customerTrust}, Supplier ${insights.supplierTrust}, Machine ${insights.machineTrust}, Operational ${insights.operationalTrust}, Compliance ${insights.complianceTrust}. ${insights.highRiskCount} entit${insights.highRiskCount === 1 ? 'y is' : 'ies are'} high-risk.`;

  const worstFactor = (p: TrustProfile): TrustFactor | undefined => [...p.factors].sort((a, b) => a.value - b.value)[0];
  const improvementRecommendations: string[] = [];
  for (const p of atRisk.slice(0, 5)) {
    const wf = worstFactor(p);
    improvementRecommendations.push(`${p.label} (${p.kind}) is ${p.level} at ${p.score}${wf ? ` — weakest factor: ${wf.label} ${wf.value} (${wf.detail})` : ''}.`);
  }
  if (improvementRecommendations.length === 0) improvementRecommendations.push('No entity is low or critical trust — no remediation required.');

  const factorTotals = new Map<TrustFactorKey, { sum: number; n: number; label: string }>();
  for (const p of profiles) for (const f of p.factors) {
    const t = factorTotals.get(f.key) ?? { sum: 0, n: 0, label: f.label };
    t.sum += f.value; t.n += 1; factorTotals.set(f.key, t);
  }
  const weakestFactors = [...factorTotals.entries()].map(([k, t]) => ({ k, label: t.label, avg: round(t.sum / t.n), n: t.n })).filter((x) => x.n >= 2).sort((a, b) => a.avg - b.avg).slice(0, 3);
  const rootCauseExplanation =
    weakestFactors.length === 0
      ? 'Not enough evidence yet to attribute a systemic trust driver.'
      : `The lowest-scoring trust factors enterprise-wide are ${weakestFactors.map((f) => `${f.label} (avg ${f.avg} over ${f.n} entities)`).join(', ')} — these depress the most scores and are the highest-leverage areas to fix.`;

  const complianceSummary =
    `Compliance trust is ${insights.complianceTrust}. ${insights.criticalCount} entit${insights.criticalCount === 1 ? 'y is' : 'ies are'} at critical trust and ${insights.lowTrustCount} at low-or-critical. Policy/audit factors are grounded in the governance findings + audit trail; no trust value is inferred.`;

  return { summary, executiveExplanation, improvementRecommendations, rootCauseExplanation, complianceSummary, grounded: true };
}
