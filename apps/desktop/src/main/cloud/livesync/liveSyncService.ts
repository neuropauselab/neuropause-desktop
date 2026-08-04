/**
 * The live sync service — assembles the real sync components (local mirror,
 * persistent queue/cursor store, engine, scheduler) into one object the app drives:
 * enqueue local changes, run/schedule sync, and read synced values back.
 *
 * The transport is injected, so the app supplies the HTTP transport while tests
 * supply a stub. This keeps the module free of Electron imports and testable end to
 * end; the Electron-specific wiring (lifecycle, connectivity, IPC) lives above it.
 */
import type {
  LiveSyncDetail,
  MergeOutcome,
  SyncChange,
  SyncEntityType,
  SyncRecord,
} from '@neuropause/shared';
import { SyncEngine } from './engine';
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
  getActiveOrgId: () => string | null;
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
  syncNow(): Promise<SyncStatus>;
  getStatus(): SyncStatus;
  /** The per-entity + conflict view of the engine's real state (see detail.ts). */
  getDetail(): LiveSyncDetail;
  setOnline(online: boolean): void;
  enqueue(orgId: string, change: SyncChange): Promise<void>;
  read(orgId: string, entityType: SyncEntityType, entityId: string): SyncRecord | null;
  list(orgId: string, entityType?: SyncEntityType): SyncRecord[];
}

export function createLiveSyncService(opts: LiveSyncServiceOptions): LiveSyncService {
  const mirror = createLocalSyncMirror({ filePath: opts.mirrorFilePath });
  const store = createPersistentSyncStore({
    filePath: opts.storeFilePath,
    applyLocal: async (change) => {
      const applier = opts.entityAppliers?.[change.entityType];
      return applier ? applier(change) : mirror.apply(change);
    },
  });
  const engine = new SyncEngine({ transport: opts.transport, store, deviceId: opts.deviceId });
  const scheduler = new SyncScheduler({
    engine,
    getActiveOrgId: opts.getActiveOrgId,
    intervalMs: opts.intervalMs,
    onStatus: opts.onStatus,
  });

  // The engine only recounts pending after a cycle; the durable queue knows the truth
  // right now, so a change enqueued a moment ago is reflected immediately.
  const readStatus = (): SyncStatus => {
    const orgId = opts.getActiveOrgId();
    const status = engine.getStatus();
    return orgId ? { ...status, pendingCount: store.pendingCount(orgId) } : status;
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
      return scheduler.syncNow();
    },
    getStatus(): SyncStatus {
      return readStatus();
    },
    getDetail(): LiveSyncDetail {
      const orgId = opts.getActiveOrgId();
      return projectLiveSyncDetail({
        status: readStatus(),
        orgId,
        deviceId: opts.deviceId,
        pending: orgId ? store.pendingSnapshot(orgId) : [],
        mirrored: orgId ? mirror.list(orgId) : [],
        conflicts: engine.getConflicts(),
      });
    },
    setOnline(online: boolean): void {
      scheduler.setOnline(online);
    },
    async enqueue(orgId: string, change: SyncChange): Promise<void> {
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
