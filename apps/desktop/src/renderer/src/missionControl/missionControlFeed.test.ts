/**
 * Phase 6 Stage 2 — Mission Control feed tests (pure; no React, no Electron).
 *
 * Locks the Stage 2 constraints:
 *   - defensive mapping: malformed payloads/rows are dropped, never guessed;
 *   - per-tile failure isolation: a failed/hung source resolves to an explicit
 *     `unavailable(reason)` and never throws or affects another source;
 *   - partial sources succeed with an honest note; REQUIRED sub-calls (the
 *     activity event query) fail the whole tile rather than fabricate an empty;
 *   - the recent-files composite merges Stage 1 workspace tabs with unified
 *     documents, deduped, newest-first, capped.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_TIMEOUT_MS,
  EMPTY_EXTRAS,
  FEED_TILE_KEYS,
  composeRecentFiles,
  emptyAvailability,
  failureReason,
  isFailureEvent,
  mapActivity,
  mapConnectors,
  mapExecutive,
  mapHealth,
  mapOrganization,
  mapRunning,
  mapTimelineStats,
  runFeedSource,
  withTimeout,
  type FeedIo,
} from './missionControlFeed';

/* ── fixtures (shaped like the real IPC payloads) ────────────────────────── */

const TIMELINE_PAGE = {
  events: [
    {
      id: 'e1',
      type: 'app.launched',
      category: 'runtime',
      priority: 'normal',
      timestamp: '2026-07-30T10:00:00Z',
      actor: { kind: 'user', id: 'u1' },
    },
    {
      id: 'e2',
      type: 'automation.run_failed',
      category: 'automation',
      priority: 'high',
      timestamp: '2026-07-30T10:05:00Z',
      actor: { kind: 'system', id: null },
    },
    'garbage',
    { id: '', type: 'missing.id' },
  ],
  nextCursor: null,
  total: 2,
};

const TIMELINE_STATS = { total: 12, byCategory: { runtime: 8, automation: 4, junk: 'x' }, byType: {}, oldest: null, newest: null };

const EXECUTE_SESSIONS = {
  sessions: [
    { id: 's1', label: 'Summarize inbox', state: 'running', completedAt: null, startedAt: '2026-07-30T09:59:00Z' },
    { id: 's2', label: 'Done thing', state: 'completed', completedAt: '2026-07-30T09:00:00Z', startedAt: '2026-07-30T08:59:00Z' },
  ],
  stats: { active: 1, queued: 0, completed: 5, failed: 1, cancelled: 0, successRate: 0.8, averageRuntimeMs: 1200 },
};

const AUTOMATION_MONITOR = { monitor: { running: 2, completed: 9, failed: 1, paused: 0, averageRuntimeMs: 40 } };
const AUTOMATION_LIST = { rules: [], summary: { total: 4, active: 3, paused: 1, draft: 0 } };

const RUNTIME_LIST = [
  { instanceId: 'i1', appSlug: 'notes', appName: 'Notes', status: 'running', startedAt: '2026-07-30T09:00:00Z' },
  { instanceId: 'i2', appSlug: 'old', appName: 'Old', status: 'stopped', startedAt: null },
];

const CONNECTORS = [
  { id: 'github', name: 'GitHub', lifecycle: 'production', configured: true, status: 'connected', health: 'healthy', accounts: [{}] },
  { id: 'slack', name: 'Slack', lifecycle: 'production', configured: true, status: 'connected', health: 'down', accounts: [{}] },
  { id: 'gmail', name: 'Gmail', lifecycle: 'production', configured: true, status: 'reauth_required', health: 'degraded', accounts: [{}] },
  { id: 'notion', name: 'Notion', lifecycle: 'preview', configured: false, status: 'unavailable', health: 'unknown', accounts: [] },
  { id: 'm365', name: 'Microsoft 365', lifecycle: 'production', configured: false, status: 'unavailable', health: 'unknown', accounts: [] },
];

