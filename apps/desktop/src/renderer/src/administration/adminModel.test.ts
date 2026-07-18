/**
 * Enterprise Administration v1.0 — admin model tests. Lock the pure lens: honest status→tone maps, the
 * keyword state-tone, unit-kind labels, the administrative-gap catalog (never empty / always reasoned), and
 * the pure org/role/governance/compliance summaries over the real admin DTO shapes.
 */
import { describe, expect, it } from 'vitest';
import type { ComplianceFinding, GovernanceConfig, OrgRole, OrgUnit } from '@neuropause/shared';
import {
  ADMIN_GAPS,
  adminGapKindMeta,
  complianceStatusTone,
  deviceTrustTone,
  stateTone,
  summarizeCompliance,
  summarizeGovernance,
  summarizeRoles,
  summarizeUnits,
  unitKindLabelPlural,
} from './adminModel';

const unit = (kind: OrgUnit['kind'], id: string): OrgUnit =>
  ({ id, orgId: 'o', kind, name: id, parentId: null, leadUserId: null } as OrgUnit);
const role = (builtIn: boolean, id: string): OrgRole =>
  ({ id, orgId: 'o', name: id, description: '', permissions: [], builtIn } as unknown as OrgRole);
const gov = (chains: boolean[], rules: boolean[]): GovernanceConfig =>
  ({
    roles: [],
    approvalChains: chains.map((enabled, i) => ({ id: `c${i}`, enabled })),
    complianceRules: rules.map((enabled, i) => ({ id: `r${i}`, enabled })),
  } as unknown as GovernanceConfig);
const finding = (status: ComplianceFinding['status']): ComplianceFinding =>
  ({ ruleId: 'r', ruleName: 'r', category: 'c', severity: 'info', status, detail: '', evidence: [] } as unknown as ComplianceFinding);

describe('status → tone maps', () => {
  it('compliance + device tones are honest', () => {
    expect(complianceStatusTone('pass')).toBe('green');
    expect(complianceStatusTone('warn')).toBe('orange');
    expect(complianceStatusTone('fail')).toBe('red');
    expect(deviceTrustTone('trusted')).toBe('green');
    expect(deviceTrustTone('blocked')).toBe('red');
    expect(deviceTrustTone('revoked')).toBe('gray');
  });

  it('keyword state tone classifies varying string states defensively', () => {
    expect(stateTone('valid')).toBe('green');
    expect(stateTone('healthy')).toBe('green');
    expect(stateTone('grace')).toBe('orange');
    expect(stateTone('preview')).toBe('orange');
    expect(stateTone('invalid')).toBe('red');
    expect(stateTone('revoked')).toBe('red');
    // negatives that CONTAIN a positive substring must still read negative
    expect(stateTone('disconnected')).toBe('red');
    expect(stateTone('connected')).toBe('green');
    expect(stateTone('something-unknown')).toBe('gray');
    expect(stateTone(null)).toBe('gray');
  });

  it('unit-kind labels are human', () => {
    expect(unitKindLabelPlural('business_unit')).toBe('Business units');
    expect(unitKindLabelPlural('department')).toBe('Departments');
    expect(unitKindLabelPlural('team')).toBe('Teams');
  });
});

describe('administrative-gap catalog (honesty ledger)', () => {
  it('is non-empty and every gap carries an area, capability, valid kind and reason', () => {
    expect(ADMIN_GAPS.length).toBeGreaterThan(0);
    for (const g of ADMIN_GAPS) {
      expect(g.area.length).toBeGreaterThan(0);
      expect(g.capability.length).toBeGreaterThan(0);
      expect(g.reason.length).toBeGreaterThan(0);
      expect(['not-in-app', 'managed']).toContain(g.kind);
      expect(adminGapKindMeta(g.kind).label.length).toBeGreaterThan(0);
    }
  });

  it('records Groups, Locations and session-admin as absent, and provider config as managed', () => {
    const by = (cap: string) => ADMIN_GAPS.find((g) => g.capability.toLowerCase().includes(cap));
    expect(by('groups')?.kind).toBe('not-in-app');
    expect(by('locations')?.kind).toBe('not-in-app');
    expect(by('session')?.kind).toBe('not-in-app');
    expect(by('provider')?.kind).toBe('managed');
  });
});

describe('pure admin summaries', () => {
  it('summarizeUnits counts each org-unit kind', () => {
    const s = summarizeUnits([unit('business_unit', 'b1'), unit('department', 'd1'), unit('department', 'd2'), unit('team', 't1')]);
    expect(s).toEqual({ businessUnits: 1, departments: 2, teams: 1, total: 4 });
  });

  it('summarizeRoles splits built-in vs custom', () => {
    const s = summarizeRoles([role(true, 'owner'), role(true, 'admin'), role(false, 'custom')]);
    expect(s).toEqual({ total: 3, builtIn: 2, custom: 1 });
  });

  it('summarizeGovernance counts enabled chains + rules', () => {
    const s = summarizeGovernance(gov([true, false, true], [true, true, false, false]));
    expect(s).toEqual({ chains: 3, chainsEnabled: 2, rules: 4, rulesEnabled: 2 });
    expect(summarizeGovernance(null)).toEqual({ chains: 0, chainsEnabled: 0, rules: 0, rulesEnabled: 0 });
  });

  it('summarizeCompliance tallies pass/warn/fail with an honest overall tone', () => {
    expect(summarizeCompliance([finding('pass'), finding('pass')]).tone).toBe('green');
    expect(summarizeCompliance([finding('pass'), finding('warn')]).tone).toBe('orange');
    expect(summarizeCompliance([finding('pass'), finding('fail')]).tone).toBe('red');
    expect(summarizeCompliance([]).tone).toBe('gray');
    const s = summarizeCompliance([finding('pass'), finding('warn'), finding('fail')]);
    expect(s).toMatchObject({ total: 3, pass: 1, warn: 1, fail: 1 });
  });
});
