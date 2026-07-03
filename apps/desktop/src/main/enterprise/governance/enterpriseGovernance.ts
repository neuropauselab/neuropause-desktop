/**
 * Enterprise Governance engine. Defines the organization's default approval
 * chains and compliance rules, and evaluates those rules deterministically
 * against live org + workforce state to produce {@link ComplianceFinding}s.
 *
 * Pure and electron-free: no hidden state, no fabrication — every finding is
 * computed from the inputs and carries the evidence that drove it.
 */
import type {
  ApprovalChain,
  ComplianceFinding,
  ComplianceRule,
  ComplianceStatus,
  OrgUnit,
  OrgUser,
} from '@neuropause/shared';
import { ORG_ID, ROLE } from '../org/seed';

export const DEFAULT_APPROVAL_CHAINS: ApprovalChain[] = (() => {
  const now = '2026-01-01T00:00:00.000Z';
  return [
    {
      id: 'chain-side-effect',
      orgId: ORG_ID,
      name: 'Side-effect approval',
      description: 'Any AI worker action with side effects is approved by a manager before it is carried out.',
      appliesTo: 'workforce_side_effect',
      steps: [{ id: 'cs1', name: 'Manager approval', roleId: ROLE.manager, order: 1 }],
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'chain-governance',
      orgId: ORG_ID,
      name: 'Governance change',
      description: 'Changes to policies, roles, or compliance rules require admin then owner sign-off.',
      appliesTo: 'governance_change',
      steps: [
        { id: 'cg1', name: 'Admin review', roleId: ROLE.admin, order: 1 },
        { id: 'cg2', name: 'Owner approval', roleId: ROLE.owner, order: 2 },
      ],
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'chain-spend',
      orgId: ORG_ID,
      name: 'Spend approval',
      description: 'Financial commitments are routed through a manager and the owner.',
      appliesTo: 'spend',
      steps: [
        { id: 'cp1', name: 'Manager approval', roleId: ROLE.manager, order: 1 },
        { id: 'cp2', name: 'Owner approval', roleId: ROLE.owner, order: 2 },
      ],
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
})();

export const DEFAULT_COMPLIANCE_RULES: ComplianceRule[] = (() => {
  const now = '2026-01-01T00:00:00.000Z';
  const rule = (
    id: string,
    name: string,
    description: string,
    category: string,
    severity: ComplianceRule['severity'],
    check: ComplianceRule['check'],
  ): ComplianceRule => ({ id, orgId: ORG_ID, name, description, category, severity, check, enabled: true, createdAt: now, updatedAt: now });

  return [
    rule(
      'rule-side-effects',
      'Side effects require approval',
      'Every side-effecting worker proposal must be approved or rejected by a human.',
      'Governance',
      'critical',
      'every_side_effect_approved',
    ),
    rule(
      'rule-audit',
      'Governed actions are audited',
      'Once workers run, the governance audit trail must hold a record of decisions.',
      'Governance',
      'critical',
      'audit_trail_present',
    ),
    rule(
      'rule-chain',
      'Approval chain defined',
      'An enabled approval chain must govern side-effecting worker actions.',
      'Governance',
      'warning',
      'approval_chain_defined',
    ),
    rule(
      'rule-worker-health',
      'Workforce is healthy',
      'No AI worker should be in an unhealthy state.',
      'Operations',
      'warning',
      'no_unhealthy_workers',
    ),
    rule(
      'rule-orphans',
      'Members are assigned',
      'Every person belongs to a unit in the org chart.',
      'Organization',
      'warning',
      'no_orphaned_members',
    ),
    rule(
      'rule-leads',
      'Units have leaders',
      'Every org unit has a lead assigned.',
      'Organization',
      'info',
      'every_unit_has_lead',
    ),
  ];
})();

export interface ComplianceWorkerRef {
  id: string;
  name: string;
  healthState: string;
}

export interface ComplianceJobRef {
  id: string;
  proposals: { id: string; verdict: { decision: string }; approval: unknown }[];
}

export interface ComplianceInput {
  units: OrgUnit[];
  users: OrgUser[];
  workers: ComplianceWorkerRef[];
  jobs: ComplianceJobRef[];
  auditCount: number;
  jobsRun: number;
  approvalChains: ApprovalChain[];
}

/** Maps a failed check to a status using the rule's severity. */
function failStatus(severity: ComplianceRule['severity']): ComplianceStatus {
  return severity === 'critical' ? 'fail' : 'warn';
}

export function evaluateCompliance(rules: ComplianceRule[], input: ComplianceInput): ComplianceFinding[] {
  const out: ComplianceFinding[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    out.push(evaluateRule(r, input));
  }
  return out;
}

function evaluateRule(rule: ComplianceRule, input: ComplianceInput): ComplianceFinding {
  const base = { ruleId: rule.id, ruleName: rule.name, category: rule.category, severity: rule.severity };

  switch (rule.check) {
    case 'every_side_effect_approved': {
      const undecided: string[] = [];
      for (const j of input.jobs)
        for (const p of j.proposals)
          if (p.verdict.decision === 'require_approval' && !p.approval) undecided.push(p.id);
      return undecided.length === 0
        ? { ...base, status: 'pass', detail: 'All side-effecting proposals have been decided.', evidence: [] }
        : { ...base, status: failStatus(rule.severity), detail: `${undecided.length} proposal(s) awaiting a decision.`, evidence: undecided };
    }

    case 'no_unhealthy_workers': {
      const bad = input.workers.filter((w) => w.healthState === 'unhealthy');
      return bad.length === 0
        ? { ...base, status: 'pass', detail: 'No workers are unhealthy.', evidence: [] }
        : { ...base, status: failStatus(rule.severity), detail: `${bad.length} worker(s) unhealthy.`, evidence: bad.map((w) => w.id) };
    }

    case 'audit_trail_present': {
      const ok = input.jobsRun === 0 || input.auditCount > 0;
      return ok
        ? { ...base, status: 'pass', detail: input.jobsRun === 0 ? 'No governed actions yet.' : `${input.auditCount} decision(s) recorded.`, evidence: [] }
        : { ...base, status: failStatus(rule.severity), detail: 'Workers ran but no audit decisions were recorded.', evidence: [] };
    }

    case 'every_unit_has_lead': {
      const missing = input.units.filter((u) => !u.leadUserId);
      return missing.length === 0
        ? { ...base, status: 'pass', detail: 'Every unit has a lead.', evidence: [] }
        : { ...base, status: failStatus(rule.severity), detail: `${missing.length} unit(s) without a lead.`, evidence: missing.map((u) => u.id) };
    }

    case 'no_orphaned_members': {
      const orphans = input.users.filter((u) => u.kind === 'human' && !u.unitId);
      return orphans.length === 0
        ? { ...base, status: 'pass', detail: 'Every person is assigned to a unit.', evidence: [] }
        : { ...base, status: failStatus(rule.severity), detail: `${orphans.length} member(s) not assigned to a unit.`, evidence: orphans.map((u) => u.id) };
    }

    case 'approval_chain_defined': {
      const ok = input.approvalChains.some((c) => c.enabled && c.appliesTo === 'workforce_side_effect');
      return ok
        ? { ...base, status: 'pass', detail: 'A side-effect approval chain is enabled.', evidence: [] }
        : { ...base, status: failStatus(rule.severity), detail: 'No enabled approval chain governs side effects.', evidence: [] };
    }

    default:
      return { ...base, status: 'pass', detail: 'No check implemented.', evidence: [] };
  }
}
