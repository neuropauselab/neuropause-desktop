import { describe, it, expect } from 'vitest';
import type { Organization, WorkspaceSummary, WorkerSummary } from '@neuropause/shared';
import { SECTIONS } from '../shell/sections';
import { REAL_STATES } from '../capability/capabilityRegistry';
import {
  COMMAND_DOMAINS,
  buildCommandIndex,
  rankCommands,
  fuzzyScore,
  buildSearchIndex,
  searchAll,
  groupSearchByKind,
  missionControlOverview,
  classifyWorkerHealth,
  workspaceSwitcher,
  activityFeed,
  unreadActivityCount,
  groupActivityByDomain,
  notifications,
  capabilityHonesty,
  isRealCapability,
  statusBar,
  type MissionControlSnapshot,
} from './missionControlModel';

function org(id: string, name: string): Organization {
  return { id, name, slug: name.toLowerCase(), description: `${name} org`, createdAt: '', updatedAt: '', metadata: {} };
}
function ws(id: string, name: string): WorkspaceSummary {
  return { id, name, organizationId: 'org_1', orgName: 'Acme', userCount: 3, unitCount: 1, active: true };
}
function worker(id: string, name: string, healthState: string): WorkerSummary {
  return { id, name, role: 'analyst', version: '1.0.0', lifecycle: 'running', healthState, trustScore: 90, skillCount: 2, builtIn: false } as unknown as WorkerSummary;
}

function sampleSnapshot(): MissionControlSnapshot {
  return {
    organizations: [org('org_1', 'Acme'), org('org_2', 'Globex')],
    workspaces: [ws('ws_1', 'Core'), ws('ws_2', 'Research')],
    activeWorkspaceId: 'ws_1',
    people: [{ id: 'p_1', name: 'Sam Rivera', title: 'PM' }],
    workers: [worker('ai_1', 'Ada', 'healthy'), worker('ai_2', 'Byte', 'degraded'), worker('ai_3', 'Cy', 'crashed')],
    projects: [{ id: 'pr_1', name: 'Launch', workspaceId: 'ws_1', status: 'active', openTasks: 3, blockedTasks: 1 }],
    tasks: [
      { id: 't_1', title: 'Write spec', workspaceId: 'ws_1', status: 'todo', assignee: 'p_1' },
      { id: 't_2', title: 'Ship build', workspaceId: 'ws_1', status: 'blocked' },
      { id: 't_3', title: 'Retro', workspaceId: 'ws_1', status: 'done' },
    ],
    documents: [{ id: 'd_1', title: 'Kubernetes runbook', type: 'document', workspaceId: 'ws_1' }],
    connectors: [
      { id: 'github', name: 'GitHub', status: 'ok' },
      { id: 'slack', name: 'Slack', status: 'down' },
    ],
    activity: [
      { id: 'a1', domain: 'task', action: 'assign', actor: 'p_1', workspace: 'ws_1', at: 100, ok: true, audited: true },
      { id: 'a2', domain: 'workforce', action: 'dispatch', actor: 'ai_1', workspace: 'ws_1', at: 200, ok: true },
      { id: 'a3', domain: 'connector', action: 'invoke', actor: 'slack', workspace: 'ws_2', at: 300, ok: false, audited: true },
    ],
    automation: { workflows: 4, triggers: 6, running: 1, queued: 2, retrying: 0, failures24h: 1 },
    governance: { auditValid: true, auditRecords: 42, events: 128, pendingApprovals: 2 },
    runtimeHealth: 'healthy',
    costUsd: 1.25,
    pendingApprovals: 2,
  };
}

describe('command-center domains', () => {
  it('defines all ten domains, each routing to an existing nav section', () => {
    expect(COMMAND_DOMAINS).toHaveLength(10);
    const sectionIds = new Set(SECTIONS.map((s) => s.id));
    for (const d of COMMAND_DOMAINS) expect(sectionIds.has(d.section)).toBe(true);
  });
});

describe('command index + palette ranking', () => {
  it('excludes hidden sections and includes a command per domain', () => {
    const commands = buildCommandIndex();
    expect(commands.some((c) => c.id === 'domain:governance')).toBe(true);
    // 'home' is a hidden section (Product Integrity) — must not leak into the palette
    expect(commands.some((c) => c.id === 'nav:home')).toBe(false);
    expect(commands.some((c) => c.id === 'nav:organization')).toBe(true);
  });
  it('ranks exact > prefix > substring > subsequence and filters non-matches', () => {
    expect(fuzzyScore('org', 'org')).toBeGreaterThan(fuzzyScore('org', 'organization'));
    expect(fuzzyScore('organization', 'organization')).toBeGreaterThan(fuzzyScore('orgz', 'organization'));
    expect(fuzzyScore('xyzq', 'organization')).toBe(-1);
    const ranked = rankCommands('workforce');
    expect(ranked[0]?.command.keywords.join(' ')).toContain('workforce');
    expect(ranked.every((r) => r.score > 0)).toBe(true);
  });
  it('empty query returns a bounded default list', () => {
    expect(rankCommands('', buildCommandIndex(), 5)).toHaveLength(5);
  });
});

