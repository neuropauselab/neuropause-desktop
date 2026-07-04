# WINDOWS-RELEASES

How to cut a Windows release with the CI pipeline, and what lands where.

## Cut a release (the whole flow)

1. Bump `apps/desktop/package.json` `version` (e.g. `1.0.0-rc.2`).
2. Commit and push to `main`.
3. Tag and push:

```
git tag v1.0.0-rc.2
git push origin v1.0.0-rc.2
```

4. The `windows-release` workflow runs on `windows-latest`: install → typecheck
   → lint → test → package → **create a GitHub Release** named for the tag, with
   the artifacts attached and release notes auto-generated.

That is the entire release ceremony. No local Windows machine needed.

## Artifacts attached to each Release

- `NeuroPause Setup 1.0.0-rc.2.exe` — the NSIS installer (what users download)
- `NeuroPause 1.0.0-rc.2.exe` — the portable build
- `NeuroPause-1.0.0-rc.2-win.zip` — the ZIP (electron-updater artifact)
- `latest.yml` — the electron-updater feed manifest
- `*.blockmap` — differential-update maps

## Prerelease flag

Tags containing `-rc` or `-beta` are published as **prereleases** automatically
(so they don't become the "Latest" download until you cut a stable `v1.0.0`).

## Auto-update wiring (with Phase 5)

Because the Release includes `latest.yml` + the zip, an electron-updater feed
pointed at **GitHub Releases** will serve Windows updates directly — no separate
static host required. Point `publish` at the GitHub provider (or keep `generic`
and host the feed yourself); this is the Phase-5 step. Until then the app runs
fine; only in-app auto-update is inert.

## Manual build without releasing

Actions tab → `windows-release` → **Run workflow** → the `.exe`/`.zip`/`.yml`
appear under the run's **Artifacts** (14-day retention). Useful for testing a
build before tagging.

## Download page

Link users to the repo's **Releases** page, or deep-link the latest
`...Setup.exe` asset, alongside the macOS `.dmg`.
