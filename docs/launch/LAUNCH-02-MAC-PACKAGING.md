# LAUNCH 02 — Package the Mac App (.dmg)

**Audit correction first:** packaging was *not* missing. Phase-1 scaffolding
shipped a complete `electron-builder.yml` (app id, asar with the plugin host
unpacked, hardened runtime + entitlements, a notarize hook that no-ops without
credentials, dmg layout, an update-feed section, commented Windows/Linux
targets) plus `npm run package` / `package:dir` scripts and the
`generate-build-info.cjs` step. Earlier "packaging does not exist" statements
are withdrawn (LAUNCH-02-1). What *was* missing — and is now fixed in code — is
the production backend URL: packaged apps have no environment variables, so
`config.ts` fell back to `localhost:4000`. The fix (verified): the URL you set
at package time is baked into `build-info.json` and read at runtime, with
priority **runtime env → baked value → localhost**, so dev workflows are
untouched.

## Part A — build and install your unsigned .dmg (today, no Apple account)

Prerequisite: your backend URL from LAUNCH-01 is live (for a throwaway test, a
`trycloudflare.com` tunnel URL works — but never ship a tunnel URL).

```
cd ~/Desktop/neuropause-desktop/apps/desktop
NEUROPAUSE_BACKEND_URL=https://api.YOURDOMAIN.com npm run package
```

First run downloads Electron once; a few minutes. Success ends with dmg/zip
artifacts in `apps/desktop/dist/` (e.g. `NeuroPause-1.0.0-rc.1-arm64.dmg`).

Install it like a user: open the dmg, drag **NeuroPause** to Applications,
eject. First launch of an **unsigned** app: right-click the app in
Applications → **Open** → **Open** (Gatekeeper's one-time bypass; signed builds
in Part B won't need this). Verify inside the app: sign in — you are on your
production backend — and Operations → Release Diagnostics shows channel
`beta`, version `1.0.0-rc.1`, packaged `true`.

Unsigned builds are for **you and machines you control only**; never
distribute them.

## Part B — signing + notarization (when you buy the Apple account)

One-time setup: enroll at developer.apple.com (~$99/yr) → Certificates →
create **Developer ID Application** → download into Keychain Access → export
as `.p12` with a password → generate an **app-specific password** at
appleid.apple.com → note your **Team ID** (Membership page). Then the same
command, with credentials in the environment, produces a signed, notarized dmg
— the hooks are already wired:

```
cd ~/Desktop/neuropause-desktop/apps/desktop
export CSC_LINK=$HOME/certs/neuropause-devid.p12
export CSC_KEY_PASSWORD='your p12 password'
export APPLE_ID='your@appleid.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='YOURTEAMID'
NEUROPAUSE_BACKEND_URL=https://api.YOURDOMAIN.com npm run package
```

Notarization adds ~5–15 minutes (Apple's servers). The resulting dmg opens on
any Mac with no warnings. Treat the `.p12` + passwords like production
secrets: password manager, never git.

## Part C — before public release (named gaps)

- **LAUNCH-02-3 — app icon missing.** Builds use Electron's default icon. Add
  `apps/desktop/resources/icon.icns` (1024px master via Icon Composer or
  `iconutil`) — electron-builder picks it up by convention.
- **LAUNCH-02-4 — update feed placeholder.** `publish.url` in
  `electron-builder.yml` points at `updates.neuropause.example`. Auto-updates
  need a real static host (S3/R2/GitHub Releases) serving the generated
  `beta-mac.yml` + artifacts; until then the in-app updater stays politely
  inert. Wiring this is its own micro-step doc when you're ready.
- Version discipline: keep `-rc.N` / `-beta.N` prereleases → channel `beta`
  automatically; dropping the prerelease at 1.0 promotes to `stable`.

## Ledger

LAUNCH-02-1 correction recorded (packaging pre-existed). LAUNCH-02-2 backend
URL baking — **closed in code, container-verified** (typecheck, lint, suite
525, bake test showing the URL landing in `build-info.json`). LAUNCH-02-3
icon and LAUNCH-02-4 update feed — open, non-blocking for your first
self-installed dmg.

**Your verification:** run Part A once your LAUNCH-01 domain answers `/live`,
and paste (1) the last lines of `npm run package` and (2) what Release
Diagnostics shows after installing. That closes checklist item 2 for
self-distribution; Part B closes it for the public.