describe('universal search (provider-agnostic)', () => {
  it('indexes every entity kind and ranks across them', () => {
    const index = buildSearchIndex(sampleSnapshot());
    const kinds = new Set(index.map((r) => r.kind));
    for (const k of ['organization', 'person', 'ai-employee', 'project', 'task', 'document', 'connector', 'event', 'timeline', 'audit', 'command']) {
      expect(kinds.has(k as never)).toBe(true);
    }
    const hits = searchAll('kubernetes', index);
    expect(hits[0]?.kind).toBe('document');
  });
  it('filters by kind and groups results', () => {
    const index = buildSearchIndex(sampleSnapshot());
    const onlyAi = searchAll('a', index, { kind: 'ai-employee' });
    expect(onlyAi.every((h) => h.kind === 'ai-employee')).toBe(true);
    const grouped = groupSearchByKind(searchAll('s', index));
    expect(Object.keys(grouped).length).toBeGreaterThan(0);
  });
  it('only emits audit records for audited activity', () => {
    const index = buildSearchIndex(sampleSnapshot());
    const audits = index.filter((r) => r.kind === 'audit');
    expect(audits).toHaveLength(2); // a1 + a3 are audited; a2 is not
  });
});

describe('executive overview rollup', () => {
  it('derives KPIs purely from the snapshot projections', () => {
    const o = missionControlOverview(sampleSnapshot());
    expect(o.organizations).toBe(2);
    expect(o.aiEmployees).toBe(3);
    expect(o.workforceHealth).toEqual({ healthy: 1, degraded: 1, failing: 1 });
    expect(o.openTasks).toBe(2); // todo + blocked (done excluded)
    expect(o.blockedTasks).toBe(1);
    expect(o.connectors).toEqual({ total: 2, up: 1, down: 1 });
    expect(o.pendingApprovals).toBe(2);
    expect(o.costUsd).toBeCloseTo(1.25);
    expect(o.activeWorkspace).toBe('Core');
    expect(o.activityCount).toBe(3);
  });
  it('classifies worker health without coupling to exact literals', () => {
    expect(classifyWorkerHealth('healthy')).toBe('healthy');
    expect(classifyWorkerHealth('degraded')).toBe('degraded');
    expect(classifyWorkerHealth('crashed')).toBe('failing');
  });
});

describe('workspace switcher + activity + notifications', () => {
  it('marks the active workspace', () => {
    const entries = workspaceSwitcher(sampleSnapshot());
    expect(entries.find((e) => e.id === 'ws_1')?.active).toBe(true);
    expect(entries.find((e) => e.id === 'ws_2')?.active).toBe(false);
  });
  it('sorts activity newest-first, filters by workspace, and counts unread', () => {
    const snap = sampleSnapshot();
    const feed = activityFeed(snap);
    expect(feed[0]?.id).toBe('a3'); // at:300 newest
    expect(activityFeed(snap, { workspaceId: 'ws_2' })).toHaveLength(1);
    expect(unreadActivityCount(snap, 150)).toBe(2); // a2 + a3 after t=150
    expect(Object.keys(groupActivityByDomain(feed))).toEqual(expect.arrayContaining(['task', 'workforce', 'connector']));
  });
  it('raises alerts for down connectors, failures, and pending approvals', () => {
    const notes = notifications(sampleSnapshot());
    expect(notes.some((n) => n.kind === 'alert' && n.title.includes('Slack'))).toBe(true);
    expect(notes.some((n) => n.kind === 'alert' && n.title.includes('connector.invoke'))).toBe(true);
    expect(notes.some((n) => n.kind === 'approval')).toBe(true);
  });
});

describe('capability honesty (anti-fabrication surfacing)', () => {
  it('reports real vs not-yet-real state truthfully', () => {
    const h = capabilityHonesty();
    const sum = Object.values(h.byState).reduce((a, b) => a + b, 0);
    expect(sum).toBe(h.total);
    expect(h.real).toBe(h.total - Object.entries(h.byState).filter(([s]) => !REAL_STATES.includes(s as never)).reduce((a, [, n]) => a + n, 0));
    expect(h.auditedShare).toBeGreaterThanOrEqual(0);
    expect(h.auditedShare).toBeLessThanOrEqual(1);
    expect(h.testedShare).toBeLessThanOrEqual(1);
  });
  it('isRealCapability agrees with REAL_STATES', () => {
    expect(isRealCapability({ id: 'x', label: 'x', domain: 'system', runtime: '-', state: 'production-complete' })).toBe(true);
    expect(isRealCapability({ id: 'y', label: 'y', domain: 'system', runtime: '-', state: 'needs-backend' })).toBe(false);
  });
});

describe('status bar', () => {
  it('summarizes runtime, connectors, approvals, audit, failures', () => {
    const s = statusBar(sampleSnapshot());
    expect(s.runtimeHealth).toBe('healthy');
    expect(s.connectorsUp).toBe(1);
    expect(s.connectorsTotal).toBe(2);
    expect(s.pendingApprovals).toBe(2);
    expect(s.auditValid).toBe(true);
    expect(s.failures).toBe(1);
  });
});
