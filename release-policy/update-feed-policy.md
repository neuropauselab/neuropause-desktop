# Public Update Feed Policy

Established: NP-RELEASE-043 §23 (18/09/2026)

## Rule

UNSIGNED RELEASE CANDIDATE          → CANNOT ENTER PUBLIC UPDATE FEED
SIGNED + VERIFIED RELEASE CANDIDATE → MAY ENTER PUBLIC UPDATE FEED

    PILOT-CLASS ARTIFACT                 -> CANNOT ENTER PUBLIC UPDATE FEED
    (regardless of signing state; PILOT distribution is CONTROLLED_PILOT only,
     per release-policy/pilot-class-policy.json and the PILOT-CLASS GOVERNANCE
     AMENDMENT v1.0. A pilot artifact in updates/*.yml or any publicly
     addressable update path is a policy violation.)

The public update feed (`https://neuropause033.com/updates/*.yml` and the
artifacts they reference) is part of the governed release path. It must not
become a parallel release path outside the governed release process
(`.github/workflows/neuropause-release.yml`).

## Requirements for feed entry

An artifact may be referenced by `beta.yml` / `latest.yml` (or the mac
equivalents) only when ALL of the following hold:

1. It is the exact artifact of an admitted release candidate (version, commit,
   digest recorded).
2. Windows: Authenticode-signed; the signer CN matches the
   `EXPECTED_WIN_SIGNER_CN` repository variable and the `win.publisherName`
   build configuration.
3. macOS: codesigned and notarized; team id matches `EXPECTED_MAC_TEAM_ID`.
4. Signing verification (`scripts/verify-signing.cjs`) has passed for the
   artifact.
5. The feed entry's `sha512`/`size` describe exactly the built binary
   (`scripts/verify-feed.cjs` has passed).

## Enforcement points

- `apps/desktop/electron-builder.yml` — `win.forceCodeSigning: true`: an
  unsigned Windows artifact cannot be packaged.
- `.github/workflows/neuropause-release.yml` — signing credentials are tested
  before packaging; signing verification and feed verification run before
  staging; promotion copies only from the immutable staged set.
- Client — `win.publisherName` (operator item) enables electron-updater's
  Authenticode verification of every downloaded update.

## Known violation (recorded 18/09/2026)

The live feed currently advertises `1.0.0-rc.27` / `NeuroPause-Setup.exe`
(size 111,894,625; feed metadata sha256
`f39881cfd41149d6ba08cc8eac25d4d5bba2e1b2c64e887b2bd8d27602f70eb4`;
Last-Modified 15 Sep 2026 06:03:52 GMT), independently measured as UNSIGNED
(PE certificate table, Computer-B NP-R34.2-B.41.4.2 H06; reproduced by
Computer-A 18/09/2026 via feed + HEAD metadata). Under this policy that
artifact must be removed from the feed or replaced by a signed, admitted
candidate. The removal is an OPERATOR action on the update host
(`/opt/neuropause-site/website/updates/`), recorded in the release evidence
when performed.
---