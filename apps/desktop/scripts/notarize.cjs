/**
 * electron-builder afterSign hook — Apple notarization.
 *
 * Submits the signed .app to Apple's notary service (notarytool) after signing.
 * It is a deliberate NO-OP when:
 *   - the platform is not macOS, or
 *   - the three credentials are not all present (local/unsigned builds).
 * This lets `npm run package:dir` and unsigned CI builds succeed unchanged.
 *
 * Required environment variables (never hard-code these):
 *   APPLE_ID                      Apple Developer account email
 *   APPLE_APP_SPECIFIC_PASSWORD   app-specific password (appleid.apple.com)
 *   APPLE_TEAM_ID                 10-character Developer Team ID
 */
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      '[notarize] Skipped — set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID to notarize. Producing an un-notarized build.',
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  console.log(`[notarize] Submitting "${appName}.app" to Apple notary (team ${teamId}); this can take several minutes…`);

  const startedAt = Date.now();
  try {
    await notarize({ appPath, appleId, appleIdPassword, teamId });
    console.log(`[notarize] Notarized successfully in ${Math.round((Date.now() - startedAt) / 1000)}s.`);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error(`[notarize] FAILED after ${Math.round((Date.now() - startedAt) / 1000)}s: ${message}`);
    console.error(
      '[notarize] Check: app-specific password valid, Team ID correct, app signed with a "Developer ID Application" certificate, and Hardened Runtime enabled.',
    );
    throw err; // fail the build so an un-notarized artifact is never shipped
  }
};
