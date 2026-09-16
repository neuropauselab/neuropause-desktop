/**
 * P13C ROUND 24 — a notarization failure must not destroy a signed artifact.
 *
 * macos-release #2 signed the app correctly and then died on a notarytool 401.
 * The `throw` in the afterSign hook took the build down INSIDE `package:mac`,
 * before the upload-artifact step that Round 17m added precisely so a later
 * step could not cost us the artifact. Six minutes of build, correct output,
 * nothing delivered.
 *
 * "Fail the build so an un-notarized artifact is never shipped" conflated
 * BUILDING with SHIPPING. A tag push may be published, so there it still
 * throws. A manual build exists to produce something testable, so there it
 * warns and keeps the artifact — marked un-notarized in a file, never assumed.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { notarizationRequirement } = require_('../../../scripts/notarize.cjs') as {
  notarizationRequirement: (env: NodeJS.ProcessEnv) => { required: boolean; reason: string };
};

describe('notarization is required only where an artifact may be published', () => {
  it('a tag push requires it — that build can become a GitHub Release', () => {
    expect(notarizationRequirement({ GITHUB_REF: 'refs/tags/v1.0.0-rc.16' }).required).toBe(true);
  });

  it('a branch push does not — the artifact is worth keeping either way', () => {
    expect(notarizationRequirement({ GITHUB_REF: 'refs/heads/main' }).required).toBe(false);
  });

  it('a local build does not', () => {
    expect(notarizationRequirement({}).required).toBe(false);
  });

  it('can be demanded explicitly', () => {
    expect(notarizationRequirement({ NEUROPAUSE_REQUIRE_NOTARIZATION: 'true' }).required).toBe(true);
  });

  it('can be waived explicitly, even on a tag — a deliberate founder-test build', () => {
    const r = notarizationRequirement({
      GITHUB_REF: 'refs/tags/v1.0.0-rc.16',
      NEUROPAUSE_ALLOW_UNNOTARIZED: 'true',
    });
    expect(r.required).toBe(false);
    // The waiver must name itself, so a marker file cannot look like a success.
    expect(r.reason).toContain('deliberate');
  });

  it('the waiver beats the demand — an explicit opt-out is never overridden', () => {
    expect(
      notarizationRequirement({
        NEUROPAUSE_REQUIRE_NOTARIZATION: 'true',
        NEUROPAUSE_ALLOW_UNNOTARIZED: 'true',
      }).required,
    ).toBe(false);
  });

  it('every decision carries a reason, so the marker file can state why', () => {
    for (const env of [{}, { GITHUB_REF: 'refs/tags/v1' }, { NEUROPAUSE_ALLOW_UNNOTARIZED: 'true' }]) {
      expect(notarizationRequirement(env).reason.length).toBeGreaterThan(10);
    }
  });
});
