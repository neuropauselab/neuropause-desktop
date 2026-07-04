import { describe, expect, it, vi } from 'vitest';
import { computeOrgHealth, orgHealthBand, type OrgHealthInputs } from '@neuropause/shared';

// The source module imports store singletons that touch electron's app.getPath.
// These tests exercise the PURE logic (computeOrgHealth + deriveOrgFindings), so
// we stub the electron-coupled imports to keep the module graph loadable.
vi.mock('../connectors/connectorStore', () => ({ connectorStore: { all: () => [] } }));
vi.mock('../license/licenseInstance', () => ({
  licenseValidator: { getStatus: () => ({ evaluation: null }) },
}));
vi.mock('./org/orgInstance', () => ({
  orgStore: { defaultOrg: () => ({ id: 'o1' }), usersFor: () => [] },
}));
vi.mock('./workspace/workspaceInstance', () => ({ workspaceStore: { list: () => [] } }));
vi.mock('../timeline', () => ({ getEnterpriseTimeline: () => null }));

import { deriveOrgFindings } from './orgIntelligence';

describe('computeOrgHealth', () => {
  it('a healthy org scores high', () => {
    const inputs: OrgHealthInputs = {
      connectorsTotal: 4,
      connectorsHealthy: 4,
      connectorsError: 0,
      licenseValid: true,
      licenseDaysToExpiry: 300,
      memberCount: 5,
      activeMemberCount: 4,
      workspaceCount: 2,
      recentEventCount: 60,
      aiSourcesUsed: 5,
      engineeringHealth01: 0.9,
      syncFailures: 0,
      executiveActiveRecently: true,
    };
    const s = computeOrgHealth(inputs);
    expect(s.overall).toBeGreaterThanOrEqual(80);
    expect(orgHealthBand(s.overall)).toBe('healthy');
    expect(s.connectorHealth).toBe(100);
    expect(s.licenseHealth).toBe(100);
  });

  it('an expired license zeroes license health and drags overall down', () => {
    const s = computeOrgHealth({ licenseValid: false, connectorsTotal: 2, connectorsHealthy: 2 });
    expect(s.licenseHealth).toBe(0);
    expect(s.overall).toBeLessThan(80);
  });

  it('license health decays linearly inside the 30-day window', () => {
    const s15 = computeOrgHealth({ licenseValid: true, licenseDaysToExpiry: 15 });
    expect(s15.licenseHealth).toBe(50);
    const s30 = computeOrgHealth({ licenseValid: true, licenseDaysToExpiry: 30 });
    expect(s30.licenseHealth).toBe(100);
  });

  it('connector errors penalize connector + reliability health', () => {
    const s = computeOrgHealth({
      connectorsTotal: 4,
      connectorsHealthy: 2,
      connectorsError: 2,
      syncFailures: 2,
    });
    expect(s.connectorHealth).toBe(30); // (2/4)*100 - 2*10
    expect(s.reliability).toBe(70); // 100 - 2*15
  });

  it('no connectors is neutral, not a failure', () => {
    const s = computeOrgHealth({ connectorsTotal: 0 });
    expect(s.connectorHealth).toBe(70);
  });

  it('bands map correctly', () => {
    expect(orgHealthBand(85)).toBe('healthy');
    expect(orgHealthBand(65)).toBe('watch');
    expect(orgHealthBand(45)).toBe('at-risk');
    expect(orgHealthBand(20)).toBe('critical');
  });
});

describe('deriveOrgFindings', () => {
  it('emits a critical finding for an invalid license', () => {
    const inputs: OrgHealthInputs = {
      licenseValid: false,
      connectorsTotal: 1,
      connectorsHealthy: 1,
    };
    const scores = computeOrgHealth(inputs);
    const findings = deriveOrgFindings(scores, inputs);
    const lic = findings.find((f) => f.id === 'org:license:invalid');
    expect(lic).toBeDefined();
    expect(lic!.priority).toBe('critical');
    expect(lic!.evidence.length).toBeGreaterThan(0);
    expect(lic!.recommendedAction).toBeTruthy();
    expect(lic!.confidence).toBeGreaterThan(0.9);
  });

  it('emits an expiring-license finding at 3 days as critical', () => {
    const inputs: OrgHealthInputs = {
      licenseValid: true,
      licenseDaysToExpiry: 3,
      connectorsTotal: 1,
      connectorsHealthy: 1,
      recentEventCount: 10,
    };
    const findings = deriveOrgFindings(computeOrgHealth(inputs), inputs);
    const exp = findings.find((f) => f.id === 'org:license:expiring');
    expect(exp).toBeDefined();
    expect(exp!.priority).toBe('critical');
  });

  it('emits a connector-error finding with evidence', () => {
    const inputs: OrgHealthInputs = {
      connectorsTotal: 3,
      connectorsHealthy: 2,
      connectorsError: 1,
      licenseValid: true,
      licenseDaysToExpiry: 100,
      recentEventCount: 5,
    };
    const findings = deriveOrgFindings(computeOrgHealth(inputs), inputs);
    const conn = findings.find((f) => f.id === 'org:connector:error');
    expect(conn).toBeDefined();
    expect(conn!.evidence).toContain('connectors.error=1');
    expect(conn!.sourceSystems).toContain('connectors');
  });

  it('emits an inactivity finding when there is no recent activity', () => {
    const inputs: OrgHealthInputs = {
      recentEventCount: 0,
      licenseValid: true,
      licenseDaysToExpiry: 100,
      connectorsTotal: 1,
      connectorsHealthy: 1,
    };
    const findings = deriveOrgFindings(computeOrgHealth(inputs), inputs);
    expect(findings.find((f) => f.id === 'org:inactive')).toBeDefined();
  });

  it('a fully healthy org yields no risk findings', () => {
    const inputs: OrgHealthInputs = {
      connectorsTotal: 3,
      connectorsHealthy: 3,
      connectorsError: 0,
      licenseValid: true,
      licenseDaysToExpiry: 200,
      memberCount: 4,
      activeMemberCount: 4,
      workspaceCount: 2,
      recentEventCount: 60,
      aiSourcesUsed: 5,
      engineeringHealth01: 0.9,
      syncFailures: 0,
      executiveActiveRecently: true,
    };
    const findings = deriveOrgFindings(computeOrgHealth(inputs), inputs);
    // healthy overall + valid license + no connector errors + active ⇒ no findings
    expect(findings).toHaveLength(0);
  });

  it('every finding carries full governance (evidence, sources, confidence, reasoning, action)', () => {
    const inputs: OrgHealthInputs = {
      licenseValid: false,
      connectorsTotal: 2,
      connectorsHealthy: 1,
      connectorsError: 1,
      recentEventCount: 0,
    };
    const findings = deriveOrgFindings(computeOrgHealth(inputs), inputs);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(f.sourceSystems.length).toBeGreaterThan(0);
      expect(f.confidence).toBeGreaterThan(0);
      expect(f.reasoning).toBeTruthy();
      expect(f.recommendedAction).toBeTruthy();
    }
  });
});
