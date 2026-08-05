/**
 * Phase 6 Stage 6 — health framework (D-3): eight composed domains, every
 * score explained with evidence, low confidence declared explicitly,
 * unavailable sources → unavailable domains (never a silent 100), and the
 * confidence breakdown reflecting real availability.
 */
import { describe, expect, it } from 'vitest';
import type { OrgHealthScores, WorkforceHealthSummary } from '@neuropause/shared';
import { INSIGHT_HEALTH_DOMAINS } from '@neuropause/shared';
import { bandFor, composeHealthFramework, type HealthFrameworkInput } from './healthFramework';

const NOW = Date.parse('2026-07-31T12:00:00.000Z');

const ORG: OrgHealthScores = {
  activity: 80,
  adoption: 70,
  engineering: 75,
  reliability: 85,
  aiUsage: 60,
  connectorHealth: 90,
  licenseHealth: 95,
  security: 70,
  operational: 75,
  overall: 78,
};

const WORKFORCE: WorkforceHealthSummary = {
  totalWorkers: 4,
  healthy: 3,
  degraded: 1,
  unhealthy: 0,
  unknown: 0,
  meanSuccessRate: 0.9,
  totalJobsRun: 40,
  totalJobsFailed: 4,
  state: 'degraded',
};

function fullInput(): HealthFrameworkInput {
  return {
    nowMs: NOW,
    org: ORG,
    orgUnits: { units: 4, leadershipCoverage: 0.75 },
    projects: { projects: 3, openTasks: 20, overdueTasks: 2 },
    workflows: { completed: 9, failed: 1 },
    automation: { completed: 18, failed: 2, paused: 1, running: 0 },
    workforce: WORKFORCE,
    system: { score: 88, level: 'healthy' },
    connectors: [
      { id: 'slack', health: 'healthy', configured: true, accounts: [{} as never] },
      { id: 'm365', health: 'degraded', configured: true, accounts: [{} as never] },
    ],
    approvals: { pending: 2, oldestCreatedAt: new Date(NOW - 86_400_000).toISOString() },
    historyDays: 30,
    failures: {},
  };
}

describe('composeHealthFramework — full inputs', () => {
  it('produces all eight domains, each scored, explained, and evidenced', () => {
    const fw = composeHealthFramework(fullInput());
    expect(fw.domains.map((d) => d.key)).toEqual([...INSIGHT_HEALTH_DOMAINS]);
    for (const d of fw.domains) {
      expect(d.score, d.key).not.toBeNull();
      expect(d.explanation.length, d.key).toBeGreaterThan(0);
      expect(d.evidence.length, d.key).toBeGreaterThan(0);
      expect(d.unavailable).toBeNull();
      expect(d.signals.length).toBeGreaterThan(0);
    }
    expect(fw.overall).not.toBeNull();
    expect(fw.band).toBe(bandFor(fw.overall!));
    // The organization domain is the EXISTING computation, verbatim.
    expect(fw.domains.find((d) => d.key === 'organization')!.score).toBe(78);
  });

  it('confidence breakdown reflects full availability + history coverage', () => {
    const fw = composeHealthFramework(fullInput());
    expect(fw.confidence.dataAvailability).toBe(1);
    expect(fw.confidence.historicalCoverage).toBeCloseTo(30 / 90, 2);
    expect(fw.confidence.overall).toBeGreaterThan(0.5);
  });

  it('departments composes structure + org score and declares its derivation', () => {
    const fw = composeHealthFramework(fullInput());
    const dept = fw.domains.find((d) => d.key === 'departments')!;
    expect(dept.score).toBe(Math.round(78 * 0.6 + 75 * 0.4));
    expect(dept.explanation.join(' ')).toContain('No per-unit operational metric exists yet');
    expect(dept.confidence).toBeLessThan(0.6); // declared low confidence
    expect(dept.explanation.join(' ')).toContain('low confidence');
  });
});

describe('composeHealthFramework — unavailability honesty', () => {
  it('a failed source produces an unavailable domain with the reason, never a score', () => {
    const input = fullInput();
    input.org = null;
    input.failures['organization'] = 'org store offline';
    const fw = composeHealthFramework(input);
    const org = fw.domains.find((d) => d.key === 'organization')!;
    expect(org.score).toBeNull();
    expect(org.band).toBe('unknown');
    expect(org.unavailable).toBe('org store offline');
    expect(org.confidence).toBe(0);
    // departments depends on org too — also honest.
    expect(fw.domains.find((d) => d.key === 'departments')!.unavailable).not.toBeNull();
    expect(fw.confidence.dataAvailability).toBeLessThan(1);
  });

  it('zero projects / zero workflow runs are stated as unavailable, not scored 100', () => {
    const input = fullInput();
    input.projects = { projects: 0, openTasks: 0, overdueTasks: 0 };
    input.workflows = { completed: 0, failed: 0 };
    const fw = composeHealthFramework(input);
    expect(fw.domains.find((d) => d.key === 'projects')!.unavailable).toContain('no project entities');
    expect(fw.domains.find((d) => d.key === 'workflows')!.unavailable).toContain('no workflow runs');
  });

  it('nothing available → overall null, band unknown, zero confidence', () => {
    const fw = composeHealthFramework({
      nowMs: NOW,
      org: null,
      orgUnits: null,
      projects: null,
      workflows: null,
      automation: null,
      workforce: null,
      system: null,
      connectors: null,
      approvals: null,
      historyDays: 0,
      failures: {},
    });
    expect(fw.overall).toBeNull();
    expect(fw.band).toBe('unknown');
    expect(fw.confidence.dataAvailability).toBe(0);
    expect(fw.confidence.overall).toBeLessThanOrEqual(0.1);
    for (const d of fw.domains) expect(d.unavailable).not.toBeNull();
  });
});

describe('domain scoring honesty', () => {
  it('approvals degrade with queue depth and age; empty queue scores high with evidence', () => {
    const base = fullInput();
    const fwBusy = composeHealthFramework({
      ...base,
      approvals: { pending: 6, oldestCreatedAt: new Date(NOW - 4 * 86_400_000).toISOString() },
    });
    const fwIdle = composeHealthFramework({ ...base, approvals: { pending: 0, oldestCreatedAt: null } });
    const busy = fwBusy.domains.find((d) => d.key === 'approvals')!;
    const idle = fwIdle.domains.find((d) => d.key === 'approvals')!;
    expect(busy.score!).toBeLessThan(idle.score!);
    expect(busy.explanation[0]).toContain('6 approval(s) parked');
    expect(idle.explanation[0]).toContain('No approvals');
  });

  it('connector domain composes existing per-connector health without recomputing it', () => {
    const base = fullInput();
    const fw = composeHealthFramework({
      ...base,
      connectors: [
        { id: 'a', health: 'healthy', configured: true, accounts: [{} as never] },
        { id: 'b', health: 'down', configured: true, accounts: [{} as never] },
      ],
    });
    const dom = fw.domains.find((d) => d.key === 'connectors')!;
    expect(dom.score).toBe(Math.round((95 + 10) / 2));
    expect(dom.evidence).toContain('connector:a=healthy');
    expect(dom.evidence).toContain('connector:b=down');
  });
});
