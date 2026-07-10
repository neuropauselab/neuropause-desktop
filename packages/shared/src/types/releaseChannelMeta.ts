/**
 * Release-channel PRESENTATION metadata — the pure labels/descriptions/ordering and the derived
 * "what can the user do right now" facts the Settings "Release Channel" surface renders from. It reuses the
 * REAL `UpdateChannel` / `UpdatePhase` / `UpdateStatus` model from `./update` and adds no update behavior of
 * its own: checking, downloading, channel switching and persistence all remain owned by the main
 * `appUpdater` service behind `update:*`. This module is the honest naming + affordance layer only.
 *
 * Honesty note: the real third channel is `internal` (team builds), NOT `nightly`. It is surfaced with its
 * true name and an accurate description rather than being relabeled.
 *
 * Everything here is pure and deterministic (no clock, no I/O), so the tests pin it exactly.
 */
import type { UpdateChannel, UpdatePhase, UpdateStatus } from './update';

/** Human metadata for one release channel. */
export interface ReleaseChannelMeta {
  channel: UpdateChannel;
  label: string;
  description: string;
  /** Display order (lower first). */
  order: number;
  /** The channel recommended for most users. */
  recommended: boolean;
}

/** The real channels, described honestly. */
export const RELEASE_CHANNEL_META: Record<UpdateChannel, ReleaseChannelMeta> = {
  stable: {
    channel: 'stable',
    label: 'Stable',
    description: 'Production-ready releases. Recommended for everyone.',
    order: 0,
    recommended: true,
  },
  beta: {
    channel: 'beta',
    label: 'Beta',
    description: 'Early access to upcoming features. Generally stable, but less tested than Stable.',
    order: 1,
    recommended: false,
  },
  internal: {
    channel: 'internal',
    label: 'Internal',
    description: 'Unfiltered internal team builds. May be unstable — intended for NeuroPause developers.',
    order: 2,
    recommended: false,
  },
};

/** The channels in display order. Deterministic. */
export function orderedReleaseChannels(): UpdateChannel[] {
  return (Object.values(RELEASE_CHANNEL_META) as ReleaseChannelMeta[])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((m) => m.channel);
}

export function releaseChannelLabel(channel: UpdateChannel): string {
  return RELEASE_CHANNEL_META[channel]?.label ?? channel;
}

export function releaseChannelDescription(channel: UpdateChannel): string {
  return RELEASE_CHANNEL_META[channel]?.description ?? '';
}

/** Short badge label for the current updater phase. */
export const UPDATE_PHASE_LABEL: Record<UpdatePhase, string> = {
  idle: 'Idle',
  checking: 'Checking',
  available: 'Update available',
  'not-available': 'Up to date',
  downloading: 'Downloading',
  downloaded: 'Ready to install',
  error: 'Error',
};

export function updatePhaseLabel(phase: UpdatePhase): string {
  return UPDATE_PHASE_LABEL[phase] ?? phase;
}

/** Format download progress as a whole-percent string, e.g. 42 → "42%". Clamped to 0–100. Deterministic. */
export function formatUpdateProgressPercent(percent: number): string {
  const p = Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : 0;
  return `${p}%`;
}

/**
 * A single human headline describing the updater state. Pure — reads only the status fields (never a
 * clock), so it is safe to render and to unit-test deterministically.
 */
export function updateStatusHeadline(status: UpdateStatus): string {
  if (!status.supported) {
    return 'Automatic updates are not available in this build.';
  }
  switch (status.phase) {
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return status.available
        ? `Version ${status.available.version} is available.`
        : 'An update is available.';
    case 'downloading':
      return status.progress
        ? `Downloading update… ${formatUpdateProgressPercent(status.progress.percent)}`
        : 'Downloading update…';
    case 'downloaded':
      return status.available
        ? `Version ${status.available.version} is ready to install.`
        : 'An update is ready to install.';
    case 'not-available':
      return `You are on the latest version (${status.currentVersion}).`;
    case 'error':
      return status.error ? `Update error: ${status.error}` : 'Something went wrong while updating.';
    case 'idle':
    default:
      return `You are on version ${status.currentVersion}.`;
  }
}

/** Whether a manual "Check for updates" is allowed right now. */
export function canCheckForUpdate(status: UpdateStatus): boolean {
  return status.supported && status.phase !== 'checking' && status.phase !== 'downloading';
}

/** Whether an available update can be downloaded now. */
export function canDownloadUpdate(status: UpdateStatus): boolean {
  return status.supported && status.phase === 'available';
}

/** Whether a downloaded update can be installed (restart-to-apply) now. */
export function canInstallUpdate(status: UpdateStatus): boolean {
  return status.supported && status.phase === 'downloaded';
}

/** Whether switching the release channel is allowed right now (not mid check/download). */
export function canSwitchChannel(status: UpdateStatus): boolean {
  return status.supported && status.phase !== 'checking' && status.phase !== 'downloading';
}
