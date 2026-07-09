import { describe, expect, it } from 'vitest';
import {
  assessProcessMining,
  buildProcessCaseDetail,
  buildProcessCaseSummaries,
  buildProcessExplorerFacets,
  buildProcessExplorerModel,
  deriveProcessExplorerKpis,
  filterProcessCases,
  type EnterpriseEntity,
  type EnterpriseFieldValue,
  type ProcessMiningInput,
} from '@neuropause/shared';

const BASE = Date.parse('2026-07-01T00:00:00.000Z');
const h = (n: number): string => new Date(BASE + n * 60 * 60 * 1000).toISOString();

function E(id: string, title: string, createdAt: string, fields: Record<string, EnterpriseFieldValue> = {}, opts: { updatedAt?: string; status?: string; createdBy?: string } = {}): EnterpriseEntity {
  return {
    id, moduleId: 'm', kind: 'k', title, status: opts.status ?? 'active', fields, tags: [], rev: 1,
    createdAt, updatedAt: opts.updatedAt ?? createdAt, createdBy: opts.createdBy ?? 'user@np.dev', updatedBy: opts.createdBy ?? 'user@np.dev', metadata: {},
  };
}

/** A three-process fixture carrying real business dimensions (customer / supplier / product / machine). */
function fixture(): ProcessMiningInput {
  return {
    leads: [E('L1', 'LEAD-1', h(-20))],
    contacts: [E('CT1', 'CONTACT-1', h(-15), { sourceLead: 'L1' })],
    customers: [E('C1', 'Acme', h(-10), { sourceLead: 'L1' })],
    quotes: [E('Q1', 'QUOTE-1', h(0), { customer: 'Acme', product: 'FG-1' })],
    orders: [E('O1', 'SO-1', h(2), { sourceQuote: 'Q1', customer: 'Acme', product: 'FG-1', warehouse: 'WH-1' })],
    invoices: [E('I1', 'INV-1', h(5), { sourceOrder: 'O1', customer: 'Acme' })],
    payments: [E('P1', 'PAY-1', h(30), { invoiceRef: 'I1' }, { status: 'cleared' })],
    purchaseRequests: [E('PR1', 'PR-1', h(0), { product: 'RAW-1' })],
    purchaseOrders: [E('PO1', 'PO-1', h(4), { sourceRequest: 'PR1', supplier: 'SupplierCo', product: 'RAW-1', warehouse: 'WH-1' })],
    goodsReceipts: [E('GR1', 'GR-1', h(10), { purchaseOrder: 'PO1', supplier: 'SupplierCo', product: 'RAW-1', warehouse: 'WH-1' })],
    movements: [E('MV1', 'MV-1', h(12), { referenceRecord: 'GR1', referenceModule: 'x', product: 'RAW-1', warehouse: 'WH-1', status: 'posted' }, { status: 'posted' })],
    productionOrders: [E('MO1', 'MO-1', h(0), { product: 'FG-1', machine: 'CNC-1', workCenter: 'WC-1' })],
    schedules: [E('SCH1', 'SCH-1', h(6), { productionOrder: 'MO-1', machine: 'CNC-1', workCenter: 'WC-1' }, { status: 'done', updatedAt: h(20) })],
  };
}

describe('graph generation — projects the discovered graph, never a mock', () => {
  it('exposes the mined nodes + edges for each process (no hardcoded flow)', () => {
    const input = fixture();
    const model = buildProcessExplorerModel(assessProcessMining(input), input);
    const otcNodes = model.graph.nodes.filter((n) => n.processType === 'order_to_cash').map((n) => n.activity);
    expect(otcNodes).toContain('Quote');
    expect(otcNodes).toContain('Payment');
    const invToPay = model.graph.edges.find((e) => e.from === 'Invoice' && e.to === 'Payment');
    expect(invToPay?.meanDurationMs).toBe(25 * 60 * 60 * 1000); // the same discovered timing the engine mined
  });
});

describe('case summaries + facets carry the real business dimensions', () => {
  it('aggregates customer / supplier / product / machine onto each case', () => {
    const input = fixture();
    const assessment = assessProcessMining(input);
    const cases = buildProcessCaseSummaries(assessment, input);
    const otc = cases.find((c) => c.processType === 'order_to_cash')!;
    expect(otc.dimensions.customers).toContain('Acme');
    expect(otc.dimensions.products).toContain('FG-1');
    expect(otc.label).toBe('Acme');
    const facets = buildProcessExplorerFacets(cases);
    expect(facets.customers.map((f) => f.value)).toContain('Acme');
    expect(facets.suppliers.map((f) => f.value)).toContain('SupplierCo');
    expect(facets.machines.map((f) => f.value)).toContain('CNC-1');
    expect(facets.products.map((f) => f.value)).toEqual(expect.arrayContaining(['FG-1', 'RAW-1']));
  });
});

describe('filtering (by process / risk / dimension / search) is deterministic', () => {
  const input = fixture();
  const cases = buildProcessCaseSummaries(assessProcessMining(input), input);

  it('filters by process type', () => {
    expect(filterProcessCases(cases, { processType: 'procure_to_pay' })).toHaveLength(1);
  });
  it('filters by customer, and by product spanning two processes', () => {
    expect(filterProcessCases(cases, { customer: 'Acme' }).map((c) => c.processType)).toEqual(['order_to_cash']);
    expect(filterProcessCases(cases, { product: 'FG-1' }).map((c) => c.processType).sort()).toEqual(['make_to_complete', 'order_to_cash']);
    expect(filterProcessCases(cases, { supplier: 'SupplierCo' })).toHaveLength(1);
    expect(filterProcessCases(cases, { machine: 'CNC-1' }).map((c) => c.processType)).toEqual(['make_to_complete']);
  });
  it('free-text search matches dimensions + activities', () => {
    expect(filterProcessCases(cases, { search: 'supplierco' })).toHaveLength(1);
    expect(filterProcessCases(cases, { search: 'acme' }).map((c) => c.processType)).toEqual(['order_to_cash']);
    expect(filterProcessCases(cases, { search: 'no-such-thing' })).toHaveLength(0);
  });
});

