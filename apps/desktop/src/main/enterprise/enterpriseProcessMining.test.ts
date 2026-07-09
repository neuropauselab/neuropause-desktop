import { describe, expect, it } from 'vitest';
import {
  assessProcessMining,
  buildProcessObservations,
  correlateProcessCases,
  discoverProcessGraph,
  computeProcessMetrics,
  processInsightsToKpis,
  type EnterpriseEntity,
  type EnterpriseFieldValue,
  type ProcessMiningInput,
} from '@neuropause/shared';

const BASE = Date.parse('2026-07-01T00:00:00.000Z');
/** ISO timestamp `n` hours after the base instant. */
const h = (n: number): string => new Date(BASE + n * 60 * 60 * 1000).toISOString();

function E(
  id: string,
  title: string,
  createdAt: string,
  fields: Record<string, EnterpriseFieldValue> = {},
  opts: { updatedAt?: string; status?: string; createdBy?: string } = {},
): EnterpriseEntity {
  return {
    id,
    moduleId: 'm',
    kind: 'k',
    title,
    status: opts.status ?? 'active',
    fields,
    tags: [],
    rev: 1,
    createdAt,
    updatedAt: opts.updatedAt ?? createdAt,
    createdBy: opts.createdBy ?? 'user@np.dev',
    updatedBy: opts.createdBy ?? 'user@np.dev',
    metadata: {},
  };
}

/** A full three-process fixture built ENTIRELY from real link fields (no fabricated correlation). */
function fixture(): ProcessMiningInput {
  return {
    // order-to-cash: Lead → Contact → Customer → Quote → Order → Invoice → Payment
    leads: [E('L1', 'LEAD-1', h(-20))],
    contacts: [E('CT1', 'CONTACT-1', h(-15), { sourceLead: 'L1' })],
    customers: [E('C1', 'Acme', h(-10), { sourceLead: 'L1' })], // title 'Acme' — the name bridge target
    quotes: [E('Q1', 'QUOTE-1', h(0), { customer: 'Acme' })], // quote.customer → customer title
    orders: [E('O1', 'SO-1', h(2), { sourceQuote: 'Q1' })],
    invoices: [E('I1', 'INV-1', h(5), { sourceOrder: 'O1' })],
    payments: [E('P1', 'PAY-1', h(30), { invoiceRef: 'I1' }, { status: 'cleared' })],
    // procure-to-pay: Purchase Request → Purchase Order → Goods Receipt → Inventory Movement
    purchaseRequests: [E('PR1', 'PR-1', h(0))],
    purchaseOrders: [E('PO1', 'PO-1', h(4), { sourceRequest: 'PR1' })],
    goodsReceipts: [E('GR1', 'GR-1', h(10), { purchaseOrder: 'PO1' })],
    movements: [
      E('MV1', 'MV-1', h(12), { referenceRecord: 'GR1', referenceModule: 'procurement-goods-receipts', status: 'posted' }, { status: 'posted' }),
      E('MVX', 'MV-VOID', h(13), { referenceRecord: 'GR1', status: 'void' }, { status: 'void' }), // inert — must be excluded
    ],
    // make-to-complete: Production Order → Production Schedule (completion)
    productionOrders: [E('MO1', 'MO-1', h(0))],
    schedules: [E('SCH1', 'SCH-1', h(6), { productionOrder: 'MO-1' }, { status: 'done', updatedAt: h(20) })],
  };
}

describe('process reconstruction — correlate real links into end-to-end cases', () => {
  it('rebuilds one order-to-cash case spanning CRM → sales → finance from real FK links', () => {
    const traces = correlateProcessCases(buildProcessObservations(fixture()));
    const otc = traces.find((t) => t.processType === 'order_to_cash')!;
    expect(otc).toBeTruthy();
    expect(otc.stages.map((s) => s.activity)).toEqual(['Lead', 'Contact', 'Customer', 'Quote', 'Order', 'Invoice', 'Payment']);
    expect(otc.completed).toBe(true); // reached Payment (terminal) / cleared
  });

  it('rebuilds procure-to-pay and make-to-complete, and EXCLUDES the inert void movement', () => {
    const traces = correlateProcessCases(buildProcessObservations(fixture()));
    const p2p = traces.find((t) => t.processType === 'procure_to_pay')!;
    expect(p2p.stages.map((s) => s.activity)).toEqual(['Purchase Request', 'Purchase Order', 'Goods Receipt', 'Inventory Movement']);
    expect(p2p.stages).toHaveLength(4); // the void movement is inert and never a process step
    const mtc = traces.find((t) => t.processType === 'make_to_complete')!;
    expect(mtc.stages.map((s) => s.activity)).toEqual(['Production Order', 'Production Schedule']);
    expect(mtc.completed).toBe(true);
  });

  it('produces exactly three cases and never fabricates a link that is not in the data', () => {
    const traces = correlateProcessCases(buildProcessObservations(fixture()));
    expect(traces).toHaveLength(3);
    // An order with a dangling sourceQuote correlates to nothing extra — no invented case merges.
    const orphan = correlateProcessCases(buildProcessObservations({ orders: [E('OZ', 'SO-Z', h(0), { sourceQuote: 'does-not-exist' })] }));
    expect(orphan).toHaveLength(1);
    expect(orphan[0].stages).toHaveLength(1);
  });
});

describe('cycle time + deterministic delay analysis (real timestamps only)', () => {
  it('computes cycle time end-to-end and the specific stage-to-stage delays', () => {
    const a = assessProcessMining(fixture());
    const otc = a.traces.find((t) => t.processType === 'order_to_cash')!;
    expect(otc.cycleTimeMs).toBe(50 * 60 * 60 * 1000); // Lead(-20) → Payment(30) = 50h
    expect(a.insights.revenueDelayHours).toBe(28); // Order(2) → Payment(30)
    expect(a.insights.purchaseDelayHours).toBe(10); // Request(0) → Goods Receipt(10)
    expect(a.insights.productionDelayHours).toBe(6); // Production Order(0) → Schedule(6)
  });
});

