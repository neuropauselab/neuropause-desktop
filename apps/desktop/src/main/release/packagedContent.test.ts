/**
 * S131 — tests for the packaged-content assertion (`scripts/verify-packaged-content.cjs`). Proves the
 * classifier passes a clean packaged tree, catches every prohibited class, respects the documented
 * source-map ambiguity, and that HOSTILE FILENAMES (traversal, mixed separators, case, nesting) cannot
 * bypass it. Pure function, exercised directly.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { classifyPackagedPaths } = require('../../../scripts/verify-packaged-content.cjs') as {
  classifyPackagedPaths: (paths: string[], opts?: { prohibitSourceMaps?: boolean }) => { ok: boolean; violations: { path: string; rule: string }[] };
};

const rulesFor = (paths: string[], opts?: { prohibitSourceMaps?: boolean }) =>
  classifyPackagedPaths(paths, opts).violations.map((v) => v.rule).sort();

describe('S131 · packaged-content assertion', () => {
  it('a clean packaged tree passes (real out/** shapes)', () => {
    const clean = ['main/index.js', 'preload/index.js', 'renderer/index.html', 'renderer/assets/app-abc123.js', 'package.json'];
    expect(classifyPackagedPaths(clean)).toEqual({ ok: true, violations: [] });
  });

  it('catches every prohibited class', () => {
    expect(rulesFor(['main/foo.test.ts'])).toContain('test-file');
    expect(rulesFor(['main/foo.spec.js'])).toContain('test-file');
    expect(rulesFor(['main/__tests__/x.js'])).toContain('test-fixture-dir');
    expect(rulesFor(['.env'])).toContain('env-file');
    expect(rulesFor(['config/.env.production'])).toContain('env-file');
    expect(rulesFor(['keys/server.pem'])).toContain('private-key');
    expect(rulesFor(['id_ed25519'])).toContain('private-key');
    expect(rulesFor(['.git/config'])).toContain('repo-metadata');
    expect(rulesFor(['scratch/build.tmp'])).toContain('temp-or-os-cruft');
    expect(rulesFor(['.DS_Store'])).toContain('temp-or-os-cruft');
    expect(rulesFor(['certification/baseline.json'])).toContain('custody-protected');
    expect(rulesFor(['.claude/settings.json'])).toContain('custody-protected');
    expect(rulesFor(['main/chunks/e2eSeed-abc.js'])).toContain('e2e-build-seam');
    expect(rulesFor(['main/firstRealSendGuard.js'])).toContain('e2e-build-seam');
  });

  it('allows legitimate look-alikes (.env.example, .env.sample)', () => {
    expect(classifyPackagedPaths(['config/.env.example', 'config/.env.sample']).ok).toBe(true);
  });

  it('source maps: allowed by default (documented ambiguity), flagged only under --prohibit-source-maps', () => {
    expect(classifyPackagedPaths(['renderer/app.js.map']).ok).toBe(true);
    expect(rulesFor(['renderer/app.js.map'], { prohibitSourceMaps: true })).toContain('source-map');
  });

  it('HOSTILE FILENAMES cannot bypass — traversal, mixed separators, case, deep nesting', () => {
    // path traversal to a secret; a backslash-separated Windows-style path; uppercase env; nested test dir.
    expect(classifyPackagedPaths(['foo/../secret.key']).ok).toBe(false);
    expect(rulesFor(['foo/../secret.key'])).toContain('private-key');
    expect(rulesFor(['a\\b\\evil.test.ts'])).toContain('test-file'); // backslash-separated basename still matched
    expect(rulesFor(['CONFIG/.ENV'])).toContain('env-file'); // case-insensitive
    expect(rulesFor(['deep/nested/__tests__/case.js'])).toContain('test-fixture-dir');
    expect(rulesFor(['a/b/c/id_rsa'])).toContain('private-key');
  });

  it('CI-failure semantics — any violation ⇒ ok:false with the offending paths named', () => {
    const r = classifyPackagedPaths(['main/index.js', 'main/leaked.test.ts', '.env']);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.path).sort()).toEqual(['.env', 'main/leaked.test.ts']);
  });

  it('empty / non-file inputs are safe', () => {
    expect(classifyPackagedPaths([])).toEqual({ ok: true, violations: [] });
    expect(classifyPackagedPaths(['', '.', 'main/'])).toEqual({ ok: true, violations: [] });
  });
});