describe('pagination — bounded page + total for virtualization', () => {
  it('slices the case list and reports the pre-pagination total', () => {
    const input = fixture();
    const assessment = assessProcessMining(input);
    const page = buildProcessExplorerModel(assessment, input, { limit: 2, offset: 0 });
    expect(page.cases).toHaveLength(2);
    expect(page.totalCases).toBe(3);
    const page2 = buildProcessExplorerModel(assessment, input, { limit: 2, offset: 2 });
    expect(page2.cases).toHaveLength(1);
    expect(page2.totalCases).toBe(3);
  });
});

describe('case lookup — every stage, module, record, timestamp, actor (timeline/audit deep-link handles)', () => {
  it('returns the full case detail with a deterministic AI read', () => {
    const input = fixture();
    const assessment = assessProcessMining(input);
    const otcId = buildProcessCaseSummaries(assessment, input).find((c) => c.processType === 'order_to_cash')!.caseId;
    const detail = buildProcessCaseDetail(assessment, input, otcId);
    expect(detail).toBeTruthy();
    expect(detail!.stages.map((s) => s.activity)).toEqual(['Lead', 'Contact', 'Customer', 'Quote', 'Order', 'Invoice', 'Payment']);
    // Each stage carries the handles the UI deep-links into the existing Timeline / Audit / Search.
    for (const st of detail!.stages) {
      expect(st.recordId).toBeTruthy();
      expect(st.moduleId).toBeTruthy();
      expect(st.recordKey).toBeTruthy();
      expect(st.timestampIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    expect(detail!.explanation).toContain('Order-to-Cash');
    expect(detail!.rootCause).toContain('Invoice → Payment'); // the case's own longest wait
    expect(detail!.nextActions.length).toBeGreaterThan(0);
    expect(buildProcessCaseDetail(assessment, input, 'nope:missing')).toBeNull();
  });
});

describe('the six explorer KPIs', () => {
  it('emits Top Bottleneck / Slowest / Fastest / Most Automated / Delayed Approval / Highest Rework', () => {
    const input = fixture();
    const kpis = deriveProcessExplorerKpis(assessProcessMining(input));
    expect(kpis.map((k) => k.key)).toEqual([
      'proc-top-bottleneck', 'proc-slowest-case', 'proc-fastest-case', 'proc-most-automated', 'proc-most-delayed-approval', 'proc-highest-rework',
    ]);
    expect(kpis.find((k) => k.key === 'proc-top-bottleneck')!.display).toContain('→');
  });
  it('is empty-safe', () => {
    const model = buildProcessExplorerModel(assessProcessMining({}), {});
    expect(model.cases).toHaveLength(0);
    expect(model.totalCases).toBe(0);
    expect(model.explorerKpis).toHaveLength(6);
    expect(model.graph.nodes).toHaveLength(0);
  });
});

describe('read-only proof — the projection mutates nothing', () => {
  it('builds the full model from deep-frozen input', () => {
    const input = fixture();
    for (const bucket of Object.values(input)) {
      for (const r of bucket as EnterpriseEntity[]) { Object.freeze(r.fields); Object.freeze(r); }
      Object.freeze(bucket);
    }
    Object.freeze(input);
    const model = buildProcessExplorerModel(assessProcessMining(input), input); // throws if it mutates
    expect(model.cases).toHaveLength(3);
    expect((input.orders ?? []).length).toBe(1);
  });
});

describe('large dataset + performance — 100k events explore without rescanning', () => {
  it('builds + filters the model over 25k procure-to-pay cases in one pass', () => {
    const purchaseRequests: EnterpriseEntity[] = [];
    const purchaseOrders: EnterpriseEntity[] = [];
    const goodsReceipts: EnterpriseEntity[] = [];
    const movements: EnterpriseEntity[] = [];
    const N = 25000;
    for (let i = 0; i < N; i += 1) {
      const product = `RAW-${i % 50}`;
      purchaseRequests.push(E(`PR${i}`, `PR-${i}`, h(i % 500), { product }));
      purchaseOrders.push(E(`PO${i}`, `PO-${i}`, h((i % 500) + 1), { sourceRequest: `PR${i}`, supplier: `S-${i % 20}`, product }));
      goodsReceipts.push(E(`GR${i}`, `GR-${i}`, h((i % 500) + 3), { purchaseOrder: `PO${i}`, supplier: `S-${i % 20}`, product }));
      movements.push(E(`MV${i}`, `MV-${i}`, h((i % 500) + 4), { referenceRecord: `GR${i}`, referenceModule: 'x', product, status: 'posted' }, { status: 'posted' }));
    }
    const input = { purchaseRequests, purchaseOrders, goodsReceipts, movements };
    const started = Date.now();
    const assessment = assessProcessMining(input);
    const model = buildProcessExplorerModel(assessment, input, { limit: 50 });
    const elapsed = Date.now() - started;
    expect(model.totalCases).toBe(N); // 100k observations → 25k cases
    expect(model.cases).toHaveLength(50); // bounded page for the virtualized list
    expect(elapsed).toBeLessThan(9000);
    // A dimension filter narrows deterministically without rescanning source records.
    const filtered = buildProcessExplorerModel(assessment, input, { product: 'RAW-1', limit: 50 });
    expect(filtered.totalCases).toBe(N / 50); // 500 cases carry RAW-1
  });
});
