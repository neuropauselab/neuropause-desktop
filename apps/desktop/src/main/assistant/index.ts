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
  ExecutionRequest,
  ExecutionSession,
  FounderResponse,
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
}

export interface AssistantSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
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

  return { handlers, dispose: () => undefined };
}