const CTX_STATE = {
  workspaces: [
    {
      id: 'w1',
      name: 'Default',
      snapshot: { activeSection: 'mission-control', tabs: [{ id: 't1', appId: 'notes', title: 'Notes', openedAt: 1_753_800_000_000 }], activeTabId: 't1' },
    },
    {
      id: 'w2',
      name: 'Research',
      snapshot: { activeSection: 'knowledge', tabs: [{ id: 't2', appId: 'notes', title: 'Notes', openedAt: 1_753_700_000_000 }], activeTabId: null },
    },
  ],
  activeId: 'w1',
};

const UNIFIED_FILES = {
  items: [
    { id: 'u1', kind: 'document', title: 'Q3 plan', connectorId: 'google-drive', updatedAt: '2026-07-30T09:00:00Z', url: 'https://drive.example/q3' },
    { id: 'u2', kind: 'file', title: '', connectorId: 'github', updatedAt: '2026-07-30T08:00:00Z', url: null },
  ],
  total: 2,
  nextCursor: null,
};

const HEALTH = {
  generatedAt: '2026-07-30T10:00:00Z',
  score: 87,
  level: 'degraded',
  uptimeMs: 1000,
  subsystems: [
    { id: 'runtime', label: 'Runtime', level: 'healthy' },
    { id: 'backend', label: 'Backend', level: 'degraded', detail: 'retrying' },
    'junk',
  ],
  throughput: { eventsPerMinute: 42, bufferedEvents: 0, avgDispatchMs: 1 },
  automation: { completed: 9, failed: 1, paused: 0, running: 2 },
  voice: 'idle',
  telemetry: { cpuPercent: 3, memoryUsedMb: 512, memoryTotalMb: 1024, processUptimeMs: 1, backendLatencyMs: 20, backendState: 'connected' },
};

const ENTERPRISE_ORG = {
  organization: { id: 'o1', name: 'Acme', slug: 'acme', description: 'test org', createdAt: '', updatedAt: '', metadata: {} },
  units: [],
  roles: [],
  users: [
    { id: 'p1', name: 'Sam Rivera', title: 'PM' },
    { id: '', name: 'invalid' },
  ],
};

const ENTERPRISE_WORKSPACES = [
  { id: 'w1', name: 'Core', organizationId: 'o1', orgName: 'Acme', userCount: 3, unitCount: 1, active: true },
  { id: 'w2', name: 'Research', organizationId: 'o1', orgName: 'Acme', userCount: 1, unitCount: 0, active: false },
];

const EXEC_DASHBOARD = {
  approvals: { pending: 2, approvedRecently: 1, rejectedRecently: 0, oldestPendingAgeMs: null },
  operations: { connectors: 3, connectedAccounts: 3, installedApps: 5, auditEntries: 42 },
  activity: { projects: 1, tasks: 4, documents: 2, customers: 0, events: 300, recentEvents: 128 },
};

const WORKERS = [
  { id: 'a1', name: 'Ada', role: 'analyst', version: '1.0.0', lifecycle: 'running', healthState: 'healthy', trustScore: 0.9, skillCount: 2, builtIn: true },
  'junk',
];

function okIo(over: Partial<FeedIo> = {}): FeedIo {
  return {
    timelineQuery: () => Promise.resolve(TIMELINE_PAGE),
    timelineStats: () => Promise.resolve(TIMELINE_STATS),
    executeSessions: () => Promise.resolve(EXECUTE_SESSIONS),
    automationMonitor: () => Promise.resolve(AUTOMATION_MONITOR),
    automationList: () => Promise.resolve(AUTOMATION_LIST),
    runtimeList: () => Promise.resolve(RUNTIME_LIST),
    connectorsList: () => Promise.resolve(CONNECTORS),
    workspaceContextsList: () => Promise.resolve(CTX_STATE),
    unifiedRecentFiles: () => Promise.resolve(UNIFIED_FILES),
    systemHealth: () => Promise.resolve(HEALTH),
    enterpriseOrg: () => Promise.resolve(ENTERPRISE_ORG),
    enterpriseWorkspaces: () => Promise.resolve(ENTERPRISE_WORKSPACES),
    enterpriseDashboard: () => Promise.resolve(EXEC_DASHBOARD),
    workforceWorkers: () => Promise.resolve(WORKERS),
    ...over,
  };
}

