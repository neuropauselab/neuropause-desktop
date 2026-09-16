/**
 * S131 — tests for the SBOM generator + verifier (`scripts/generate-sbom.cjs`, `scripts/verify-sbom.cjs`).
 * Loaded via createRequire and exercised against a synthetic lockfile fixture AND the REAL committed
 * package-lock.json, so the controls are proven deterministic and lockfile-corresponding without a build.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const gen = require('../../../scripts/generate-sbom.cjs') as {
  buildSbom: (lockfile: unknown) => { bomFormat: string; specVersion: string; version: number; components: Array<{ type: string; name: string; version: string; purl: string; scope: string; properties?: Array<{ name: string; value: string }> }>; metadata: unknown };
  buildProvenance: (env: Record<string, string | undefined>, digest: string, gitCommit: string | null) => { attestationLevel: string; subject: { sbomDigest: string | null }; build: Record<string, unknown> };
  jsonDigest: (o: unknown) => string;
  npmPurl: (n: string, v: string) => string;
};
const ver = require('../../../scripts/verify-sbom.cjs') as {
  validateSbom: (sbom: unknown, lockfile: unknown) => { ok: boolean; errors: string[] };
};

const FIXTURE = {
  name: 'fixture-app',
  version: '9.9.9',
  packages: {
    '': { name: 'fixture-app', version: '9.9.9' },
    'node_modules/left-pad': { version: '1.3.0', integrity: 'sha512-AAAA', resolved: 'x' },
    'node_modules/@scope/thing': { version: '2.0.0', dev: true, integrity: 'sha512-BBBB' },
    'node_modules/dep-a/node_modules/left-pad': { version: '1.3.0' }, // nested duplicate → deduped
    'node_modules/dep-a': { version: '4.5.6' },
    'node_modules/@neuropause/desktop': { link: true }, // workspace link → excluded
    'node_modules/no-version-pkg': { resolved: 'y' }, // no version → excluded
  },
};

describe('S131 · SBOM generation (pure, deterministic)', () => {
  it('builds a CycloneDX 1.5 SBOM from the lockfile — deduped, sorted, workspace-links excluded', () => {
    const sbom = gen.buildSbom(FIXTURE);
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.specVersion).toBe('1.5');
    const ids = sbom.components.map((c) => `${c.name}@${c.version}`);
    expect(ids).toEqual(['@scope/thing@2.0.0', 'dep-a@4.5.6', 'left-pad@1.3.0']); // sorted by purl, deduped
    expect(sbom.components.every((c) => c.type === 'library')).toBe(true);
    const scoped = sbom.components.find((c) => c.name === '@scope/thing')!;
    expect(scoped.purl).toBe('pkg:npm/%40scope/thing@2.0.0');
    expect(scoped.scope).toBe('optional'); // dev dependency
    expect(scoped.properties).toEqual([{ name: 'npm:integrity', value: 'sha512-BBBB' }]);
  });

  it('is byte-deterministic for a given lockfile (no clock, no randomness)', () => {
    expect(JSON.stringify(gen.buildSbom(FIXTURE))).toBe(JSON.stringify(gen.buildSbom(FIXTURE)));
  });

  it('provenance binds SBOM digest + CI identity; absent CI fields are null (never fabricated)', () => {
    const digest = gen.jsonDigest(gen.buildSbom(FIXTURE));
    const ci = gen.buildProvenance(
      { GITHUB_REPOSITORY: 'np/app', GITHUB_SHA: 'abc123', GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '42', RUNNER_NAME: 'gh-1' },
      digest, null,
    );
    expect(ci.attestationLevel).toBe('SELF_ATTESTED_UNSIGNED'); // precise honesty — not signed SLSA
    expect(ci.subject.sbomDigest).toBe(digest);
    expect(ci.build.repository).toBe('np/app');
    expect(ci.build.commit).toBe('abc123');
    expect(ci.build.hosted).toBe(true);

    const local = gen.buildProvenance({}, digest, 'localsha');
    expect(local.build.repository).toBeNull(); // CI-only field honestly null locally
    expect(local.build.commit).toBe('localsha'); // falls back to git commit
    expect(local.build.hosted).toBe(false);
    expect(local.build.builderIdentity).toBe('local');
  });
});

describe('S131 · SBOM verification (fail-closed)', () => {
  it('accepts a well-formed SBOM that corresponds to its lockfile', () => {
    const sbom = gen.buildSbom(FIXTURE);
    expect(ver.validateSbom(sbom, FIXTURE)).toEqual({ ok: true, errors: [] });
  });

  it('REJECTS an empty component list (not a bill of materials)', () => {
    const r = ver.validateSbom({ bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, components: [] }, FIXTURE);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/EMPTY/);
  });

  it('REJECTS a non-CycloneDX envelope and a non-array components', () => {
    expect(ver.validateSbom({ bomFormat: 'SPDX', specVersion: '1.5', version: 1, components: [] }, FIXTURE).ok).toBe(false);
    expect(ver.validateSbom({ bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, components: {} }, FIXTURE).ok).toBe(false);
  });

  it('REJECTS an invented component not present in the lockfile (correspondence)', () => {
    const sbom = gen.buildSbom(FIXTURE);
    sbom.components.push({ type: 'library', name: 'evil-injected', version: '6.6.6', purl: 'pkg:npm/evil-injected@6.6.6', scope: 'required' });
    const r = ver.validateSbom(sbom, FIXTURE);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/NOT in the lockfile|count/);
  });

  it('REJECTS components missing name/version/type/purl', () => {
    const bad = { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, components: [{ name: '', version: '', type: 'file', purl: 'nope' }] };
    const r = ver.validateSbom(bad, null);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('REJECTS hostile/malformed component names — traversal, spaces, control chars, over-nested scope', () => {
    for (const name of ['../evil', 'a b', 'a\nb', 'a/b', '@scope/a/b', 'a\tb', '@bad']) {
      const sbom = { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, components: [{ type: 'library', name, version: '1.0.0', purl: `pkg:npm/${name}@1.0.0` }] };
      const r = ver.validateSbom(sbom, null);
      expect(r.ok, `hostile name ${JSON.stringify(name)} must be rejected`).toBe(false);
      expect(r.errors.join(' ')).toMatch(/hostile\/malformed|purl/);
    }
  });

  it('END-TO-END against the REAL committed lockfile: generated SBOM validates and is non-empty', () => {
    const repoRoot = join(__dirname, '..', '..', '..', '..', '..');
    const lockfile = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'));
    const sbom = gen.buildSbom(lockfile);
    expect(sbom.components.length).toBeGreaterThan(100); // a real dependency graph
    expect(ver.validateSbom(sbom, lockfile)).toEqual({ ok: true, errors: [] });
  });
});
