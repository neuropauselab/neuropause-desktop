/**
 * EnterpriseModuleRegistry — the composition point every ERP module plugs into,
 * and the generic IPC surface they all share.
 *
 * `buildModuleHandlers` produces ONE set of `enterprise:module.*` handlers that
 * serve every registered module (the module is resolved from the payload). Each
 * mutation automatically:
 *   • authorizes against the module's declared read/write permission (RBAC),
 *   • validates + coerces the input via the module's descriptor,
 *   • persists through the module's record store,
 *   • records an enterprise audit entry,
 *   • publishes a platform event → Timeline + Executive Center,
 *   • broadcasts the change to the renderer.
 *
 * That is the entire point of the framework: a module author writes a descriptor
 * and a store; all of the above is inherited, not re-implemented.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleActionResult,
  EnterpriseModuleLifecycleAction,
  EnterpriseModuleSummary,
  EnterpriseRecordSummary,
  ModuleActionRequest as TAction,
  ModuleCreateRequest as TCreate,
  ModuleDeleteRequest as TDelete,
  ModuleGetRequest as TGet,
  ModuleListRequest as TList,
  ModuleSearchRequest as TSearch,
  ModuleSetStatusRequest as TSetStatus,
  ModuleSummarizeRequest as TSummarize,
  ModuleUpdateRequest as TUpdate,
  PlatformEventInput,
} from '@neuropause/shared';
import {
  EmptyRequest,
  IpcChannel,
  ModuleActionRequest,
  ModuleCreateRequest,
  ModuleDeleteRequest,
  ModuleGetRequest,
  ModuleListRequest,
  ModuleSearchRequest,
  ModuleSetStatusRequest,
  ModuleSummarizeRequest,
  ModuleUpdateRequest,
  deriveRecordTitle,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { ENTERPRISE_CHANNEL_PERMISSIONS } from '../authzGate';
import type {
  EnterpriseModule,
  EnterpriseModuleActionContext,
  EnterpriseModuleContext,
} from './enterpriseModule';

type LifecycleAction = EnterpriseModuleLifecycleAction;

export class EnterpriseModuleRegistry {
  private readonly modules = new Map<string, EnterpriseModule>();

  /** Register a module. Ids are unique; re-registering the same id throws. */
  register(module: EnterpriseModule): void {
    const id = module.descriptor.id;
    if (this.modules.has(id)) throw new Error(`Enterprise module "${id}" is already registered.`);
    this.modules.set(id, module);
  }

  get(id: string): EnterpriseModule | null {
    return this.modules.get(id) ?? null;
  }

  list(): EnterpriseModule[] {
    return [...this.modules.values()];
  }

  size(): number {
    return this.modules.size;
  }

  /** Descriptors + live counts for the registry-list channel. */
  async summaries(): Promise<EnterpriseModuleSummary[]> {
    const out: EnterpriseModuleSummary[] = [];
    for (const m of this.modules.values()) {
      await m.store.load();
      out.push({
        ...m.descriptor,
        recordCount: m.store.count(),
        activeCount: m.store.count('active'),
        aiSummary: Boolean(m.hooks.summarize),
        actions: m.hooks.runAction ? (m.descriptor.actions ?? []) : [],
      });
    }
    return out;
  }
}

const PLATFORM_TYPE: Record<LifecycleAction, PlatformEventInput['type']> = {
  created: 'enterprise.record.created',
  updated: 'enterprise.record.updated',
  status_changed: 'enterprise.record.status_changed',
  deleted: 'enterprise.record.deleted',
  converted: 'enterprise.record.converted',
};

const ACTION_VERB: Record<LifecycleAction, string> = {
  created: 'Created',
  updated: 'Updated',
  status_changed: 'Changed status of',
  deleted: 'Deleted',
  converted: 'Converted',
};

/**
 * The single seam where a persisted record change fans out to audit, the
 * platform timeline, the renderer broadcast, and the module's own hook. The
 * `onChange` hook is awaited (with the shared action context) so a cross-module
 * reconciliation completes before the originating mutation returns.
 */
