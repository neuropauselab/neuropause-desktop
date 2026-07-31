/**
 * Workspace Assistant composition root (Phase 6 Stage 4).
 *
 * Wires the AssistantService to the LIVE subsystems — the same singletons the
 * Founder AI root uses (UDM search backend + knowledge graph + AI memory +
 * Mission Brief through the existing Context Builder, the shared AI Engine,
 * conversation-memory governance) plus the operational reads (connector
 * service, automation store, worker registry, workforce job store, enterprise
 * timeline, workspace contexts) and the ExecuteEngine handed in by the
 * composition root. Exposes the documented Stage 4 `assistant:*` IPC cluster.
 * Adds NO engine, NO retrieval pipeline, NO execution path of its own.
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type {
  AssistantConversation,
  AssistantStructuredReport,
  Briefing,
  ExecutionRequest,
  ExecutionSession,
  FounderResponse,
  MemoryItem,
  UnifiedEntity,
  AssistantAskRequest as TAssistantAskRequest,
  AssistantCancelRequest as TAssistantCancelRequest,
  AssistantConversationBranchRequest as TAssistantConversationBranchRequest,
  AssistantConversationDeleteRequest as TAssistantConversationDeleteRequest,
  AssistantConversationGetRequest as TAssistantConversationGetRequest,
  AssistantConversationSaveRequest as TAssistantConversationSaveRequest,
  AssistantConversationsRequest as TAssistantConversationsRequest,
  AssistantPlanDecideRequest as TAssistantPlanDecideRequest,
} from '@neuropause/shared';
import {
  AssistantAskRequest,
  AssistantCancelRequest,
  AssistantConversationBranchRequest,
  AssistantConversationDeleteRequest,
  AssistantConversationGetRequest,
  AssistantConversationSaveRequest,
  AssistantConversationsRequest,
  AssistantPlanDecideRequest,
  IpcChannel,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { unifiedStore } from '../unified/storeInstance';
import { graphStore } from '../graph/graphInstance';
import { memoryStore } from '../memory/memoryInstance';
import { memoryAuditLog } from '../memory/memoryAuditInstance';
import { getEnterpriseTimeline } from '../timeline';
import { generateBriefing } from '../intelligence/briefingGenerator';
import { isCompleted } from '../intelligence/classify';
import { createContextBuilder } from '../ai/contextBuilder';
import { aiEngine } from '../ai/engineInstance';
import {
  captureFounderMemory,
  recallForAnswer,
  screenMemory,
  type ConversationMemoryDeps,
} from '../ai/conversationMemory';
import { connectorService } from '../connectors/connectorService';
import { automationStore } from '../enterprise/automationInstance';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { jobStore } from '../workforce/runtime/jobInstance';
import * as workspaceContexts from '../ipc/handlers/workspaceContexts';
// Phase 6 Stage 5 — productivity wiring (existing singletons only).
import { notificationScheduler } from '../services/notificationScheduler';
import { decisionStore } from '../enterprise/decisionInstance';
import { nameMatches } from './assistantModel';
import { buildMeetingBrief, buildWorkSummary, selectMeeting } from './productivity';
import { ConversationStore } from './conversationStore';
import { AssistantService } from './assistantService';

const log = createLogger('workspace-assistant');

export interface AssistantSubsystemDeps {
  broadcast: (channel: string, payload: unknown) => void;
  publish: (event: {
    type: string;
    category: string;
    source: string;
    priority?: string;
    metadata?: Record<string, string | number | boolean | null>;
    correlationId?: string;
  }) => void;
  /** The EXISTING ExecuteEngine — the assistant's only execution path. */
  execute: (req: ExecutionRequest) => Promise<ExecutionSession>;
  /** Live count of active ExecuteEngine sessions (for the workspace snapshot). */
  executionsActive: () => number;
  /** Phase 6 Stage 5 — ExecuteEngine history (Work Summary aggregation input). */
  executionHistory?: () => { label: string; state: string; startedAt: string }[];
  /** Phase 6 Stage 5 — recent automation run records (Work Summary input). */
  automationRuns?: () => { ok: boolean; startedAt: string }[];
  /** Phase 6 Stage 6 (D-5) — the Enterprise Intelligence Layer's ten-question
   *  resolver (in-process port; read-only). Late-bound by the composition root. */
  intelligenceAnswer?: (text: string, now: string) => AssistantStructuredReport | null;
  /** Phase 6 Stage 7 (D-8) — the Knowledge Platform's ten-question resolver
   *  (in-process port; read-only; answers ride the 'intelligence' report kind). */
  knowledgeAnswer?: (text: string, now: string) => AssistantStructuredReport | null;
}

