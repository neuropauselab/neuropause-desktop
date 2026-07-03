import { describe, expect, it } from 'vitest';
import type {
  BusinessActivitySummary,
  ComplianceFinding,
  Job,
  OperationsSummary,
  Organization,
  OrgUnit,
  OrgUser,
  Recommendation,
  WorkerSummary,
} from '@neuropause/shared';
import { computeExecutiveSnapshot, type ExecutiveInput } from './executiveDashboard';

const NOW = '2026-02-10T12:00:00.000Z';

const org: Organization = { id: 'o', name: 'Acme', slug: 'acme', description: '', createdAt: NOW, updatedAt: NOW, metadata: {} };

const units: OrgUnit[] = [
  { id: 'u1', orgId: 'o', kind: 'team', name: 'A', parentId: null, leadUserId: 'h1', createdAt: NOW, updatedAt: NOW },
  { id: 'u2', orgId: 'o', kind: 'team', name: 'B', parentId: null, leadUserId: null, createdAt: NOW, updatedAt: NOW },
];

const users: OrgUser[] = [
  { id: 'h1', orgId: 'o', name: 'Human', email: null, title: '', kind: 'human', workerId: null, unitId: 'u1', roleIds: [], status: 'active', createdAt: NOW, updatedAt: NOW },
  { id: 'a1', orgId: 'o', name: 'AI', email: null, title: '', kind: 'ai_worker', workerId: 'w1', unitId: 'u1', roleIds: [], status: 'active', createdAt: NOW, updatedAt: NOW },
];

const workers = [
  { id: 'w1', name: 'Eng AI', role: 'engineering', version: '1', lifecycle: 'running', healthState: 'healthy', trustScore: 0.6, skillCount: 3, builtIn: true },
  { id: 'w2', name: 'Fin AI', role: 'finance', version: '1', lifecycle: 'idle', healthState: 'degraded', trustScore: 0.4, skillCount: 2, builtIn: true },
] as unknown as WorkerSummary[];

const jobs = [
  { id: 'j1', status: 'succeeded', createdAt: NOW, proposals: [] },
  { id: 'j2', status: 'awaiting_approval', createdAt: '2026-02-10T10:00:00.000Z', proposals: [{ id: 'p1', verdict: { decision: 'require_approval' }, approval: null }] },
] as unknown as Job[];

const recommendations = [
  { id: 'r1', kind: 'k', title: 'Low', rationale: '', priority: 'low', score: 0.2 },
  { id: 'r2', kind: 'k', title: 'High', rationale: '', priority: 'high', score: 0.9 },
] as unknown as Recommendation[];

const activity: BusinessActivitySummary = { projects: 4, tasks: 9, documents: 3, customers: 2, events: 1, recentEvents: 5 };
const operations: OperationsSummary = { connectors: 16, connectedAccounts: 2, installedApps: 7, auditEntries: 11 };

function input(over: Partial<ExecutiveInput> = {}): ExecutiveInput {
  return {
    workspaceId: 'ws',
    org,
    units,
    users,
    workers,
    jobs,
    findings: [],
    recommendations,
    briefingHeadline: 'All quiet',
    briefingGrounded: false,
    activity,
    operations,
    now: NOW,
    ...over,
  };
}

describe('computeExecutiveSnapshot', () => {
  it('rolls up organization health within 0..1 with member breakdown', () => {
    const snap = computeExecutiveSnapshot(input());
    expect(snap.organization.healthScore).toBeGreaterThanOrEqual(0);
    expect(snap.organization.healthScore).toBeLessThanOrEqual(1);
    expect(snap.organization.userCount).toBe(2);
    expect(snap.organization.humanCount).toBe(1);
    expect(snap.organization.workerCount).toBe(1);
    expect(snap.organization.leadershipCoverage).toBe(0.5); // 1 of 2 units led
  });

  it('summarizes the workforce from workers + jobs', () => {
    const snap = computeExecutiveSnapshot(input());
    expect(snap.workforce.total).toBe(2);
    expect(snap.workforce.running).toBe(1);
    expect(snap.workforce.idle).toBe(1);
    expect(snap.workforce.healthy).toBe(1);
    expect(snap.workforce.degraded).toBe(1);
    expect(snap.workforce.jobsRun).toBe(2);
    expect(snap.workforce.successRate).toBe(1); // 1 succeeded, 0 failed
  });

  it('counts pending approvals and tracks the oldest', () => {
    const snap = computeExecutiveSnapshot(input());
    expect(snap.approvals.pending).toBe(1);
    expect(snap.approvals.oldestPendingAgeMs).toBe(2 * 60 * 60 * 1000);
  });

  it('derives risk level from compliance findings', () => {
    const low = computeExecutiveSnapshot(input({ findings: [] }));
    expect(low.risk.level).toBe('low');

    const warn: ComplianceFinding[] = [{ ruleId: 'r', ruleName: 'R', category: 'C', severity: 'warning', status: 'warn', detail: 'd', evidence: [] }];
    expect(computeExecutiveSnapshot(input({ findings: warn })).risk.level).toBe('elevated');

    const fail: ComplianceFinding[] = [{ ruleId: 'r', ruleName: 'R', category: 'C', severity: 'critical', status: 'fail', detail: 'd', evidence: ['x'] }];
    const high = computeExecutiveSnapshot(input({ findings: fail }));
    expect(high.risk.level).toBe('high');
    expect(high.risk.criticalFindings).toBe(1);
    expect(high.risk.items[0].title).toBe('R');
  });

  it('surfaces the top recommendations sorted by score', () => {
    const snap = computeExecutiveSnapshot(input());
    expect(snap.intelligence.recommendationCount).toBe(2);
    expect(snap.intelligence.topRecommendations[0].id).toBe('r2'); // higher score first
    expect(snap.intelligence.headline).toBe('All quiet');
    expect(snap.intelligence.grounded).toBe(false);
  });

  it('passes operations and activity through', () => {
    const snap = computeExecutiveSnapshot(input());
    expect(snap.operations).toEqual(operations);
    expect(snap.activity).toEqual(activity);
    expect(snap.workspaceId).toBe('ws');
  });
});
