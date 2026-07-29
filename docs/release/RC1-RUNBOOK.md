# NeuroPause Desktop — RC1 Runbook (1.0.0-rc.1)

The step-by-step procedure to cut, sign, notarize, publish, and distribute
Release Candidate 1, then promote it to Release 1.0. RC1 is an **operational**
milestone — the code is built; this is about producing and shipping a real
signed artifact to a controlled cohort.

Steps are tagged by who performs them:
- **[A]** Automatable / already done in the repo (no credentials).
- **[B]** Requires your Apple Developer account on your Mac.
- **[C]** Requires a third-party host (update feed / backend).

See `PACKAGING-SIGNING-NOTARIZATION.md` for the signing/notarization detail this
runbook references, and `RC1-CHECKLIST.md` for the gating checklist.

---

## 0. Target

| Field | Value |
| --- | --- |
| Version | `1.0.0-rc.1` |
| Channel | Release Candidate → **beta** update channel (prerelease) |
| Distribution | Developer ID signed · Apple notarized · direct DMG |
| Artifacts | `NeuroPause-1.0.0-rc.1-arm64.dmg`, `…-arm64-mac.zip`, `beta-mac.yml` |

The Release Candidate **stage** rides the **beta** update channel: prerelease
versions (`-rc.N`) are served from `beta-mac.yml`, and a fresh RC install
defaults to the beta channel automatically (the build stamps `channel: beta`,
and the updater adopts the build's channel when no preference is set).

---

## 1. Confirm the tree is green — [A] (done)

```zsh
npm run typecheck -w @neuropause/desktop
npm run test -w @neuropause/desktop
npm run lint
```

Expected: both typechecks clean, 273 tests passing, lint zero problems. ✅ already
verified on your machine.

## 2. Version is set — [A] (done)

`apps/desktop/package.json` and the root `package.json` are at `1.0.0-rc.1`.
The build derives `channel: beta` from the `-rc.1` prerelease tag automatically
(`scripts/generate-build-info.cjs`).

Verify the stamp:

```zsh
node apps/desktop/scripts/generate-build-info.cjs
```

Expected: `{"version":"1.0.0-rc.1","channel":"beta", …}`.

## 3. Configure signing credentials — [B]

You need an **Apple Developer account** ($99/yr — confirm current pricing), a
**Developer ID Application** certificate, and an **app-specific password** (or an
App Store Connect API key) for notarization. Set these in your shell before
building (do **not** commit them):

```zsh
export CSC_LINK="$HOME/certs/developer-id-application.p12"
export CSC_KEY_PASSWORD="<your .p12 password>"
export APPLE_ID="<your Apple ID email>"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific password>"
export APPLE_TEAM_ID="<your 10-char Team ID>"
```

## 4. Point the update feed at a real host — [C]

Decide where `beta-mac.yml` + the dmg/zip will live (S3, Cloudflare R2, GitHub
Releases, or any static HTTPS host). Set the URL in `apps/desktop/electron-builder.yml`:

```yaml
publish:
  provider: generic
  url: https://<your-rc-feed-host>/rc
  channel: beta
```

The feed only needs to serve the three artifact files over HTTPS. For a direct-
download pilot you can host the DMG anywhere; the feed URL is what enables
**auto-update** for installed testers.

## 5. Build, sign, and notarize — [B]

```zsh
npm run package -w @neuropause/desktop
```

This runs build-info generation → `electron-vite build` → `electron-builder --mac
--arm64`, which signs with your Developer ID, runs the `afterSign` notarization
hook (`scripts/notarize.cjs`), and produces the dmg + zip + `beta-mac.yml` in
`apps/desktop/dist/`.

Watch for: `signing` succeeds (an identity is found) and `[notarize]` submits and
returns success (not the "skipped — set APPLE_ID…" message you saw on the
unsigned dry run).

## 6. Verify the build — [B]

Install the DMG, launch, and open **Operations → Release**. Confirm:

- **Signing & Notarization** reads **"Signed & notarized."**
- Build version is `1.0.0-rc.1`, channel `beta`.
- **Updates** shows self-update **operational**, channel `beta`.

Then run the quality tests in `RC1-CHECKLIST.md` (smoke, install, upgrade, fresh
install, offline startup, crash recovery).

## 7. Publish the feed — [C]

Upload to your feed host so the path matches the `publish.url`:

```
<host>/rc/NeuroPause-1.0.0-rc.1-arm64.dmg
<host>/rc/NeuroPause-1.0.0-rc.1-arm64-mac.zip
<host>/rc/beta-mac.yml
```

(`electron-builder` can upload automatically for some providers via `--publish`;
for a generic host, upload the `dist/` artifacts manually.)

## 8. Distribute to the cohort — [B/C]

Send testers the DMG download link and the tester docs: `INSTALLATION.md`,
`QUICK-START.md`, `TROUBLESHOOTING.md`, `RELEASE-NOTES-1.0.0-rc.1.md`, and
`KNOWN-LIMITATIONS.md`. Target 10–15 technical users (see the cohort section of
`FEEDBACK-PROGRAM.md`).

If the pilot exercises full app functionality (AI Store catalog, etc.), stand up
the backend (`:4000` + Postgres/Redis) and share its address; the local surfaces
(diagnostics, recovery, workspace) work without it.

## 9. Run the feedback program — [A/B]

Collect and triage per `FEEDBACK-PROGRAM.md` (Critical / High / Medium / Low).
Testers attach a **support bundle** (Operations → Release → Support bundle) to any
report — it is redacted by default.

## 10. Promote to Release 1.0 — [A/B/C]

Only when `RC1-CHECKLIST.md` exit criteria are all met:

1. **[A]** Bump version `1.0.0-rc.1` → `1.0.0` (drops the prerelease tag, so the
   build stamps `channel: stable`).
2. **[A]** Set `electron-builder.yml` `publish.channel: latest` (and the
   production feed URL).
3. **[B]** Rebuild **the same code** (no new features) — only verified blockers
   may be fixed — sign, and notarize.
4. **[A]** Tag `v1.0.0` in git.
5. **[C]** Publish `latest-mac.yml` + artifacts to the production feed.
6. **[A]** Publish the public documentation.

This re-points production users to the `latest` (stable) channel; existing RC
testers on beta can be moved to stable in-app or by the next stable update.

---

## Rollback during the pilot

If the RC has a blocker after distribution, you roll **forward**: fix the
blocker, cut `1.0.0-rc.2`, and publish to the same beta feed — installed testers
auto-update. Production is never downgraded in place (see `RELEASE-PIPELINE.md`
§3). Testers can also self-recover via the Recovery Center (Safe Mode, Restore
Backup) without waiting for a new build.