export interface AssistantSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
  /** Phase 6 Stage 5 — conversation summaries for the recommendation aux port. */
  conversationSummaries: () => { id: string; title: string; updatedAt: string; waitingSteps: number }[];
}

/** Conversation-memory deps over the live store, with every audit event tagged
 *  with this turn's correlation id (end-to-end traceability, D+1 requirement). */
function memoryDeps(correlationId: string): ConversationMemoryDeps {
  return {
    remember: (input, now) => memoryStore.remember(input, now),
    recall: (q) => memoryStore.recall(q),
    get: (id) => memoryStore.get(id),
    forget: (ids) => memoryStore.forget(ids),
    audit: (event) => memoryAuditLog.record({ ...event, correlationId }),
  };
}

export function initAssistant(deps: AssistantSubsystemDeps): AssistantSubsystem {
  const store = new ConversationStore(join(app.getPath('userData'), 'assistant-conversations.json'));
  const loaded = store.loadAllSync();

  /* ── Phase 6 Stage 5 — productivity ports over EXISTING singletons ─────── */

  // D-3: assistant tasks are MemoryItems (kind 'task', tagged) in the EXISTING
  // memory store — no task engine. Every write lands in the memory audit log
  // with the turn's correlation id.
  const ASSISTANT_TASK_TAG = 'assistant-task';
  const taskFromMemory = (m: MemoryItem): {
    id: string;
    title: string;
    status: string;
    due: string | null;
    priority: string;
    createdAt: string;
    updatedAt: string;
  } => ({
    id: m.id,
    title: m.title,
    status: typeof m.metadata['status'] === 'string' ? (m.metadata['status'] as string) : 'open',
    due: typeof m.metadata['due'] === 'string' ? (m.metadata['due'] as string) : null,
    priority: typeof m.metadata['priority'] === 'string' ? (m.metadata['priority'] as string) : 'normal',
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  });
  const listAssistantTasks = (): ReturnType<typeof taskFromMemory>[] =>
    memoryStore
      .recall({ kinds: ['task'], tag: ASSISTANT_TASK_TAG, limit: 200 })
      .hits.map((h) => taskFromMemory(h.item));

  /** Connector problems, exactly as the workspace-snapshot port classifies them. */
  const connectorProblemList = (): { id: string; reason: string }[] =>
    connectorService
      .list()
      .map((c) => ({
        id: c.id,
        problem:
          c.health === 'healthy' || !c.configured || c.health === 'unknown'
            ? null
            : `health ${c.health} (status ${c.status})`,
      }))
      .filter((c): c is { id: string; problem: string } => c.problem !== null)
      .map((c) => ({ id: c.id, reason: c.problem }));

  /** Small retrieval helper for the meeting-prep collector — the SAME context
   *  builder + sources buildContext uses, with a fixed modest budget. */
  const retrieveFor = (query: string, now: string): { source: string; text: string }[] => {
    const entities = readEntities();
    const tl = getEnterpriseTimeline();
    const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
    const brief = generateBriefing('morning', { entities, events, now });
    const builder = createContextBuilder({
      searchSources: { entity: unifiedStore.searchBackend, graph: graphStore, memory: memoryStore },
      getBriefing: () => brief,
    });
    return builder
      .build({ worker: 'assistant', query, maxItems: 8, maxChars: 3000, perSourceLimit: 6, now })
      .map((it) => ({ source: it.source, text: it.text }));
  };

  // The read paths the productivity flows compose over (same reads the
  // context builder / briefing generator already use).
  const readEntities = (): UnifiedEntity[] =>
    unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
  const readTimeline = (limit: number): { at: string; kind: string; title: string }[] => {
    const tl = getEnterpriseTimeline();
    if (!tl) return [];
    return tl.query({ limit, order: 'desc' }).entries.map((e) => ({ at: e.at, kind: e.kind, title: e.title }));
  };

  const briefingToReport = (briefing: Briefing): AssistantStructuredReport => {
    const sections = briefing.sections
      .filter((s) => !s.empty && s.items.length > 0)
      .map((s) => ({
        title: s.title,
        lines: s.items.map((it) => (it.detail ? `${it.text} — ${it.detail}` : it.text)),
      }));
    return {
      kind: 'brief',
      title: briefing.headline,
      sections,
      grounded: briefing.grounded && sections.length > 0,
    };
  };

  const service = new AssistantService({
    store,
    context: {
      workspaces: () => {
        const state = workspaceContexts.list();
        const active = state.workspaces.find((w) => w.id === state.activeId) ?? null;
        return {
          active: active ? { id: active.id, name: active.name } : null,
          count: state.workspaces.length,
        };
      },
      connectors: () =>
        connectorService.list().map((c) => ({
          id: c.id,
          connected: c.status === 'connected',
          problem:
            c.health === 'healthy' || !c.configured
              ? null
              : c.health === 'unknown'
                ? null
                : `health ${c.health} (status ${c.status})`,
        })),
      executions: () => ({ active: deps.executionsActive() }),
      pendingApprovals: () => jobStore.page({ status: 'awaiting_approval', limit: 1 }).total,
      automations: () =>
        automationStore.all().map((r) => ({
          id: r.id,
          name: r.name,
          actionCount: r.actions.length,
          active: r.status === 'active',
        })),
      workers: () =>
        workerRegistry.summaries().map((w) => ({ id: w.id, name: w.name, role: w.role })),
      timeline: (limit) => {
        const tl = getEnterpriseTimeline();
        if (!tl) throw new Error('enterprise timeline not initialized');
        return tl
          .query({ limit, order: 'desc' })
          .entries.map((e) => ({ id: e.id, at: e.at, kind: e.kind, title: e.title }));
      },
      memoryTotal: () => memoryStore.recall({ limit: 1 }).total,
    },
    buildContext: (req) => {
      // Mirrors the Founder AI root exactly: a fresh Mission Brief + a Context
      // Builder over the live federated-search surfaces, per request.
      const now = req.now ?? new Date().toISOString();
      const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
      const tl = getEnterpriseTimeline();
      const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
      const brief = generateBriefing('morning', { entities, events, now });
      const builder = createContextBuilder({
        searchSources: { entity: unifiedStore.searchBackend, graph: graphStore, memory: memoryStore },
        getBriefing: () => brief,
      });
      return builder.build(req);
    },
    runAi: (req) => aiEngine.run(req),
    recallMemories: (question, now, correlationId) =>
      recallForAnswer(memoryDeps(correlationId), { question, now }),
    captureMemory: ({ question, answerText, grounded, conversationId, correlationId, now }) => {
      // Reuse the EXISTING classify → screen → store governance by shaping the
      // assistant's outcome into the response fields the classifier reads.
      const responseShape = {
        intent: 'general',
        needsClarification: false,
        grounded,
        keyFindings: [],
        sourceSystems: [],
        evidence: [],
        confidence: grounded ? 0.6 : 0,
        executiveSummary: answerText,
      } as unknown as FounderResponse;
      const result = captureFounderMemory(memoryDeps(correlationId), {
        question,
        response: responseShape,
        conversationId,
        now,
      });
      return { outcome: result.outcome, type: result.classification.type };
    },
    screen: (text) => screenMemory(text),
    execute: (req) => deps.execute(req),
    publish: deps.publish,
    broadcast: (event) => deps.broadcast(IpcChannel.AssistantEventBroadcast, event),
    newId: () => randomUUID(),

    /* ── Phase 6 Stage 5 — productivity ports (D-2/D-3/D-4 + Work Summary) ── */

    // D-3: tasks = MemoryItems in the EXISTING memory store; audited writes.
    tasks: {
      create: ({ title, due, priority, conversationId, correlationId, now }) => {
        const item = memoryStore.remember(
          {
            kind: 'task',
            title,
            content: title,
            tags: [ASSISTANT_TASK_TAG],
            metadata: { status: 'open', priority, due, owner: 'me', conversationId, correlationId },
          },
          now,
        );
        memoryAuditLog.record({
          id: `maud_${randomUUID()}`,
          action: 'created',
          memoryId: item.id,
          at: now,
          detail: `Assistant task created: ${title}`,
          decision: null,
          rejections: [],
          correlationId,
        });
        return { id: item.id, title: item.title };
      },
      complete: (id, now, correlationId) => {
        const updated = memoryStore.update(id, { metadata: { status: 'done', completedAt: now } }, now);
        if (!updated) return null;
        memoryAuditLog.record({
          id: `maud_${randomUUID()}`,
          action: 'updated',
          memoryId: updated.id,
          at: now,
          detail: `Assistant task completed: ${updated.title}`,
          decision: null,
          rejections: [],
          correlationId,
        });
        return { id: updated.id, title: updated.title };
      },
      list: listAssistantTasks,
    },

    // D-8: reminders through the EXISTING notification scheduler (local, auto-run).
    scheduleReminder: ({ title, at, correlationId }) => {
      const id = `asst-reminder-${randomUUID().slice(0, 8)}`;
      notificationScheduler.schedule({ id, title: 'Reminder', body: title, at });
      deps.publish({
        type: 'assistant.reminder.scheduled',
        category: 'runtime',
        source: 'workspace-assistant',
        metadata: { reminderId: id, at },
        correlationId,
      });
      return { id };
    },

    // D-2: brief requests resolve to the EXISTING briefing generator.
    briefing: (period, now) => {
      const entities = readEntities();
      const tl = getEnterpriseTimeline();
      const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
      return briefingToReport(generateBriefing(period, { entities, events, now }));
    },

    // D-4: deterministic meeting-prep collector — existing reads only.
    meetingPrep: (requestText, now, _correlationId) => {
      const entities = readEntities();
      const meeting = selectMeeting(entities, now, requestText);
      if (!meeting) return null;
      const participants: string[] = [];
      if (meeting.author) participants.push(meeting.author);
      const rawAttendees = (meeting.metadata as Record<string, unknown>)['attendees'];
      if (typeof rawAttendees === 'string') {
        participants.push(...rawAttendees.split(/[;,]/).map((s) => s.trim()).filter(Boolean));
      } else if (Array.isArray(rawAttendees)) {
        for (const a of rawAttendees) if (typeof a === 'string' && a.trim()) participants.push(a.trim());
      }
      const unique = [...new Set(participants)];
      const related = retrieveFor(`${meeting.title} ${unique.join(' ')}`.trim(), now).map((it) => ({
        source: it.source,
        title: it.text.length > 120 ? `${it.text.slice(0, 117)}…` : it.text,
      }));
      const timeline = readTimeline(200)
        .filter(
          (t) =>
            nameMatches(t.title, meeting.title) ||
            unique.some((p) => p.length >= 3 && t.title.toLowerCase().includes(p.toLowerCase())),
        )
        .slice(0, 6)
        .map((t) => ({ at: t.at, title: t.title }));
      const decisions = decisionStore
        .all()
        // "Open" for meeting prep = still undecided (not accepted/rejected/archived).
        .filter((d) => d.status !== 'accepted' && d.status !== 'rejected' && d.status !== 'archived')
        .slice(0, 5)
        .map((d) => ({ title: d.title, status: d.status }));
      const memories = memoryStore
        .recall({ text: meeting.title, limit: 5 })
        .hits.map((h) => ({ title: h.item.title }));
      return buildMeetingBrief({
        meeting: {
          id: meeting.id,
          title: meeting.title,
          startsAt: meeting.timestamp,
          organizer: meeting.author,
        },
        participants: unique,
        related,
        timeline,
        decisions,
        memories,
      });
    },

    // Phase 6 Stage 6 (D-5): the ten questions answer from the insight layer.
    intelligence: (text, now) => deps.intelligenceAnswer?.(text, now) ?? null,

    // Phase 6 Stage 7 (D-8): the ten knowledge questions answer from the
    // Knowledge Platform (same in-process port pattern; read-only).
    knowledge: (text, now) => deps.knowledgeAnswer?.(text, now) ?? null,

    // Stage 5 addition #2: descriptive Work Summary over existing metrics.
    workSummary: (now) => {
      const entities = readEntities();
      const today = now.slice(0, 10);
      return buildWorkSummary({
        nowIso: now,
        assistantTasks: listAssistantTasks().map((t) => ({
          title: t.title,
          status: t.status,
          updatedAt: t.updatedAt,
        })),
        connectorTasksCompletedToday: entities
          .filter((e) => e.kind === 'task' && isCompleted(e) && e.updatedAt.slice(0, 10) === today)
          .slice(0, 20)
          .map((e) => e.title),
        meetingsToday: entities
          .filter(
            (e) =>
              (e.kind === 'calendar_event' || e.kind === 'event') &&
              e.timestamp !== null &&
              e.timestamp.slice(0, 10) === today,
          )
          .slice(0, 10)
          .map((e) => e.title),
        executionsToday: (deps.executionHistory?.() ?? [])
          .filter((e) => e.startedAt.slice(0, 10) === today)
          .map((e) => ({ label: e.label, state: e.state })),
        automationRunsToday: (deps.automationRuns?.() ?? [])
          .filter((r) => r.startedAt.slice(0, 10) === today)
          .map((r) => ({ ok: r.ok })),
        jobsToday: jobStore
          .page({ limit: 200 })
          .jobs.filter((j) => j.createdAt.slice(0, 10) === today).length,
        pendingApprovals: jobStore.page({ status: 'awaiting_approval', limit: 1 }).total,
        conversationsToday: store.list(null, 100).filter((c) => c.updatedAt.slice(0, 10) === today)
          .length,
        connectorProblems: connectorProblemList(),
      });
    },
  });

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.AssistantAsk,
      schema: AssistantAskRequest,
      // Reasoning + retrieval can legitimately take longer than the default.
      timeoutMs: 90_000,
      handler: (p) => {
        const r = p as TAssistantAskRequest;
        return service.ask({
          text: r.text,
          ...(r.mode ? { mode: r.mode } : {}),
          ...(r.conversationId ? { conversationId: r.conversationId } : {}),
          workspaceId: r.workspaceId ?? null,
          ...(r.uiContext ? { uiContext: r.uiContext } : {}),
          ...(r.now ? { now: r.now } : {}),
        });
      },
    },
    {
      channel: IpcChannel.AssistantConversations,
      schema: AssistantConversationsRequest,
      handler: (p) => {
        const r = p as TAssistantConversationsRequest;
        return { conversations: store.list(r.workspaceId ?? null, r.limit ?? 50) };
      },
    },
    {
      channel: IpcChannel.AssistantConversationGet,
      schema: AssistantConversationGetRequest,
      handler: (p) => store.get((p as TAssistantConversationGetRequest).conversationId),
    },
    {
      channel: IpcChannel.AssistantConversationSave,
      schema: AssistantConversationSaveRequest,
      audit: true,
      handler: async (p) => {
        const r = p as TAssistantConversationSaveRequest;
        const conversation = store.get(r.conversationId);
        if (!conversation) return null;
        const next: AssistantConversation = {
          ...conversation,
          ...(r.title !== undefined ? { title: r.title } : {}),
          ...(r.pinned !== undefined ? { pinned: r.pinned } : {}),
        };
        await store.upsert(next);
        return next;
      },
    },
    {
      channel: IpcChannel.AssistantConversationDelete,
      schema: AssistantConversationDeleteRequest,
      audit: true,
      handler: (p) => store.delete((p as TAssistantConversationDeleteRequest).conversationId),
    },
    {
      channel: IpcChannel.AssistantConversationBranch,
      schema: AssistantConversationBranchRequest,
      handler: (p) => {
        const r = p as TAssistantConversationBranchRequest;
        return service.branch(r.conversationId, r.messageId, r.now);
      },
    },
    {
      // Classified 'workforce:operate' in RUNTIME_CHANNEL_PERMISSIONS — approving
      // a step re-enters the ExecuteEngine exactly like `execute:run` does.
      channel: IpcChannel.AssistantPlanDecide,
      schema: AssistantPlanDecideRequest,
      audit: true,
      handler: (p) => {
        const r = p as TAssistantPlanDecideRequest;
        return service.decideStep({
          conversationId: r.conversationId,
          messageId: r.messageId,
          stepId: r.stepId,
          decision: r.decision,
          note: r.note ?? null,
          ...(r.now ? { now: r.now } : {}),
        });
      },
    },
    {
      channel: IpcChannel.AssistantCancel,
      schema: AssistantCancelRequest,
      handler: (p) => service.cancel((p as TAssistantCancelRequest).conversationId),
    },
  ];

  log.info('Workspace Assistant initialized', {
    conversations: loaded.length,
    channels: handlers.length,
  });

  return {
    handlers,
    dispose: () => undefined,
    // Phase 6 Stage 5 — feeds the followup_conversation recommendation rule.
    conversationSummaries: () =>
      store.list(null, 50).map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        waitingSteps: s.waitingSteps ?? 0,
      })),
  };
}
