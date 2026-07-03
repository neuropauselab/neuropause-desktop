import { describe, expect, it } from 'vitest';
import {
  UPDATE_CHANNELS,
  resolveChannel,
  feedChannel,
  allowsPrerelease,
  compareVersions,
  isNewerVersion,
  pickRollbackTarget,
} from './updateChannels';

describe('updateChannels', () => {
  it('exposes the three release channels', () => {
    expect(UPDATE_CHANNELS).toEqual(['stable', 'beta', 'internal']);
  });

  it('resolves known channels and defaults unknown input to stable', () => {
    expect(resolveChannel('beta')).toBe('beta');
    expect(resolveChannel('internal')).toBe('internal');
    expect(resolveChannel('stable')).toBe('stable');
    expect(resolveChannel('nonsense')).toBe('stable');
    expect(resolveChannel(undefined)).toBe('stable');
    expect(resolveChannel(42)).toBe('stable');
  });

  it('maps channels to their electron-updater feed track', () => {
    expect(feedChannel('stable')).toBe('latest');
    expect(feedChannel('beta')).toBe('beta');
    expect(feedChannel('internal')).toBe('internal');
  });

  it('only allows prereleases on non-stable channels', () => {
    expect(allowsPrerelease('stable')).toBe(false);
    expect(allowsPrerelease('beta')).toBe(true);
    expect(allowsPrerelease('internal')).toBe(true);
  });
});

describe('compareVersions', () => {
  it('orders core versions numerically (not lexically)', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1); // 10 > 9, not "10" < "9"
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('treats a release as newer than its prerelease', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1);
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
  });

  it('orders prerelease identifiers correctly', () => {
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBe(1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta.1.1')).toBe(-1); // shorter set is lower
  });

  it('tolerates a leading v and sorts unparseable versions below parseable', () => {
    expect(compareVersions('v1.2.0', '1.1.0')).toBe(1);
    expect(compareVersions('garbage', '1.0.0')).toBe(-1);
    expect(compareVersions('garbage', 'also-garbage')).toBe(0);
  });

  it('isNewerVersion is a strict comparison', () => {
    expect(isNewerVersion('1.2.0', '1.1.9')).toBe(true);
    expect(isNewerVersion('1.1.0', '1.1.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
  });
});

describe('pickRollbackTarget', () => {
  it('returns the highest version strictly older than current', () => {
    expect(pickRollbackTarget('1.3.0', ['1.0.0', '1.2.0', '1.1.0'])).toBe('1.2.0');
  });

  it('ignores versions equal to or newer than current', () => {
    expect(pickRollbackTarget('1.2.0', ['1.2.0', '1.3.0'])).toBe(null);
    expect(pickRollbackTarget('1.2.0', ['1.2.0', '1.1.5', '1.4.0'])).toBe('1.1.5');
  });

  it('returns null on empty history', () => {
    expect(pickRollbackTarget('1.0.0', [])).toBe(null);
  });
});
