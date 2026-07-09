import { describe, expect, it } from 'vitest';
import {
  PROPOSAL_TYPES,
  deriveHandoffInsights,
  domainPriority,
  executionProposalFromRecord,
  handoffInsightsToKpis,
  proposalDraftFields,
  proposalPriority,
  proposalRecordFields,
  proposalTransition,
  routeDecision,
  type DecisionType,
  type EnterpriseEntity,
  type ExecutionProposalRecord,
  type ExecutiveDecisionRecord,
  type RecoveryActionType,
} from '@neuropause/shared';

const T0 = '2026-07-08T00:00:00.000Z';

function decision(over: Partial<ExecutiveDecisionRecord> = {}): ExecutiveDecisionRecord {
  return {
    id: 'd1', decisionId: 'decision:machine_failure_recovery', title: 'Machine Failure Recovery — CNC-1',
    category: 'machine_failure_recovery', evidence: ['maxDelay=5d'], affectedOrders: ['FG-1'], affectedMachines: ['CNC-1'],
    affectedCustomers: ['Acme'], affectedRevenue: 1000, expectedImprovementPct: 80, confidence: 90,
    primaryAction: 'use_alternate_machine', tradeoffs: ['alternate may be slower'], createdBy: 'ceo@np.dev', createdTime: T0,
    status: 'verified', approvedBy: 'ceo@np.dev', approvedAt: T0, approvalReason: 'ok', approvalComments: '',
    rejectedBy: '', rejectedAt: '', rejectionReason: '', verifiedBy: 'ceo@np.dev', verifiedAt: T0, verificationReport: null,
    createdAt: T0, updatedAt: T0, ...over,
  };
}

function proposalRecord(fields: Record<string, string | number>): EnterpriseEntity {
  return {
    id: 'p1', moduleId: 'execution-proposals', kind: 'execution-proposal', title: String(fields.proposalNumber ?? 'PROP-x'),
    status: 'active', fields, tags: [], rev: 1, createdAt: T0, updatedAt: T0, createdBy: null, updatedBy: null, metadata: {},
  };
}

describe('routeDecision — deterministic responsible-module routing (the execution authorities)', () => {
  it('routes each decision/action to the ONE responsible module', () => {
    // Routing optimization → Routings (Manufacturing).
    expect(routeDecision(decision({ category: 'routing_optimization', primaryAction: 'resequence_jobs' }))).toEqual({
      proposalType: 'routing', targetModuleId: 'manufacturing-routings',
    });
    // Maintenance reschedule OR a delay-maintenance action → Work Orders (Maintenance).
    expect(routeDecision(decision({ category: 'maintenance_reschedule', primaryAction: 'resequence_jobs' })).proposalType).toBe('maintenance');
    expect(routeDecision(decision({ category: 'late_order_recovery', primaryAction: 'delay_maintenance' })).proposalType).toBe('maintenance');
    // Buy-side actions → Purchase Requests (Procurement).
    for (const a of ['increase_procurement', 'expedite_supplier', 'subcontract_production'] as RecoveryActionType[]) {
      expect(routeDecision(decision({ category: 'material_shortage_recovery', primaryAction: a }))).toEqual({
        proposalType: 'purchase_request', targetModuleId: 'procurement-requests',
      });
    }
    // Safety stock → Inventory reallocation (Inventory ledger).
    expect(routeDecision(decision({ category: 'inventory_buffer_recovery', primaryAction: 'use_safety_stock' }))).toEqual({
      proposalType: 'inventory_reallocation', targetModuleId: 'inventory-movements',
    });
    // Capacity recovery → Capacity (Production Schedules).
    expect(routeDecision(decision({ category: 'capacity_recovery', primaryAction: 'add_second_shift' }))).toEqual({
      proposalType: 'capacity', targetModuleId: 'manufacturing-schedules',
    });
    // Shop-floor sequencing actions → Production Schedule (Manufacturing).
    for (const a of ['use_alternate_machine', 'split_order', 'resequence_jobs', 'move_order'] as RecoveryActionType[]) {
      expect(routeDecision(decision({ category: 'machine_failure_recovery', primaryAction: a }))).toEqual({
        proposalType: 'production_schedule', targetModuleId: 'manufacturing-schedules',
      });
    }
  });

  it('is total — every decision type routes to a real responsible module + a known proposal type', () => {
    const types: DecisionType[] = [
      'machine_failure_recovery', 'supplier_delay_recovery', 'material_shortage_recovery', 'capacity_recovery',
      'demand_spike_recovery', 'maintenance_reschedule', 'routing_optimization', 'priority_customer_recovery',
      'late_order_recovery', 'inventory_buffer_recovery',
    ];
    for (const c of types) {
      const r = routeDecision(decision({ category: c, primaryAction: 'resequence_jobs' }));
      expect(r.targetModuleId).toBeTruthy();
      expect(PROPOSAL_TYPES).toContain(r.proposalType);
    }
  });
});

