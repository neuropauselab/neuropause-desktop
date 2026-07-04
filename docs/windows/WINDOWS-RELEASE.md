# WINDOWS-RELEASE

Releasing a Windows build to users. Complements PRODUCTION-LAUNCH.md (backend)
and the macOS packaging docs.

## Prerequisites

- A **Windows build machine or CI runner** (Phase 7 wires GitHub Actions
  `windows-latest` — the machine-free path). electron-builder cannot build
  Windows artifacts on macOS/Linux.
- The live backend (already up: `https://api.neuropause033.com`).
- Optional but recommended: an **Authenticode code-signing certificate** (Phase
  4) to remove the SmartScreen warning.

## Release sequence

1. **Version.** Bump `apps/desktop/package.json` `version` (e.g. `1.0.0-rc.2`).
   A `-rc`/`-beta` prerelease keeps `publish.channel: beta`; dropping the
   prerelease promotes to stable (set channel `latest`).
2. **Build** on Windows: `npm run package:win` (see WINDOWS-BUILD.md). Produces
   the installer, portable, zip, and the channel feed manifest.
3. **Verify locally** on the Windows box: run the checklist below.
4. **Sign** (if certificate available): set `WIN_CSC_LINK` +
   `WIN_CSC_KEY_PASSWORD` before the build; the `.exe` is then Authenticode-
   signed and SmartScreen-clean.
5. **Publish** the `.exe` (and `.zip` + `latest.yml`/`beta.yml`) to your host —
   GitHub Releases or the same static server as macOS. electron-updater reads the
   per-platform feed automatically.
6. **Download page**: add the Windows installer link alongside the macOS `.dmg`.

## Local verification checklist (run on Windows before publishing)

- [ ] Installer launches; wizard shows; directory choice works
- [ ] Installs per-user with **no admin prompt**
- [ ] Desktop + Start Menu shortcuts created, named NeuroPause
- [ ] App launches; onboarding wizard appears on first run
- [ ] Sign-in succeeds against `api.neuropause033.com` (loopback OAuth returns)
- [ ] A connector (e.g. Google) completes OAuth and syncs
- [ ] Secrets persist across restart (safeStorage/DPAPI)
- [ ] Uninstaller listed in Settings → Apps; uninstall removes the app
- [ ] Reinstall preserves per-user data (`%APPDATA%` untouched by uninstall)
- [ ] `.exe` Properties → Details shows version 1.0.0-rc.x

(Full QA matrix — fresh/upgrade/downgrade/uninstall/reinstall/data-preservation —
is Phase 6.)

## Known limitations at this phase

- **No `.exe` has been built yet** — this phase delivered the *configuration*;
  building requires a Windows host/runner.
- **No `icon.ico`** — default Electron icon until the asset is added (cosmetic).
- **Unsigned** until an Authenticode cert is supplied (Phase 4) — SmartScreen
  "Run anyway" applies, same as the macOS unsigned experience.
- **Auto-update** feed URL is still the placeholder `updates.neuropause.example`
  — set a real host (shared with macOS) when wiring updates (Phase 5/7).

## macOS unaffected

No macOS packaging, signing, or release configuration was changed in this phase.
