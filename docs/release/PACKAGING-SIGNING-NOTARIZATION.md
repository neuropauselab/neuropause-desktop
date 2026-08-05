# Packaging · Signing · Notarization — Release 1.0, Increment 2 (Stage 1)

> The build/sign/notarize/update pipeline. This document separates what is
> **already wired in the repository** (no action needed) from what **you run on
> your Mac with your Apple Developer account** (the credentials never live in
> this repo). Nothing here embeds a certificate, password, or Team ID.

---

## What's in the repo vs. what you run

| Wired in the repo (done) | You run on your Mac (Apple account required) |
|---|---|
| `electron-builder.yml` — arm64 DMG + zip, hardened runtime, entitlements, afterSign hook, update feed config | Provide a Developer ID Application certificate via `CSC_LINK`/`CSC_KEY_PASSWORD` |
| `resources/entitlements.mac.plist` — hardened-runtime entitlements | Provide notarization creds via `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` |
| `scripts/notarize.cjs` — afterSign notarization (no-ops without creds) | Run `npm run package:mac` to produce the signed, notarized DMG |
| `scripts/generate-build-info.cjs` — version/commit/channel stamping | Host the update feed + artifacts (or your release server) |

You can produce an **unsigned local build today** with no Apple account:

```
npm run package:dir
```

This generates `build-info.json`, bundles the app, and packages an unsigned
`.app` under `apps/desktop/dist/`. It will not pass Gatekeeper on another
machine, but it runs on yours and is the fastest way to smoke-test packaging.

---

## 1 · Prerequisites (one-time)

1. **Apple Developer Program** membership (Team ID is a 10-character string).
2. A **Developer ID Application** certificate in your login keychain. Export it
   as a `.p12` (Keychain Access → right-click the cert → Export) and set a
   password — you will pass both to electron-builder.
3. An **app-specific password** for notarization: <https://appleid.apple.com>
   → Sign-In and Security → App-Specific Passwords. (Your normal Apple ID
   password will not work with the notary service.)

## 2 · Environment variables

Set these in the shell that runs the build. **Never commit them.** Prefer a
local untracked file you `source`, or your CI's secret store.

```
export CSC_LINK="$HOME/secure/neuropause-developer-id.p12"   # path or base64
export CSC_KEY_PASSWORD="…"            # the .p12 export password

export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDE12345"
```

If `CSC_LINK` is unset the app builds **unsigned**. If the three `APPLE_*`
variables are not all present, the afterSign hook **skips notarization** and
prints why — the build still succeeds, it is simply un-notarized.

## 3 · Build the signed, notarized DMG

```
npm run package:mac
```

This runs three steps in order:

1. `node scripts/generate-build-info.cjs` — writes `resources/build-info.json`
   (`version` from `package.json`, `commit` from git, `channel` from
   `NEUROPAUSE_CHANNEL`, plus build time).
2. `electron-vite build` — bundles main, preload, and renderer into `out/`.
3. `electron-builder --mac --arm64` — signs with your Developer ID, then the
   `afterSign` hook (`scripts/notarize.cjs`) submits the `.app` to Apple's
   notary service and waits.

Output lands in `apps/desktop/dist/`: a `.dmg`, a `.zip` (the format
electron-updater downloads on macOS), and the channel feed file (`latest.yml`).

---

## 4 · Code signing — what's enforced

- **Hardened Runtime** is on (`mac.hardenedRuntime: true`).
- **Entitlements** (`resources/entitlements.mac.plist`) grant only what an
  Electron app needs: JIT + writable-executable memory (V8), library-validation
  disabled (native node modules are signed separately), dyld env vars, the
  network client (backend/connectors/update feed), and a loopback network
  server (the OAuth redirect listener). Nothing broader.
- Signing identity comes solely from `CSC_LINK`/`CSC_KEY_PASSWORD`; there is no
  identity in the config.

### Validate a signed build

```
# Gatekeeper assessment (should say: accepted, source=Notarized Developer ID)
spctl --assess --type execute --verbose=4 "dist/mac-arm64/NeuroPause.app"

# Signature + hardened runtime flags (look for "flags=…runtime")
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/NeuroPause.app"
codesign --display --verbose=4 "dist/mac-arm64/NeuroPause.app"

# Confirm the notarization ticket is stapled
xcrun stapler validate "dist/NeuroPause-<version>-arm64.dmg"
```

---

## 5 · Notarization — verification & failure diagnostics

The afterSign hook submits via `notarytool` and **throws on failure**, so an
un-notarized artifact is never produced when credentials are present.

If it fails, the hook prints the message and the usual causes. To investigate a
specific submission:

```
# List recent submissions
xcrun notarytool history --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID"

# Full log for one submission (shows the exact rejected file + reason)
xcrun notarytool log <submission-id> --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID"
```

Common rejections and fixes:

| Symptom | Cause | Fix |
|---|---|---|
| `HTTP 401` / invalid credentials | wrong app-specific password or Team ID | regenerate the app-specific password; confirm the Team ID |
| `The binary is not signed with a valid Developer ID` | signed with the wrong cert type | use a **Developer ID Application** cert, not "Apple Development" |
| `The executable does not have the hardened runtime enabled` | hardened runtime off on a nested binary | keep `hardenedRuntime: true`; ensure native modules are re-signed |
| Hangs for many minutes | normal | notarization is queue-based; the hook waits and reports the elapsed time |

---

## 6 · Auto-update feed & channels

electron-updater reads a feed generated from the `publish` block in
`electron-builder.yml`. The repo ships a **generic** provider with a placeholder
URL:

```yaml
publish:
  provider: generic
  url: https://updates.neuropause.example/desktop
  channel: latest
```

Replace the URL with your server, or override at build time:

