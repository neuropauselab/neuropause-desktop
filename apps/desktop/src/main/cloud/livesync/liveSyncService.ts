/**
 * The live sync service — assembles the real sync components (local mirror,
 * persistent queue/cursor store, engine, scheduler) into one object the app drives:
 * enqueue local changes, run/schedule sync, and read synced values back.
 *
 * The transport is injected, so the app supplies the HTTP transport while tests
 * supply a stub. This keeps the module free of Electron imports and testable end to
 * end; the Electron-specific wiring (lifecycle, connectivity, IPC) lives above it.
 *
 * P13C ROUND 9 — F3. THE READS ARE THE CALLER'S, NOT THE DEVICE POINTER'S.
 *
 * Every read here used to resolve `getActiveOrgId()` — one process-global pointer
 * set from the renderer — and hand back that organization's queue depth, mirrored
 * records, cursor and conflicts. `livesync:status` and `livesync:detail` are
 * `cloud:read` channels, `getStatus().cursor` is folded into the Cloud admin
 * overview and the control-plane projection, and the pointer is stale for as long
 * as it takes a second window or an organization switch to update it. So the
 * pointer decided WHOSE numbers everybody saw.
 *
 * The pointer now does one job: it names the organization the background loop
 * syncs. Every read resolves the CALLER through the same tenant seam the queue
 * and the mirror use, so a caller sees their own organization or nothing.
 */
import type {
  LiveSyncDetail,
  MergeOutcome,
  SyncChange,
  SyncEntityType,
  SyncRecord,
  TenantScope,
} from '@neuropause/shared';
import { runOutsidePrincipal } from '../../tenancy/backgroundPrincipal';
import { EMPTY_SYNC_STATUS, SyncEngine } from './engine';
import { SyncScheduler } from './scheduler';
import { createLocalSyncMirror } from './mirror';
import { createPersistentSyncStore } from './store';
import { projectLiveSyncDetail } from './detail';
import type { SyncStatus, SyncTransport } from './types';

export interface LiveSyncServiceOptions {
  deviceId: string;
  storeFilePath: string;
  mirrorFilePath: string;
  transport: SyncTransport;
  /**
   * The DEVICE's active organization. It selects which organization the
   * background loop syncs and nothing else — no read is answered from it.
   */
  getActiveOrgId: () => string | null;
  /**
   * THE TENANT BOUNDARY, AND IT IS REQUIRED.
   *
   * The queue and the mirror hold customer record mutations for every
   * organization on the machine in one file each. Required rather than optional
   * so a composition root that forgets it fails to COMPILE, which is a stronger
   * gate than failing at startup and strictly stronger than being caught by a
   * later audit.
   */
  scope: () => TenantScope | null;
  intervalMs?: number;
  onStatus?: (status: SyncStatus) => void;
  /**
   * Per-entity local appliers (V6.6.4). When an entity type is present here, a
   * pulled change of that type is applied by its handler instead of the generic
   * last-write-wins mirror. AI Memory uses this: it reconciles via its own
   * append-only merge (resolveMemorySync), which the LWW mirror must never touch.
   */
  entityAppliers?: Partial<Record<SyncEntityType, (change: SyncChange) => Promise<MergeOutcome>>>;
}

export interface LiveSyncService {
  init(): Promise<void>;
  start(): void;
  stop(): void;
  isRunning(): boolean;
  /** Sync the CALLER'S organization now. */
  syncNow(): Promise<SyncStatus>;
  /** The CALLER'S organization's sync status. Empty when none resolves. */
  getStatus(): SyncStatus;
  /** The per-entity + conflict view of the engine's real state (see detail.ts). */
  getDetail(): LiveSyncDetail;
  /** Pause or resume the CALLER'S organization's sync. Nobody else's. */
  setOnline(online: boolean): SyncStatus;
  enqueue(orgId: string, change: SyncChange): Promise<void>;
  read(orgId: string, entityType: SyncEntityType, entityId: string): SyncRecord | null;
  list(orgId: string, entityType?: SyncEntityType): SyncRecord[];
}

