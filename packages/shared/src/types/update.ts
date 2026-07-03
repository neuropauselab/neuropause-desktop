/**
 * Application self-update contracts (electron-updater).
 *
 * These describe the desktop app updating *itself* — distinct from the Store's
 * installed-app update checks (see types/store + catalog:checkUpdate).
 */

/** Release channel the desktop app follows for its own updates. */
export type UpdateChannel = 'stable' | 'beta' | 'internal';

/** Lifecycle phase the updater is currently in. */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

/** Byte-level download progress while a release is being fetched. */
export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

/** Metadata about a discovered release. */
export interface UpdateInfo {
  version: string;
  channel: UpdateChannel;
  releaseDate: string | null;
  /** Plain-text release notes, if the feed provides them. */
  releaseNotes: string | null;
}

/** The complete, serializable view of the updater the renderer renders from. */
export interface UpdateStatus {
  phase: UpdatePhase;
  channel: UpdateChannel;
  currentVersion: string;
  available: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
  /**
   * Whether self-update is operational. Only packaged builds with a configured
   * feed can update; dev and unconfigured builds report `false` and the UI
   * shows an informational state instead of controls.
   */
  supported: boolean;
  /** ISO timestamp of the last completed check, or null if never checked. */
  checkedAt: string | null;
}

/** Broadcast payload pushed whenever the updater status changes. */
export interface UpdateEvent {
  status: UpdateStatus;
}