async function emitLifecycle(
  ctx: EnterpriseModuleContext,
  actionCtx: EnterpriseModuleActionContext,
  module: EnterpriseModule,
  action: LifecycleAction,
  record: EnterpriseEntity,
): Promise<void> {
  const { id, singular } = { id: module.descriptor.id, singular: module.descriptor.singular };
  ctx.audit({
    action: `module.${id}.${action}`,
    target: record.id,
    summary: `${ACTION_VERB[action]} ${singular} "${record.title}"`,
  });
  ctx.publish?.({
    type: PLATFORM_TYPE[action],
    category: 'enterprise',
    source: `enterprise:${id}`,
    actor: { kind: 'user', id: ctx.actor() },
    resource: { type: id, id: record.id, name: record.title },
    priority: action === 'deleted' ? 'high' : 'normal',
    metadata: { status: record.status, rev: record.rev, kind: record.kind },
  });
  ctx.broadcast(IpcChannel.EnterpriseModuleEventBroadcast, {
    moduleId: id,
    action,
    id: record.id,
    at: record.updatedAt,
  });
  await module.hooks.onChange?.({ action, record }, actionCtx);
}

function resolve(registry: EnterpriseModuleRegistry, moduleId: string): EnterpriseModule {
  const module = registry.get(moduleId);
  if (!module) throw new Error(`Unknown enterprise module: "${moduleId}".`);
  return module;
}

/**
 * Build the generic `enterprise:module.*` handlers. Registered ONCE at boot;
 * they serve every module registered before or after (modules are resolved per
 * call), so a module added later needs no new IPC wiring.
 */
/**
 * Build the shared action/onChange context and the lifecycle fan-out bound to it.
 *
 * Extracted so the fan-out has exactly ONE definition. It was previously inline
 * in `buildModuleHandlers`, which meant any other producer of records — the Data
 * Plane importer, for one — had no way to reach it and its records were
 * invisible to audit, to the renderer broadcast and to every module's `onChange`.
 */
export function createLifecycleEmitter(
  registry: EnterpriseModuleRegistry,
  ctx: EnterpriseModuleContext,
  correlationId?: string,
): {
  actionCtx: EnterpriseModuleActionContext;
  emit: (module: EnterpriseModule, action: LifecycleAction, record: EnterpriseEntity) => Promise<void>;
} {
  const actionCtx: EnterpriseModuleActionContext = {
    actor: ctx.actor,
    now: ctx.now,
    authorize: ctx.authorize,
    moduleFor: (id) => registry.get(id),
    emit: (m, action, rec) => {
      void emitLifecycle(ctx, actionCtx, m, action, rec);
    },
    ...(correlationId === undefined ? {} : { correlationId }),
  };
  return {
    actionCtx,
    emit: (module, action, record) => emitLifecycle(ctx, actionCtx, module, action, record),
  };
}

/** One import's records, replayed through the module lifecycle. */
export interface ImportedRecordsNotification {
  moduleId: string;
  recordIds: readonly string[];
  /** Ties every emitted event back to the import that produced it. */
  correlationId: string;
}

export interface ImportedRecordsResult {
  moduleId: string;
  /** Records that completed the full fan-out. */
  notified: number;
  /** Ids no longer present in the store (deleted between import and replay). */
  missing: number;
  /** A hook that threw. The import is NOT failed by this — it already happened. */
  failed: { recordId: string; message: string }[];
}

/**
 * Replay imported records through the SAME lifecycle a user-created record takes.
 *
 * Without this, importing 500 invoices leaves every open view stale, writes
 * nothing to the audit trail per record, and silently skips the reconcilers that
 * make the ERP consistent — the records exist in the store and nothing in the
 * system knows.
 *
 * Deliberately sequential: a reconciler may write to another module, and running
 * hundreds of them concurrently would race those writes against each other.
 * Deliberately non-throwing: the records are already persisted, so a failing
 * hook is reported, not allowed to unwind an import that has already succeeded.
 */
