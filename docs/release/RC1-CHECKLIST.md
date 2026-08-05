# NeuroPause Desktop — RC1 Pre-Release Checklist (1.0.0-rc.1)

Gating checklist for Release Candidate 1. Status legend:

- ✅ **Verified** — confirmed green in-container and on the build machine.
- 🔒 **[B]** — requires your Apple Developer account / the signed build.
- 🧪 **Manual** — a hands-on test you run against the installed build (steps below).
- 🌐 **[C]** — requires a third-party host.

---

## Engineering

| Item | Status | Evidence |
| --- | --- | --- |
| All automated tests passing | ✅ | 273 tests, 42 files (vitest) |
| Type checking clean | ✅ | `tsc` node + web, 0 errors |
| Lint clean | ✅ | `eslint`, 0 problems |
| Packaging verified | ✅ | `package:dir` produced `NeuroPause.app` on macOS (unsigned dry run) |
| Auto-update verified | ✅ (config) / 🔒 [B] (live) | updater service + channel logic tested (12 tests); live check needs a published feed |
| Migration verified | ✅ | migration engine 6 tests; baseline stamps data version on startup |
| Recovery verified | ✅ (engine) / 🧪 (UI) | recovery actions wired + Recovery Center page; run the crash-recovery test below |
| Diagnostics verified | ✅ | Release Diagnostics page renders build/signing/update/health |

## Security

| Item | Status | Evidence |
| --- | --- | --- |
| Code signed | 🔒 **[B]** | hardened-runtime config + entitlements ready; needs Developer ID cert |
| Apple notarized | 🔒 **[B]** | `afterSign` notarize hook ready; needs Apple ID + app-specific password |
| Secrets removed | ✅ | no credentials in repo; support bundles redact tokens/keys/emails; connectors token file never bundled |
| Production configuration enabled | ✅ | build stamps `channel: beta` for `-rc.1`; updater inert until packaged; auto-install off, downgrade off |

## Quality (run on the signed build — 🧪)

Each test below lists the action and the expected result.

1. **Smoke test** — launch the app; the shell loads, the sidebar renders, and
   **Operations → Release** shows a populated diagnostics report.
2. **Installation test** — open the DMG, drag to Applications, launch. Because the
   build is notarized, Gatekeeper opens it without the "unidentified developer"
   block.
3. **Upgrade test** — install an earlier build, then install `1.0.0-rc.1` over it;
   confirm settings/data persist and the migration audit shows the run
   (`migration-audit.json`).
4. **Fresh install test** — on a machine (or user account) with no prior NeuroPause
   data, launch; first-run completes, data version is stamped to 1, no errors.
5. **Offline startup test** — disconnect the network and launch; the app starts,
   local surfaces work, and the backend-dependent areas degrade gracefully (shown
   in Release Diagnostics health, not a crash).
6. **Crash recovery test** — from **Operations → Recovery**, enable Safe Mode and
   restart: the app launches with plugins skipped. Create a backup, then Validate
   and Restore it; both report success and a safety backup is recorded.

## Documentation

| Item | Status |
| --- | --- |
| Installation Guide | ✅ `docs/guides/INSTALLATION.md` |
| Quick Start Guide | ✅ `docs/guides/QUICK-START.md` |
| Troubleshooting Guide | ✅ `docs/guides/TROUBLESHOOTING.md` |
| Release Notes | ✅ `docs/release/RELEASE-NOTES-1.0.0-rc.1.md` |
| Known Limitations | ✅ `docs/release/KNOWN-LIMITATIONS.md` |

---

## Exit criteria — RC1 → Release 1.0

Promote only when **all** hold:

- [ ] No critical defects remain (see triage in `FEEDBACK-PROGRAM.md`).
- [ ] Core workflows are reliable across the cohort.
- [ ] Auto-update works (a tester received and installed an update from the feed).
- [ ] Signing and notarization verified (Release Diagnostics reads "Signed & notarized").
- [ ] Recovery mechanisms validated (Safe Mode + Restore exercised successfully).
- [ ] Pilot users completed representative workflows successfully.
- [ ] Documentation complete and accurate against the shipped build.

When every box is checked, follow `RC1-RUNBOOK.md` §10 to promote to 1.0.
