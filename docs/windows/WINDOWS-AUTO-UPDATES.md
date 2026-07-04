# WINDOWS-AUTO-UPDATES

How automatic updates work for NeuroPause on Windows. **Key finding (recon): the
auto-update system already exists and is complete** — this phase changed exactly
one thing (the feed provider), reusing all existing code per the charter.

## What already exists (verified, not built)

- **`src/main/services/appUpdater.ts`** — a full electron-updater wrapper with the
  complete state machine: `checking → available → downloading → downloaded →
  error / not-available`. Sets `autoDownload=false`, `autoInstallOnAppQuit=false`,
  `allowDowngrade=false`, and channel/prerelease flags per the selected channel.
- **`src/main/services/updater/updateChannels.ts`** (tested) — the three-channel
  model: **stable** (latest.yml), **beta** (beta.yml), **internal**.
- **Six IPC channels** — `update:getStatus`, `update:checkNow`, `update:download`,
  `update:installOnQuit`, `update:setChannel`, `update:event` (broadcast).
- **`src/renderer/src/operations/UpdatesPanel.tsx`** — the update UI.

None of this was duplicated. The only gap was *where the app looks for updates*.

## The one change this phase made

`electron-builder.yml` `publish:` was pointed from the placeholder `generic`
host (`updates.neuropause.example`, which never existed) to **GitHub Releases**:

```
publish:
  provider: github
  owner: dishantdobariya91-debug
  repo: neuropause-desktop
  channel: beta
```

Why: the `windows-release` CI workflow **already publishes** `latest.yml` + the
installer/zip to a GitHub Release on every tag (proven by the green v1.0.0-rc.7
run). electron-updater's github provider reads that exact Release. So updates now
flow through infrastructure that already exists — no separate static host, no new
code.

## The update flow (Windows)

1. The installed app (built with this config) knows its feed is the GitHub repo's
   Releases.
2. On check (manual via the Updates panel, or the app's configured cadence),
   electron-updater fetches the channel manifest (`beta.yml` for -rc/-beta,
   `latest.yml` for stable) from the newest matching Release.
3. If a newer version exists, the state machine emits `available`; the UI shows it.
4. `autoDownload=false` means the **user chooses** to download — then progress
   streams via `download-progress` → the panel shows a progress bar.
5. On `update-downloaded`, the UI offers **Restart & Install**; electron-updater
   runs the NSIS updater, which replaces the app and relaunches.

## Prerequisites for it to actually deliver an update

- A **published GitHub Release** containing `latest.yml`/`beta.yml` + the `.exe`
  (CI does this on tag — already working).
- The installed build must have been packaged with the **github** publish config
  (i.e. built from this commit onward). Builds made before this change point at
  the old placeholder feed and won't update until replaced once.
- For a **private** repo, electron-updater needs a token to read Releases
  (`GH_TOKEN` in the app environment) — see UPDATE-VERIFICATION.md. A public repo
  needs none. (This is the one real caveat for a private-repo distribution.)

## Rollback / safety (from existing code)

- `allowDowngrade=false` — the updater will not move a user to an older version.
- `autoInstallOnAppQuit=false` + `autoDownload=false` — nothing installs without
  explicit user action, so a bad auto-install can't happen silently.
- electron-updater verifies the downloaded file's SHA512 against the manifest;
  a corrupted/interrupted download fails the `error` transition and is simply
  retried on the next check — the running app is untouched.
- A failed update never replaces the installed app: the swap happens only after a
  fully verified download, so the prior version keeps running on failure.
