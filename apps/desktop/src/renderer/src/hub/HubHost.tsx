/**
 * HubHost (Phase 6 Stage 5) — binds the Work Hub to the EXISTING IPC feeds.
 * Every tile loads independently through `settleTile` (the Stage 2 isolation
 * contract): one failing subsystem becomes that tile's explicit unavailable
 * reason and never blanks the rest. No new channels are consumed here beyond
 * the documented Stage 5 `notifications:*` cluster.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AssistantConversationSummary,
  Briefing,
  ExecutionSession,
  ExecutiveDecision,
  ExecutiveSnapshot,
  Job,
  Recommendation,
  UnifiedEntity,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import type { SectionId } from '@renderer/shell/sections';
import { setPendingAssistantQuery } from '@renderer/assistant/assistantHandoff';
import {
  briefPeriodForHour,
  composeProductivityTimeline,
  meetingsToday,
  notificationRows,
  prioritizeEmails,
  recommendationCards,
  settleTile,
  taskBoard,
  tileLoading,
  workSummaryTile,
  briefDisplay,
  execHighlights,
  type AssistantTaskRow,
  type HubTabId,
  type TileState,
} from './hubModel';
import { useNotificationInbox } from './useNotificationInbox';
import { HubView } from './HubView';

export interface HubData {
  entities: TileState<UnifiedEntity[]>;
  brief: TileState<Briefing>;
  recommendations: TileState<Recommendation[]>;
  approvals: TileState<Job[]>;
  conversations: TileState<AssistantConversationSummary[]>;
  executions: TileState<ExecutionSession[]>;
  executive: TileState<ExecutiveSnapshot>;
  decisions: TileState<ExecutiveDecision[]>;
  assistantTasks: TileState<AssistantTaskRow[]>;
}

const LOADING: HubData = {
  entities: tileLoading(),
  brief: tileLoading(),
  recommendations: tileLoading(),
  approvals: tileLoading(),
  conversations: tileLoading(),
  executions: tileLoading(),
  executive: tileLoading(),
  decisions: tileLoading(),
  assistantTasks: tileLoading(),
};

/** Project a ready tile through a pure mapper; loading/unavailable pass through. */
function derive<S, T>(tile: TileState<S>, fn: (data: S) => T): TileState<T> {
  if (tile.state === 'ready') return { state: 'ready', data: fn(tile.data) };
  return tile.state === 'loading'
    ? { state: 'loading' }
    : { state: 'unavailable', reason: tile.reason };
}

