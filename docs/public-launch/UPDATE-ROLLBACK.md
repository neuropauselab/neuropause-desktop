# NeuroPause — Update and rollback

## Mechanism (measured in code and on the built artifacts)

- electron-updater 6.x, generic provider, feed `https://neuropause033.com/updates/beta-mac.yml` (macOS) and `beta.yml` (Windows); channel derived from the version's prerelease tag (`-rc` → beta).
- The app never downloads or installs silently: check → user-driven download → install-on-restart (`services/appUpdater.ts`).
- `autoDownload=false`, `autoInstallOnAppQuit=false`, `allowDowngrade=false` (now set AFTER the channel assignment so the channel setter cannot override it).
- Integrity: the feed's `sha512` is verified by electron-updater against the downloaded payload; `verify-release-artifacts.cjs` proves the feed matches the built binaries before publication; `verify-mac-artifact.cjs` re-proves it from the published containers.

## Verified behaviours

| Case | Expected | Evidence |
| --- | --- | --- |
| Feed references a payload whose sha512 differs | REFUSE | NEG-BYTE control: FEED=FAIL |
| Feed points at a filename that does not exist | REFUSE / verifier FAIL | NEG-NAME control |
| Feed unreachable | safe no-update (`error` phase, app keeps running) | `appUpdater.ts` error transition |
| Downgrade offered | refused (`allowDowngrade=false`) | code + ordering fix |
| Old arm64-only install → universal | feed carries only universal names; `filterFilesForArch` keeps them for both arches | 15_UPDATE_FEED_VERIFICATION |

## Rollback

`AUTOMATIC_ROLLBACK = NOT_SUPPORTED` by design (downgrade disabled). Safe rollback paths:
1. Server-side release freeze: remove/replace the feed entry so no client is offered the bad build.
2. Manual reinstall of the previous signed DMG/installer (kept immutable under `downloads/` with its digest).
3. A forward-fix release with a higher version.

Rollback of the client itself was not exercised end-to-end (no second signed release exists on this branch): `ROLLBACK = NOT_MEASURED` in the registers. Rollback of the feed is a host operation and was BLOCKED (host unreachable / SSH denied).