export function createLiveSyncService(opts: LiveSyncServiceOptions): LiveSyncService {
  const mirror = createLocalSyncMirror({ filePath: opts.mirrorFilePath }).bindScope(opts.scope);
  const store = createPersistentSyncStore({
    filePath: opts.storeFilePath,
    applyLocal: async (change) => {
      const applier = opts.entityAppliers?.[change.entityType];
      if (!applier) return mirror.apply(change);
      /**
       * AN ENTITY APPLIER RUNS OUTSIDE THE CYCLE'S PRINCIPAL, AND THAT GRANTS
       * NOTHING.
       *
       * A cycle runs as a TENANT-level principal — the honest authority for a
       * job that syncs an organization — which carries no workspace and no human
       * identity. AI Memory, the only applier today, resolves its OWN viewer and
       * authorizes against it: it refuses any payload whose organization is not
       * the viewer's tenant, and a workspace-visible memory needs a workspace the
       * organization-level principal does not have. Leaving the principal means
       * the applier sees exactly what the signed-in user sees — never more — so
       * a memory for another organization is still refused, by the memory store's
       * own inbound check rather than by this one.
       *
       * The follow-up belongs in the memory subsystem, not here: an inbound
       * memory names its own workspace, so the apply should resolve a viewer from
       * the payload's owner under the tenant principal instead of from the
       * session. Until it does, narrowing the viewer here would silently stop
       * workspace-visible memories from landing.
       */
      return runOutsidePrincipal(() => applier(change));
    },
  }).bindScope(opts.scope);
  const engine = new SyncEngine({ transport: opts.transport, store, deviceId: opts.deviceId });
  const scheduler = new SyncScheduler({
    engine,
    getActiveOrgId: opts.getActiveOrgId,
    intervalMs: opts.intervalMs,
    onStatus: opts.onStatus,
  });

  /**
   * The organization asking, resolved server-side.
   *
   * Never `getActiveOrgId()`. That pointer belongs to the device and to the
   * background loop; using it to answer a read is what let a stale or
   * second-window pointer show one organization's sync state to another.
   */
  const viewerOrgId = (): string | null => {
    const scope = opts.scope();
    return scope !== null && scope.tenantId ? scope.tenantId : null;
  };

  // The engine only recounts pending after a cycle; the durable queue knows the truth
  // right now, so a change enqueued a moment ago is reflected immediately.
  const readStatus = (): SyncStatus => {
    const orgId = viewerOrgId();
    if (orgId === null) return { ...EMPTY_SYNC_STATUS };
    return { ...engine.getStatus(orgId), pendingCount: store.pendingCount(orgId) };
  };

  return {
    async init(): Promise<void> {
      await mirror.load();
      await store.load();
    },
    start(): void {
      scheduler.start();
    },
    stop(): void {
      scheduler.stop();
    },
    isRunning(): boolean {
      return scheduler.isRunning();
    },
    syncNow(): Promise<SyncStatus> {
      return scheduler.syncNow(viewerOrgId());
    },
    getStatus(): SyncStatus {
      return readStatus();
    },
    getDetail(): LiveSyncDetail {
      const orgId = viewerOrgId();
      return projectLiveSyncDetail({
        status: readStatus(),
        orgId,
        deviceId: opts.deviceId,
        pending: orgId ? store.pendingSnapshot(orgId) : [],
        mirrored: orgId ? mirror.list(orgId) : [],
        conflicts: engine.getConflicts(orgId),
      });
    },
    setOnline(online: boolean): SyncStatus {
      const orgId = viewerOrgId();
      // No organization resolves ⇒ nothing of the caller's to pause. Pausing
      // "whatever is active" is precisely the cross-tenant toggle being removed.
      if (orgId === null) return { ...EMPTY_SYNC_STATUS };
      scheduler.setOnline(orgId, online);
      return readStatus();
    },
    async enqueue(orgId: string, change: SyncChange): Promise<void> {
      // The store stamps the owner from the seam and refuses a mismatched claim.
      await store.enqueue(orgId, change);
    },
    read(orgId: string, entityType: SyncEntityType, entityId: string): SyncRecord | null {
      return mirror.get(orgId, entityType, entityId);
    },
    list(orgId: string, entityType?: SyncEntityType): SyncRecord[] {
      return mirror.list(orgId, entityType);
    },
  };
}