describe('proposalTransition — strict, deterministic lifecycle', () => {
  it('allows only the legal transitions', () => {
    expect(proposalTransition('submit', 'draft')).toBe('pending_confirmation');
    expect(proposalTransition('accept', 'pending_confirmation')).toBe('accepted');
    expect(proposalTransition('reject', 'pending_confirmation')).toBe('rejected');
    expect(proposalTransition('cancel', 'draft')).toBe('cancelled');
    expect(proposalTransition('cancel', 'pending_confirmation')).toBe('cancelled');
    // illegal
    expect(proposalTransition('accept', 'draft')).toBeNull();
    expect(proposalTransition('accept', 'accepted')).toBeNull();
    expect(proposalTransition('submit', 'pending_confirmation')).toBeNull();
    expect(proposalTransition('reject', 'accepted')).toBeNull();
    expect(proposalTransition('cancel', 'accepted')).toBeNull();
  });
});

describe('proposalPriority + domainPriority', () => {
  it('ranks from exposure + expected improvement and maps critical → urgent for domain modules', () => {
    expect(proposalPriority({ affectedRevenue: 200000, expectedImprovementPct: 10 })).toBe('critical');
    expect(proposalPriority({ affectedRevenue: 0, expectedImprovementPct: 85 })).toBe('critical');
    expect(proposalPriority({ affectedRevenue: 30000, expectedImprovementPct: 10 })).toBe('high');
    expect(proposalPriority({ affectedRevenue: 6000, expectedImprovementPct: 10 })).toBe('medium');
    expect(proposalPriority({ affectedRevenue: 100, expectedImprovementPct: 10 })).toBe('low');
    expect(domainPriority('critical')).toBe('urgent');
    expect(domainPriority('high')).toBe('high');
  });
});

describe('proposalDraftFields — every draft is deliberately INERT', () => {
  it('production schedule: scheduled-but-unstarted (Manufacturing must Start it)', () => {
    const f = proposalDraftFields('production_schedule', decision({ id: 'dX', affectedOrders: ['MO-9'], affectedMachines: ['CNC-2'] }));
    expect(f).toMatchObject({ scheduleNumber: 'SCH-PROP-dX', productionOrder: 'MO-9', machine: 'CNC-2', status: 'scheduled' });
  });
  it('purchase request: draft (Procurement must Approve it)', () => {
    const f = proposalDraftFields('purchase_request', decision({ id: 'dX', affectedRevenue: 200000 }));
    expect(f).toMatchObject({ requestNumber: 'PR-PROP-dX', status: 'draft', priority: 'urgent' });
  });
  it('inventory reallocation: a VOID movement (excluded from every stock balance)', () => {
    const f = proposalDraftFields('inventory_reallocation', decision({ id: 'dX' }));
    expect(f).toMatchObject({ movementNumber: 'MV-PROP-dX', type: 'adjustment', status: 'void', quantity: 1 });
  });
  it('maintenance: a scheduled work order (Maintenance must Assign/Start it)', () => {
    const f = proposalDraftFields('maintenance', decision({ id: 'dX', affectedMachines: ['CNC-2'] }));
    expect(f).toMatchObject({ workOrderNumber: 'WO-PROP-dX', machine: 'CNC-2', status: 'scheduled', type: 'preventive' });
  });
  it('routing: a draft routing (Manufacturing must Activate it)', () => {
    const f = proposalDraftFields('routing', decision({ id: 'dX', affectedOrders: ['FG-2'] }));
    expect(f).toMatchObject({ routingNumber: 'ROUTE-PROP-dX', product: 'FG-2', status: 'draft' });
  });
});