const reject = (msg: string) => (): Promise<unknown> => Promise.reject(new Error(msg));
const hang = (): Promise<unknown> => new Promise(() => undefined);

/* ── mappers ─────────────────────────────────────────────────────────────── */

describe('mapActivity (defensive)', () => {
  it('maps real events, drops malformed rows, flags failures', () => {
    const records = mapActivity(TIMELINE_PAGE);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ id: 'e1', domain: 'runtime', action: 'app.launched', actor: 'u1', ok: true });
    expect(records[0]?.at).toBe(Date.parse('2026-07-30T10:00:00Z'));
    expect(records[1]?.ok).toBe(false); // *_failed event type
  });
  it('returns [] for garbage payloads', () => {
    expect(mapActivity(null)).toEqual([]);
    expect(mapActivity('nope')).toEqual([]);
    expect(mapActivity({ events: 'nope' })).toEqual([]);
  });
});

describe('isFailureEvent', () => {
  it('flags failed/crash/error types and critical priority', () => {
    expect(isFailureEvent('automation.run_failed', 'normal')).toBe(true);
    expect(isFailureEvent('runtime.crash', 'normal')).toBe(true);
    expect(isFailureEvent('app.launched', 'critical')).toBe(true);
    expect(isFailureEvent('app.launched', 'normal')).toBe(false);
  });
});

describe('mapTimelineStats', () => {
  it('keeps numeric categories only', () => {
    const stats = mapTimelineStats(TIMELINE_STATS);
    expect(stats).toEqual({ total: 12, byCategory: { runtime: 8, automation: 4 } });
  });
  it('rejects unusable payloads', () => {
    expect(mapTimelineStats(null)).toBeNull();
    expect(mapTimelineStats({ byCategory: {} })).toBeNull();
  });
});

describe('mapConnectors (honest status mapping)', () => {
  it('maps production connectors and excludes preview ones', () => {
    const lite = mapConnectors(CONNECTORS);
    expect(lite.map((c) => `${c.id}:${c.status}`)).toEqual(['github:ok', 'slack:down', 'gmail:degraded', 'm365:disabled']);
  });
  it('returns [] for non-array payloads', () => {
    expect(mapConnectors({})).toEqual([]);
    expect(mapConnectors(undefined)).toEqual([]);
  });
});

describe('mapRunning', () => {
  it('collects live executions + running apps and builds the automation slice', () => {
    const patch = mapRunning({ sessions: EXECUTE_SESSIONS, monitor: AUTOMATION_MONITOR, automationList: AUTOMATION_LIST, runtime: RUNTIME_LIST });
    const running = patch.extras?.running ?? [];
    expect(running.map((r) => r.id)).toEqual(expect.arrayContaining(['exec:s1', 'app:i1']));
    expect(running.some((r) => r.id === 'exec:s2')).toBe(false); // terminal
    expect(running.some((r) => r.id === 'app:i2')).toBe(false); // stopped
    expect(patch.extras?.executionStats).toEqual({ active: 1, queued: 0, completed: 5, failed: 1 });
    expect(patch.extras?.monitor).toEqual({ running: 2, completed: 9, failed: 1, paused: 0 });
    expect(patch.snapshot?.automation).toMatchObject({ workflows: 4, triggers: 3, running: 2, failures24h: 1 });
  });
  it('tolerates missing parts without fabricating an automation slice', () => {
    const patch = mapRunning({ sessions: EXECUTE_SESSIONS });
    expect(patch.snapshot?.automation).toBeUndefined();
    expect(patch.extras?.monitor).toBeNull();
    expect((patch.extras?.running ?? []).length).toBe(1);
  });
});

