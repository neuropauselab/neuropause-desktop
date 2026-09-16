/**
 * electron-builder afterSign hook — Apple notarization.
 *
 * P13C ROUND 24 — WHY THIS CHANGED.
 *
 * On 13 Aug, `macos-release` #2 signed the app correctly:
 *
 *   • signing  identityName=Developer ID Application: … identityHash=5D6C38F1…
 *
 * and then died here with a 401 from notarytool ("The account does not exist").
 * The `throw` below destroyed a correctly signed .app, and because the failure
 * happens INSIDE `package:mac`, it took the build down before the
 * upload-artifact step that Round 17m added specifically so that a step after
 * the artifact exists can never cost us the artifact. Same lesson, one layer
 * deeper: a 6-minute build produced the right thing and delivered nothing.
 *
 * The old comment — "fail the build so an un-notarized artifact is never
 * shipped" — is correct about SHIPPING and wrong about BUILDING. Those are
 * different acts. So:
 *
 *   - credentials absent            → skip, no failure (unchanged)
 *   - notarization fails, tag push  → THROW. A published release must be
 *                                     notarized; an un-notarized .dmg shows
 *                                     Gatekeeper's "cannot be opened" dialog.
 *   - notarization fails, otherwise → LOUD WARNING, artifact survives.
 *   - NEUROPAUSE_ALLOW_UNNOTARIZED  → downgrade even a tag push to a warning,
 *                                     for a deliberate founder-test build.
 *
 * In every case a machine-readable marker is written to
 * `dist/notarization-status.json` so nothing downstream has to GUESS whether an
 * artifact is notarized. "It built" was never the same claim as "it is
 * notarized", and the difference is now a file rather than an assumption.
 *
 * Required environment variables (never hard-code these):
 *   APPLE_ID                      Apple Developer account email
 *   APPLE_APP_SPECIFIC_PASSWORD   app-specific password (appleid.apple.com)
 *   APPLE_TEAM_ID                 10-character Developer Team ID
 */
const { notarize } = require('@electron/notarize');
const { writeFileSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

/**
 * Is a notarization failure fatal? Pure, so it is testable without Apple.
 *
 * `env` is process.env. Returns { required, reason }.
 */
function notarizationRequirement(env) {
  if (String(env.NEUROPAUSE_ALLOW_UNNOTARIZED || '').toLowerCase() === 'true') {
    return { required: false, reason: 'NEUROPAUSE_ALLOW_UNNOTARIZED=true — deliberate un-notarized build' };
  }
  if (String(env.NEUROPAUSE_REQUIRE_NOTARIZATION || '').toLowerCase() === 'true') {
    return { required: true, reason: 'NEUROPAUSE_REQUIRE_NOTARIZATION=true' };
  }
  if (String(env.GITHUB_REF || '').startsWith('refs/tags/')) {
    return { required: true, reason: `tag push (${env.GITHUB_REF}) — this build may be published` };
  }
  return { required: false, reason: 'not a tag push — build artifact is kept even if notarization fails' };
}

/** Record what actually happened, so no downstream step has to assume. */
function writeStatus(appOutDir, status) {
  try {
    const path = join(dirname(appOutDir), 'notarization-status.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`);
    console.log(`[notarize] status written: ${path} (${status.state})`);
  } catch (err) {
    console.error(`[notarize] could not write status marker: ${err && err.message}`);
  }
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const version = context.packager.appInfo.version;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      '[notarize] Skipped — set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID to notarize. Producing an un-notarized build.',
    );
    writeStatus(appOutDir, {
      state: 'skipped',
      notarized: false,
      version,
      reason: 'one or more Apple credentials are absent',
      at: new Date().toISOString(),
    });
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const { required, reason } = notarizationRequirement(process.env);
  console.log(`[notarize] Submitting "${appName}.app" to Apple notary (team ${teamId}); this can take several minutes…`);

  const startedAt = Date.now();
  try {
    await notarize({ appPath, appleId, appleIdPassword, teamId });
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[notarize] Notarized successfully in ${seconds}s.`);
    writeStatus(appOutDir, { state: 'notarized', notarized: true, version, seconds, at: new Date().toISOString() });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    console.error(`[notarize] FAILED after ${seconds}s: ${message}`);
    console.error(
      '[notarize] Check: app-specific password valid (Apple issues it WITH dashes), Team ID correct, the Apple ID enrolled in the Developer Program, app signed with a "Developer ID Application" certificate, and Hardened Runtime enabled.',
    );
    writeStatus(appOutDir, {
      state: 'failed',
      notarized: false,
      version,
      seconds,
      error: message,
      failedTheBuild: required,
      requirementReason: reason,
      at: new Date().toISOString(),
    });
    if (required) {
      console.error(`[notarize] FAILING THE BUILD — ${reason}. A published release must be notarized.`);
      throw err;
    }
    console.error(
      `[notarize] NOT failing the build — ${reason}.\n` +
        '[notarize] The SIGNED artifact is kept and marked un-notarized in notarization-status.json.\n' +
        '[notarize] It will show Gatekeeper\'s "cannot be opened" dialog on another Mac. Do not distribute it.',
    );
  }
};

// Exported for tests. The decision is the part worth verifying without Apple.
exports.notarizationRequirement = notarizationRequirement;
