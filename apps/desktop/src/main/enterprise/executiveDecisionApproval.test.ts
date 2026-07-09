import { describe, expect, it } from 'vitest';
import {
  approvalInsightsToKpis,
  buildVerificationReport,
  decisionRecordFieldsFromPlan,
  decisionTransition,
  deriveApprovalInsights,
  type BillOfMaterials,
  type BomComponent,
  type ExecutiveDecisionRecord,
  type Machine,
  type PlanningInput,
  type Product,
  type RecoveryPlan,
  type SalesOrder,
  type Supplier,
  type VerificationReport,
} from '@neuropause/shared';

const T0 = '2026-07-08T00:00:00.000Z';
const NOW = Date.parse(T0);

function product(p: Partial<Product> = {}): Product {
  return { id: `p-${p.sku ?? 'X'}`, sku: 'FG-1', barcode: '', name: 'Widget', category: '', unit: 'unit', purchaseCost: 4, standardCost: 5, sellingPrice: 10, reorderLevel: 10, safetyStock: 5, maximumStock: 200, currentStock: 0, reservedStock: 0, availableStock: 0, status: 'active', ...p };
}
function order(p: Partial<SalesOrder> = {}): SalesOrder {
  return { id: 'o1', orderNumber: 'SO-1', sourceQuote: '', customer: 'Acme', contact: '', status: 'pending', currency: 'USD', total: 1000, orderedQty: 10, fulfilledQty: 0, product: 'FG-1', warehouse: 'WH-1', orderDate: '', expectedDeliveryDate: '2026-08-01', shippedDate: '', deliveredDate: '', carrier: '', trackingNumber: '', salesRep: '', createdAt: T0, updatedAt: T0, ...p };
}
function comp(sku: string, quantity: number): BomComponent {
  return { sku, quantity, waste: 0, alternative: '' };
}
function bom(productSku: string, components: BomComponent[]): BillOfMaterials {
  return { id: `b-${productSku}`, bomNumber: `BOM-${productSku}`, product: productSku, outputQuantity: 1, yield: 100, waste: 0, revision: 'A', components, status: 'active', notes: '' };
}
function supplier(p: Partial<Supplier> = {}): Supplier {
  return { id: 's1', name: 'SupplierCo', gst: '', pan: '', contactPerson: '', email: '', phone: '', bankDetails: '', paymentTerms: 'net30', leadTime: 10, vendorRating: 4, status: 'active', ...p };
}
function machine(p: Partial<Machine> = {}): Machine {
  return { id: `mc-${p.name ?? 'M'}`, name: 'CNC-1', code: 'MC-1', workCenter: 'WC-1', runtime: 50, downtime: 50, maintenanceDue: '', status: 'running', ...p };
}
function base(): PlanningInput {
  return {
    products: [product({ sku: 'FG-1' }), product({ sku: 'RAW-1', name: 'Raw' })],
    salesOrders: [order({ product: 'FG-1', orderedQty: 10, total: 1000, customer: 'Acme' })],
    quotes: [], shipments: [], productionOrders: [], purchaseOrders: [],
    suppliers: [supplier({ leadTime: 10 })],
    boms: [bom('FG-1', [comp('RAW-1', 2)])],
    machines: [machine({ name: 'CNC-1', status: 'running' })],
    invoices: [],
  };
}
function plan(p: Partial<RecoveryPlan> = {}): RecoveryPlan {
  return {
    id: 'decision:machine_failure_recovery',
    decisionType: 'machine_failure_recovery',
    title: 'Machine Failure Recovery — CNC-1',
    businessImpact: 'CNC-1 failure delays orders.',
    evidence: ['maxDelay=5d', 'lateDeliveries=1'],
    affectedOrders: ['FG-1'],
    affectedMachines: ['CNC-1'],
    affectedCustomers: ['Acme'],
    affectedRevenue: 1000,
    recoverySteps: [{ action: 'use_alternate_machine', description: 'Move to an idle machine.', evidence: ['addedDowntime=240h'] }],
    expectedImprovementPct: 80,
    confidence: 0.9,
    estimatedRecoveryDays: 1,
    priority: 'high',
    tradeoffs: ['the alternate may be slower or need setup'],
    status: 'pending',
    score: 785,
    ...p,
  };
}
function decision(over: Partial<ExecutiveDecisionRecord> = {}): ExecutiveDecisionRecord {
  return {
    id: 'd1', decisionId: 'decision:machine_failure_recovery', title: 'Machine Failure Recovery', category: 'machine_failure_recovery',
    evidence: [], affectedOrders: ['FG-1'], affectedMachines: ['CNC-1'], affectedCustomers: ['Acme'], affectedRevenue: 1000,
    expectedImprovementPct: 80, confidence: 90, primaryAction: 'use_alternate_machine', tradeoffs: ['alternate may be slower'],
    createdBy: 'exec', createdTime: T0, status: 'approved',
    approvedBy: 'exec', approvedAt: T0, approvalReason: 'sound', approvalComments: '',
    rejectedBy: '', rejectedAt: '', rejectionReason: '', verifiedBy: '', verifiedAt: '', verificationReport: null,
    createdAt: T0, updatedAt: T0, ...over,
  };
}

