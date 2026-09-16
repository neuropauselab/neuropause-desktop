# NeuroPause OS — Installation (public launch)

## Supported platforms (measured from the artifacts, not from marketing text)

| Platform | Artifact | Architecture | Minimum OS | Signing | Gatekeeper / SmartScreen today |
| --- | --- | --- | --- | --- | --- |
| macOS | `NeuroPause-universal.dmg` (installer), `NeuroPause-1.0.0-rc.30-universal-mac.zip` (update payload) | universal: x86_64 + arm64 (all 15 Mach-O objects) | 12.0 Monterey (`LSMinimumSystemVersion`, measured) | Developer ID Application (Team J3G89MY3QG), hardened runtime | **NOT notarized** → `spctl` rejects: "Unnotarized Developer ID". A public user cannot open it without right-click → Open |
| Windows | `NeuroPause-Setup.exe` (NSIS, per-user, x64), portable `.exe`, `-win.zip` | x64 | Windows 10/11 x64 (declared) | **unsigned** (no Authenticode certificate) | SmartScreen "unknown publisher" warning |

Intel Macs are supported by the same universal artifact. Apple Silicon runtime is measured (packaged-runtime smoke test); Intel runtime is `NOT_MEASURED` on this hardware (no Intel runner).

## First run (what actually happens)

1. Launch → the app starts in **local mode**: "Working locally — your data stays on this device. Connect an account to sync." No sign-in wall.
2. Connect an account → email/password or OAuth (OAuth providers are disabled until server credentials exist).
3. Device registration happens per organization (`POST /devices`); a revoked device is refused with 403.
4. If the backend is unreachable (measured HTTP 530 on 2026-09-12), the app stays in local mode and **keeps** stored credentials (fix shipped in this branch: 5xx/52x/429 are transient, not rejection).

There is no consent screen, policy-bootstrap step or health-check page as separate states; these are recorded as gaps in `19_FIRST_RUN_REGISTER.json`.

## Verify a download

```
shasum -a 256 NeuroPause-universal.dmg
```
Compare with `certification/public-launch-002/31_RELEASE_ARTIFACT_REGISTER.json` (and `37_RELEASE_CHECKSUMS.txt` under `certification/public-launch/`). The values are generated from the bytes, never typed.

## Uninstall

macOS: drag `NeuroPause.app` to the Trash; user data lives in `~/Library/Application Support/NeuroPause`. Windows: Settings → Apps → NeuroPause → Uninstall; user data in `%APPDATA%\NeuroPause`.

## What is not yet true for a public user

- macOS notarization is absent (operator credential boundary).
- Windows signing is absent (no certificate).
- The public download host answered HTTP 530 and the apex domain had no DNS record on 2026-09-12; the registry expiry recorded by the mapper is 2026-09-15.
