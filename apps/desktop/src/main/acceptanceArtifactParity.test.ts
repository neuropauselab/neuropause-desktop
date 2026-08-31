/**
 * P13C ROUND 61 — GATE 20. ACCEPTANCE-ARTIFACT FEATURE PARITY.
 *
 * WHAT THIS GUARDS
 * ----------------
 * The Gate-20 Windows acceptance ran rc.20 (`efe8196`, 2026-08-15) in an
 * offline VM and could not drive items B3/B5/B6/B9. The recorded cause was
 * "gated behind signing in, which needs the cloud auth backend" — true of that
 * binary, false of the product: local-first mode (S17, `89f3c45`, 2026-08-18)
 * removed the sign-in wall three days after rc.20 was cut. The artifact was 390
 * commits stale and NOTHING bound it to the procedure that consumed it, so a
 * machine session was spent discovering a limitation of the build.
 *
 * `scripts/verify-acceptance-artifact.cjs` answers "does this artifact contain
 * the features the procedure drives?" before a session is spent. These pins
 * hold two distinct things:
 *
 *   1. THE MANIFEST CANNOT ROT. Every marker is asserted to still exist in
 *      current source. Without this the manifest could silently come to assert
 *      the absence of something that merely got renamed — a false-absence
 *      claim, which is the exact failure class the verifier exists to prevent.
 *      This is consumer-end pinning: the requirement flows from the source that
 *      must contain the feature, not from the script that looks for it.
 *
 *   2. THE VERIFIER IS LOAD-BEARING. It must FAIL on an artifact missing a
 *      feature, PASS on one that has them, and refuse to issue any verdict when
 *      its own search instrument misbehaves.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const MAIN = fileURLToPath(new URL('.', import.meta.url));
const DESKTOP = join(MAIN, '..', '..');
const REPO = join(DESKTOP, '..', '..');

const require_ = createRequire(import.meta.url);
const {
  verifyAcceptanceArtifact,
  countOccurrences,
  FEATURE_MANIFEST,
  CONTROL_ABSENT,
  CONTROL_PRESENT,
} = require_(join(DESKTOP, 'scripts', 'verify-acceptance-artifact.cjs'));

/** Resolve a manifest `source` path (repo-relative) to disk. */
function sourceOf(rel: string): string {
  const p = join(REPO, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

/** A synthetic artifact body containing every marker plus the present-control. */
function fullArtifact(): string {
  return (
    `some electron bundle preamble\n` +
    FEATURE_MANIFEST.map((f: { marker: string }) => `>>${f.marker}<<`).join('\n')
  );
}

describe('acceptance-artifact feature manifest (Gate 20)', () => {
  it('is non-empty and every entry is fully specified', () => {
    expect(FEATURE_MANIFEST.length).toBeGreaterThan(0);
    for (const f of FEATURE_MANIFEST) {
      expect(f.id, 'id').toBeTruthy();
      expect(f.marker, `marker for ${f.id}`).toBeTruthy();
      expect(f.source, `source for ${f.id}`).toBeTruthy();
      expect(f.why, `why for ${f.id}`).toBeTruthy();
      expect(Array.isArray(f.acceptanceItems) && f.acceptanceItems.length > 0).toBe(true);
    }
  });

  // THE ANTI-ROT PIN. If a marker stops existing in the source that is supposed
  // to contain it, this fails HERE — loudly, in the suite — instead of the
  // verifier silently reporting a real artifact as missing a feature it has.
  it('every marker still exists in the source file that must contain it', () => {
    const rotted: string[] = [];
    for (const f of FEATURE_MANIFEST) {
      const text = sourceOf(f.source);
      if (text === '') {
        rotted.push(`${f.id}: source file missing → ${f.source}`);
        continue;
      }
      if (countOccurrences(text, f.marker) === 0) {
        rotted.push(`${f.id}: marker ${JSON.stringify(f.marker)} not found in ${f.source}`);
      }
    }
    expect(rotted, `manifest has rotted:\n${rotted.join('\n')}`).toEqual([]);
  });

  // Markers must be string literals (UI copy / channel ids / log lines), never
  // bare identifiers: a minifier renames identifiers, so an absent identifier
  // proves nothing about the artifact.
  it('markers are minification-durable (contain a space, colon, or dot)', () => {
    const fragile = FEATURE_MANIFEST.filter(
      (f: { marker: string }) => !/[\s:.]/.test(f.marker),
    ).map((f: { id: string; marker: string }) => `${f.id}=${f.marker}`);
    // Identifier-shaped markers are permitted only where the identifier is also
    // an exported cross-module symbol that survives bundling; each is listed
    // explicitly so the exception is deliberate, never accidental.
    const ALLOWED_IDENTIFIER_MARKERS = ['protectedOwnerIdForTarget', 'announceTenantRecovery'];
    const unexpected = fragile.filter(
      (s) => !ALLOWED_IDENTIFIER_MARKERS.some((a) => s.endsWith(`=${a}`)),
    );
    expect(unexpected, `fragile identifier markers: ${unexpected.join(', ')}`).toEqual([]);
  });
});

describe('verifyAcceptanceArtifact — load-bearing behaviour (Gate 20)', () => {
  it('PASSES an artifact that contains every manifest feature', () => {
    const r = verifyAcceptanceArtifact({
      asarText: fullArtifact(),
      buildInfo: { version: '1.0.0-rc.99', commit: 'abc1234', dirty: false },
    });
    expect(r.instrument).toBe('OK');
    expect(r.missing).toEqual([]);
    expect(r.unreachableItems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  // THE GATE-20 REPRODUCTION, in miniature: an artifact with every feature
  // EXCEPT local-first entry must be reported as unable to drive the signed-in
  // acceptance items — which is exactly what the real rc.20 artifact does.
  it('FAILS an artifact missing local-first entry, and names the unreachable items', () => {
    const withoutLocalFirst = fullArtifact()
      .split('\n')
      .filter((l) => !l.includes('Working locally'))
      .join('\n');
    const r = verifyAcceptanceArtifact({
      asarText: withoutLocalFirst,
      buildInfo: { version: '1.0.0-rc.20', commit: 'efe8196', dirty: false },
    });
    expect(r.instrument).toBe('OK');
    expect(r.ok).toBe(false);
    expect(r.missing.map((m: { id: string }) => m.id)).toContain('local-first-entry');
    // The four items the real Windows session could not drive.
    for (const item of ['B3', 'B5', 'B6', 'B9']) {
      expect(r.unreachableItems).toContain(item);
    }
  });

  it('reports a dirty build as a provenance failure', () => {
    const r = verifyAcceptanceArtifact({
      asarText: fullArtifact(),
      buildInfo: { version: '1.0.0-rc.99', commit: 'abc1234', dirty: true },
    });
    expect(r.ok).toBe(false);
    expect(r.checks.some((c: { label: string; ok: boolean }) => c.label === 'build provenance clean' && !c.ok)).toBe(true);
  });

  it('fails when build-info is absent rather than assuming provenance', () => {
    const r = verifyAcceptanceArtifact({ asarText: fullArtifact(), buildInfo: null });
    expect(r.ok).toBe(false);
    expect(r.checks.some((c: { label: string; ok: boolean }) => c.label === 'build-info present' && !c.ok)).toBe(true);
  });

  // A zero from an unverified instrument is evidence about the instrument, not
  // about the artifact. Both control directions must be honoured.
  it('refuses a verdict when the present-control is missing (INSTRUMENT_FAILURE)', () => {
    const r = verifyAcceptanceArtifact({
      asarText: FEATURE_MANIFEST.map((f: { marker: string }) => f.marker).join('\n'),
      buildInfo: { version: 'x', commit: 'y', dirty: false },
    });
    expect(r.instrument).toBe('INSTRUMENT_FAILURE');
    expect(r.ok).toBe(false);
    expect(r.checks).toEqual([]);
  });

  it('refuses a verdict when the absent-control appears (INSTRUMENT_FAILURE)', () => {
    const r = verifyAcceptanceArtifact({
      asarText: `${fullArtifact()}\n${CONTROL_ABSENT}\n`,
      buildInfo: { version: 'x', commit: 'y', dirty: false },
    });
    expect(r.instrument).toBe('INSTRUMENT_FAILURE');
    expect(r.ok).toBe(false);
  });

  it('counts exact substrings without regex interpretation', () => {
    expect(countOccurrences('a.b a.b axb', 'a.b')).toBe(2);
    expect(countOccurrences('abc', '')).toBe(0);
    expect(CONTROL_PRESENT).toBeTruthy();
  });
});
