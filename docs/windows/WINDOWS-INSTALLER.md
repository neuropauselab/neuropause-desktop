# WINDOWS-INSTALLER

What the NSIS installer does, and the end-user experience — derived from the
committed `nsis:` configuration.

## Installer behavior (from config)

| Setting | Value | Effect |
| --- | --- | --- |
| `oneClick` | false | A real wizard: welcome → (optional) directory → install → finish. Not a silent one-click. |
| `perMachine` | false | **Per-user install** into `%LOCALAPPDATA%\Programs\neuropause` — **no admin prompt**. |
| `allowToChangeInstallationDirectory` | true | The user can pick a different folder. |
| `createDesktopShortcut` | true | Desktop shortcut named NeuroPause. |
| `createStartMenuShortcut` | true | Start Menu entry named NeuroPause. |
| `shortcutName` | NeuroPause | Shortcut label. |

An **uninstaller** is generated automatically by NSIS and registered in
Windows *Settings → Apps → Installed apps* (and the legacy Add/Remove Programs),
named from `productName` (NeuroPause) with publisher from `copyright`
(Copyright © NeuroPause). Version metadata comes from `package.json` `version`
(1.0.0-rc.1) and is stamped on the `.exe` (right-click → Properties → Details).

## Product / metadata (from electron-builder.yml + package.json)

- Application name: **NeuroPause** (`productName`)
- App ID: **com.neuropause.desktop** (`appId`)
- Publisher / copyright: **Copyright © NeuroPause**
- Version: **1.0.0-rc.1** (`package.json` `version`; channel `beta`)

## Per-user vs per-machine

Configured **per-user** (`perMachine:false`) so early-access testers can install
without IT/admin rights — the Windows analogue of the friction-free Mac drag-to-
Applications. A user who wants a machine-wide install can still elevate during
the wizard (electron-builder's default `allowElevation`). For a fleet/managed
rollout, flip `perMachine:true` later — a one-line change, no code impact.

## Silent install

NSIS supports silent/unattended install for MDM/scripted deployment:

```
"NeuroPause Setup 1.0.0-rc.1.exe" /S              # silent, per-user
"NeuroPause Setup 1.0.0-rc.1.exe" /S /D=C:\Apps\NeuroPause   # silent + dir
```

## First-launch experience (end user)

1. Download `NeuroPause Setup 1.0.0-rc.1.exe`.
2. If the build is **unsigned** (no Authenticode cert), Windows SmartScreen shows
   "Windows protected your PC" → **More info → Run anyway**. This is the exact
   analogue of the macOS right-click → Open you already used, and it disappears
   once the build is code-signed (Phase 4).
3. The wizard installs per-user; shortcuts are created.
4. Launching opens NeuroPause, which talks to the **baked backend URL**
   (`https://api.neuropause033.com`) — the same endpoint the Mac build targets.
   That endpoint is **not serving yet** (Phase-4 backend deployment in
   progress), so sign-in, the onboarding wizard, and connectors will fail in
   any build produced today. These paths are shared with the Mac build and were
   reviewed in Phase 2, but none of them has been exercised on Windows — no
   `.exe` has been built yet.

## Portable build

The portable `.exe` runs with **no installation** — useful for a locked-down
machine or a quick trial. It writes its per-user data to the same
`%APPDATA%`-based location via `app.getPath('userData')`.