describe('strict decision lifecycle transitions', () => {
  it('only allows the legal transitions', () => {
    expect(decisionTransition('approve', 'pending')).toBe('approved');
    expect(decisionTransition('reject', 'pending')).toBe('rejected');
    expect(decisionTransition('verify', 'approved')).toBe('verified');
    expect(decisionTransition('archive', 'verified')).toBe('archived');
    // illegal
    expect(decisionTransition('approve', 'approved')).toBeNull();
    expect(decisionTransition('verify', 'pending')).toBeNull();
    expect(decisionTransition('archive', 'pending')).toBeNull();
  });
});

describe('decisionRecordFieldsFromPlan', () => {
  it('maps a recovery plan into a pending decision record', () => {
    const f = decisionRecordFieldsFromPlan(plan(), 'exec@np.dev', T0);
    expect(f).toMatchObject({ category: 'machine_failure_recovery', status: 'pending', primaryAction: 'use_alternate_machine', affectedRevenue: 1000, expectedImprovementPct: 80, confidence: 90, createdBy: 'exec@np.dev', createdTime: T0 });
  });
});

describe('verification re-runs the Digital Twin (read-only) and scores accuracy', () => {
  it('proves an alternate-machine recovery restores the failed order', () => {
    const input = base();
    const before = JSON.stringify(input);
    const report = buildVerificationReport(input, [], decision(), NOW);
    expect(report).toMatchObject({
      baselineLate: 0,
      stressedLate: 1, // machine failure loses the only machine
      recoveredLate: 0, // adding an alternate machine recovers the order
      ordersRecovered: 1,
      recoveryImprovement: 100,
      remainingRisk: 0,
      revenueSaved: 1000,
      verificationAccuracy: 80, // 100 − |predicted 80 − verified 100|
    });
    expect(JSON.stringify(input)).toBe(before); // never mutated production
  });
});

describe('deriveApprovalInsights + KPIs', () => {
  it('rolls decision records into the seven approval KPIs', () => {
    const vr: VerificationReport = { recoveryImprovement: 100, remainingRisk: 0, expectedDelayDays: 0, revenueSaved: 1000, ordersRecovered: 1, machineUtilization: 10, confidence: 90, tradeoffs: [], verificationAccuracy: 80, baselineLate: 0, stressedLate: 1, recoveredLate: 0 };
    const decisions = [
      decision({ status: 'pending', approvedAt: '', approvalReason: '' }),
      decision({ status: 'approved', createdTime: '2026-07-08T00:00:00.000Z', approvedAt: '2026-07-08T05:00:00.000Z' }),
      decision({ status: 'rejected' }),
      decision({ status: 'verified', verificationReport: vr, createdTime: '2026-07-08T00:00:00.000Z', approvedAt: '2026-07-08T03:00:00.000Z' }),
    ];
    const insights = deriveApprovalInsights(decisions);
    expect(insights).toMatchObject({
      pendingDecisions: 1,
      approvedDecisions: 1,
      rejectedDecisions: 1,
      verifiedDecisions: 1,
      averageVerificationAccuracy: 80,
      recoverySuccessRate: 100, // the verified recovery improved ≥ 50%
    });
    expect(insights.approvalLeadTimeHours).toBeGreaterThan(0); // approved records carry lead time
    expect(approvalInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'apr-pending',
      'apr-approved',
      'apr-rejected',
      'apr-verified',
      'apr-verification-accuracy',
      'apr-approval-lead-time',
      'apr-recovery-success',
    ]);
  });
});
