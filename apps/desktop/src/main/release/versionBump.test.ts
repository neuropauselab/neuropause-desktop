/**
 * A.363 — the version tool moves ALL FIVE authoritative version fields.
 *
 * THE FAILURE CLASS: `scripts/bump-version.cjs` originally wrote only the two
 * manifests, so by rc.24 the committed package-lock.json still said
 * `1.0.0-rc.21` (root) / `1.0.0-rc.22` (apps/desktop) — a five-field,
 * three-value metadata disagreement that no gate watched (Gate 27 reads only
 * the manifests and the CHANGELOG). These pins make that class impossible to
 * reintroduce silently: the fixture tests prove the tool moves every field for
 * ANY target version, and the live pin fails the suite the moment the five
 * real fields ever disagree again.
 *
 * The fixture runs the REAL script (copied byte-for-byte into a temp repo
 * shape) so the thing proven is the thing shipped, not a re-implementation.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('.', import.meta.url));
const REPO = join(MAIN, '..', '..', '..', '..', '..');
const SCRIPT = join(REPO, 'scripts', 'bump-version.cjs');

interface LockShape {
  version: string;
  packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
}

/** Build a minimal repo-shaped fixture and return its root. */
function makeFixture(versions: { pkg: string; desktop: string; lockRoot: string; lockDesktop: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'np-version-bump-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'apps', 'desktop'), { recursive: true });
  cpSync(SCRIPT, join(root, 'scripts', 'bump-version.cjs'));
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: versions.pkg, dependencies: { zod: '^3.0.0' } }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, 'apps', 'desktop', 'package.json'),
    `${JSON.stringify({ name: '@fixture/desktop', version: versions.desktop }, null, 2)}\n`,
  );
  const lock = {
    name: 'fixture',
    version: versions.lockRoot,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'fixture', version: versions.lockRoot, dependencies: { zod: '^3.0.0' } },
      'apps/desktop': { name: '@fixture/desktop', version: versions.lockDesktop },
      'apps/backend': { name: '@fixture/backend', version: '0.1.0' },
      'node_modules/zod': { version: '3.25.0', resolved: 'https://example.invalid/zod.tgz' },
    },
  };
  writeFileSync(join(root, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  return root;
}

function bump(root: string, target: string): string {
  return execFileSync('node', [join(root, 'scripts', 'bump-version.cjs'), target], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fiveFields(root: string): string[] {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  const desktop = JSON.parse(readFileSync(join(root, 'apps', 'desktop', 'package.json'), 'utf8')) as {
    version: string;
  };
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as LockShape;
  return [
    pkg.version,
    desktop.version,
    lock.version,
    lock.packages[''].version as string,
    lock.packages['apps/desktop'].version as string,
  ];
}

describe('version bump moves all five authoritative fields (A.363)', () => {
  it('repairs the historical mismatch shape: rc.24 manifests over an rc.21/rc.22 lockfile → rc.25 everywhere', () => {
    const root = makeFixture({
      pkg: '1.0.0-rc.24',
      desktop: '1.0.0-rc.24',
      lockRoot: '1.0.0-rc.21',
      lockDesktop: '1.0.0-rc.22',
    });
    bump(root, '1.0.0-rc.25');
    expect(fiveFields(root)).toEqual(Array<string>(5).fill('1.0.0-rc.25'));
  });

  it('is not hard-coded to rc.25: a coherent rc.25 tree moves to rc.26 in all five fields', () => {
    const root = makeFixture({
      pkg: '1.0.0-rc.25',
      desktop: '1.0.0-rc.25',
      lockRoot: '1.0.0-rc.25',
      lockDesktop: '1.0.0-rc.25',
    });
    bump(root, '1.0.0-rc.26');
    expect(fiveFields(root)).toEqual(Array<string>(5).fill('1.0.0-rc.26'));
  });

  it('handles arbitrary semver, not just this rc line', () => {
    const root = makeFixture({ pkg: '2.3.3', desktop: '2.3.3', lockRoot: '2.3.3', lockDesktop: '2.3.3' });
    bump(root, '2.3.4-beta.1');
    expect(fiveFields(root)).toEqual(Array<string>(5).fill('2.3.4-beta.1'));
  });

  it('touches nothing but version fields: dependency ranges, resolutions, and other workspace entries survive byte-for-byte', () => {
    const root = makeFixture({
      pkg: '1.0.0-rc.24',
      desktop: '1.0.0-rc.24',
      lockRoot: '1.0.0-rc.21',
      lockDesktop: '1.0.0-rc.22',
    });
    bump(root, '1.0.0-rc.25');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as LockShape;
    expect(pkg.dependencies).toEqual({ zod: '^3.0.0' });
    expect(lock.packages[''].dependencies).toEqual({ zod: '^3.0.0' });
    expect(lock.packages['node_modules/zod']).toEqual({
      version: '3.25.0',
      resolved: 'https://example.invalid/zod.tgz',
    });
    expect(lock.packages['apps/backend']).toEqual({ name: '@fixture/backend', version: '0.1.0' });
  });

  it('still refuses to move backwards', () => {
    const root = makeFixture({
      pkg: '1.0.0-rc.25',
      desktop: '1.0.0-rc.25',
      lockRoot: '1.0.0-rc.25',
      lockDesktop: '1.0.0-rc.25',
    });
    expect(() => bump(root, '1.0.0-rc.24')).toThrow();
    expect(fiveFields(root)).toEqual(Array<string>(5).fill('1.0.0-rc.25'));
  });
});

describe('live repository version coherence (the pin that catches the rc.21/rc.22/rc.24 class)', () => {
  it('the five authoritative version fields agree', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { version: string };
    const desktop = JSON.parse(readFileSync(join(REPO, 'apps', 'desktop', 'package.json'), 'utf8')) as {
      version: string;
    };
    const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as LockShape;
    const five = [
      pkg.version,
      desktop.version,
      lock.version,
      lock.packages[''].version,
      lock.packages['apps/desktop'].version,
    ];
    expect(
      five.every((v) => v === pkg.version),
      `The five authoritative version fields disagree: ${JSON.stringify(five)}. ` +
        'Run: npm run version:bump -- <version> — it moves all five together.',
    ).toBe(true);
  });

  it('the workspace keeps a single root lockfile', () => {
    expect(existsSync(join(REPO, 'apps', 'desktop', 'package-lock.json'))).toBe(false);
  });
});
