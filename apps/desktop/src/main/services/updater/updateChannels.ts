/**
 * Pure update logic — deliberately free of any Electron or electron-updater
 * import so it can be unit-tested under a plain Node environment and reused by
 * both the updater service and the diagnostics layer.
 *
 *   - channel resolution + feed mapping (stable / beta / internal)
 *   - semver comparison (core + prerelease ordering)
 *   - rollback-target selection from a history of installed versions
 */
import type { UpdateChannel } from '@neuropause/shared';

export const UPDATE_CHANNELS: readonly UpdateChannel[] = ['stable', 'beta', 'internal'];

export const DEFAULT_CHANNEL: UpdateChannel = 'stable';

/** Coerce arbitrary input to a known channel, defaulting to stable. */
export function resolveChannel(input: unknown): UpdateChannel {
  return UPDATE_CHANNELS.includes(input as UpdateChannel) ? (input as UpdateChannel) : DEFAULT_CHANNEL;
}

/**
 * electron-updater feed channel string. `stable` follows the default `latest`
 * track; pre-release channels follow their own track so a beta/internal build
 * never sees a release from another channel.
 */
export function feedChannel(channel: UpdateChannel): string {
  return channel === 'stable' ? 'latest' : channel;
}

/** Stable only accepts full releases; beta/internal accept pre-releases too. */
export function allowsPrerelease(channel: UpdateChannel): boolean {
  return channel !== 'stable';
}

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

function parse(version: string): ParsedVersion | null {
  const cleaned = version.trim().replace(/^v/, '');
  const [main, pre] = cleaned.split('-', 2);
  const parts = main.split('.');
  if (parts.length !== 3) return null;
  const core = parts.map((p) => Number(p));
  if (core.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return {
    core: [core[0], core[1], core[2]],
    prerelease: pre ? pre.split('.') : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  // Per semver: a version with no prerelease outranks one that has any.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined) return -1; // shorter prerelease set is lower
    if (bi === undefined) return 1;
    const an = /^\d+$/.test(ai);
    const bn = /^\d+$/.test(bi);
    if (an && bn) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return Math.sign(diff);
    } else if (an !== bn) {
      return an ? -1 : 1; // numeric identifiers are lower than alphanumeric
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compare two versions. Returns -1 if a < b, 0 if equal, 1 if a > b. Unparseable
 * versions sort below parseable ones (and equal to each other).
 */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/**
 * Choose a rollback target: the highest version in `history` that is strictly
 * older than `current`. Returns null when no older version exists. This is the
 * "rollback preparation" primitive — it identifies the version a failed update
 * would revert to, without performing any side effect.
 */
export function pickRollbackTarget(current: string, history: readonly string[]): string | null {
  let best: string | null = null;
  for (const v of history) {
    if (compareVersions(v, current) >= 0) continue;
    if (best === null || compareVersions(v, best) > 0) best = v;
  }
  return best;
}
