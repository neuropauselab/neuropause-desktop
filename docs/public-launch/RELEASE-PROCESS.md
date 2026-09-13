# NeuroPause — Release process (as it must run for a public build)

```
SOURCE (commit, clean tree)            git rev-parse HEAD; git status --porcelain == ""
  → VERSION                            npm run version:bump (five fields in sync); a version is spent once tagged
  → CLEAN INSTALL                      npm ci from the lockfile (never a symlinked node_modules)
  → GATES                              npm run typecheck · backend + desktop suites · npm run build
  → PACKAGE                            apps/desktop: npm run package:mac (universal) · npm run package:win
  → VERIFY (bytes, not build dir)      node scripts/verify-mac-artifact.cjs --dist dist
                                       node scripts/verify-mac-artifact.controls.cjs --dist dist   (negative controls must FAIL closed)
                                       node scripts/packaged-smoke.cjs --zip dist/*-mac.zip         (PACKAGE → LOAD → READY)
  → SIGN                               electron-builder with Developer ID (CSC_LINK in CI, keychain locally)
  → NOTARIZE + STAPLE                  notarytool (APPLE_ID / app-specific password / team) — status in dist/notarization-status.json
  → RELEASE MANIFEST                   dist/verification/release-manifest.mac.json (np.mac.release/v1) — digests after ALL transformations
  → PUBLISH (human-authorized only)    PUBLISH_TO_SITE=true + tag push → GitHub Release + site + feed
  → LAST MILE                          download bytes == manifest digest; feed == payload; clean-machine install; first run
  → HUMAN RELEASE DECISION             PUBLIC_RELEASE_AUTHORIZATION record — separate from every automated gate
```

`npm run neuropause:public-launch:verify` is the read-only final check (exit codes 0–7, see `scripts/public-launch-verify.cjs`).

## Provenance binding

`build-info.json` (inside the app) carries version, channel, commit (with `-dirty` when built over an unclean tree), branch, build time and the baked backend URL. The release manifest binds commit → tree → artifact digests → signing identity → notarization status. Two binaries cannot share a release id: `release_id = NP-OS-<version>-<commit12>` and each artifact's sha256 is recorded.

## CI

`macos-release.yml` (runner now pinned to `macos-15`; unverified until a pushed commit runs it) and `windows-release.yml` build on tag push or manual dispatch. Publishing to the site is gated on the repo variable `PUBLISH_TO_SITE` (unset). The rc.29 macOS run failed in the signing keychain step; the rc.29 Windows run failed on a UI test race fixed in this branch.
