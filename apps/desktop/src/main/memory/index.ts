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
import { withMemoryAuthz } from './memoryAuthzGate';
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
import { activeMemoryViewer, activeTenantScope } from '../enterprise';
import type { BackgroundPrincipal } from '../tenancy/backgroundPrincipal';
import { runAsPrincipal, tenantPrincipal } from '../tenancy/backgroundPrincipal';
import { memoryMaySync } from '@neuropause/shared';
import { memoryAuditLog } from './memoryAuditInstance';
import { projectMemory } from './memoryProjector';
import { projectBusinessMemory } from './businessMemoryProjector';
import { getRelationshipModel } from '../enterprise/relationshipProvider';
import type { PlatformEventType } from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { runOutsidePrincipal } from '../tenancy/backgroundPrincipal';
import type { TenantScope } from '@neuropause/shared';
import { registerShutdownFlush } from '../shutdownFlush';

const log = createLogger('memory');

/** The job identity every principal this subsystem's reprojection mints carries. */
const REBUILD_JOB_ID = 'memory-reprojection';

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
  /**
   * The tenant boundary for the AUDIT LOG. P13C Round 7.
   *
   * Injected, not imported — importing `activeTenantScope` here drags Electron
   * into this subsystem's node tests. Required, because the store it binds went
   * from "no boundary at all" to "denies when unbound", and an optional binding
   * is a boundary somebody forgets.
   */
  scope: () => TenantScope | null;
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
  // GATE 16 (round 46) — these stores coalesce writes in memory; drain them on the
  // shutdown/suspend barrier so a quit or lid close never loses the last mutation.
  registerShutdownFlush('memory-stores', async () => {
    await Promise.allSettled([memoryStore.flush(), memoryAuditLog.flush()]);
  });
  // P13C Round 7 — the audit trail carries assistant-written record titles.
  memoryAuditLog.bindScope(deps.scope);
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

  /**
   * P13C — the projection runs UNDER A PRINCIPAL, or not at all.
   *
   * The graph reprojection already gated on a resolved tenant; this one did
   * not, and relied entirely on the store's binding. That is a real
   * difference: `applyProjected` THROWS without a viewer, so an ungated
   * rebuild turned "no tenant is active" into a caught-and-logged error on a
   * timer rather than a decision.
   *
   * This is the IMMEDIATE path — the `memory:rebuild` channel and the Recovery
   * Center — where the caller IS the request and resolving the tenant here is
   * resolving it at the only moment there is. The DEBOUNCED path does not share
   * that property and does not share this function; see `enqueueRebuild`.
   */
  const rebuild = (): void => {
    const principal = tenantPrincipal({ jobId: REBUILD_JOB_ID, scope: activeTenantScope() });
    if (principal === null) {
      log.info('Memory rebuild skipped: no organization is active');
      return;
    }
    runAsPrincipal(principal, () => rebuildUnderPrincipal());
  };

  const rebuildUnderPrincipal = (): void => {
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

  /**
   * ONE QUEUED REPROJECTION. P13C ROUND 10 — NEW-M10.
   *
   * The principal is a FIELD on the queue item, not something the drain works
   * out. That ordering is the whole point of `tenancy/backgroundPrincipal.ts`,
   * which states it as the contract: "the principal is captured by the CALLER,
   * at the moment the job is scheduled or enqueued — not resolved inside `fn`".
   */
  interface QueuedReprojection {
    /** WHO THIS REPROJECTION IS FOR, decided when the store change arrived. */
    principal: BackgroundPrincipal;
    /** The tenant, restated from the principal for logging and tests. */
    tenantId: string;
    /** The workspace, or '' for tenant-wide. */
    workspaceId: string;
    /** WHAT asked for it — the store change, or an ERP/connector event. */
    operation: string;
    enqueuedAt: string;
  }

  /**
   * KEYED BY TENANT + WORKSPACE, and that is not an optimization.
   *
   * The debounce holds ONE timer. Two organizations' stores can both change
   * inside the same 800 ms window — a fanned-out sync writes A's records and
   * then B's — and coalescing those into a single job would mean choosing which
   * tenant's reprojection to run and silently dropping the other's. A map keyed
   * by owner coalesces WITHIN a tenant, which is what a debounce is for, and
   * never ACROSS one.
   */
  const pendingReprojections = new Map<string, QueuedReprojection>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * THE ENQUEUE. Resolves the tenant HERE, where the caller's context is the
   * right one.
   *
   * The comment this replaces claimed the rebuild "reads and stamps the same
   * tenant even if the user switches organizations while it is queued". It did
   * not: `tenantPrincipal({ scope: activeTenantScope() })` ran INSIDE the 800 ms
   * `setTimeout` callback, so the tenant was resolved at DRAIN, and a switch
   * inside the debounce window made A's store change reproject as B. The
   * destinations are owner-scoped, so no cross-tenant write was reachable — the
   * defect was that the work ran for the wrong tenant and the comment asserted
   * the opposite of the code.
   *
   * Null means the change arrived with no tenant resolvable. Such a change is
   * DROPPED rather than queued, because there is no tenant to reproject for —
   * the same fail-closed rule `workforce/runtime/scheduler.ts` applies to a job
   * enqueued while signed out.
   */
  const enqueueRebuild = (operation: string): void => {
    const principal = tenantPrincipal({ jobId: REBUILD_JOB_ID, scope: activeTenantScope() });
    if (principal === null) {
      log.info('Memory reprojection not queued: no organization is active', { operation });
      return;
    }
    const workspaceId = principal.workspaceId ?? '';
    const key = `${principal.tenantId}::${workspaceId}`;
    if (!pendingReprojections.has(key)) {
      pendingReprojections.set(key, {
        principal,
        tenantId: principal.tenantId as string,
        workspaceId,
        operation,
        enqueuedAt: new Date().toISOString(),
      });
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      drainReprojections();
    }, 800);
  };

  /**
   * THE DRAIN. Runs each queued item under ITS OWN captured principal.
   *
   * Nothing here reads `activeTenantScope()`. That is what makes the timer
   * harmless: which organization is on screen when it fires is no longer an
   * input to the answer. One tenant's failure does not cancel the next one's.
   */
  const drainReprojections = (): void => {
    const items = [...pendingReprojections.values()];
    pendingReprojections.clear();
    for (const item of items) {
      try {
        runAsPrincipal(item.principal, () => rebuildUnderPrincipal());
      } catch (err) {
        log.error('Memory rebuild failed', {
          tenantId: item.tenantId,
          operation: item.operation,
          error: String(err),
        });
      }
    }
  };

  const onUnifiedChanged = (): void => enqueueRebuild('unified-store:changed');
  const onPlatformRebuildEvent = (): void => enqueueRebuild('platform-event:record-changed');
  unifiedStore.on('changed', onUnifiedChanged);
  // P2.5 — ERP record + connector-write events also re-project business memory.
  // The handler runs inside `bus.publish`, so the publishing principal is still
  // in scope and the capture above names the event's own tenant.
  if (deps.on) deps.on(MEMORY_REBUILD_EVENTS, onPlatformRebuildEvent);
  /**
   * The boot projection. Deliberately NOT queued: it is armed before any store
   * change exists, so there is no enqueue moment distinct from the fire moment,
   * and resolving at fire is resolving at the only time there is.
   */
  const initialTimer = setTimeout(safeRebuild, 1600);

  /**
   * P13C ROUND 7 — COMPUTED FOR THE VIEWER, NOT FOR THE JOB.
   *
   * THE CLASS: a background pass runs as tenant A while the window in front of
   * the user is showing tenant B. Any value computed for the RENDERER during
   * that pass is computed under A's principal, so a correctly-scoped store
   * honestly answers for A — and the answer is delivered into B's window.
   *
   * The store is not the defect. The store is right, which is exactly why this
   * survived seven rounds of auditing stores: every isolation test on it passes,
   * because the boundary holds and the READER is standing on the wrong side of
   * it.
   *
   * `runOutsidePrincipal` exists for precisely this and had ONE caller in the
   * whole main process (the unread badge), with a comment describing the general
   * case. This is the general case, in the five other places it occurs.
   *
   * It grants nothing: leaving the principal falls back to the SESSION, so the
   * value is what the signed-in viewer is entitled to and never more.
   */
  const onChanged = (): void =>
    deps.broadcast(IpcChannel.MemoryEventBroadcast, runOutsidePrincipal(() => memoryStore.counts()));
  memoryStore.on('changed', onChanged);

  const execMemoryDeps: ConversationMemoryDeps = {
    remember: (i, n) => memoryStore.remember(i, n),
    recall: (q) => memoryStore.recall(q),
    get: (id) => memoryStore.get(id),
    forget: (ids) => memoryStore.forget(ids),
    update: (id, patch, n) => memoryStore.update(id, patch, n),
    audit: (e) => memoryAuditLog.record(e),
  };

  /**
   * The family's defs, BEFORE authority is stamped. `withMemoryAuthz` below is
   * what makes this array shippable: it refuses to return a def whose channel has
   * no row in `MEMORY_CHANNEL_AUTHORITY`, so a fourteenth `memory:*` channel
   * added here cannot reach a renderer until someone has decided what it needs.
   */
  const rawHandlers: SecureHandlerDef[] = [
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
          /**
           * P13A — EGRESS, so `memoryMaySync` gates it, not visibility alone.
           *
           * `allItems()` is correctly scoped to what the viewer may READ, which
           * by design includes their own PERSONAL memories. Backfill does not
           * read them — it embeds them into the ORG-WIDE cloud vector namespace,
           * where every other member of the org can reach them through semantic
           * recall. Scoping to the viewer is the right rule for a read and the
           * wrong one for an upload.
           *
           * `memoryMaySync` is the same predicate that governs the live-sync
           * bridge in both directions: tenant and workspace memories travel,
           * personal and system never do. Found by adversarial review — the
           * sync pipe was fixed and this second pipe to the same destination
           * was not.
           */
          listItems: () => memoryStore.allItems().filter((it) => memoryMaySync(it.owner)),
          /**
           * The destination comes from the SAME authority as the source.
           *
           * `runtimeIdentity` answers "who did this device sign in as";
           * `activeMemoryViewer` answers "may this account act here right now",
           * and only the second is an authorization. Reading the corpus through
           * one and choosing its cloud namespace with the other is the exact
           * shape of the bug that made the live-sync bridge upload tenant A's
           * memories under tenant B. `undefined` here means no tenant resolved,
           * and `runMemoryBackfill` already declines to run without one.
           */
          getOrgId: () => activeMemoryViewer()?.tenantId,
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

  /**
   * P13C ROUND 9 — F20. THE AUTHORITY IS STAMPED HERE, NOT LEFT TO THE CALLER.
   *
   * `withRuntimeAuthz` at the composition root only stamps defs that carry no
   * `permission` of their own, so a def gated here wins and the two tables are
   * cross-checked for agreement inside the gate. Doing it in this file is what
   * makes the throw-on-unclassified guard meaningful: the array and the
   * classification live together, and neither can be edited without the other
   * being in view.
   */
  const handlers: SecureHandlerDef[] = withMemoryAuthz(rawHandlers);

  log.info('AI memory initialized', memoryStore.counts());

  return {
    handlers,
    rebuild,
    // A6 — the tracker inside the decorator is the only live account of the
    // semantic leg's health, so the probe reads it directly rather than any
    // subsystem re-deriving one from logs.
    probe: retrievalProbe(semantic.health),
    dispose: () => {
      unifiedStore.off('changed', onUnifiedChanged);
      memoryStore.off('changed', onChanged);
      pendingReprojections.clear();
      if (timer) clearTimeout(timer);
      clearTimeout(initialTimer);
    },
  };
}
