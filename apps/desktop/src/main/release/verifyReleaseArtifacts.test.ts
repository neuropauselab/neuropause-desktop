/**
 * Tests for the release-artifact + feed-integrity verifier
 * (`scripts/verify-release-artifacts.cjs`). Loaded via createRequire and
 * exercised against a REAL temporary `dist` directory, so the check is proven
 * to catch a feed that does not match the binaries — without a mac/win runner.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseUpdateFeed, sha512Base64, verifyReleaseArtifacts } = require('../../../scripts/verify-release-artifacts.cjs') as {
  parseUpdateFeed: (text: string) => { version: string | null; path: string | null; sha512: string | null; files: { url: string; sha512: string | null; size: number | null }[] };
  sha512Base64: (buf: Buffer) => string;
  verifyReleaseArtifacts: (dist: string, platform: string) => { ok: boolean; checks: { label: string; ok: boolean; detail: string | null }[] };
};

const DMG = Buffer.from('fake dmg installer payload');
const ZIP = Buffer.from('fake mac zip update payload — larger than the dmg');
const DMG_NAME = 'NeuroPause-arm64.dmg';
const ZIP_NAME = 'NeuroPause-1.0.0-rc.1-arm64-mac.zip';

function macFeed(dmgSha: string, zipSha: string): string {
  return [
    'version: 1.0.0-rc.1',
    'files:',
    `  - url: ${DMG_NAME}`,
    `    sha512: ${dmgSha}`,
    `    size: ${DMG.length}`,
    `  - url: ${ZIP_NAME}`,
    `    sha512: ${zipSha}`,
    `    size: ${ZIP.length}`,
    `path: ${ZIP_NAME}`,
    `sha512: ${zipSha}`,
    "releaseDate: '2026-08-04T00:00:00.000Z'",
    '',
  ].join('\n');
}

let dist: string;
beforeEach(() => { dist = mkdtempSync(join(tmpdir(), 'np-verify-')); });
afterEach(() => { rmSync(dist, { recursive: true, force: true }); });

function writeMacDist(feed: string, { withZip = true } = {}): void {
  writeFileSync(join(dist, DMG_NAME), DMG);
  if (withZip) writeFileSync(join(dist, ZIP_NAME), ZIP);
  writeFileSync(join(dist, DMG_NAME + '.blockmap'), Buffer.from('bm'));
  writeFileSync(join(dist, 'beta-mac.yml'), feed);
}

describe('parseUpdateFeed', () => {
  it('extracts version, path, top-level sha512 and each file entry', () => {
    const feed = parseUpdateFeed(macFeed('DMGSHA', 'ZIPSHA'));
    expect(feed.version).toBe('1.0.0-rc.1');
    expect(feed.path).toBe(ZIP_NAME);
    expect(feed.sha512).toBe('ZIPSHA');
    expect(feed.files).toHaveLength(2);
    expect(feed.files[0]).toMatchObject({ url: DMG_NAME, sha512: 'DMGSHA', size: DMG.length });
    expect(feed.files[1]).toMatchObject({ url: ZIP_NAME, sha512: 'ZIPSHA', size: ZIP.length });
  });
});

describe('verifyReleaseArtifacts (mac)', () => {
  it('passes when installers, payload and feed are present and every sha512 matches', () => {
    writeMacDist(macFeed(sha512Base64(DMG), sha512Base64(ZIP)));
    // Round 61: the fixture feed declares 1.0.0-rc.1, so the new version-parity
    // check needs the expected version injected — the pure function must have
    // every input controlled by the test rather than reading the live manifest.
    const result = verifyReleaseArtifacts(dist, 'mac', { expectedVersion: '1.0.0-rc.1' });
    expect(result.ok).toBe(true);
    expect(result.checks.filter((c) => c.label.startsWith('present:')).every((c) => c.ok)).toBe(true);
    expect(result.checks.some((c) => c.label === `sha512 ok [files]: ${ZIP_NAME}` && c.ok)).toBe(true);
    expect(result.checks.some((c) => c.label === `sha512 ok [path]: ${ZIP_NAME}` && c.ok)).toBe(true);
  });

  it('fails when a files[] entry sha512 does not match the binary on disk', () => {
    writeMacDist(macFeed(sha512Base64(DMG), sha512Base64(Buffer.from('tampered'))));
    const result = verifyReleaseArtifacts(dist, 'mac');
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.label === `sha512 ok [files]: ${ZIP_NAME}`)?.ok).toBe(false);
  });

  it('fails when the top-level update path sha512 is tampered (what electron-updater downloads)', () => {
    const good = macFeed(sha512Base64(DMG), sha512Base64(ZIP));
    const tampered = good.replace(/^sha512: .+$/m, 'sha512: AAAAtampereddigestAAAA==');
    writeMacDist(tampered);
    const result = verifyReleaseArtifacts(dist, 'mac');
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.label === `sha512 ok [path]: ${ZIP_NAME}`)?.ok).toBe(false);
  });

  it('fails when a feed-referenced payload is missing from dist', () => {
    writeMacDist(macFeed(sha512Base64(DMG), sha512Base64(ZIP)), { withZip: false });
    const result = verifyReleaseArtifacts(dist, 'mac');
    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.label.includes('-mac.zip') && !c.ok)).toBe(true);
    expect(result.checks.some((c) => c.label === `files→file: ${ZIP_NAME}` && !c.ok)).toBe(true);
  });

  it('fails cleanly when the dist directory does not exist', () => {
    const result = verifyReleaseArtifacts(join(dist, 'nope'), 'mac');
    expect(result.ok).toBe(false);
    expect(result.checks[0].label).toBe('dist directory');
  });
});

/**
 * GATE 27 (round 61) — the version-parity check.
 *
 * Every other check in this verifier compares the feed against the binaries
 * BESIDE IT in the same dist/, so a build stamped with a stale version is
 * perfectly self-consistent and passed 6/6. That blindness is how the
 * `da36851` class ("two binaries, one version") kept getting through. These
 * pins hold the one question that catches it here.
 */
