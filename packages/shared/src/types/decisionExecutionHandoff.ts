/**
 * Decision Execution Handoff — the controlled bridge between GOVERNANCE and EXECUTION. The Executive
 * Decision Approval System produces VERIFIED recovery decisions; this layer lets a verified decision
 * create a single, inert EXECUTION PROPOSAL routed to the ONE responsible operational module — and
 * NOTHING more. Nothing executes automatically. The chain is strict and one-directional:
 *
 *   Verified Executive Decision → Execution Proposal → Responsible Module (inert draft) →
 *   Human Confirmation → the Existing Module executes (via its OWN action + its OWN RBAC scope).
 *
 * A proposal is a governance artifact: it records the source decision, the target module + the inert
 * draft record it created, the reason, the evidence, the expected improvement, the risk, the priority,
 * and its own confirmation lifecycle (draft → pending confirmation → accepted / rejected / cancelled).
 * Accepting a proposal changes ONLY the proposal record's state — it never runs production. The draft
 * it created is deliberately inert (a `void` stock movement, a `draft` purchase request / routing, a
 * `scheduled`-but-unstarted production schedule / work order) so it changes no balance and no schedule
 * until the responsible team explicitly executes it through the domain module that owns that authority.
 *
 * This file holds the proposal-record projection + mapper, the strict status lifecycle, the
 * DETERMINISTIC decision router (which module is responsible for a given decision + action), the inert
 * draft-field builders per target, the proposal-record field mapper, and the handoff KPIs. It invents
 * nothing: every route and every field is derived from the verified decision. Manufacturing stays the
 * execution authority, Inventory the inventory authority, Maintenance the downtime authority,
 * Procurement the buy-side authority; the executive layer only GOVERNS the handoff.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';
import type { DecisionType, RecoveryActionType } from './enterpriseDecisionEngine';
import { RECOVERY_ACTION_META } from './enterpriseDecisionEngine';
import type { ExecutiveDecisionRecord } from './executiveDecisionApproval';
// The responsible modules are the EXISTING execution authorities — reuse their canonical ids, never
// re-declare them (a second declaration would collide in the shared barrel and duplicate the truth).
import { PRODUCTION_SCHEDULES_MODULE_ID } from './manufacturing';
import { PURCHASE_REQUESTS_MODULE_ID } from './procurement';
import { STOCK_MOVEMENTS_MODULE_ID } from './inventory';
import { WORK_ORDERS_MODULE_ID } from './maintenanceManagement';
import { ROUTINGS_MODULE_ID } from './routing';

/* ── module identity + RBAC scope ──────────────────────────────────────────── */

export const EXECUTION_PROPOSALS_MODULE_ID = 'execution-proposals';
export const EXECUTION_PROPOSAL_KIND = 'execution-proposal';

/** Only a VERIFIED decision, and only an executive user, can hand a decision off to execution. */
export const EXECUTIVE_EXECUTE = 'executive:execute';

/* ── proposal types (fixed vocabulary — one per responsible domain) ─────────── */

export type ProposalType =
  | 'production_schedule'
  | 'purchase_request'
  | 'inventory_reallocation'
  | 'maintenance'
  | 'workforce'
  | 'routing'
  | 'capacity';

export const PROPOSAL_TYPES: readonly ProposalType[] = [
  'production_schedule',
  'purchase_request',
  'inventory_reallocation',
  'maintenance',
  'workforce',
  'routing',
  'capacity',
];

export const PROPOSAL_TYPE_LABEL: Record<ProposalType, string> = {
  production_schedule: 'Production Schedule',
  purchase_request: 'Purchase Request',
  inventory_reallocation: 'Inventory Reallocation',
  maintenance: 'Maintenance',
  workforce: 'Workforce',
  routing: 'Routing',
  capacity: 'Capacity',
};

/* ── status lifecycle (strict, deterministic) ──────────────────────────────── */

export type ProposalStatus = 'draft' | 'pending_confirmation' | 'accepted' | 'rejected' | 'cancelled';

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  'draft',
  'pending_confirmation',
  'accepted',
  'rejected',
  'cancelled',
];

export type ProposalAction = 'submit' | 'accept' | 'reject' | 'cancel';

/** The one legal target status for an action from a status, or null if not allowed. */
export function proposalTransition(action: ProposalAction, from: ProposalStatus): ProposalStatus | null {
  switch (action) {
    case 'submit':
      return from === 'draft' ? 'pending_confirmation' : null;
    case 'accept':
      return from === 'pending_confirmation' ? 'accepted' : null;
    case 'reject':
      return from === 'pending_confirmation' ? 'rejected' : null;
    case 'cancel':
      return from === 'draft' || from === 'pending_confirmation' ? 'cancelled' : null;
    default:
      return null;
  }
}

