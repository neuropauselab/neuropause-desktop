import { describe, expect, it } from 'vitest';
import {
  RELEASE_CHANNEL_META,
  orderedReleaseChannels,
  releaseChannelLabel,
  releaseChannelDescription,
  UPDATE_PHASE_LABEL,
  updatePhaseLabel,
  formatUpdateProgressPercent,
  updateStatusHeadline,
  canCheckForUpdate,
  canDownloadUpdate,
  canInstallUpdate,
  canSwitchChannel,
  type UpdateStatus,
  type UpdatePhase,
} from '@neuropause/shared';

function status(partial: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    phase: 'idle',
    channel: 'stable',
    currentVersion: '1.2.3',
    available: null,
    progress: null,
    error: null,
    supported: true,
    checkedAt: null,
    ...partial,
  };
}

const ALL_PHASES: UpdatePhase[] = [
  'idle',
  'checking',
  'available',
  'not-available',
  'downloading',
  'downloaded',
  'error',
];

describe('releaseChannelMeta — channel metadata', () => {
  it('orders the real channels stable → beta → internal', () => {
    expect(orderedReleaseChannels()).toEqual(['stable', 'beta', 'internal']);
  });

  it('every channel has a non-empty label + description; exactly one is recommended (stable)', () => {
    for (const meta of Object.values(RELEASE_CHANNEL_META)) {
      expect(meta.label).toBeTruthy();
      expect(meta.description).toBeTruthy();
    }
    const recommended = Object.values(RELEASE_CHANNEL_META).filter((m) => m.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].channel).toBe('stable');
  });

  it('names the internal channel honestly (never "nightly")', () => {
    expect(releaseChannelLabel('internal')).toBe('Internal');
    expect(releaseChannelDescription('internal')).toBeTruthy();
    const allText = Object.values(RELEASE_CHANNEL_META)
      .map((m) => `${m.label} ${m.description}`)
      .join(' ')
      .toLowerCase();
    expect(allText).not.toContain('nightly');
  });
});

describe('releaseChannelMeta — phase labels + progress', () => {
  it('labels every phase', () => {
    for (const phase of ALL_PHASES) {
      expect(UPDATE_PHASE_LABEL[phase]).toBeTruthy();
      expect(updatePhaseLabel(phase)).toBe(UPDATE_PHASE_LABEL[phase]);
    }
    expect(updatePhaseLabel('not-available')).toBe('Up to date');
    expect(updatePhaseLabel('downloaded')).toBe('Ready to install');
  });

  it('formats progress as clamped whole percent', () => {
    expect(formatUpdateProgressPercent(42.6)).toBe('43%');
    expect(formatUpdateProgressPercent(0)).toBe('0%');
    expect(formatUpdateProgressPercent(-5)).toBe('0%');
    expect(formatUpdateProgressPercent(150)).toBe('100%');
    expect(formatUpdateProgressPercent(Number.NaN)).toBe('0%');
  });
});

describe('releaseChannelMeta — updateStatusHeadline (pure, deterministic)', () => {
  it('explains an unsupported build', () => {
    expect(updateStatusHeadline(status({ supported: false }))).toBe(
      'Automatic updates are not available in this build.',
    );
  });

  it('describes each supported phase from real fields only', () => {
    expect(updateStatusHeadline(status({ phase: 'idle' }))).toBe('You are on version 1.2.3.');
    expect(updateStatusHeadline(status({ phase: 'not-available' }))).toBe(
      'You are on the latest version (1.2.3).',
    );
    expect(updateStatusHeadline(status({ phase: 'checking' }))).toBe('Checking for updates…');
    expect(
      updateStatusHeadline(
        status({
          phase: 'available',
          available: { version: '2.0.0', channel: 'stable', releaseDate: null, releaseNotes: null },
        }),
      ),
    ).toBe('Version 2.0.0 is available.');
    expect(
      updateStatusHeadline(
        status({
          phase: 'downloading',
          progress: { percent: 40, bytesPerSecond: 1, transferred: 1, total: 2 },
        }),
      ),
    ).toBe('Downloading update… 40%');
    expect(
      updateStatusHeadline(
        status({
          phase: 'downloaded',
          available: { version: '2.0.0', channel: 'stable', releaseDate: null, releaseNotes: null },
        }),
      ),
    ).toBe('Version 2.0.0 is ready to install.');
    expect(updateStatusHeadline(status({ phase: 'error', error: 'boom' }))).toBe(
      'Update error: boom',
    );
  });

  it('is deterministic', () => {
    const s = status({ phase: 'not-available' });
    expect(updateStatusHeadline(s)).toBe(updateStatusHeadline(s));
  });
});

describe('releaseChannelMeta — action gates', () => {
  it('allows check/switch when idle and supported, but not mid check/download', () => {
    expect(canCheckForUpdate(status({ phase: 'idle' }))).toBe(true);
    expect(canSwitchChannel(status({ phase: 'idle' }))).toBe(true);
    expect(canCheckForUpdate(status({ phase: 'checking' }))).toBe(false);
    expect(canCheckForUpdate(status({ phase: 'downloading' }))).toBe(false);
    expect(canSwitchChannel(status({ phase: 'downloading' }))).toBe(false);
  });

  it('gates download to available and install to downloaded', () => {
    expect(canDownloadUpdate(status({ phase: 'available' }))).toBe(true);
    expect(canDownloadUpdate(status({ phase: 'idle' }))).toBe(false);
    expect(canInstallUpdate(status({ phase: 'downloaded' }))).toBe(true);
    expect(canInstallUpdate(status({ phase: 'available' }))).toBe(false);
  });

  it('blocks every action on an unsupported build', () => {
    const s = status({ supported: false, phase: 'available' });
    expect(canCheckForUpdate(s)).toBe(false);
    expect(canDownloadUpdate(s)).toBe(false);
    expect(canInstallUpdate(status({ supported: false, phase: 'downloaded' }))).toBe(false);
    expect(canSwitchChannel(s)).toBe(false);
  });
});
