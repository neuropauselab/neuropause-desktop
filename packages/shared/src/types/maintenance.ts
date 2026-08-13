/**
 * Maintenance contracts — migration, backup/restore, recovery actions, and the
 * support bundle. These describe the Release Engineering operations that keep an
 * installed app upgradeable and recoverable across releases.
 */

/** The data domains the migration engine and backup manager operate over. */
export type MaintenanceDomain =
  | 'database'
  | 'registry'
  | 'configuration'
  | 'workspace'
  | 'knowledgeGraph'
  | 'aiWorker'
  | 'plugin'
  | 'aiMemory'
  | 'timeline'
  // Phase 8 (RC hardening, 8.2): the two domains that carry the user's actual
  // BUSINESS data — previously outside backup/restore entirely.
  // `business` = every enterprise-module record store (all certified modules,
  // present and future, via the enterprise-module-* prefix) + executive
  // decisions, governance, automations, health history.
  // `assistant` = assistant conversations + captured feedback.
  | 'business'
  | 'assistant';

export type MigrationStepStatus = 'pending' | 'applied' | 'skipped' | 'failed' | 'rolledBack';

/** One migration step's outcome within a run. */
export interface MigrationStepResult {
  id: string;
  domain: MaintenanceDomain;
  fromVersion: number;
  toVersion: number;
  status: MigrationStepStatus;
  durationMs: number;
  detail: string | null;
}

/** A migration run's overall result. */
export interface MigrationReport {
  startedAt: string;
  finishedAt: string;
  fromVersion: number;
  toVersion: number;
  ok: boolean;
  backupId: string | null;
  recovered: boolean;
  steps: MigrationStepResult[];
}

/** Whether the persisted data needs migrating and to what version. */
export interface MigrationStatus {
  currentVersion: number;
  targetVersion: number;
  pending: number;
  upToDate: boolean;
  lastRun: MigrationReport | null;
}

/** A persisted backup's metadata. */
export interface BackupInfo {
  id: string;
  createdAt: string;
  appVersion: string;
  trigger: 'manual' | 'scheduled' | 'pre-migration';
  domains: MaintenanceDomain[];
  sizeBytes: number;
  /** Whether the on-disk contents still match the recorded checksums. */
  valid: boolean | null;
}

/** A single file inside a backup, with its integrity checksum. */
export interface BackupEntry {
  domain: MaintenanceDomain;
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

/** The manifest stored alongside a backup's files. */
export interface BackupManifest {
  id: string;
  createdAt: string;
  appVersion: string;
  dataVersion: number;
  trigger: BackupInfo['trigger'];
  entries: BackupEntry[];
}

/** Result of validating a backup's integrity. */
export interface BackupValidation {
  id: string;
  valid: boolean;
  checked: number;
  mismatched: string[];
  missing: string[];
}

/** Result of a restore (full or selective). */
export interface RestoreResult {
  id: string;
  ok: boolean;
  restored: MaintenanceDomain[];
  skipped: MaintenanceDomain[];
  /** A safety backup taken of the pre-restore state. */
  safetyBackupId: string | null;
  detail: string | null;
}

/** The recovery operations the Recovery Center can invoke. */
export type RecoveryAction =
  | 'safeMode'
  | 'disablePlugins'
  | 'resetSettings'
  | 'restoreBackup'
  | 'repairInstallation'
  | 'verifyIntegrity'
  | 'rebuildSearchIndexes'
  | 'rebuildKnowledgeGraph';

/** Result of running a recovery action. */
export interface RecoveryActionResult {
  action: RecoveryAction;
  ok: boolean;
  /** Whether the change takes effect only after a restart. */
  requiresRestart: boolean;
  message: string;
  detail: string | null;
}

/** Whether the next launch should enter Safe Mode, and why. */
export interface SafeModeState {
  enabled: boolean;
  reason: string | null;
  setAt: string | null;
}

/** Metadata for a generated support bundle. */
export interface SupportBundleInfo {
  path: string;
  createdAt: string;
  sizeBytes: number;
  contents: string[];
  /** Categories of content deliberately excluded (secrets, tokens, etc.). */
  redacted: string[];
}
