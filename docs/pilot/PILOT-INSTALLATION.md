# NeuroPause OS - PILOT Installation Procedure (DRAFT, admin-placed as docs/pilot/PILOT-INSTALLATION.md)

## Pre-installation
1. Confirm a signed human PILOT EXECUTION AUTHORIZATION exists for this pilot.
2. Confirm this participant/device is in the authorized pilot scope.
3. Obtain NeuroPause-Pilot-Setup.exe ONLY from the controlled pilot channel (direct
   operator handoff). NEVER from a public URL or the update feed.
4. Verify the installer SHA-256 against NP-PILOT-MANIFEST.json. Mismatch => STOP.
5. Confirm the manifest states release_class=PILOT and the expected commit.

## Installation
6. Run the installer; note the install path.
7. Launch "NeuroPause (Pilot)". Verify displayed metadata: version, commit,
   RELEASE_CLASS=PILOT (resources/pilot-class.json).
8. Verify NO public auto-update is configured (pilot build has no publish provider).
9. Record: installer filename, version, commit, sha256, install time (UTC),
   machine identifier (minimum-necessary policy). No secret values.

## Health check
10. APPLICATION_STARTS - VERSION_VISIBLE - RELEASE_CLASS=PILOT - PUBLIC_FEED=FALSE -
    PRODUCTION_MODE=FALSE - CONFIGURATION_LOAD=PASS. Any required check fails =>
    PILOT_READY=FALSE, stop, report; do not bypass.

## Boundaries
An installed pilot instance is NOT a production release, establishes no production
readiness, and must not be represented as signed/certified. PILOT->PRODUCTION requires
a new human decision and the separate governed production path.
