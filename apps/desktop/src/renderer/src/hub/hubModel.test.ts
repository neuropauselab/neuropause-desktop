/**
 * Phase 6 Stage 5 — Work Hub pure view-model: the tile contract (per-source
 * isolation + honest degradation), meeting rows, the D-3 task board (sources
 * never conflated), D-5 email prioritization (deterministic, explainable),
 * the Productivity Timeline composition (addition #1), the descriptive Work
 * Summary tile (addition #2), deep-link routing, and the executive highlights.
 */
import { describe, expect, it } from 'vitest';
import type {
  AssistantConversationSummary,
  ExecutionSession,
  ExecutiveSnapshot,
  InboxNotification,
  UnifiedEntity,
} from '@neuropause/shared';
import {
  briefPeriodForHour,
  composeProductivityTimeline,
  meetingsToday,
  prioritizeEmails,
  sectionForDeepLink,
  settleTile,
  sourceLabel,
  taskBoard,
  workSummaryTile,
} from './hubModel';

const NOW = '2026-07-31T09:00:00.000Z';

function entity(over: Partial<UnifiedEntity>): UnifiedEntity {
  return {
    id: 'u1',
    kind: 'task',
    connectorId: 'm365',
    accountId: 'a',
    sourceId: 's',
    createdAt: NOW,
    updatedAt: NOW,
    syncState: 'active',
    syncedAt: NOW,
    metadata: {},
    title: 'Untitled',
    url: null,
    parentId: null,
    containerId: null,
    body: null,
    status: null,
    author: null,
    timestamp: null,
    endTimestamp: null,
    labels: [],
    ...over,
  } as UnifiedEntity;
}

describe('settleTile (per-source isolation)', () => {
  it('wraps success as ready and failure as an explicit unavailable reason', async () => {
    expect(await settleTile(() => Promise.resolve(7))).toEqual({ state: 'ready', data: 7 });
    expect(await settleTile(() => Promise.reject(new Error('feed down')))).toEqual({
      state: 'unavailable',
      reason: 'feed down',
    });
  });
});

describe('briefPeriodForHour', () => {
  it('is deterministic across the day', () => {
    expect(briefPeriodForHour(8)).toBe('morning');
    expect(briefPeriodForHour(12)).toBe('morning');
    expect(briefPeriodForHour(13)).toBe('afternoon');
    expect(briefPeriodForHour(16)).toBe('afternoon');
    expect(briefPeriodForHour(17)).toBe('evening');
    expect(briefPeriodForHour(23)).toBe('evening');
  });
});

