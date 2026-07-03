import { describe, expect, it } from 'vitest';
import type { ComplianceRule, OrgUnit, OrgUser } from '@neuropause/shared';
import {
  DEFAULT_APPROVAL_CHAINS,
  DEFAULT_COMPLIANCE_RULES,
  evaluateCompliance,
  type ComplianceInput,
} from './enterpriseGovernance';

const NOW = '2026-02-10T00:00:00.000Z';

function ruleByCheck(check: ComplianceRule['check']): ComplianceRule {
  const r = DEFAULT_COMPLIANCE_RULES.find((x) => x.check === check);
  if (!r) throw new Error(`no default rule for ${check}`);
  return r;
}

function baseInput(over: Partial<ComplianceInput> = {}): ComplianceInput {
  return {
    units: [],
    users: [],
    workers: [],
    jobs: [],
    auditCount: 0,
    jobsRun: 0,
    approvalChains: DEFAULT_APPROVAL_CHAINS,
    ...over,
  };
}

describe('evaluateCompliance — defaults', () => {
  it('a clean org passes every default rule', () => {
    const findings = evaluateCompliance(DEFAULT_COMPLIANCE_RULES, baseInput());
    expect(findings.length).toBe(DEFAULT_COMPLIANCE_RULES.length);
    expect(findings.every((f) => f.status === 'pass')).toBe(true);
  });

  it('skips disabled rules', () => {
    const disabled = DEFAULT_COMPLIANCE_RULES.map((r) => ({ ...r, enabled: false }));
    expect(evaluateCompliance(disabled, baseInput())).toHaveLength(0);
  });
});

describe('evaluateCompliance — checks', () => {
  it('every_side_effect_approved fails (critical) on an undecided proposal, passes once decided', () => {
    const rule = ruleByCheck('every_side_effect_approved');
    const pending = baseInput({
      jobs: [{ id: 'j1', proposals: [{ id: 'p1', verdict: { decision: 'require_approval' }, approval: null }] }],
    });
    const fail = evaluateCompliance([rule], pending)[0];
    expect(fail.status).toBe('fail'); // critical severity
    expect(fail.evidence).toContain('p1');

    const decided = baseInput({
      jobs: [{ id: 'j1', proposals: [{ id: 'p1', verdict: { decision: 'require_approval' }, approval: { decision: 'approved' } }] }],
    });
    expect(evaluateCompliance([rule], decided)[0].status).toBe('pass');
  });

  it('no_unhealthy_workers warns when a worker is unhealthy', () => {
    const rule = ruleByCheck('no_unhealthy_workers');
    const fail = evaluateCompliance([rule], baseInput({ workers: [{ id: 'w1', name: 'X', healthState: 'unhealthy' }] }))[0];
    expect(fail.status).toBe('warn'); // warning severity
    expect(fail.evidence).toContain('w1');
    expect(evaluateCompliance([rule], baseInput({ workers: [{ id: 'w1', name: 'X', healthState: 'healthy' }] }))[0].status).toBe('pass');
  });

  it('audit_trail_present fails when workers ran but nothing was recorded', () => {
    const rule = ruleByCheck('audit_trail_present');
    expect(evaluateCompliance([rule], baseInput({ jobsRun: 3, auditCount: 0 }))[0].status).toBe('fail');
    expect(evaluateCompliance([rule], baseInput({ jobsRun: 3, auditCount: 5 }))[0].status).toBe('pass');
    expect(evaluateCompliance([rule], baseInput({ jobsRun: 0, auditCount: 0 }))[0].status).toBe('pass');
  });

  it('every_unit_has_lead is informational and flags unled units', () => {
    const rule = ruleByCheck('every_unit_has_lead');
    const units: OrgUnit[] = [{ id: 'u', orgId: 'o', kind: 'team', name: 'T', parentId: null, leadUserId: null, createdAt: NOW, updatedAt: NOW }];
    const f = evaluateCompliance([rule], baseInput({ units }))[0];
    expect(f.severity).toBe('info');
    expect(f.status).toBe('warn'); // info maps to warn, not fail
    expect(f.evidence).toContain('u');
  });

  it('no_orphaned_members flags humans without a unit but ignores AI workers', () => {
    const rule = ruleByCheck('no_orphaned_members');
    const users: OrgUser[] = [
      { id: 'h', orgId: 'o', name: 'H', email: null, title: '', kind: 'human', workerId: null, unitId: null, roleIds: [], status: 'active', createdAt: NOW, updatedAt: NOW },
      { id: 'a', orgId: 'o', name: 'A', email: null, title: '', kind: 'ai_worker', workerId: 'w', unitId: null, roleIds: [], status: 'active', createdAt: NOW, updatedAt: NOW },
    ];
    const f = evaluateCompliance([rule], baseInput({ users }))[0];
    expect(f.evidence).toEqual(['h']);
  });

  it('approval_chain_defined fails when no side-effect chain is enabled', () => {
    const rule = ruleByCheck('approval_chain_defined');
    const noChain = baseInput({ approvalChains: DEFAULT_APPROVAL_CHAINS.map((c) => ({ ...c, enabled: false })) });
    expect(evaluateCompliance([rule], noChain)[0].status).toBe('warn');
    expect(evaluateCompliance([rule], baseInput())[0].status).toBe('pass');
  });
});