describe('composeRecentFiles (D-2 composite)', () => {
  it('merges tabs + unified documents, newest first, dropping untitled rows', () => {
    const files = composeRecentFiles(CTX_STATE, UNIFIED_FILES);
    // One deduped tab (same appId+title across two workspaces) + one titled document
    // (the untitled unified row is dropped). The 2026 document outranks the 2025 tab.
    expect(files).toHaveLength(2);
    expect(files[0]?.kind).toBe('document');
    expect(files[1]?.kind).toBe('tab');
  });
  it('sorts by recency with the newest first', () => {
    const files = composeRecentFiles(CTX_STATE, UNIFIED_FILES);
    const times = files.map((f) => f.at ?? -1);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
  it('caps the list and survives garbage inputs', () => {
    expect(composeRecentFiles(null, null)).toEqual([]);
    expect(composeRecentFiles('x', 42)).toEqual([]);
    const many = { items: Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, kind: 'file', title: `File ${i}`, connectorId: 'github', updatedAt: '2026-07-30T09:00:00Z', url: null })) };
    expect(composeRecentFiles(null, many)).toHaveLength(15);
  });
  it('dedupes identical app tabs across workspaces', () => {
    const files = composeRecentFiles(CTX_STATE, null);
    expect(files.filter((f) => f.kind === 'tab')).toHaveLength(1);
  });
});

describe('mapHealth', () => {
  it('sanitizes the snapshot and maps the coarse runtime health', () => {
    const mapped = mapHealth(HEALTH);
    expect(mapped?.runtimeHealth).toBe('degraded');
    expect(mapped?.health.score).toBe(87);
    expect(mapped?.health.subsystems).toHaveLength(2); // junk row dropped
    expect(mapped?.health.subsystems[1]).toEqual({ id: 'backend', label: 'Backend', level: 'degraded', detail: 'retrying' });
    expect(mapped?.health.eventsPerMinute).toBe(42);
  });
  it('maps critical/offline to down and unknown levels defensively', () => {
    expect(mapHealth({ ...HEALTH, level: 'critical' })?.runtimeHealth).toBe('down');
    expect(mapHealth({ ...HEALTH, level: 'weird' })?.runtimeHealth).toBe('degraded');
  });
  it('rejects unrecognisable payloads', () => {
    expect(mapHealth(null)).toBeNull();
    expect(mapHealth({ level: 'healthy' })).toBeNull(); // no score
  });
});

describe('mapOrganization', () => {
  it('maps org + people + workspaces and derives the active workspace', () => {
    const patch = mapOrganization(ENTERPRISE_ORG, ENTERPRISE_WORKSPACES);
    expect(patch.organizations?.[0]?.name).toBe('Acme');
    expect(patch.people).toHaveLength(1); // invalid user dropped
    expect(patch.workspaces).toHaveLength(2);
    expect(patch.activeWorkspaceId).toBe('w1');
  });
  it('omits the workspace slice entirely when the workspace payload is not a list', () => {
    const patch = mapOrganization(ENTERPRISE_ORG, null);
    expect(patch.workspaces).toBeUndefined();
    expect(patch.organizations?.[0]?.id).toBe('o1');
  });
});

describe('mapExecutive', () => {
  it('maps approvals/audit/events and NEVER claims the audit chain was checked', () => {
    const patch = mapExecutive(EXEC_DASHBOARD, WORKERS);
    expect(patch.pendingApprovals).toBe(2);
    expect(patch.governance).toMatchObject({ auditChecked: false, auditRecords: 42, events: 128, pendingApprovals: 2 });
    expect(patch.workers).toHaveLength(1); // junk row dropped
  });
});

/* ── failure isolation (the Stage 2 constraint) ──────────────────────────── */

