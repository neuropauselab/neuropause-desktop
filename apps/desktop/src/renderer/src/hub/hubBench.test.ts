/**
 * Phase 6 Stage 5 (D-10) — Work Hub bench evidence (house __bench__ pattern):
 * REAL executed timings for the pure feed-composition layers, printed for the
 * validation record and asserted against generous ceilings. The 5.12 budget is
 * hub feed compose ≤250 ms with instant IO — measured here over 5k entities.
 */
import { describe, expect, it } from 'vitest';
import type { AssistantConversationSummary, ExecutionSession, InboxNotification, UnifiedEntity } from '@neuropause/shared';
import { composeProductivityTimeline, meetingsToday, prioritizeEmails, taskBoard, workSummaryTile } from './hubModel';

const NOW = '2026-07-31T09:00:00.000Z';

function entity(i: number): UnifiedEntity {
  const kinds = ['task', 'message', 'calendar_event', 'document'] as const;
  const kind = kinds[i % kinds.length]!;
  const hour = String(6 + (i % 12)).padStart(2, '0');
  return {
    id: `e${i}`,
    kind,
    connectorId: i % 2 === 0 ? 'm365' : 'google-workspace',
    accountId: 'a',
    sourceId: `s${i}`,
    createdAt: NOW,
    updatedAt: `2026-07-31T${hour}:00:00.000Z`,
    syncState: 'active',
    syncedAt: NOW,
    metadata: {},
    title: `Entity ${i}`,
    url: null,
    parentId: null,
    containerId: null,
    body: null,
    status: kind === 'message' ? (i % 3 === 0 ? 'unread' : 'read') : i % 4 === 0 ? 'completed' : 'open',
    author: `Person ${i % 40}`,
    timestamp: kind === 'calendar_event' ? `2026-07-31T${hour}:30:00.000Z` : `2026-07-31T${hour}:00:00.000Z`,
    endTimestamp: null,
    labels: i % 7 === 0 ? ['Important'] : [],
  } as UnifiedEntity;
}

describe('work hub benchmarks (pure feed composition)', () => {
  it('composes the full hub feed over 5k entities within the 5.12 budget', () => {
    const entities = Array.from({ length: 5000 }, (_, i) => entity(i));
    const assistantTasks = Array.from({ length: 100 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      status: i % 3 === 0 ? 'done' : 'open',
      due: i % 2 === 0 ? NOW : null,
      priority: i % 5 === 0 ? 'high' : 'normal',
    }));
    const conversations: AssistantConversationSummary[] = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      workspaceId: null,
      title: `Conversation ${i}`,
      pinned: false,
      updatedAt: NOW,
      messageCount: 6,
      lastIntent: 'question',
      waitingSteps: i % 4 === 0 ? 1 : 0,
    }));
    const executions = Array.from({ length: 200 }, (_, i) => ({
      id: `x${i}`,
      kind: 'automation',
      label: `Run ${i}`,
      state: i % 6 === 0 ? 'failed' : 'completed',
      steps: [],
      currentStep: -1,
      startedAt: NOW,
      completedAt: NOW,
      durationMs: 4,
      error: null,
      resultSummary: null,
      result: null,
    })) as ExecutionSession[];
    const notifications: InboxNotification[] = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`,
      title: `Notification ${i}`,
      body: 'body',
      priority: 'high',
      sourceKey: i % 5 === 0 ? 'mission-brief-morning' : 'work-complete',
      deepLink: null,
      at: NOW,
      read: i % 2 === 0,
    }));

    const started = performance.now();
    const meetings = meetingsToday(entities, '2026-07-31T05:00:00.000Z');
    const emails = prioritizeEmails(entities, NOW);
    const board = taskBoard(assistantTasks, entities);
    const timeline = composeProductivityTimeline({
      conversations,
      executions,
      pendingApprovals: [{ id: 'j1', title: 'Approve', createdAt: NOW }],
      notifications,
    });
    const summary = workSummaryTile({
      nowIso: NOW,
      assistantTasks,
      entities,
      executions,
      conversations,
      pendingApprovals: 1,
      meetingsToday: meetings.length,
    });
    const ms = performance.now() - started;

    // eslint-disable-next-line no-console
    console.log(
      `hub.feed-compose  ${ms.toFixed(1)} ms / 5k entities → ${meetings.length} meeting(s), ${emails.length} email(s), ${board.assistant.length + board.connector.length} task row(s), ${timeline.length} timeline entrie(s), ${summary.sections.length} summary section(s)`,
    );
    expect(meetings.length).toBeGreaterThan(0);
    expect(emails.length).toBeGreaterThan(0);
    expect(timeline.length).toBeGreaterThan(0);
    expect(summary.grounded).toBe(true);
    expect(ms).toBeLessThan(250); // 5.12 budget: hub feed compose ≤250 ms
  });
});
