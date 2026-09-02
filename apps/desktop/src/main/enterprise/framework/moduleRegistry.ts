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
  DocumentApprovalResult,
  DocumentApprovalView,
  DocumentLinesResult,
  DocumentLinesView,
} from '@neuropause/shared';
import { randomUUID } from 'node:crypto';
import {
  EmptyRequest,
  FINANCE_MODULE_ID,
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
  ModuleApprovalRequest,
  ModuleApproveRequest,
  ModuleLinesRequest,
  ModuleSetLinesRequest,
  ORDERS_MODULE_ID,
  QUOTES_MODULE_ID,
  deriveRecordTitle,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../ipc/secureBridge';

/**
 * ERP Session 46 — the ORIGIN BOUNDARY for actions that now have a governed command equivalent.
 *
 * S43–S45 routed the O2C lifecycle actions (Ship / Generate-Invoice / Issue / Convert-Quote) through the
 * governed `platform:command.dispatch` spine, but the RENDERER routing is only a courtesy: the legacy
 * `enterprise:module.action` door still accepted those same verbs from any authorized dispatcher, so a
 * caller could bypass the journal/idempotency/event/outbox/audit by hitting the legacy channel directly.
 *
 * The fix is a SERVER-SIDE origin discriminator, never a renderer-provided flag:
 *   • `INTERNAL_ACTION_ORIGIN` is a per-process random token, module-private (NOT in `@neuropause/shared`,
 *     so no renderer/agent can import it) and unguessable.
 *   • The command bus (and only the command bus) passes it when it internally invokes `moduleAction` for a
 *     governed key — it calls `def.handler` DIRECTLY, so the token reaches the handler.
 *   • The renderer path is `ModuleActionRequest.parse()` at the secure bridge, and that schema is
 *     `.strict()`, so an `origin` field on a renderer request is REJECTED outright — the marker cannot be
 *     forged across the IPC boundary.
 * Result: the governed keys execute ONLY through the command bus; every external invocation is refused.
 */
export const INTERNAL_ACTION_ORIGIN = `internal:${randomUUID()}`;

/** Actions that MUST go through the governed command path — refused on the legacy door from an external caller. */
const GOVERNED_ONLY_ACTIONS: Record<string, ReadonlySet<string>> = {
  [ORDERS_MODULE_ID]: new Set(['ship', 'convertToInvoice']),
  [FINANCE_MODULE_ID]: new Set(['issue']),
  [QUOTES_MODULE_ID]: new Set(['convertToOrder']),
};
import { ENTERPRISE_CHANNEL_PERMISSIONS } from '../authzGate';
import type {
  EnterpriseModule,
  EnterpriseModuleActionContext,
  EnterpriseModuleContext,
} from './enterpriseModule';
import type { TenantScopeSource } from './enterpriseRecordStore';
import { registerTenantStore } from '../../tenancy/tenantOwnedStore';

type LifecycleAction = EnterpriseModuleLifecycleAction;

export class EnterpriseModuleRegistry {
  private readonly modules = new Map<string, EnterpriseModule>();
  /** The tenant boundary handed to every store that registers here. */
  private scopeSource: TenantScopeSource | null = null;

  /**
   * P13C ROUND 3 — PHASE 4. ONE registry entry standing for all 106 module stores.
   *
   * Registering 106 individual entries would be noise; what the gate needs to
   * know is whether ANY module store is unbound, and this registry already
   * answers that in `unscopedModules()`. So the predicate is "no module is
   * unscoped AND the registry itself has a source", which is stricter than
   * either half: an empty registry with no source would otherwise report bound
   * simply because it has nothing to be unbound.
   */
  constructor() {
    registerTenantStore(
      'enterprise-module-stores',
      () => this.scopeSource !== null && this.unscopedModules().length === 0,
    );
  }

  /**
   * Bind the tenant boundary for every module, present and future.
   *
   * THE SINGLE BINDING POINT. Every one of the 106 module stores passes through
   * `register`, so binding here covers all of them plus anything a plugin
   * registers later — instead of 106 factory signatures, each of which is a
   * chance to forget one and fail open.
   *
   * Called before the modules register. Anything registered before this runs
   * stays unbound, and an unbound store returns nothing, so the ordering
   * mistake is loud rather than silent.
   */
  bindScope(source: TenantScopeSource): void {
    this.scopeSource = source;
    // Re-bind anything already registered, so ordering is forgiving in the safe
    // direction: late binding still closes the boundary rather than leaving a
    // store permanently unscoped.
    for (const m of this.modules.values()) m.store.bindScope(source);
  }

  /** Register a module. Ids are unique; re-registering the same id throws. */
  register(module: EnterpriseModule): void {
    const id = module.descriptor.id;
    if (this.modules.has(id)) throw new Error(`Enterprise module "${id}" is already registered.`);
    if (this.scopeSource !== null) module.store.bindScope(this.scopeSource);
    this.modules.set(id, module);
  }

  /** Modules whose store has no tenant boundary. Should always be empty. */
  unscopedModules(): string[] {
    return [...this.modules.values()]
      .filter((m) => !m.store.hasScope())
      .map((m) => m.descriptor.id);
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

  /**
   * P13C ROUND 37 — GATE 16. Drain every module store's pending background
   * write. One registration on the shutdown barrier stands for all ~106
   * stores, same shape as the one registry entry standing for them above.
   */
  async flushAll(): Promise<void> {
    await Promise.allSettled([...this.modules.values()].map((m) => m.store.flush()));
  }

  /**
   * Descriptors + live counts.
   *
   * Returns EVERY module — this is the trusted internal view (dashboards,
   * companion families, aggregates). The IPC list channel filters this by the
   * CALLER's per-module read permission via `readableSummaries` (GATE 5 B-1):
   * the record count is a disclosure and must never name a module the caller
   * cannot read.
   */
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

  /**
   * GATE 5 — B-1. The summaries the CALLER is entitled to see, filtered by each
   * module's own declared read permission. The `EnterpriseModulesList` channel
   * is gated at the coarse `operations:read` (the right to use the enterprise
   * surface at all), but a module also declares its OWN read permission and its
   * record COUNT is a disclosure — "how many employees are there", "which
   * business systems does this company run" — exactly what `dp:exportable`
   * refuses. `dp:module.list`/`get` authorize per module one at a time; the LIST
   * applies the same gate. Deny-by-default: a thrown `authorize` omits the
   * module rather than surfacing it.
   */
  async readableSummaries(
    authorize: EnterpriseModuleContext['authorize'],
  ): Promise<EnterpriseModuleSummary[]> {
    const out: EnterpriseModuleSummary[] = [];
    for (const m of this.modules.values()) {
      try {
        authorize(m.descriptor.permissions.read);
      } catch {
        continue;
      }
      await m.store.load();
      out.push({
        ...m.descriptor,
        recordCount: m.store.count(),
        activeCount: m.store.count('active'),
        aiSummary: Boolean(m.hooks.summarize),
        actions: m.hooks.runAction ? (m.descriptor.actions ?? []) : [],
      });
    }
    /**
     * GATE 6 (round 49) — TOTAL FILTERING IS A REFUSAL, NOT AN EMPTY LIST.
     * With modules registered but NONE readable, returning `[]` made the
     * Business workspace render "No business areas yet — nothing is shown that
     * has no real backing", a lie on both counts: the modules exist, and the
     * reason they are invisible is permissions. Say so. (A genuinely empty
     * registry — no modules built in — still returns `[]` honestly.)
     */
    if (out.length === 0 && this.modules.size > 0) {
      throw new Error(
        'None of the business modules are readable with your current permissions.',
      );
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
  // AFTER the module's own reconciler: a posting refusal happens inside it.
  ctx.onAfterChange?.({ moduleId: id, record });
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
      // Gated at the coarse enterprise-reader permission here; each module is
      // ALSO filtered by its own read permission inside `summaries` (GATE 5
      // B-1), so the list — and its record counts — never names a module the
      // caller cannot read.
      permission: ENTERPRISE_CHANNEL_PERMISSIONS[IpcChannel.EnterpriseModulesList],
      handler: () => registry.readableSummaries((p) => ctx.authorize(p)),
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
        /**
         * THE approval gate.
         *
         * A document's business status — draft → approved → sent → received —
         * lives in its `status` FIELD, not in the record's lifecycle status
         * (which is only active/archived/deleted). So the transition an
         * approval policy governs arrives here, on update, not on
         * `setStatus`. Gating the other channel would compile, read
         * plausibly, and never once fire.
         *
         * Only a CHANGE is gated: re-saving a document that is already
         * approved must not demand approval again.
         */
        const nextStatus = result.values.status;
        if (
          ctx.canEnterStatus &&
          typeof nextStatus === 'string' &&
          nextStatus !== current.fields.status
        ) {
          const verdict = ctx.canEnterStatus(r.moduleId, current, nextStatus);
          if (!verdict.allowed) {
            const raised = ctx.onApprovalRequired?.({
              moduleId: r.moduleId,
              record: current,
              status: nextStatus,
              reason: verdict.reason ?? 'Approval required.',
            });
            return {
              ok: false as const,
              errors: { status: verdict.reason ?? 'Approval required.' },
              ...(raised?.holdId ? { holdId: raised.holdId } : {}),
            };
          }
        }
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
        // S55 — 'deleted' via SetStatus was a SECOND delete door: it skipped the Delete
        // door's dependency assessment, refusal-without-force, and decision record while
        // producing the same terminal state and the same downstream GL-reversal
        // consequences. One governed delete path exists; this door refuses and points at
        // it (measured: no production or test caller used SetStatus-'deleted' — the
        // refusal strands nothing).
        if (r.status === 'deleted') {
          return {
            ok: false as const,
            errors: { _: 'Deletion goes through the Delete door (it assesses dependencies and records the decision) — not through a status change.' },
          };
        }
        // APPROVAL GATE. This is where a purchase order becomes "approved" or a
        // bill becomes "paid", and until now it went straight to the store: the
        // approval/SoD engine existed, declared policies for these very
        // statuses, and was never consulted by anything. A document's own
        // creator could wave it through in one click.
        //
        // A refusal here is a HOLD, not an error — the request is understood
        // and legitimate, it simply is not authorised yet, and the composition
        // root turns that into a durable item someone can act on.
        const existing = module.store.get(r.id);
        if (existing && ctx.canEnterStatus) {
          const verdict = ctx.canEnterStatus(r.moduleId, existing, r.status);
          if (!verdict.allowed) {
            const raised = ctx.onApprovalRequired?.({
              moduleId: r.moduleId,
              record: existing,
              status: r.status,
              reason: verdict.reason ?? 'Approval required.',
            });
            return {
              ok: false as const,
              errors: { _: verdict.reason ?? 'Approval required.' },
              ...(raised?.holdId ? { holdId: raised.holdId } : {}),
            };
          }
        }
        const record = module.store.setStatus(r.id, r.status, {
          actor: ctx.actor(),
          now: ctx.now(),
        });
        if (!record) return { ok: false as const, errors: { _: 'Invalid status transition.' } };
        // 'deleted' is refused above, so this door only ever fans status_changed —
        // the compiler proves the old 'deleted' branch unreachable.
        await fan(module, 'status_changed', record);
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
        const existing = module.store.get(r.id);
        if (!existing || existing.status === 'deleted') {
          return { ok: false as const, errors: { _: 'Record not found.' } };
        }
        // Governed delete: assess dependencies BEFORE mutating. A record with
        // real relationship links refuses without an explicit force flag and
        // returns the evidence instead -- deleting a customer that invoices
        // point at silently breaks those links, and the person deleting must
        // see that before it happens, not after.
        const assessment = ctx.assessDelete?.(r.moduleId, existing) ?? null;
        const requestedAction = `Delete ${module.descriptor.singular.toLowerCase()} "${existing.title}"`;
        const subject = `${r.moduleId}/${existing.id} (${existing.title})`;
        if (assessment && assessment.risk !== 'supported' && r.force !== true) {
          // HOLD, not failure. Nothing mutated, the evidence goes back to the
          // caller, and the returned hold id is what makes the pause outlive
          // the dialog: the person who can clear it may not be this person.
          const recorded = ctx.recordDecision?.({
            requestedAction,
            subject,
            assessment,
            outcome: 'cancelled',
            executed: 'Nothing — the delete was refused pending acknowledgement.',
          });
          return {
            ok: false as const,
            assessment,
            holdId: recorded?.holdId ?? null,
          };
        }
        const record = module.store.softDelete(r.id, { actor: ctx.actor(), now: ctx.now() });
        if (!record) return { ok: false as const, errors: { _: 'Record not found.' } };
        if (assessment) {
          ctx.recordDecision?.({
            requestedAction,
            subject,
            assessment,
            outcome: 'proceeded',
            executed:
              'Soft-deleted despite the assessment (force acknowledged); the record is retained and recoverable.',
          });
        }
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
        // ERP Session 46 — the ORIGIN BOUNDARY. A now-governed action executes ONLY through the command
        // bus, which passes `INTERNAL_ACTION_ORIGIN` by calling this handler directly. An EXTERNAL caller
        // (renderer / agent / REST — whose payload was `.strict()`-parsed at the bridge and therefore
        // CANNOT carry an `origin` field) is refused, so the governed journal/idempotency/event/outbox/
        // audit path is the only way to perform it. RBAC still applied above; this is an ADDITIONAL gate.
        if (
          GOVERNED_ONLY_ACTIONS[r.moduleId]?.has(r.action) &&
          (p as { origin?: unknown }).origin !== INTERNAL_ACTION_ORIGIN
        ) {
          return { ok: false, error: `"${r.action}" must be performed through its governed command, not the legacy action door.` };
        }
        await module.store.load();
        const record = module.store.get(r.id);
        if (!record || record.status === 'deleted') return { ok: false, error: 'Record not found.' };
        const result = await module.hooks.runAction(r.action, record, actionCtx);
        // A POLICY refusal is a hold, not an error string. Only the module
        // knows which of its refusals is which, so it declares it; the
        // framework never guesses from a message.
        if (!result.ok && result.policy) {
          ctx.onPolicyConflict?.({
            moduleId: r.moduleId,
            record,
            action: r.action,
            policy: result.policy,
          });
        }
        return result;
      },
    },

    /* ── ERP document layer ───────────────────────────────────────────────
     * The engines behind these have existed and been registered for some
     * time; what was missing was any way to reach them. Without a channel,
     * lines could never be entered, every derived total was 0, the
     * three-way match had nothing to match, and four posting rules (GRNI,
     * COGS, material issue, production completion) refused for want of
     * costed lines. One channel pair unblocks all of it.
     *
     * `documents` is optional on the context: a registry composed without
     * the document integration (as every existing test does) keeps working
     * and simply reports the module as unsupported.
     */
    {
      channel: IpcChannel.EnterpriseModuleLines,
      schema: ModuleLinesRequest,
      requireAuth: true,
      handler: async (p): Promise<DocumentLinesView> => {
        const r = p as ModuleLinesRequest;
        const module = resolve(registry, r.moduleId);
        ctx.authorize(module.descriptor.permissions.read);
        await module.store.load();
        /**
         * P11 — THE SCOPED READ IS THE GATE, and this channel was missing it.
         *
         * Its three siblings — SetLines, Approval, Approve — all resolve the
         * record through `store.get(id)` first and bail on null. This one went
         * straight to the line store, which has no tenant field at all and
         * filters on `documentType + documentId` over one global array. So a
         * caller holding the module's read scope in their OWN tenant could pass
         * another tenant's document id and receive its line items: descriptions,
         * quantities, unit prices, discounts, tax, currency.
         *
         * Worse on an upgraded install: a pre-P11 record has no owner, so
         * `store.get` denies it to everyone — and its lines were still readable
         * by anyone. Records the migration says nobody can see.
         *
         * The ids were not a guessing problem either: the audit trail is not
         * workspace-filtered on read and every mutation records the record id
         * and title, so one `governance:read` call harvested them.
         */
        if (module.store.get(r.id) === null) return UNSUPPORTED_LINES;
        return ctx.documents?.linesView(r.moduleId, r.id) ?? UNSUPPORTED_LINES;
      },
    },
    {
      channel: IpcChannel.EnterpriseModuleSetLines,
      schema: ModuleSetLinesRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<DocumentLinesResult> => {
        const r = p as ModuleSetLinesRequest;
        const module = resolve(registry, r.moduleId);
        ctx.authorize(module.descriptor.permissions.write);
        await module.store.load();
        const record = module.store.get(r.id);
        if (!record || record.status === 'deleted') {
          return { ok: false, errors: [{ lineNo: 0, errors: ['Record not found.'] }], view: null };
        }
        if (!ctx.documents) {
          return {
            ok: false,
            errors: [{ lineNo: 0, errors: ['Line items are not available in this build.'] }],
            view: null,
          };
        }
        const result = await ctx.documents.setLines(r.moduleId, r.id, r.lines);
        // Totals are DERIVED from lines, so a line change is a change to the
        // document as far as every downstream reader is concerned. Fanning the
        // lifecycle event is what makes the list refresh and the audit trail
        // record that the document's value moved.
        if (result.ok) await fan(module, 'updated', record);
        return result;
      },
    },
    {
      channel: IpcChannel.EnterpriseModuleApproval,
      schema: ModuleApprovalRequest,
      requireAuth: true,
      handler: async (p): Promise<DocumentApprovalView> => {
        const r = p as ModuleApprovalRequest;
        const module = resolve(registry, r.moduleId);
        ctx.authorize(module.descriptor.permissions.read);
        await module.store.load();
        const record = module.store.get(r.id);
        if (!record || !ctx.documents) return NOT_REQUIRED_APPROVAL;
        return ctx.documents.approvalView(r.moduleId, record);
      },
    },
    {
      channel: IpcChannel.EnterpriseModuleApprove,
      schema: ModuleApproveRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<DocumentApprovalResult> => {
        const r = p as ModuleApproveRequest;
        const module = resolve(registry, r.moduleId);
        // Deciding an approval is a write against the document, so it takes
        // the module's write scope. Role eligibility and segregation of duties
        // are enforced separately, inside the engine — RBAC says "may act on
        // this module", SoD says "may not act on THIS document".
        ctx.authorize(module.descriptor.permissions.write);
        await module.store.load();
        const record = module.store.get(r.id);
        if (!record || record.status === 'deleted') {
          return { ok: false, error: 'Record not found.', approval: null };
        }
        if (!ctx.documents) {
          return { ok: false, error: 'Approvals are not available in this build.', approval: null };
        }
        return ctx.documents.decide(r.moduleId, record, r.stepId, r.decision, r.note);
      },
    },
  ];
}

/** A module with no document spec: not a line-item document at all. */
const UNSUPPORTED_LINES: DocumentLinesView = {
  supported: false,
  documentType: null,
  editPermission: null,
  lines: [],
  totals: null,
};

/** A document type with no approval policy. Distinct from "not yet approved". */
const NOT_REQUIRED_APPROVAL: DocumentApprovalView = {
  required: false,
  state: 'not_required',
  amount: 0,
  requiredSteps: [],
  satisfiedStepIds: [],
  nextStep: null,
  reasons: [],
  decisions: [],
  canDecide: false,
  blockedReason: null,
  gatedStatuses: [],
};