describe('proposalRecordFields + executionProposalFromRecord', () => {
  it('maps a verified decision + route into a pending-confirmation proposal, carrying evidence + risk', () => {
    const route = routeDecision(decision());
    const f = proposalRecordFields(decision(), route, 'draft-rec-1', 'ceo@np.dev', T0);
    expect(f).toMatchObject({
      proposalNumber: 'PROP-d1', sourceDecisionId: 'd1', proposalType: 'production_schedule',
      targetModule: 'manufacturing-schedules', targetRecord: 'draft-rec-1', status: 'pending_confirmation',
      expectedImprovementPct: 80, priority: 'critical', primaryAction: 'use_alternate_machine',
      createdBy: 'ceo@np.dev', createdTime: T0,
    });
    expect(String(f.risk)).toContain('alternate'); // deterministic per-action trade-off (never invented)
    expect(String(f.evidence)).toContain('maxDelay'); // decision evidence carried forward as JSON
  });
  it('projects a stored record back into a typed proposal', () => {
    const p = executionProposalFromRecord(proposalRecord(proposalRecordFields(decision(), routeDecision(decision()), 'draft-1', 'ceo@np.dev', T0)));
    expect(p).toMatchObject({ proposalNumber: 'PROP-d1', proposalType: 'production_schedule', status: 'pending_confirmation', priority: 'critical', evidence: ['maxDelay=5d'] });
  });
});

describe('deriveHandoffInsights + KPIs', () => {
  const mk = (over: Partial<ExecutionProposalRecord>): ExecutionProposalRecord => ({
    id: 'x', proposalNumber: 'PROP', sourceDecisionId: 'd', decisionTitle: 't', decisionCategory: 'machine_failure_recovery',
    proposalType: 'production_schedule', targetModule: 'manufacturing-schedules', targetRecord: 'r', reason: 't', evidence: [],
    expectedImprovementPct: 50, risk: '', priority: 'medium', primaryAction: 'use_alternate_machine', status: 'pending_confirmation',
    createdBy: 'x', createdTime: T0, confirmedBy: '', confirmedAt: '', rejectedBy: '', rejectedAt: '', rejectionReason: '',
    createdAt: T0, updatedAt: T0, ...over,
  });

  it('rolls proposal records into the six handoff KPIs', () => {
    const proposals = [
      mk({ status: 'pending_confirmation' }),
      mk({ status: 'accepted', createdTime: '2026-07-08T00:00:00.000Z', confirmedAt: '2026-07-08T04:00:00.000Z' }),
      mk({ status: 'rejected', createdTime: '2026-07-08T00:00:00.000Z', rejectedAt: '2026-07-08T02:00:00.000Z' }),
    ];
    const insights = deriveHandoffInsights(proposals);
    expect(insights).toMatchObject({
      pendingProposals: 1,
      acceptedProposals: 1,
      rejectedProposals: 1,
      executionReadiness: 50, // accepted 1 / live (pending 1 + accepted 1) = 50%
      proposalAcceptanceRate: 50, // accepted 1 / decided (accepted 1 + rejected 1) = 50%
    });
    expect(insights.averageApprovalTimeHours).toBe(3); // mean(4h, 2h)
    expect(handoffInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'prop-pending', 'prop-accepted', 'prop-rejected', 'prop-execution-readiness', 'prop-avg-approval-time', 'prop-acceptance-rate',
    ]);
  });

  it('is optimistic-neutral when there are no decided proposals yet', () => {
    const insights = deriveHandoffInsights([mk({ status: 'pending_confirmation' })]);
    expect(insights).toMatchObject({ executionReadiness: 0, proposalAcceptanceRate: 100, averageApprovalTimeHours: 0 });
  });
});
