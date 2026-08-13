/**
 * IP-02 — pure tests for the Desktop Industry Integration projections over the
 * canonical @neuropause/industry data shapes.
 */
import { describe, expect, it } from 'vitest';
import type {
  CapabilityEvidence,
  IndustryReadiness,
  IndustrySolution,
} from '@neuropause/industry/catalog';
import {
  evidenceLevelLabel,
  groupCapabilitiesByArea,
  projectIndustries,
  projectIndustry,
  readinessView,
} from './industryProjection';

const solution = (over: Partial<IndustrySolution> = {}): IndustrySolution =>
  ({
    key: 'healthcare',
    name: 'Healthcare',
    reusesDomains: ['crm', 'projects'],
    objects: [{}, {}],
    workflows: [
      { name: 'Admit', steps: ['a'], requiresApproval: true },
      { name: 'Discharge', steps: ['b'], requiresApproval: false },
    ],
    kpis: [{}],
    compliancePacks: [{}],
    connectors: [{}, {}, {}],
    aiSkills: [{}],
    documentTemplates: [],
    ...over,
  }) as unknown as IndustrySolution;

describe('industryProjection', () => {
  it('projects a canonical solution into compact counts', () => {
    const s = projectIndustry(solution());
    expect(s.key).toBe('healthcare');
    expect(s.reusesDomains).toEqual(['crm', 'projects']);
    expect(s.counts).toEqual({
      objects: 2,
      workflows: 2,
      kpis: 1,
      compliancePacks: 1,
      connectors: 3,
      aiSkills: 1,
      documentTemplates: 0,
    });
    expect(s.approvalWorkflows).toBe(1);
  });

  it('projects and sorts industries by name', () => {
    const list = projectIndustries([
      solution({ key: 'retail', name: 'Retail' }),
      solution({ key: 'banking', name: 'Banking' }),
    ]);
    expect(list.map((i) => i.name)).toEqual(['Banking', 'Retail']);
  });

  it('groups the capability matrix by area, preserving order', () => {
    const matrix = [
      { capability: 'SDK', area: 'SDK', level: 'live-verified', note: '' },
      { capability: 'Config', area: 'Config', level: 'live-verified', note: '' },
      { capability: 'Tenant config', area: 'Config', level: 'live-verified', note: '' },
    ] as unknown as CapabilityEvidence[];
    const groups = groupCapabilitiesByArea(matrix);
    expect(groups.map((g) => g.area)).toEqual(['SDK', 'Config']);
    expect(groups[1].items).toHaveLength(2);
  });

  it('computes a readiness view percentage (0 when empty)', () => {
    const r = {
      total: 10,
      liveVerified: 7,
      adapterVerified: 2,
      businessDataPending: 1,
      regulatedExternal: 0,
    } as IndustryReadiness;
    expect(readinessView(r).liveVerifiedPct).toBe(70);
    expect(readinessView({ ...r, total: 0, liveVerified: 0 }).liveVerifiedPct).toBe(0);
  });

  it('labels evidence levels honestly, passing unknowns through', () => {
    expect(evidenceLevelLabel('live-verified')).toBe('Live');
    expect(evidenceLevelLabel('adapter-verified')).toBe('Adapter-verified');
    expect(evidenceLevelLabel('regulated-external')).toBe('External');
    expect(evidenceLevelLabel('mystery')).toBe('mystery');
  });
});
