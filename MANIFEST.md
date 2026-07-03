# NeuroPause Desktop — Release Candidate 1 (1.0.0-rc.1)

**Overlay this from the repo root:** `unzip -o ~/Downloads/neuropause-rc1.zip`

This package cuts **Release Candidate 1**. It's an **operational** milestone, not
an architectural one — the code is built and green; this sets the version,
points the build at the Release-Candidate (beta) update channel, and ships the
full pilot documentation, runbook, checklist, and feedback program.

**No new dependencies.** Source/docs-only overlay — you do **not** need `npm install`.

---

## Changed files (4)

- `package.json` + `apps/desktop/package.json` — version → **`1.0.0-rc.1`**
- `apps/desktop/scripts/generate-build-info.cjs` — derives the update channel from
  the version's prerelease tag (`-rc.*`/`-beta.*` → **beta**, `-internal.*` →
  internal, none → stable). The RC therefore stamps `channel: beta` automatically.
- `apps/desktop/electron-builder.yml` — `publish.channel: beta` (generates
  `beta-mac.yml`) and a placeholder feed URL to replace with your real host

## New documentation (8)

**Release engineering**
- `docs/release/RC1-RUNBOOK.md` — build → sign → notarize → publish → distribute →
  promote, with each step tagged [A] automatable / [B] needs Apple account /
  [C] needs a host
- `docs/release/RC1-CHECKLIST.md` — the pre-release checklist with live status
  (verified in-container vs. requires the signed build vs. manual test)
- `docs/release/RELEASE-NOTES-1.0.0-rc.1.md`
- `docs/release/KNOWN-LIMITATIONS.md`
- `docs/release/FEEDBACK-PROGRAM.md` — cohort, collection, Critical/High/Medium/Low
  triage rubric, and exit-criteria scoreboard

**Tester guides**
- `docs/guides/INSTALLATION.md`
- `docs/guides/QUICK-START.md`
- `docs/guides/TROUBLESHOOTING.md`

---

## What's already done vs. what's yours to do

**Done in this overlay (no credentials needed):**
- Version is `1.0.0-rc.1`; the build self-identifies on the beta channel.
- A fresh RC install **defaults to the beta channel** automatically (the updater
  adopts the build's stamped channel when no preference exists), so testers check
  the RC feed without any manual switch.
- All pilot documentation is written.
- Engineering gates are green: **273 tests**, typecheck clean, lint clean.

**Yours to do (RC1-RUNBOOK.md has the exact commands):**
- **[B]** Sign + notarize with your Apple Developer account, then `npm run package
  -w @neuropause/desktop`. Verify **Operations → Release** reads *"Signed &
  notarized."*
- **[C]** Set the real feed URL in `electron-builder.yml` and publish
  `beta-mac.yml` + the dmg/zip to your host (S3 / R2 / GitHub Releases / static).
- **[B]** Run the six quality tests in `RC1-CHECKLIST.md` on the signed build.
- Distribute the DMG + tester guides to 10–15 testers and run the feedback program.

---

## Verify after overlaying

```zsh
node apps/desktop/scripts/generate-build-info.cjs
npm run typecheck -w @neuropause/desktop
npm run test -w @neuropause/desktop
npm run lint
```

Expected: build-info prints `"version":"1.0.0-rc.1","channel":"beta"`; both
typechecks clean; 273 tests passing; lint zero problems.

---

## Promotion to Release 1.0

When the RC1 exit criteria are met (no critical defects, core workflows reliable,
auto-update + signing/notarization + recovery verified, representative workflows
completed, docs complete), follow `RC1-RUNBOOK.md` §10: bump to `1.0.0`, flip
`publish.channel` to `latest`, rebuild the **same** code (blockers only, no new
features), tag `v1.0.0`, publish the stable feed and public docs.
