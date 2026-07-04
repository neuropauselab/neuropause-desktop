# WINDOWS-CI

The automated Windows build/release pipeline for NeuroPause —
`.github/workflows/windows-release.yml`. This is the automation that finally
*produces* the `.exe` (Phases 3–4 delivered configuration; this delivers the
build machine, via CI).

## Why CI (not your Mac)

electron-builder cannot emit a Windows installer from macOS/Linux (Phase-3
finding). GitHub Actions' **`windows-latest`** runner is the machine-free
Windows host. You push; GitHub builds the `.exe`.

## What the workflow does (verified structure)

Runner: `windows-latest`. Steps, in order:

1. **Checkout** (`actions/checkout@v4`)
2. **Setup Node** from **`.nvmrc`** (pinned 20.11.0) with npm cache
3. **`npm ci`** — clean install
4. **`npm run typecheck`** — node + web + backend
5. **`npm run lint`** — `--max-warnings 0`
6. **`npm test`** — the full suite (must be green or the build fails)
7. **`npm run package:win`** — generates build-info, builds, packages NSIS +
   portable + zip
8. **Upload artifacts** — every run keeps `.exe`/`.zip`/`.yml`/`.blockmap` for 14
   days (`actions/upload-artifact@v4`)
9. **Publish GitHub Release** — **tag pushes only** (`softprops/action-gh-release@v2`)

## Triggers

- **`workflow_dispatch`** — manual run from the Actions tab: builds + uploads
  artifacts, no Release.
- **`push` tag `v*`** (e.g. `v1.0.0-rc.2`) — builds **and** publishes a GitHub
  Release with the installer attached.

## Gates

Typecheck, lint, and tests run **before** packaging. A red suite blocks the
installer — the Windows pipeline enforces the same 532/168 quality bar as local
development. No artifact ships from a broken build.

## Backend URL

Baked at build time via `generate-build-info.cjs`, from the `NEUROPAUSE_BACKEND_URL`
repo **variable** (falls back to `https://api.neuropause033.com`). Set it under
Settings → Secrets and variables → Actions → Variables to override per
environment.

## No macOS regression

Recon confirmed **no prior workflow existed**; this is the first and only file in
`.github/workflows/`. There is no macOS pipeline for it to touch. (When a macOS
CI workflow is later added, it will be a separate file — this one is
Windows-scoped.)