export function HubHost({ onNavigate }: { onNavigate?: (id: SectionId) => void }): JSX.Element {
  const [tab, setTab] = useState<HubTabId>('today');
  const [data, setData] = useState<HubData>(LOADING);
  const inbox = useNotificationInbox(50);

  const refresh = useCallback((): void => {
    setData(LOADING);
    const period = briefPeriodForHour(new Date().getHours());
    void settleTile(() =>
      ipc.unified
        .query({ kinds: ['calendar_event', 'event', 'task', 'message'], limit: 2000 })
        .then((r) => r.items),
    ).then((t) => setData((d) => ({ ...d, entities: t })));
    void settleTile(() => ipc.intelligence.briefing(period)).then((t) =>
      setData((d) => ({ ...d, brief: t })),
    );
    void settleTile(() =>
      ipc.recommendations.generate({ limit: 12 }).then((r) => r.recommendations),
    ).then((t) => setData((d) => ({ ...d, recommendations: t })));
    void settleTile(() =>
      ipc.workforce.jobs({ status: 'awaiting_approval', limit: 20 }).then((r) => r.jobs),
    ).then((t) => setData((d) => ({ ...d, approvals: t })));
    void settleTile(() =>
      ipc.assistant.conversations(undefined, 30).then((r) => r.conversations),
    ).then((t) => setData((d) => ({ ...d, conversations: t })));
    void settleTile(() => ipc.execute.history().then((r) => r.records)).then((t) =>
      setData((d) => ({ ...d, executions: t })),
    );
    void settleTile(() => ipc.enterprise.dashboard()).then((t) =>
      setData((d) => ({ ...d, executive: t })),
    );
    void settleTile(() => ipc.decisions.list().then((r) => r.decisions)).then((t) =>
      setData((d) => ({ ...d, decisions: t })),
    );
    void settleTile(() =>
      ipc.memory
        .recall({ kinds: ['task'], tag: 'assistant-task', limit: 100 })
        .then((r) =>
          r.hits.map(
            (h): AssistantTaskRow => ({
              id: h.item.id,
              title: h.item.title,
              status:
                typeof h.item.metadata['status'] === 'string'
                  ? (h.item.metadata['status'] as string)
                  : 'open',
              due:
                typeof h.item.metadata['due'] === 'string'
                  ? (h.item.metadata['due'] as string)
                  : null,
              priority:
                typeof h.item.metadata['priority'] === 'string'
                  ? (h.item.metadata['priority'] as string)
                  : 'normal',
            }),
          ),
        ),
    ).then((t) => setData((d) => ({ ...d, assistantTasks: t })));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const nowIso = useMemo(() => new Date().toISOString(), [data.entities]);

  // ── Derived tile models (pure projections; unavailable propagates as-is). ──
  const meetings = derive(data.entities, (e) => meetingsToday(e, nowIso));
  const emails = derive(data.entities, (e) => prioritizeEmails(e, nowIso));
  const tasks: TileState<ReturnType<typeof taskBoard>> =
    data.assistantTasks.state === 'ready' && data.entities.state === 'ready'
      ? { state: 'ready', data: taskBoard(data.assistantTasks.data, data.entities.data) }
      : data.assistantTasks.state === 'unavailable'
        ? { state: 'unavailable', reason: data.assistantTasks.reason }
        : data.entities.state === 'unavailable'
          ? { state: 'unavailable', reason: data.entities.reason }
          : { state: 'loading' };
  const brief = derive(data.brief, briefDisplay);
  const recs = derive(data.recommendations, (r) => recommendationCards(r));
  const executive = derive(data.executive, execHighlights);
  const timeline =
    data.conversations.state === 'ready' && data.executions.state === 'ready' && data.approvals.state === 'ready'
      ? {
          state: 'ready' as const,
          data: composeProductivityTimeline({
            conversations: data.conversations.data,
            executions: data.executions.data,
            pendingApprovals: data.approvals.data.map((j) => ({
              id: j.id,
              title: j.summary ?? j.skillId,
              createdAt: j.createdAt,
            })),
            notifications: inbox.items,
          }),
        }
      : { state: 'loading' as const };
  const summary =
    data.assistantTasks.state === 'ready' &&
    data.entities.state === 'ready' &&
    data.executions.state === 'ready' &&
    data.conversations.state === 'ready' &&
    data.approvals.state === 'ready'
      ? {
          state: 'ready' as const,
          data: workSummaryTile({
            nowIso,
            assistantTasks: data.assistantTasks.data,
            entities: data.entities.data,
            executions: data.executions.data,
            conversations: data.conversations.data,
            pendingApprovals: data.approvals.data.length,
            meetingsToday: meetings.state === 'ready' ? meetings.data.length : 0,
          }),
        }
      : { state: 'loading' as const };
  const notifications =
    inbox.available === null
      ? tileLoading<ReturnType<typeof notificationRows>>()
      : inbox.available
        ? { state: 'ready' as const, data: notificationRows(inbox.items) }
        : { state: 'unavailable' as const, reason: 'notification inbox unavailable' };

  const prepareMeeting = useCallback(
    (query: string): void => {
      setPendingAssistantQuery(query);
      onNavigate?.('assistant');
    },
    [onNavigate],
  );

  return (
    <HubView
      tab={tab}
      onTab={setTab}
      onRefresh={refresh}
      unread={inbox.unread}
      brief={brief}
      meetings={meetings}
      recommendations={recs}
      notifications={notifications}
      timeline={timeline}
      tasks={tasks}
      emails={emails}
      approvals={derive(data.approvals, (jobs) =>
        jobs.map((j) => ({ id: j.id, title: j.summary ?? j.skillId, createdAt: j.createdAt })),
      )}
      conversations={data.conversations}
      summary={summary}
      executive={executive}
      decisions={derive(data.decisions, (list) =>
        list.slice(0, 6).map((d) => ({ id: d.id, title: d.title, status: d.status })),
      )}
      onMarkNotificationRead={(id) => inbox.markRead([id])}
      onPrepareMeeting={prepareMeeting}
      {...(onNavigate ? { onNavigate } : {})}
    />
  );
}
