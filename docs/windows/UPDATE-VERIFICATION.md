# UPDATE-VERIFICATION

End-to-end verification for NeuroPause Windows auto-updates (STEP 6), plus the
rollback/failure behavior (STEP 5) derived from the existing electron-updater
configuration.

## The one prerequisite for a private repo

electron-updater reads updates from the GitHub Release set. For a **public** repo,
nothing extra is needed. For a **private** repo (NeuroPause is private today),
the installed app must be able to authenticate to read Releases — provide a
**`GH_TOKEN`** in the app's environment (a fine-grained token with read-only
Contents on this repo). Without it, checks against a private repo's Releases will
fail with an auth error. Options:

- Make the repo (or just Releases via a distribution repo) public, **or**
- Ship a `GH_TOKEN` to the app, **or**
- Serve the feed from a static host (the `generic` provider) instead of GitHub.

This is the single real gate between "installer downloads" and "updates arrive"
for a private-repo distribution — stated plainly, not assumed.

## STEP 5 — Rollback & failure behavior (from config, verified)

- **Failed update recovery** — a download that fails hits the updater's `error`
  transition; the **running app is untouched** (the swap happens only after a
  fully verified download). The next check retries.
- **Version rollback** — `allowDowngrade=false`: the updater will never move a
  user to a lower version, so a bad newer release can be pulled from the feed and
  users simply stay put; it cannot force them backward. To "roll back", publish a
  higher version number containing the previous good build.
- **Corrupted download** — electron-updater verifies the file SHA512 against the
  manifest; a mismatch is rejected (no install) and reported via `error`.
- **Interrupted download** — no partial install occurs; `autoInstallOnAppQuit=
  false` means nothing is applied on quit from a partial state. Re-check resumes.

## STEP 6 — End-to-end verification checklist

Run on a Windows machine. "Installed build" means one packaged from the
github-publish commit onward.

**Fresh install**
- [ ] Download `NeuroPause Setup <ver>.exe` from the GitHub Release
- [ ] Install (SmartScreen "Run anyway" if unsigned); app launches
- [ ] Operations → Updates shows current version + channel

**First update**
- [ ] Publish a higher tag (e.g. `v1.0.0-rc.8`); CI creates the Release
- [ ] In the app: Check for updates → "Update available" appears
- [ ] Download → progress bar advances → "Restart & Install" offered
- [ ] Restart → app relaunches on the new version

**Minor update** (e.g. rc.8 → rc.9)
- [ ] Same flow; version increments; user data preserved (`%APPDATA%` untouched)

**Major update** (e.g. 1.0.0 → 1.1.0)
- [ ] Same flow across a minor-version bump; settings/onboarding/pilot preserved

**Channel switch**
- [ ] Switch stable → beta in the Updates panel
- [ ] A prerelease tag now appears as available; switching back does not downgrade

**Offline update**
- [ ] With no network: Check for updates fails gracefully (error state, app keeps
      running); no crash, no partial install
- [ ] Reconnect → check succeeds

**Rollback / bad release**
- [ ] Unpublish or supersede a bad release; confirm `allowDowngrade=false` keeps
      users on their version; publish a higher good version to move them forward

## What is verified today vs pending a live run

- **Verified in-repo**: the updater code + state machine, the three channels
  (tested), six IPC channels, the UpdatesPanel UI, `allowDowngrade`/SHA512
  behavior, the github publish provider, and CI uploading `latest.yml` + `.exe`
  to Releases.
- **Pending a live two-build test**: an actual install-then-update cycle on
  Windows (requires two published tags and, for the private repo, the `GH_TOKEN`
  decision above). This checklist is that test.