```
npm run package:mac -- --config.publish.url="$NEUROPAUSE_UPDATE_URL"
```

### Three channels

The app follows one of three channels (`stable` / `beta` / `internal`); a user
can switch channels in-app, and the choice persists. Each channel has its own
feed file at the same base URL:

| App channel | Feed file | Build it with |
|---|---|---|
| stable | `latest.yml` | `NEUROPAUSE_CHANNEL=stable npm run package:mac` |
| beta | `beta.yml` | `NEUROPAUSE_CHANNEL=beta npm run package:mac -- --config.publish.channel=beta` |
| internal | `internal.yml` | `NEUROPAUSE_CHANNEL=internal npm run package:mac -- --config.publish.channel=internal` |

Publish each channel's `dist/` artifacts (the `.zip`, the blockmap, and the
channel `.yml`) to the feed URL. A stable user never sees a beta/internal
release because the app only fetches its own channel's feed file.

> **Behavior:** the app **never** downloads or installs silently. It checks on
> launch and on demand, downloads only when asked, and installs only on an
> explicit user action ("Install on restart"). In development builds the updater
> is inert and reports `supported: false`.

### Rollback preparation

The app records every version it has run into `update-history.json` and can
compute the version a rollback would revert to (the highest recorded version
older than the current one). **Executing** a rollback is a publish-side action:
re-publish the older artifact to the channel feed, or build with
`--config.mac.... ` and `allowDowngrade` enabled, so clients move back to it.
The client never auto-downgrades on its own.

---

## 7 · Version stamping & reproducibility

- The single source of version truth is `apps/desktop/package.json` → `version`.
  Bump it before building (see the release pipeline doc for SemVer rules).
- `build-info.json` records `version` + `commit` + `channel` + `buildTime`,
  surfaced at runtime in Release Diagnostics so any installed build is
  identifiable from a screenshot.
- **Reproducibility caveat:** `buildTime` is a timestamp, so byte-for-byte
  reproducibility requires pinning it. For reproducible builds set
  `SOURCE_DATE_EPOCH` and pass a fixed `NEUROPAUSE_BUILD_TIME`; otherwise builds
  differ only by the embedded timestamp. Dependencies are already lockfile-pinned.

---

## Quick reference

```
npm run package:dir     # unsigned local build (no Apple account)
npm run package:mac     # signed + notarized arm64 DMG (creds required)
NEUROPAUSE_CHANNEL=beta npm run package:mac -- --config.publish.channel=beta
```

---

## 8 · Entitlements audit & the notarization dependency (V6.0)

### Build dependency

`scripts/notarize.cjs` calls `require('@electron/notarize')`, so that package
must be a declared dependency — it is now in `apps/desktop` devDependencies
(`@electron/notarize` `^2.5.0`, matching the notarytool API and electron-builder
24). Run `npm install` after pulling this change. Without it a **signed** build
(`package:mac`) fails at the afterSign step with "Cannot find module
'@electron/notarize'"; unsigned builds (`package:dir`) were unaffected because the
hook no-ops before requiring it — which is why the gap could go unnoticed.

### Two entitlements files

- `resources/entitlements.mac.plist` — the **main app**: JIT + writable-exec
  memory + library-validation-disabled + dyld env (all required by Electron/V8
  and separately-signed native modules), plus `network.client` (HTTPS to the
  backend, connectors, update feed) and `network.server` (the loopback listener
  that receives the OAuth redirect).
- `resources/entitlements.mac.inherit.plist` — **helper processes** (Renderer /
  GPU / Utility / Plugin): the JIT/library code-signing capabilities only. No
  network or device permissions — helpers don't need them.

### Security audit — permissions NeuroPause does NOT request (and why)

NeuroPause performs **no native macOS monitoring**. Verified: no
`desktopCapturer`, no Accessibility (`systemPreferences.isTrustedAccessibilityClient`),
no Screen Recording, no camera/microphone (`askForMediaAccess`), and no
native-monitoring dependencies (no active-win / iohook / robotjs / applescript).
The only native APIs used are `nativeTheme` (dark mode) and `powerMonitor`
(suspend/resume/lock) — **neither requires an entitlement or a usage-description
prompt**. "Activity Intelligence" is entirely connector-derived: it arrives over
the network through OAuth SaaS APIs, not by observing the local machine.

Consequently the app requires **none** of these Info.plist usage strings, and
they are deliberately omitted (adding them would request permissions the app
never uses): `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`,
`NSScreenCaptureUsageDescription` / Screen Recording, `NSAccessibilityUsageDescription`,
`NSAppleEventsUsageDescription` (automation), `NSContactsUsageDescription`,
`NSCalendarsUsageDescription`, `NSLocationUsageDescription`. Google/Microsoft
calendar and mail are reached via OAuth over HTTPS, **not** EventKit/native
frameworks, so no calendar/contacts entitlement applies.

If a future increment adds genuine local monitoring (e.g. front-app tracking via
a native module), that module's specific entitlement + the matching usage string
must be added **at that point** — not pre-emptively.

### Release checklist (macOS)

1. Apple Developer Program membership active; "Developer ID Application"
   certificate installed in the login keychain (or provided via `CSC_LINK`).
2. `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` exported.
3. `npm install` (ensures `@electron/notarize` is present).
4. `npm run package:mac` → produces a signed, notarized, stapled arm64 DMG + zip.
5. Verify: `spctl --assess --type execute --verbose=4 "dist/mac-arm64/NeuroPause.app"`
   reports `accepted, source=Notarized Developer ID`.
6. Verify: `xcrun stapler validate "dist/NeuroPause-<version>-arm64.dmg"`.
7. Smoke-test the DMG on a **second** Mac (not the build machine) to confirm
   Gatekeeper passes for a first-time user.
