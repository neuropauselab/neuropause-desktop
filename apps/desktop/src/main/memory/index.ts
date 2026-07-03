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
import { memoryAuditLog } from './memoryAuditInstance';
import { projectMemory } from './memoryProjector';

const log = createLogger('memory');

export interface MemorySubsystemDeps {
  broadcast: (channel: string, payload: unknown) => void;
}

export interface MemorySubsystem {
  handlers: SecureHandlerDef[];
  /** Re-index organizational memory on demand (Recovery Center). */
  rebuild: () => void;
  dispose: () => void;
}

export async function initMemory(deps: MemorySubsystemDeps): Promise<MemorySubsystem> {
  await memoryStore.load();
  await memoryAuditLog.load();

  const rebuild = (): void => {
    const now = new Date().toISOString();
    const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
    const items = projectMemory(entities, now);
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
    dispose: () => {
      unifiedStore.off('changed', scheduleRebuild);
      memoryStore.off('changed', onChanged);
      if (timer) clearTimeout(timer);
      clearTimeout(initialTimer);
    },
  };
}