describe('runFeedSource — per-tile failure isolation', () => {
  it('activity: happy path patches activity + stats', async () => {
    const res = await runFeedSource(okIo(), 'activity');
    expect(res.ok).toBe(true);
    expect(res.patch?.snapshot?.activity).toHaveLength(2);
    expect(res.patch?.extras?.timelineStats?.total).toBe(12);
    expect(res.note).toBeNull();
  });

  it('activity: a failed event query fails the tile (an empty feed would be a lie)', async () => {
    const res = await runFeedSource(okIo({ timelineQuery: reject('bus offline') }), 'activity');
    expect(res.ok).toBe(false);
    expect(res.patch).toBeNull();
    expect(res.reason).toContain('timeline query');
    expect(res.reason).toContain('bus offline');
  });

  it('activity: a failed stats sub-call degrades to a partial note, not a dead tile', async () => {
    const res = await runFeedSource(okIo({ timelineStats: reject('stats broke') }), 'activity');
    expect(res.ok).toBe(true);
    expect(res.patch?.snapshot?.activity).toHaveLength(2);
    expect(res.note).toContain('stats broke');
  });

  it('running: partial sub-call failures keep the tile alive with an honest note', async () => {
    const res = await runFeedSource(okIo({ automationMonitor: reject('monitor down') }), 'running');
    expect(res.ok).toBe(true);
    expect(res.note).toContain('monitor down');
    const ids = (res.patch?.extras?.running ?? []).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['exec:s1', 'app:i1']));
  });

  it('running: only when EVERY sub-call fails does the tile go unavailable', async () => {
    const io = okIo({
      executeSessions: reject('a'),
      automationMonitor: reject('b'),
      automationList: reject('c'),
      runtimeList: reject('d'),
    });
    const res = await runFeedSource(io, 'running');
    expect(res.ok).toBe(false);
    expect(res.reason).toBeTruthy();
  });

  it('recentFiles: one failing sub-source still yields the other, with a note', async () => {
    const res = await runFeedSource(okIo({ workspaceContextsList: reject('store locked') }), 'recentFiles');
    expect(res.ok).toBe(true);
    expect(res.note).toContain('store locked');
    expect((res.patch?.extras?.recentFiles ?? []).some((f) => f.kind === 'document')).toBe(true);
    expect((res.patch?.extras?.recentFiles ?? []).some((f) => f.kind === 'tab')).toBe(false);
  });

  it('health: an unrecognisable payload is an explicit unavailable, never a fake snapshot', async () => {
    const res = await runFeedSource(okIo({ systemHealth: () => Promise.resolve({ nonsense: true }) }), 'health');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('not recognisable');
  });

  it('a hung source times out into unavailable instead of blocking forever', async () => {
    const res = await runFeedSource(okIo({ systemHealth: hang }), 'health', 20);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('timed out');
  });

  it('one failing source never affects another (isolation)', async () => {
    const io = okIo({ enterpriseDashboard: reject('backend 500'), workforceWorkers: reject('backend 500') });
    const [exec, conn] = await Promise.all([runFeedSource(io, 'executive'), runFeedSource(io, 'connectors')]);
    expect(exec.ok).toBe(false);
    expect(conn.ok).toBe(true);
    expect(conn.patch?.snapshot?.connectors).toHaveLength(4);
  });

  it('never throws — even a rejecting io resolves to a result object', async () => {
    const io = okIo({ connectorsList: () => Promise.reject(new Error('kaboom')) });
    await expect(runFeedSource(io, 'connectors')).resolves.toMatchObject({ ok: false });
  });
});

/* ── plumbing ────────────────────────────────────────────────────────────── */

describe('withTimeout + failureReason + availability plumbing', () => {
  it('withTimeout passes values through and rejects hung promises', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, 'x')).resolves.toBe(7);
    await expect(withTimeout(new Promise(() => undefined), 10, 'slow call')).rejects.toThrow(/slow call timed out/);
  });

  it('failureReason is bounded and never empty', () => {
    expect(failureReason(new Error('boom'))).toBe('boom');
    expect(failureReason('')).toBe('unknown error');
    expect(failureReason({ message: 'obj msg' })).toBe('obj msg');
    expect(failureReason('x'.repeat(500)).length).toBeLessThanOrEqual(160);
  });

  it('emptyAvailability starts every tile loading; EMPTY_EXTRAS is truly empty', () => {
    const availability = emptyAvailability();
    expect(Object.keys(availability).sort()).toEqual([...FEED_TILE_KEYS].sort());
    for (const key of FEED_TILE_KEYS) expect(availability[key]).toEqual({ state: 'loading' });
    expect(EMPTY_EXTRAS.running).toEqual([]);
    expect(EMPTY_EXTRAS.health).toBeNull();
    expect(DEFAULT_SOURCE_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
