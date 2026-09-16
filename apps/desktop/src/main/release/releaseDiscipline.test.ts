/**
 * P13C ROUND 61 — GATE 27. RELEASE DISCIPLINE, AUTOMATED.
 *
 * THE FAILURE CLASS, in the repo's own words (CHANGELOG, rc.20 section):
 * "a build calling itself rc.19 today would not be the rc.19 whose Windows
 * installer hash is on record."
 *
 * That class — `da36851`, two binaries under one version — has now been caught
 * BY HAND three times: rc.17→rc.18 (Gate 21), rc.19→rc.20 (Gate 27 round 40),
 * and round 61, which found the tree declaring `1.0.0-rc.20` while sitting
 * **390 commits** past the `v1.0.0-rc.20` tag, with the CHANGELOG asserting
 * "_No unreleased changes_". Three catches, all manual, each one later and
 * larger than the last. Nothing in the suite ever looked.
 *
 * `verify:release` cannot catch it: it compares an update feed against the
 * binaries beside it in one `dist/` directory, so a stale-version build is
 * perfectly self-consistent and passes. The blindness is structural, not a bug.
 *
 * THE RULE THESE PINS ENFORCE — a version is SPENT once a tag exists for it.
 * After a release is tagged, the very next commit must bump. That is what keeps
 * the drift at one commit instead of three hundred and ninety.
 *
 * Deliberately degrades rather than fabricating a red: if git is unavailable or
 * the tag does not exist, the tag assertion is inert. A test that cannot measure
 * must not claim a verdict.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('.', import.meta.url));
const REPO = join(MAIN, '..', '..', '..', '..', '..');
const DESKTOP_PKG = join(REPO, 'apps', 'desktop', 'package.json');
const ROOT_PKG = join(REPO, 'package.json');
const CHANGELOG = join(REPO, 'CHANGELOG.md');

function readJson(p: string): { version?: string } {
  return JSON.parse(readFileSync(p, 'utf8')) as { version?: string };
}

/** Run a git command, or return null if git/the repo is unavailable. */
function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

describe('release discipline (Gate 27)', () => {
  it('the two manifests declare the SAME version', () => {
    // They are bumped together by scripts/bump-version.cjs precisely because
    // moving them by hand is what shipped rc.2..rc.13 all labeled rc.1.
    const root = readJson(ROOT_PKG).version;
    const desktop = readJson(DESKTOP_PKG).version;
    expect(root, 'root package.json has a version').toBeTruthy();
    expect(desktop).toBe(root);
  });

  it('the CHANGELOG documents the version the tree declares', () => {
    const version = readJson(DESKTOP_PKG).version as string;
    expect(existsSync(CHANGELOG)).toBe(true);
    const text = readFileSync(CHANGELOG, 'utf8');
    // A released version must have its own section; an unreleased one must at
    // least be named. Either way the CHANGELOG may not be silent about it.
    expect(
      text.includes(`[${version}]`) || text.includes(`\`${version}\``),
      `CHANGELOG.md does not mention ${version}`,
    ).toBe(true);
  });

  /**
   * THE PIN THAT WOULD HAVE CAUGHT ROUND 61's DEFECT.
   *
   * If a tag already exists for the declared version, that version is SPENT:
   * building now would emit a second, different binary claiming a name already
   * bound to other bytes. HEAD must therefore BE that tag.
   */
  it('does not declare a version whose tag is already spent', () => {
    const version = readJson(DESKTOP_PKG).version as string;
    const tag = `v${version}`;

    const tagged = git(['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`]);
    if (tagged === null) return; // no such tag (or no git) — nothing to enforce

    const head = git(['rev-parse', 'HEAD']);
    if (head === null) return; // cannot measure — do not manufacture a verdict

    const ahead = git(['rev-list', '--count', `${tag}..HEAD`]) ?? '?';
    expect(
      head,
      `The tree declares ${version}, but tag ${tag} is already bound to ${tagged.slice(0, 7)} ` +
        `and HEAD is ${head.slice(0, 7)} — ${ahead} commits past it. Building now would produce ` +
        `a second, different binary calling itself ${version}: the da36851 failure class. ` +
        `Run: npm run version:bump -- <next version>, then add its CHANGELOG section.`,
    ).toBe(tagged);
  });

  it('the CHANGELOG does not claim "no unreleased changes" while commits sit past the tag', () => {
    const version = readJson(DESKTOP_PKG).version as string;
    const tag = `v${version}`;
    const tagged = git(['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`]);
    if (tagged === null) return;
    const ahead = Number(git(['rev-list', '--count', `${tag}..HEAD`]) ?? '0');
    if (!Number.isFinite(ahead) || ahead === 0) return;

    const text = readFileSync(CHANGELOG, 'utf8');
    expect(
      /no unreleased changes/i.test(text),
      `CHANGELOG.md says "No unreleased changes" while ${ahead} commits sit past ${tag}.`,
    ).toBe(false);
  });
});
