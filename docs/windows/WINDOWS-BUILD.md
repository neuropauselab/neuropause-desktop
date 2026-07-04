# WINDOWS-BUILD

How to build the Windows artifacts for NeuroPause from the existing Electron
codebase. This is a **packaging** guide; the runtime was verified Windows-ready
in WINDOWS-AUDIT.md (Phase 1) and WINDOWS-RUNTIME.md (Phase 2).

## The one hard constraint

electron-builder **cannot produce a Windows installer from macOS or Linux**. A
Windows `.exe`/NSIS artifact must be built on a **Windows host** or a **Windows
CI runner** (GitHub Actions `windows-latest` — see Phase 7). Everything below
assumes a Windows machine or runner; the *configuration* itself is committed and
cross-platform.

## What was enabled (Phase 3)

`apps/desktop/electron-builder.yml` — a new `win:` block and `nsis:` block,
**added below the untouched `mac:` block**:

- `win.target`: **nsis** (installer .exe), **zip** (what electron-updater pulls
  on Windows), **portable** (single self-contained .exe, no install) — all x64.
- `nsis`: `oneClick:false` (wizard with directory choice), `perMachine:false`
  (per-user, no admin elevation), `allowToChangeInstallationDirectory:true`,
  `createDesktopShortcut:true`, `createStartMenuShortcut:true`,
  `shortcutName:NeuroPause`.

`apps/desktop/package.json` — a new script, mac scripts unchanged:

```
"package:win": "node scripts/generate-build-info.cjs && electron-vite build && electron-builder --win --x64"
```

## Build command (on Windows)

```
cd apps/desktop
set NEUROPAUSE_BACKEND_URL=https://api.neuropause033.com
npm ci
npm run package:win
```

(`generate-build-info.cjs` bakes the backend URL and channel into
`build-info.json`, exactly as it does for macOS — the URL-baking mechanism is
shared and already verified.)

Outputs land in `apps/desktop/dist/`:

- `NeuroPause Setup 1.0.0-rc.1.exe` — the NSIS installer
- `NeuroPause 1.0.0-rc.1.exe` — the portable build
- `NeuroPause-1.0.0-rc.1-win.zip` — the ZIP (updater artifact)
- `latest.yml` / `beta.yml` — the update feed manifest for the active channel

## Icons (honest status)

**`resources/icon.ico` does not exist yet.** No placeholder was generated (per
the brief). Until it is added, electron-builder uses the **default Electron
icon** — the same state your macOS build is in (`icon.icns` also absent; the Mac
build log prints "default Electron icon is used"). To finish branding:

1. Add a 256×256 (multi-resolution) `resources/icon.ico` and a
   `resources/icon.icns` for macOS.
2. Uncomment `icon: resources/icon.ico` in the `win:` block.
3. Rebuild. The installer, executable, and uninstaller icons all derive from it.

This is cosmetic and does not block installation or launch.

## macOS is untouched

The `mac:` block, `dmg:` block, entitlements, notarize hook, and `package:mac`
script are byte-for-byte unchanged (verified: YAML parse confirms
`hardenedRuntime`, entitlements path, and both dmg/zip targets intact). Building
Windows changes nothing about the Mac build you already shipped.
