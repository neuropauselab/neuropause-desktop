/**
 * NeuroPause Runtime — shared DTO contracts for the trusted execution layer.
 *
 * These describe the runtime, the Local Application Registry, the NeuroPause
 * Package Service (NPS), and the permission model. The main process owns the
 * authoritative state; the renderer only ever sees these read shapes over the
 * secure catalog/runtime IPC bridge.
 */
import type { AppType, PermissionKey } from './store';

/* ───────────────────────────── Permissions ──────────────────────────────── */

/**
 * Runtime-enforceable permissions. Extends the catalog permission set with
 * shell execution, which is granted/enforced at runtime rather than declared
 * by every catalog entry.
 */
export type RuntimePermissionKey = PermissionKey | 'shell_execution';

export const RUNTIME_PERMISSION_KEYS: readonly RuntimePermissionKey[] = [
  'network',
  'filesystem_read',
  'filesystem_write',
  'clipboard',
  'notifications',
  'camera',
  'microphone',
  'local_models',
  'automation',
  'background',
  'shell_execution',
];

export type PermissionState = 'requested' | 'granted' | 'denied' | 'revoked';

export interface PermissionGrant {
  permission: RuntimePermissionKey;
  state: PermissionState;
  /** ISO-8601 timestamp of the last decision. */
  decidedAt: string | null;
}

/* ───────────────────────────── Runtime ──────────────────────────────────── */

export type RuntimeStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'suspended'
  | 'stopping'
  | 'crashed'
  | 'failed';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface ResourceSample {
  cpuPercent: number | null;
  memoryMb: number | null;
  sampledAt: string;
}

export interface RuntimeInstanceDto {
  instanceId: string;
  appSlug: string;
  appName: string;
  kind: AppType;
  status: RuntimeStatus;
  health: HealthStatus;
  pid: number | null;
  startedAt: string | null;
  uptimeMs: number;
  restarts: number;
  lastError: string | null;
  resource: ResourceSample | null;
}

export type RuntimeEventType = 'lifecycle' | 'health' | 'crash' | 'log';

export interface RuntimeEvent {
  type: RuntimeEventType;
  instanceId: string;
  appSlug: string;
  status: RuntimeStatus | null;
  health: HealthStatus | null;
  message: string | null;
  at: string;
}

/** Web apps are hosted in the renderer; main asks the renderer to open a tab. */
export interface OpenAppRequest {
  appSlug: string;
  appName: string;
  launchUrl: string | null;
  instanceId: string;
}

/* ───────────────────────── Local Application Registry ────────────────────── */

export interface RegistryUsage {
  launches: number;
  totalActiveMs: number;
  lastSessionAt: string | null;
}

export interface RegistryEntryDto {
  slug: string;
  name: string;
  appType: AppType;
  installedVersion: string | null;
  channel: string;
  installLocation: string | null;
  packageHash: string | null;
  signatureKeyId: string | null;
  hasSignature: boolean;
  grantedPermissions: RuntimePermissionKey[];
  launchCount: number;
  lastLaunchedAt: string | null;
  installedAt: string;
  lastUpdatedAt: string | null;
  runtimeStatus: RuntimeStatus;
  healthStatus: HealthStatus;
  diskUsageBytes: number | null;
  pinned: boolean;
  favorite: boolean;
  config: Record<string, unknown>;
  usage: RegistryUsage;
}

export interface RegistryStats {
  totalInstalled: number;
  totalLaunches: number;
  totalDiskBytes: number;
  pinnedCount: number;
  favoriteCount: number;
  byType: Record<string, number>;
}

/* ───────────────────────── NeuroPause Package Service ────────────────────── */

export type NpsOperationKind =
  | 'install'
  | 'uninstall'
  | 'update'
  | 'rollback'
  | 'repair'
  | 'verify';

export type NpsOperationStatus =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface NpsOperationDto {
  id: string;
  kind: NpsOperationKind;
  appSlug: string;
  status: NpsOperationStatus;
  /** 0..1 overall progress. */
  progress: number;
  bytesDownloaded: number | null;
  bytesTotal: number | null;
  message: string | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
}

/** Slim progress event broadcast to the renderer during an operation. */
export interface NpsProgressEvent {
  id: string;
  appSlug: string;
  status: NpsOperationStatus;
  progress: number;
  bytesDownloaded: number | null;
  bytesTotal: number | null;
  message: string | null;
}

/** Result of an install attempt returned to the caller. */
export interface InstallResultDto {
  ok: boolean;
  operationId: string;
  entry: RegistryEntryDto | null;
  /** Permissions the app requested that were not granted. */
  missingPermissions: RuntimePermissionKey[];
  message: string | null;
}