export async function notifyImportedRecords(
  registry: EnterpriseModuleRegistry,
  ctx: EnterpriseModuleContext,
  event: ImportedRecordsNotification,
): Promise<ImportedRecordsResult> {
  const module = registry.get(event.moduleId);
  if (!module) {
    return { moduleId: event.moduleId, notified: 0, missing: event.recordIds.length, failed: [] };
  }

  const { emit } = createLifecycleEmitter(registry, ctx, event.correlationId);
  const result: ImportedRecordsResult = { moduleId: event.moduleId, notified: 0, missing: 0, failed: [] };

  for (const recordId of event.recordIds) {
    const record = module.store.get(recordId);
    if (!record) {
      result.missing += 1;
      continue;
    }
    try {
      await emit(module, 'created', record);
      result.notified += 1;
    } catch (err) {
      result.failed.push({ recordId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

export function buildModuleHandlers(
  registry: EnterpriseModuleRegistry,
  ctx: EnterpriseModuleContext,
): SecureHandlerDef[] {
  // One shared action/onChange context: lets record actions and `onChange`
  // reconcilers reach other modules (`moduleFor`) and fan out their lifecycle
  // (`emit`), reusing the same identity + RBAC gate as the request.
  const { actionCtx, emit } = createLifecycleEmitter(registry, ctx);
  const fan = (module: EnterpriseModule, action: LifecycleAction, record: EnterpriseEntity) =>
    emit(module, action, record);
  return [
    {
      channel: IpcChannel.EnterpriseModulesList,
      schema: EmptyRequest,
      requireAuth: true,
      // Metadata-only listing of available modules — any enterprise reader.
      permission: ENTERPRISE_CHANNEL_PERMISSIONS[IpcChannel.EnterpriseModulesList],
      handler: () => registry.summaries(),
    },
    {
      channel: IpcChannel.EnterpriseModuleList,
      schema: ModuleListRequest,
      requireAuth: true,
      handler: async (p) => {
        const r = p as TList;
        const module = resolve(registry, r.moduleId);
        ctx.authorize(module.descriptor.permissions.read);
        await module.store.load();
        return module.store.list({ status: r.status, search: r.search, limit: r.limit });
      },
    },
    {
      channel: IpcChannel.EnterpriseModuleGet,
      schema: ModuleGetRequest,
      requireAuth: true,
      handler: async (p) => {
        const r = p as TGet;
        const module = resolve(registry, r.moduleId);
        ctx.authorize(module.descriptor.permissions.read);
        await module.store.load();
        return module.store.get(r.id);
      },
    },
    {
      channel: IpcChannel.EnterpriseModuleSearch,
      schema: ModuleSearchRequest,
      requireAuth: true,
      handler: async (p) => {
        const r = p as TSearch;
        const module = resolve(registry, r.moduleId);
        ctx.authorize(module.descriptor.permissions.read);
        await module.store.load();
        return module.store.search(r.query, r.limit);
      },
    },
    {
      channel: IpcChannel.EnterpriseModuleSummarize,
      schema: ModuleSummarizeRequest,
      requireAuth: true,
      handler: async (p): Promise<EnterpriseRecordSummary | null> => {
        const r = p as TSummarize;
        const module = resolve(registry, r.moduleId);
        ctx.authorize(module.descriptor.permissions.read);
        await module.store.load();
        const record = module.store.get(r.id);
        if (!record || record.status === 'deleted') return null;
        if (module.hooks.summarize) return module.hooks.summarize(record);
        // Modules without an AI hook still answer, honestly, with a plain summary.
        return {
          moduleId: module.descriptor.id,
          recordId: record.id,
          headline: record.title,
          summary: `No AI summary is available for ${module.descriptor.plural}.`,
          risk: 'low',
          riskReason: 'Not assessed.',
          executiveExplanation: '',
          grounded: false,
          model: 'none',
        };
      },
    },
    {
      channel: IpcChannel.EnterpriseModuleCreate,
      schema: ModuleCreateRequest,
      requireAuth: true,
      audit: true,
      handler: async (p) => {
        const r = p as TCreate;
        const module = resolve(registry, r.moduleId);
        ctx.authorize(module.descriptor.permissions.write);
        await module.store.load();
        const result = module.hooks.validate({
          title: r.title,
          fields: r.fields,
          tags: r.tags,
          metadata: r.metadata,
        });
        if (!result.ok) return { ok: false as const, errors: result.errors };
        const title = deriveRecordTitle(module.descriptor, result.values, r.title);
        const record = module.store.create({
          title,
          fields: result.values,
          tags: r.tags,
          metadata: r.metadata,
          actor: ctx.actor(),
          now: ctx.now(),
        });
        await fan(module, 'created', record);
        return { ok: true as const, record };
      },
    },
    {
      channel: IpcChannel.EnterpriseModuleUpdate,
      schema: ModuleUpdateRequest,
      requireAuth: true,
      audit: true,
      handler: async (p) => {
        const r = p as TUpdate;
        const module = resolve(registry, r.moduleId);
        ctx.authorize(module.descriptor.permissions.write);
        await module.store.load();
        const current = module.store.get(r.id);
        if (!current || current.status === 'deleted')
          return { ok: false as const, errors: { _: 'Record not found.' } };
        // Validate the MERGED field set so required constraints still hold.
        // `recordId` identifies the record being edited so a uniqueness check in
        // a module's `validate` hook can exclude the record from its own search.
        const merged = { ...current.fields, ...(r.fields ?? {}) };
        const result = module.hooks.validate({
          title: r.title ?? current.title,
          fields: merged,
          tags: r.tags,
          metadata: r.metadata,
          recordId: r.id,
        });
        if (!result.ok) return { ok: false as const, errors: result.errors };
        const title = deriveRecordTitle(module.descriptor, result.values, r.title ?? current.title);
        const record = module.store.update(r.id, {
          title,
          fields: result.values,
          tags: r.tags,
          metadata: r.metadata,
          actor: ctx.actor(),
          now: ctx.now(),
        });
        if (!record) return { ok: false as const, errors: { _: 'Record not found.' } };
        await fan(module, 'updated', record);
        return { ok: true as const, record };
      },
    },
    {
      channel: IpcChannel.EnterpriseModuleSetStatus,
      schema: ModuleSetStatusRequest,
      requireAuth: true,
      audit: true,
      handler: async (p) => {
        const r = p as TSetStatus;
        const module = resolve(registry, r.moduleId);
        ctx.authorize(module.descriptor.permissions.write);
        await module.store.load();
        const record = module.store.setStatus(r.id, r.status, {
          actor: ctx.actor(),
          now: ctx.now(),
        });
        if (!record) return { ok: false as const, errors: { _: 'Invalid status transition.' } };
        await fan(module, r.status === 'deleted' ? 'deleted' : 'status_changed', record);
        return { ok: true as const, record };
      },
    },
    {
      channel: IpcChannel.EnterpriseModuleDelete,
      schema: ModuleDeleteRequest,
      requireAuth: true,
      audit: true,
      handler: async (p) => {
        const r = p as TDelete;
        const module = resolve(registry, r.moduleId);
        ctx.authorize(module.descriptor.permissions.write);
        await module.store.load();
        const record = module.store.softDelete(r.id, { actor: ctx.actor(), now: ctx.now() });
        if (!record) return { ok: false as const, errors: { _: 'Record not found.' } };
        await fan(module, 'deleted', record);
        return { ok: true as const, record };
      },
    },
    {
      channel: IpcChannel.EnterpriseModuleAction,
      schema: ModuleActionRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<EnterpriseModuleActionResult> => {
        const r = p as TAction;
        const module = resolve(registry, r.moduleId);
        // The action mutates the acting module — require its write scope. A
        // cross-module action (e.g. conversion) may assert further scopes via
        // `actionCtx.authorize`.
        ctx.authorize(module.descriptor.permissions.write);
        if (!module.hooks.runAction || !(module.descriptor.actions ?? []).some((a) => a.key === r.action)) {
          return { ok: false, error: `Unknown action "${r.action}".` };
        }
        await module.store.load();
        const record = module.store.get(r.id);
        if (!record || record.status === 'deleted') return { ok: false, error: 'Record not found.' };
        return module.hooks.runAction(r.action, record, actionCtx);
      },
    },
  ];
}