describe('meetingsToday', () => {
  it('returns only today-and-upcoming calendar entities, soonest first, with a Prepare hand-off', () => {
    const rows = meetingsToday(
      [
        entity({ id: 'later', kind: 'calendar_event', title: 'Board review', timestamp: '2026-07-31T15:00:00.000Z' }),
        entity({ id: 'soon', kind: 'calendar_event', title: 'Design sync', timestamp: '2026-07-31T10:00:00.000Z', author: 'Sam' }),
        entity({ id: 'past', kind: 'calendar_event', title: 'Standup', timestamp: '2026-07-31T08:00:00.000Z' }),
        entity({ id: 'tomorrow', kind: 'calendar_event', title: 'Offsite', timestamp: '2026-08-01T10:00:00.000Z' }),
        entity({ id: 'not-cal', kind: 'task', title: 'Not a meeting', timestamp: '2026-07-31T11:00:00.000Z' }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['soon', 'later']);
    expect(rows[0]!.organizer).toBe('Sam');
    expect(rows[0]!.prepareQuery).toContain('Design sync');
  });
});

describe('taskBoard (D-3 — sources never conflated)', () => {
  it('keeps assistant and connector tasks in separate lists', () => {
    const board = taskBoard(
      [
        { id: 'a1', title: 'Send deck', status: 'open', due: '2026-07-31T17:00:00.000Z', priority: 'high' },
        { id: 'a2', title: 'Done thing', status: 'done', due: null, priority: 'normal' },
      ],
      [
        entity({ id: 'c1', kind: 'task', title: 'Fix invoice', status: 'open' }),
        entity({ id: 'c2', kind: 'task', title: 'Closed one', status: 'completed' }),
      ],
    );
    expect(board.assistant.map((t) => t.id)).toEqual(['a1']); // done filtered out
    expect(board.connector.map((t) => t.id)).toEqual(['c1']); // completed filtered out
    expect(board.connector[0]!.connectorId).toBe('m365');
  });

  it('orders assistant tasks: due first (earliest), then high priority', () => {
    const board = taskBoard(
      [
        { id: 'nodue', title: 'No due', status: 'open', due: null, priority: 'high' },
        { id: 'later', title: 'Later', status: 'open', due: '2026-08-02T09:00:00.000Z', priority: 'normal' },
        { id: 'soon', title: 'Soon', status: 'open', due: '2026-07-31T12:00:00.000Z', priority: 'normal' },
      ],
      [],
    );
    expect(board.assistant.map((t) => t.id)).toEqual(['soon', 'later', 'nodue']);
  });
});

describe('prioritizeEmails (D-5 — deterministic + explainable)', () => {
  it('ranks unread first and explains why each row is there', () => {
    const rows = prioritizeEmails(
      [
        entity({ id: 'read1', kind: 'message', title: 'Old read', status: 'read', timestamp: '2026-07-30T09:00:00.000Z', author: 'Ana' }),
        entity({ id: 'unread1', kind: 'message', title: 'Question', status: 'unread', timestamp: '2026-07-31T08:00:00.000Z', author: 'Sam' }),
        entity({ id: 'flagged', kind: 'message', title: 'Contract', status: 'read', timestamp: '2026-07-31T07:00:00.000Z', labels: ['Important'], author: 'Lee' }),
      ],
      NOW,
    );
    expect(rows[0]!.id).toBe('unread1');
    expect(rows[0]!.why).toContain('unread');
    const flagged = rows.find((r) => r.id === 'flagged')!;
    expect(flagged.category).toBe('important');
    expect(flagged.why).toContain('flagged');
  });

  it('marks unread mail from frequent senders as important', () => {
    const from = (id: string, status: string): UnifiedEntity =>
      entity({ id, kind: 'message', title: id, status, author: 'Busy Sender', timestamp: NOW });
    const rows = prioritizeEmails(
      [from('m1', 'unread'), from('m2', 'read'), from('m3', 'read'), from('m4', 'read')],
      NOW,
    );
    expect(rows.find((r) => r.id === 'm1')!.category).toBe('important');
  });
});

describe('composeProductivityTimeline (addition #1 — composition only)', () => {
  it('merges conversations, executions, approvals, notifications, and briefings chronologically', () => {
    const conversations: AssistantConversationSummary[] = [
      { id: 'c1', workspaceId: null, title: 'Chase invoice', pinned: false, updatedAt: '2026-07-31T08:30:00.000Z', messageCount: 4, lastIntent: 'task', waitingSteps: 1 },
    ];
    const executions = [
      { id: 'e1', kind: 'automation', label: 'Run digest', state: 'completed', steps: [], currentStep: -1, startedAt: '2026-07-31T08:45:00.000Z', completedAt: NOW, durationMs: 5, error: null, resultSummary: '2 action(s)', result: null } as ExecutionSession,
    ];
    const notifications: InboxNotification[] = [
      { id: 'n1', title: 'Mission Brief — 3 updates', body: 'ready', priority: 'high', sourceKey: 'mission-brief-morning', deepLink: 'enterprise/briefings', at: '2026-07-31T08:00:00.000Z', read: false },
      { id: 'n2', title: 'Connector needs attention: slack', body: 'offline', priority: 'high', sourceKey: 'connector-issue', deepLink: 'connections', at: '2026-07-31T08:50:00.000Z', read: false },
    ];
    const entries = composeProductivityTimeline({
      conversations,
      executions,
      pendingApprovals: [{ id: 'j1', title: 'Send chase email', createdAt: '2026-07-31T08:40:00.000Z' }],
      notifications,
    });
    expect(entries.map((e) => e.kind)).toEqual([
      'notification', // 08:50 connector
      'execution', // 08:45
      'approval', // 08:40
      'conversation', // 08:30
      'briefing', // 08:00 (brief source → briefing kind)
    ]);
    expect(entries[3]!.detail).toContain('1 step(s) waiting');
    expect(entries[0]!.section).toBe('connectors');
  });

  it('returns [] from empty inputs (honest empty state)', () => {
    expect(
      composeProductivityTimeline({ conversations: [], executions: [], pendingApprovals: [], notifications: [] }),
    ).toEqual([]);
  });
});

describe('workSummaryTile (addition #2 — descriptive, never a score)', () => {
  const base = {
    nowIso: NOW,
    assistantTasks: [],
    entities: [],
    executions: [],
    conversations: [] as AssistantConversationSummary[],
    pendingApprovals: 0,
    meetingsToday: 0,
  };

  it('is ungrounded on an empty day', () => {
    const s = workSummaryTile(base);
    expect(s.grounded).toBe(false);
    expect(s.sections).toEqual([]);
  });

  it('aggregates only what happened and stays descriptive', () => {
    const s = workSummaryTile({
      ...base,
      entities: [entity({ id: 't-done', kind: 'task', status: 'completed', updatedAt: NOW })],
      executions: [
        { id: 'e1', kind: 'task', label: 'x', state: 'completed', steps: [], currentStep: -1, startedAt: NOW, completedAt: NOW, durationMs: 1, error: null, resultSummary: null, result: null } as ExecutionSession,
        { id: 'e2', kind: 'task', label: 'y', state: 'failed', steps: [], currentStep: -1, startedAt: NOW, completedAt: NOW, durationMs: 1, error: 'boom', resultSummary: null, result: null } as ExecutionSession,
      ],
      pendingApprovals: 2,
      meetingsToday: 1,
    });
    expect(s.grounded).toBe(true);
    const titles = s.sections.map((x) => x.title);
    expect(titles).toContain('Completed today');
    expect(titles).toContain('Still open');
    expect(titles).toContain('Risks & blockers');
    expect(JSON.stringify(s)).not.toMatch(/score/i);
  });
});

describe('deep links + source labels', () => {
  it('maps known deep links onto existing sections and unknown ones to null', () => {
    expect(sectionForDeepLink('workforce')).toBe('workforce');
    expect(sectionForDeepLink('connections')).toBe('connectors');
    expect(sectionForDeepLink('automations')).toBe('automation-center');
    expect(sectionForDeepLink('hub')).toBe('hub');
    expect(sectionForDeepLink('enterprise/briefings')).toBe('intelligence');
    expect(sectionForDeepLink('something-unknown')).toBeNull();
    expect(sectionForDeepLink(null)).toBeNull();
  });

  it('labels known sources and passes unknown keys through', () => {
    expect(sourceLabel('mission-brief-morning')).toBe('Morning Brief');
    expect(sourceLabel('meeting-soon')).toBe('Meetings');
    expect(sourceLabel('some-custom-source')).toBe('some-custom-source');
  });
});

describe('executive highlights (D-6 — composed from the existing snapshot)', () => {
  it('projects the snapshot into toned highlight cards', async () => {
    const { execHighlights } = await import('./hubModel');
    const snapshot: ExecutiveSnapshot = {
      generatedAt: NOW,
      workspaceId: 'ws1',
      organization: {
        organizationId: 'org1',
        organizationName: 'NeuroPause',
        userCount: 12,
        humanCount: 8,
        workerCount: 4,
        unitCount: 3,
        leadershipCoverage: 0.66,
        healthScore: 0.8,
        healthLabel: 'Healthy',
      },
      workforce: { total: 4, idle: 2, running: 1, healthy: 3, degraded: 1, unhealthy: 0, unknown: 0, averageTrust: 0.8, jobsRun: 12, successRate: 0.92 },
      activity: { projects: 2, tasks: 9, documents: 4, customers: 1, events: 3, recentEvents: 5 },
      risk: { level: 'elevated', openFindings: 2, criticalFindings: 0, items: [] },
      approvals: { pending: 1, approvedRecently: 2, rejectedRecently: 0, oldestPendingAgeMs: 3 * 86_400_000 },
      intelligence: { headline: 'x', recommendationCount: 3, topRecommendations: [], grounded: true },
      operations: { connectors: 3, connectedAccounts: 2, installedApps: 5, auditEntries: 40 },
    };
    const cards = execHighlights(snapshot);
    expect(cards.find((c) => c.label === 'Org health')).toMatchObject({ value: '80%', tone: 'ok' });
    expect(cards.find((c) => c.label === 'Approvals')).toMatchObject({ tone: 'bad' }); // oldest 3 days
    expect(cards.find((c) => c.label === 'Risk')).toMatchObject({ value: 'elevated', tone: 'warn' });
    expect(cards.find((c) => c.label === 'Workforce')!.tone).toBe('warn'); // one degraded
  });
});