describe('bottleneck detection from the discovered directly-follows graph', () => {
  it('flags the slowest real transition per process', () => {
    const traces = correlateProcessCases(buildProcessObservations(fixture()));
    const graph = discoverProcessGraph(traces);
    const otcInvoiceToPayment = graph.edges.find((e) => e.from === 'Invoice' && e.to === 'Payment')!;
    expect(otcInvoiceToPayment.meanDurationMs).toBe(25 * 60 * 60 * 1000); // 5h → 30h
    const metrics = computeProcessMetrics(traces, graph);
    const otc = metrics.byType.find((m) => m.processType === 'order_to_cash')!;
    expect(otc.bottleneckActivity).toBe('Invoice → Payment');
    expect(otc.bottleneckWaitHours).toBe(25);
  });

  it('detects rework when an activity repeats within a case', () => {
    // Two quotes for the same customer → the Quote activity recurs in one case → rework.
    const input: ProcessMiningInput = {
      customers: [E('C1', 'Acme', h(0), {})],
      quotes: [E('Q1', 'QUOTE-1', h(1), { customer: 'Acme' }), E('Q2', 'QUOTE-2', h(2), { customer: 'Acme' })],
    };
    const traces = correlateProcessCases(buildProcessObservations(input));
    expect(traces).toHaveLength(1);
    expect(traces[0].reworkCount).toBe(1);
    const metrics = computeProcessMetrics(traces, discoverProcessGraph(traces));
    expect(metrics.byType.find((m) => m.processType === 'order_to_cash')!.reworkRate).toBe(100);
  });
});

describe('automation coverage + completion (deterministic signals)', () => {
  it('counts only system-posted movements as automated and terminal stages as completion', () => {
    const a = assessProcessMining(fixture());
    // 13 real stages (void excluded); exactly one is automated (the reference-posted movement).
    expect(a.metrics.overall.automationCoverage).toBe(8); // round(1/13*100)
    expect(a.metrics.overall.completionRate).toBe(100); // all three cases reached a terminal stage
  });
});

describe('KPI generation — the nine Executive Center process tiles', () => {
  it('emits the nine process KPIs in order with real values', () => {
    const a = assessProcessMining(fixture());
    const kpis = processInsightsToKpis(a.insights);
    expect(kpis.map((k) => k.key)).toEqual([
      'proc-avg-cycle', 'proc-longest-wait', 'proc-fastest', 'proc-approval-delay',
      'proc-production-delay', 'proc-purchase-delay', 'proc-revenue-delay', 'proc-health', 'proc-automation',
    ]);
    expect(kpis.find((k) => k.key === 'proc-revenue-delay')!.value).toBe(28);
    expect(kpis.find((k) => k.key === 'proc-automation')!.display).toBe('8%');
    expect(a.insights.processHealth).toBeGreaterThanOrEqual(0);
    expect(a.insights.processHealth).toBeLessThanOrEqual(100);
  });

  it('is empty-safe — no cases yields neutral KPIs and no recommendations', () => {
    const a = assessProcessMining({});
    expect(a.traces).toHaveLength(0);
    expect(a.insights.totalCases).toBe(0);
    expect(a.recommendations).toHaveLength(0);
    expect(processInsightsToKpis(a.insights)).toHaveLength(9);
    expect(a.narrative.grounded).toBe(true);
  });
});

describe('read-only proof — mining mutates nothing', () => {
  it('never writes to the input records (deep-frozen input still assesses)', () => {
    const input = fixture();
    for (const bucket of Object.values(input)) {
      for (const r of bucket as EnterpriseEntity[]) {
        Object.freeze(r.fields);
        Object.freeze(r);
      }
      Object.freeze(bucket);
    }
    Object.freeze(input);
    const a = assessProcessMining(input); // would throw if it mutated any frozen record
    expect(a.traces.length).toBe(3);
    expect((input.orders ?? []).length).toBe(1); // input arrays untouched
  });
});

describe('performance — 100,000+ events reconstruct without rescanning', () => {
  it('assesses 100k observations (25k procure-to-pay cases × 4 stages) in a single linear pass', () => {
    const purchaseRequests: EnterpriseEntity[] = [];
    const purchaseOrders: EnterpriseEntity[] = [];
    const goodsReceipts: EnterpriseEntity[] = [];
    const movements: EnterpriseEntity[] = [];
    const N = 25000;
    for (let i = 0; i < N; i += 1) {
      purchaseRequests.push(E(`PR${i}`, `PR-${i}`, h(i % 500)));
      purchaseOrders.push(E(`PO${i}`, `PO-${i}`, h((i % 500) + 1), { sourceRequest: `PR${i}` }));
      goodsReceipts.push(E(`GR${i}`, `GR-${i}`, h((i % 500) + 3), { purchaseOrder: `PO${i}` }));
      movements.push(E(`MV${i}`, `MV-${i}`, h((i % 500) + 4), { referenceRecord: `GR${i}`, referenceModule: 'x', status: 'posted' }, { status: 'posted' }));
    }
    const started = Date.now();
    const a = assessProcessMining({ purchaseRequests, purchaseOrders, goodsReceipts, movements });
    const elapsed = Date.now() - started;
    expect(a.traces).toHaveLength(N); // 100k observations → 25k correlated cases
    expect(a.metrics.overall.caseCount).toBe(N);
    expect(elapsed).toBeLessThan(8000); // linear — no quadratic rescanning
  });
});