describe('verifyReleaseArtifacts — version parity (Gate 27)', () => {
  it('PASSES when the feed version matches the declared version', () => {
    writeMacDist(macFeed(sha512Base64(DMG), sha512Base64(ZIP)));
    const result = verifyReleaseArtifacts(dist, 'mac', { expectedVersion: '1.0.0-rc.1' });
    expect(result.checks.some((c) => c.label.startsWith('feed version parity') && c.ok)).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('FAILS when the artifacts are stamped with a version they were not built under', () => {
    writeMacDist(macFeed(sha512Base64(DMG), sha512Base64(ZIP)));
    // The feed says rc.1; the manifests say rc.2 — two binaries, one version.
    const result = verifyReleaseArtifacts(dist, 'mac', { expectedVersion: '1.0.0-rc.2' });
    expect(result.ok).toBe(false);
    const parity = result.checks.find((c) => c.label === 'feed version parity');
    expect(parity?.ok).toBe(false);
    expect(String(parity?.detail)).toContain('1.0.0-rc.2');
  });

  // `expectedVersion` uses `??`, so an omitted/null injection means "not
  // provided" and the check falls back to the live desktop manifest. Named for
  // what it actually pins: the check is ALWAYS applied — there is no path where
  // omitting the injection quietly skips it.
  it('still applies the check when no version is injected, falling back to the manifest', () => {
    writeMacDist(macFeed(sha512Base64(DMG), sha512Base64(ZIP)));
    const result = verifyReleaseArtifacts(dist, 'mac');
    // The fixture feed is pinned at 1.0.0-rc.1, which the live manifest is not.
    expect(result.ok).toBe(false);
    expect(
      result.checks.some((c) => c.label === 'feed version parity' && !c.ok),
    ).toBe(true);
  });
});