/* ── coercion helpers ──────────────────────────────────────────────────────── */

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(str(v)) || 0);
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
function csv(v: unknown): string[] {
  return str(v)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
function parseJson<T>(v: unknown): T | null {
  const s = str(v).trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
function oneOf<T extends string>(v: unknown, all: readonly T[], fallback: T): T {
  const s = str(v);
  return (all as readonly string[]).includes(s) ? (s as T) : fallback;
}

/* ── proposal priority (deterministic — derived from the decision, never invented) ── */

export type ProposalPriority = 'low' | 'medium' | 'high' | 'critical';
export const PROPOSAL_PRIORITIES: readonly ProposalPriority[] = ['low', 'medium', 'high', 'critical'];

/** Rank a proposal from the verified decision's exposure + expected improvement. Pure + monotone. */
export function proposalPriority(decision: Pick<ExecutiveDecisionRecord, 'affectedRevenue' | 'expectedImprovementPct'>): ProposalPriority {
  const rev = Math.max(0, decision.affectedRevenue);
  const imp = Math.max(0, decision.expectedImprovementPct);
  if (rev >= 100000 || imp >= 80) return 'critical';
  if (rev >= 25000 || imp >= 60) return 'high';
  if (rev >= 5000 || imp >= 40) return 'medium';
  return 'low';
}

/** Map a proposal priority onto a domain module's own {low, medium, high, urgent} option set. */
export function domainPriority(p: ProposalPriority): 'low' | 'medium' | 'high' | 'urgent' {
  return p === 'critical' ? 'urgent' : p;
}

/* ── the deterministic decision router ─────────────────────────────────────── */

export interface ProposalRoute {
  proposalType: ProposalType;
  /** The single responsible module id (the execution authority for this proposal). */
  targetModuleId: string;
}

/**
 * Route a verified decision to the ONE responsible module + proposal type. Deterministic and total:
 * the decision's recovery ACTION is the primary signal (it names the concrete lever), with the decision
 * CATEGORY resolving the remaining cases. Never invents a target — every branch maps to a real module.
 *
 *   routing_optimization ............................. Routing        → manufacturing-routings
 *   maintenance_reschedule / delay_maintenance ....... Maintenance    → maintenance-work-orders
 *   increase_procurement / expedite_supplier /
 *     subcontract_production ......................... Purchase Req.  → procurement-requests
 *   use_safety_stock ................................. Inventory      → inventory-movements (void)
 *   capacity_recovery ................................ Capacity       → manufacturing-schedules
 *   move / split / alternate-machine / second-shift /
 *     resequence (+ every remaining decision) ........ Production     → manufacturing-schedules
 */
export function routeDecision(
  decision: Pick<ExecutiveDecisionRecord, 'category' | 'primaryAction'>,
): ProposalRoute {
  const { category, primaryAction } = decision;

  if (category === 'routing_optimization') {
    return { proposalType: 'routing', targetModuleId: ROUTINGS_MODULE_ID };
  }
  if (category === 'maintenance_reschedule' || primaryAction === 'delay_maintenance') {
    return { proposalType: 'maintenance', targetModuleId: WORK_ORDERS_MODULE_ID };
  }
  if (
    primaryAction === 'increase_procurement' ||
    primaryAction === 'expedite_supplier' ||
    primaryAction === 'subcontract_production'
  ) {
    return { proposalType: 'purchase_request', targetModuleId: PURCHASE_REQUESTS_MODULE_ID };
  }
  if (primaryAction === 'use_safety_stock') {
    return { proposalType: 'inventory_reallocation', targetModuleId: STOCK_MOVEMENTS_MODULE_ID };
  }
  if (category === 'capacity_recovery') {
    return { proposalType: 'capacity', targetModuleId: PRODUCTION_SCHEDULES_MODULE_ID };
  }
  // Default: everything else is a production-schedule change on the shop floor.
  return { proposalType: 'production_schedule', targetModuleId: PRODUCTION_SCHEDULES_MODULE_ID };
}

/* ── inert draft-field builders (per target module) ────────────────────────── */

/**
 * Build the field bag for the INERT draft record the handoff creates in the responsible module. Every
 * draft is deliberately non-operational: a `void` stock movement (excluded from all balances), a
 * `draft` purchase request / routing, or a `scheduled`-but-unstarted production schedule / work order.
 * The draft carries a `-PROP-<decisionId>` reference so it is traceable back to the proposal, and the
 * responsible team must run it through the domain module's own lifecycle (with the domain RBAC scope)
 * for anything real to happen. Pure — derived entirely from the verified decision.
 */
export function proposalDraftFields(
  proposalType: ProposalType,
  decision: ExecutiveDecisionRecord,
): Record<string, string | number> {
  const id = decision.id;
  const order = decision.affectedOrders[0] ?? 'PROPOSED';
  const machine = decision.affectedMachines[0] ?? '';
  const prio = proposalPriority(decision);

  switch (proposalType) {
    case 'production_schedule':
    case 'capacity':
      return {
        scheduleNumber: `SCH-PROP-${id}`,
        productionOrder: order,
        workCenter: '',
        machine,
        startDate: '',
        endDate: '',
        status: 'scheduled', // inert — Manufacturing must Start it (manufacturing:manage)
      };
    case 'purchase_request':
      return {
        requestNumber: `PR-PROP-${id}`,
        department: 'Executive',
        requester: decision.createdBy || 'executive',
        product: order,
        quantity: 1,
        priority: domainPriority(prio),
        reason: decision.title,
        status: 'draft', // inert — Procurement must Approve it (procurement:manage)
      };
    case 'inventory_reallocation':
      return {
        movementNumber: `MV-PROP-${id}`,
        type: 'adjustment',
        product: order,
        warehouse: 'PROPOSED',
        quantity: 1,
        status: 'void', // inert — a void movement is EXCLUDED from every stock balance
        reason: decision.title,
      };
    case 'maintenance':
      return {
        workOrderNumber: `WO-PROP-${id}`,
        type: 'preventive',
        machine: machine || 'PROPOSED',
        description: decision.title,
        scheduledDate: '',
        priority: domainPriority(prio),
        status: 'scheduled', // inert — Maintenance must Assign/Start it (maintenance:manage)
      };
    case 'routing':
      return {
        routingNumber: `ROUTE-PROP-${id}`,
        product: order,
        operations: '',
        status: 'draft', // inert — Manufacturing must Activate it (manufacturing:manage)
        notes: decision.title,
      };
    case 'workforce':
    default:
      // Workforce has no execution module yet (see module notes) — a bare, inert placeholder.
      return {
        proposalNumber: `WF-PROP-${id}`,
        reason: decision.title,
        status: 'draft',
      };
  }
}

/* ── the proposal record projection ────────────────────────────────────────── */

export interface ExecutionProposalRecord {
  id: string;
  proposalNumber: string;
  /** The verified decision this proposal was handed off from. */
  sourceDecisionId: string;
  decisionTitle: string;
  decisionCategory: DecisionType;
  proposalType: ProposalType;
  /** The single responsible module + the inert draft record created inside it. */
  targetModule: string;
  targetRecord: string;
  reason: string;
  evidence: string[];
  expectedImprovementPct: number;
  risk: string;
  priority: ProposalPriority;
  primaryAction: RecoveryActionType;
  status: ProposalStatus;
  createdBy: string;
  createdTime: string;
  confirmedBy: string;
  confirmedAt: string;
  rejectedBy: string;
  rejectedAt: string;
  rejectionReason: string;
  createdAt: string;
  updatedAt: string;
}

const ACTIONS: readonly RecoveryActionType[] = Object.keys(RECOVERY_ACTION_META) as RecoveryActionType[];

export function executionProposalFromRecord(record: EnterpriseEntity): ExecutionProposalRecord {
  const f = record.fields;
  return {
    id: record.id,
    proposalNumber: str(f.proposalNumber) || record.title,
    sourceDecisionId: str(f.sourceDecisionId),
    decisionTitle: str(f.decisionTitle),
    decisionCategory: str(f.decisionCategory) as DecisionType,
    proposalType: oneOf<ProposalType>(f.proposalType, PROPOSAL_TYPES, 'production_schedule'),
    targetModule: str(f.targetModule),
    targetRecord: str(f.targetRecord),
    reason: str(f.reason),
    evidence: parseJson<string[]>(f.evidence) ?? csv(f.evidence),
    expectedImprovementPct: num(f.expectedImprovementPct),
    risk: str(f.risk),
    priority: oneOf<ProposalPriority>(f.priority, PROPOSAL_PRIORITIES, 'medium'),
    primaryAction: oneOf<RecoveryActionType>(f.primaryAction, ACTIONS, 'resequence_jobs'),
    status: oneOf<ProposalStatus>(f.status, PROPOSAL_STATUSES, 'draft'),
    createdBy: str(f.createdBy),
    createdTime: str(f.createdTime),
    confirmedBy: str(f.confirmedBy),
    confirmedAt: str(f.confirmedAt),
    rejectedBy: str(f.rejectedBy),
    rejectedAt: str(f.rejectedAt),
    rejectionReason: str(f.rejectionReason),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Map a verified decision + its route + the created draft into the fields of a new proposal record.
 * The proposal is created ALREADY awaiting confirmation (`pending_confirmation`) — the verified-decision
 * handoff IS the submission. Pure; the risk is the deterministic per-action trade-off. Nothing here
 * executes — the proposal only records intent for a human to confirm.
 */
export function proposalRecordFields(
  decision: ExecutiveDecisionRecord,
  route: ProposalRoute,
  targetRecordId: string,
  createdBy: string,
  now: string,
): Record<string, string | number> {
  return {
    proposalNumber: `PROP-${decision.id}`,
    sourceDecisionId: decision.id,
    decisionTitle: decision.title,
    decisionCategory: decision.category,
    proposalType: route.proposalType,
    targetModule: route.targetModuleId,
    targetRecord: targetRecordId,
    reason: decision.title,
    evidence: JSON.stringify(decision.evidence),
    expectedImprovementPct: decision.expectedImprovementPct,
    risk: RECOVERY_ACTION_META[decision.primaryAction]?.tradeoff ?? '',
    priority: proposalPriority(decision),
    primaryAction: decision.primaryAction,
    status: 'pending_confirmation',
    createdBy: createdBy || decision.createdBy,
    createdTime: now,
  };
}

/* ── handoff KPIs ──────────────────────────────────────────────────────────── */

export interface HandoffInsights {
  pendingProposals: number;
  acceptedProposals: number;
  rejectedProposals: number;
  /** Share of live proposals (pending + accepted) that are confirmed and ready for the domain team. */
  executionReadiness: number;
  /** Mean hours from proposal creation to its accept/reject decision. */
  averageApprovalTimeHours: number;
  /** Accepted ÷ (accepted + rejected), as a percentage. */
  proposalAcceptanceRate: number;
}

/** Roll the proposal records into the six handoff KPIs. Pure. */
export function deriveHandoffInsights(proposals: ExecutionProposalRecord[]): HandoffInsights {
  const byStatus = (s: ProposalStatus): ExecutionProposalRecord[] => proposals.filter((p) => p.status === s);
  const pending = byStatus('pending_confirmation');
  const accepted = byStatus('accepted');
  const rejected = byStatus('rejected');

  const live = pending.length + accepted.length;
  const executionReadiness = live > 0 ? clamp(Math.round((accepted.length / live) * 100), 0, 100) : 100;

  const decidedTimes: number[] = [];
  for (const p of proposals) {
    const decidedAt = p.confirmedAt || p.rejectedAt;
    if (!decidedAt || !p.createdTime) continue;
    const created = Date.parse(p.createdTime);
    const decided = Date.parse(decidedAt);
    if (Number.isFinite(created) && Number.isFinite(decided) && decided >= created) {
      decidedTimes.push(Math.round((decided - created) / (60 * 60 * 1000)));
    }
  }
  const averageApprovalTimeHours = decidedTimes.length === 0 ? 0 : mean(decidedTimes);

  const decided = accepted.length + rejected.length;
  const proposalAcceptanceRate = decided === 0 ? 100 : clamp(Math.round((accepted.length / decided) * 100), 0, 100);

  return {
    pendingProposals: pending.length,
    acceptedProposals: accepted.length,
    rejectedProposals: rejected.length,
    executionReadiness,
    averageApprovalTimeHours,
    proposalAcceptanceRate,
  };
}

/** Map handoff insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function handoffInsightsToKpis(insights: HandoffInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const pendingBand: ExecutiveKpi['band'] = insights.pendingProposals === 0 ? 'healthy' : insights.pendingProposals <= 3 ? 'watch' : 'at-risk';
  const timeBand: ExecutiveKpi['band'] = insights.averageApprovalTimeHours <= 24 ? 'healthy' : insights.averageApprovalTimeHours <= 72 ? 'watch' : 'at-risk';
  return [
    { key: 'prop-pending', label: 'Pending Proposals', value: insights.pendingProposals, display: `${insights.pendingProposals}`, band: pendingBand, deepLink: 'enterprise/executive' },
    { key: 'prop-accepted', label: 'Accepted Proposals', value: insights.acceptedProposals, display: `${insights.acceptedProposals}`, deepLink: 'enterprise/executive' },
    { key: 'prop-rejected', label: 'Rejected Proposals', value: insights.rejectedProposals, display: `${insights.rejectedProposals}`, deepLink: 'enterprise/executive' },
    { key: 'prop-execution-readiness', label: 'Execution Readiness', value: insights.executionReadiness, display: `${insights.executionReadiness}%`, band: pctBand(insights.executionReadiness), deepLink: 'enterprise/executive' },
    { key: 'prop-avg-approval-time', label: 'Average Approval Time', value: insights.averageApprovalTimeHours, display: `${insights.averageApprovalTimeHours}h`, band: timeBand, deepLink: 'enterprise/executive' },
    { key: 'prop-acceptance-rate', label: 'Proposal Acceptance Rate', value: insights.proposalAcceptanceRate, display: `${insights.proposalAcceptanceRate}%`, band: pctBand(insights.proposalAcceptanceRate), deepLink: 'enterprise/executive' },
  ];
}
