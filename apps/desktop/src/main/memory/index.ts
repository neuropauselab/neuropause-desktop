/**
 * AI Memory composition root.
 *
 * Loads the memory store, then keeps the projected memories in sync with the
 * Unified Data Model: each UDM change re-projects memory-worthy entities and
 * replaces the projected set (explicit memories are preserved). Exposes recall,
 * lookup, explicit remember/forget, counts, and manual rebuild over the secure
 * IPC bridge, and broadcasts a counts snapshot whenever memory changes.
 *
 * Reads only the UDM — never a connector.
 */
import type {
  ExecMemoryAuditRequest as TExecMemoryAuditRequest,
  ExecMemoryForgetRequest as TExecMemoryForgetRequest,
  ExecMemoryPinRequest as TExecMemoryPinRequest,
  ExecMemoryResolveRequest as TExecMemoryResolveRequest,
  ExecMemorySearchRequest as TExecMemorySearchRequest,
  MemoryForgetRequest as TMemoryForgetRequest,
  MemoryGetRequest as TMemoryGetRequest,
  MemoryRecallRequest as TMemoryRecallRequest,
  MemoryRememberRequest as TMemoryRememberRequest,
} from '@neuropause/shared';
import {
  EmptyRequest,
  ExecMemoryAuditRequest,
  ExecMemoryForgetRequest,
  ExecMemoryPinRequest,
  ExecMemoryResolveRequest,
  ExecMemorySearchRequest,
  IpcChannel,
  MemoryForgetRequest,
  MemoryGetRequest,
  MemoryRecallRequest,
  MemoryRememberRequest,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import {
  forgetMemory,
  pinMemory,
  searchExecutiveMemories,
  setDecisionStatus,
  type ConversationMemoryDeps,
} from '../ai/conversationMemory';
import { unifiedStore } from '../unified/storeInstance';
import { memoryStore } from './memoryInstance';
import { handleSemanticRecall } from './semanticRecallHandler';
import { createResilientSemanticSearch } from './resilientSemanticSearch';
import { retrievalProbe } from '../platform/aiHealthProbes';
import type { DiagnosticProbe } from '../platform/diagnostics';
import { backendSemanticSearch } from '../backendsemantic/backendSemanticInstance';
import { runMemoryBackfill } from './memoryBackfill';
import { backendBackfill } from '../backendsemantic/backendBackfillInstance';
import { runtimeIdentity } from '../runtimeIdentity';
import { memoryAuditLog } from './memoryAuditInstance';
import { projectMemory } from './memoryProjector';
import { projectBusinessMemory } from './businessMemoryProjector';
import { getRelationshipModel } from '../enterprise/relationshipProvider';
import type { PlatformEventType } from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';

const log = createLogger('memory');

/** P2.5 — ERP record + connector-write events that should re-project business memory (UDM 'changed' misses these). */
const MEMORY_REBUILD_EVENTS: readonly PlatformEventType[] = [
  'enterprise.record.created',
  'enterprise.record.updated',
  'enterprise.record.status_changed',
  'enterprise.record.deleted',
  'enterprise.record.converted',
  'connector.write_completed',
];

export interface MemorySubsystemDeps {
  broadcast: IpcBroadcaster;
  /** P2.5 — subscribe to platform events so ERP changes re-project business memory. */
  on?: (types: readonly PlatformEventType[], handler: () => void) => void;
}

export interface MemorySubsystem {
  handlers: SecureHandlerDef[];
  /** Re-index organizational memory on demand (Recovery Center). */
  rebuild: () => void;
  /** A6 — semantic retrieval health for the existing diagnostics report. */
  probe: DiagnosticProbe;
  dispose: () => void;
}

export async function initMemory(deps: MemorySubsystemDeps): Promise<MemorySubsystem> {
  await memoryStore.load();
  await memoryAuditLog.load();

  // V8.2: wire the backend semantic source so recallSemantic can blend vector hits.
  // A6: through the resilient decorator, which adds a deadline (the raw client had
  // none, so a black-holed connection stalled recall until the 30 s IPC timeout at
  // `secureBridge.ts:26`), a breaker (MemoryView debounces at 200 ms, so a dead
  // backend was otherwise re-dialled on every keystroke), and classification. The
  // decorated function has the same `SemanticSearchFn` shape, so nothing downstream
  // changes — `configureSemantic` is still the one injection seam.
  const semantic = createResilientSemanticSearch(backendSemanticSearch, {
    // The store now absorbs semantic failures to serve a degraded answer, so this
    // is the only remaining place a failure can be recorded in the logs. Skips are
    // deliberately not logged: they are by design, and the probe reports them.
    // Failures are self-limiting — after three the breaker suspends the leg.
    onOutcome: (outcome) => {
      if (outcome.state !== 'failed') return;
      log.warn('semantic retrieval failed; recall degraded to lexical', {
        kind: outcome.kind,
        code: outcome.code,
        retryable: outcome.retryable,
        latencyMs: outcome.latencyMs,
        detail: outcome.detail,
      });
    },
  });
  memoryStore.configureSemantic(semantic.search);

  const rebuild = (): void => {
    const now = new Date().toISOString();
    const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
    // P2.5 — the ERP relationship model, guarded so memory rebuilds never fail if ERP isn't ready.
    let erpModel: ReturnType<typeof getRelationshipModel> | null = null;
    try {
      erpModel = getRelationshipModel();
    } catch (err) {
      log.warn('ERP relationship model unavailable for memory projection', { error: String(err) });
    }
    // P2.5 — UDM memory + ERP business memory in ONE projected set (single namespace, no parallel store).
    const items = [...projectMemory(entities, now), ...projectBusinessMemory(erpModel, now)];
    const result = memoryStore.applyProjected(items, now);
    log.info('AI memory rebuilt', { projected: items.length, ...result });
  };

  const safeRebuild = (): void => {
    try {
      rebuild();
    } catch (err) {
      log.error('Memory rebuild failed', { error: String(err) });
    }
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRebuild = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      safeRebuild();
    }, 800);
  };
  unifiedStore.on('changed', scheduleRebuild);
  // P2.5 — ERP record + connector-write events also re-project business memory.
  if (deps.on) deps.on(MEMORY_REBUILD_EVENTS, scheduleRebuild);
  const initialTimer = setTimeout(safeRebuild, 1600);

  const onChanged = (): void =>
    deps.broadcast(IpcChannel.MemoryEventBroadcast, memoryStore.counts());
  memoryStore.on('changed', onChanged);

  const execMemoryDeps: ConversationMemoryDeps = {
    remember: (i, n) => memoryStore.remember(i, n),
    recall: (q) => memoryStore.recall(q),
    get: (id) => memoryStore.get(id),
    forget: (ids) => memoryStore.forget(ids),
    update: (id, patch, n) => memoryStore.update(id, patch, n),
    audit: (e) => memoryAuditLog.record(e),
  };

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.MemoryRecall,
      schema: MemoryRecallRequest,
      handler: (p) => memoryStore.recall(p as TMemoryRecallRequest),
    },
    {
      channel: IpcChannel.MemorySemanticRecall,
      schema: MemoryRecallRequest,
      handler: (p) =>
        handleSemanticRecall(
          {
            recallSemantic: (query, orgId) => memoryStore.recallSemantic(query, orgId),
            recall: (query) => memoryStore.recall(query),
            getOrgId: () => runtimeIdentity.getCurrent()?.organizationId,
            // A6 raised this from `warn` to `error`. Pre-A6 it fired for every
            // backend hiccup, so `warn` was right — the noise was expected. Now
            // `recallSemantic` absorbs and labels every retrieval failure itself
            // (and the decorator above logs those), so anything that still
            // escapes to this backstop came from ranking or the store: a defect,
            // not a degradation, and it should not sit at the same level as a
            // transient 503.
            onSemanticError: (err) =>
              log.error('semantic recall threw past its own degradation path', {
                error: String(err),
              }),
          },
          p as TMemoryRecallRequest,
        ),
    },
    {
      channel: IpcChannel.MemoryGet,
      schema: MemoryGetRequest,
      handler: (p) => memoryStore.get((p as TMemoryGetRequest).id),
    },
    {
      channel: IpcChannel.MemoryRemember,
      schema: MemoryRememberRequest,
      handler: (p) => memoryStore.remember(p as TMemoryRememberRequest),
    },
    {
      channel: IpcChannel.MemoryForget,
      schema: MemoryForgetRequest,
      handler: (p) => ({ forgotten: memoryStore.forget((p as TMemoryForgetRequest).ids) }),
    },
    {
      channel: IpcChannel.MemoryBackfill,
      schema: EmptyRequest,
      handler: () =>
        runMemoryBackfill({
          listItems: () => memoryStore.allItems(),
          getOrgId: () => runtimeIdentity.getCurrent()?.organizationId,
          backfill: (orgId, memories) => backendBackfill(orgId, memories),
          onProgress: (p) => log.info('memory backfill progress', p),
        }),
    },
    { channel: IpcChannel.MemoryCounts, schema: EmptyRequest, handler: () => memoryStore.counts() },
    {
      channel: IpcChannel.MemoryRebuild,
      schema: EmptyRequest,
      handler: () => {
        rebuild();
        return memoryStore.counts();
      },
    },
    // ── Executive conversation memory (Memory panel) ──
    {
      channel: IpcChannel.ExecMemorySearch,
      schema: ExecMemorySearchRequest,
      handler: (p) => searchExecutiveMemories(execMemoryDeps, p as TExecMemorySearchRequest),
    },
    {
      channel: IpcChannel.ExecMemoryForget,
      schema: ExecMemoryForgetRequest,
      handler: (p) => ({
        forgotten: forgetMemory(execMemoryDeps, (p as TExecMemoryForgetRequest).id),
      }),
    },
    {
      channel: IpcChannel.ExecMemoryPin,
      schema: ExecMemoryPinRequest,
      handler: (p) =>
        pinMemory(
          execMemoryDeps,
          (p as TExecMemoryPinRequest).id,
          (p as TExecMemoryPinRequest).pinned,
        ),
    },
    {
      channel: IpcChannel.ExecMemoryResolve,
      schema: ExecMemoryResolveRequest,
      handler: (p) =>
        setDecisionStatus(
          execMemoryDeps,
          (p as TExecMemoryResolveRequest).id,
          (p as TExecMemoryResolveRequest).status,
        ),
    },
    {
      channel: IpcChannel.ExecMemoryAudit,
      schema: ExecMemoryAuditRequest,
      handler: (p) => memoryAuditLog.page(p as TExecMemoryAuditRequest),
    },
  ];

  log.info('AI memory initialized', memoryStore.counts());

  return {
    handlers,
    rebuild,
    // A6 — the tracker inside the decorator is the only live account of the
    // semantic leg's health, so the probe reads it directly rather than any
    // subsystem re-deriving one from logs.
    probe: retrievalProbe(semantic.health),
    dispose: () => {
      unifiedStore.off('changed', scheduleRebuild);
      memoryStore.off('changed', onChanged);
      if (timer) clearTimeout(timer);
      clearTimeout(initialTimer);
    },
  };
}
