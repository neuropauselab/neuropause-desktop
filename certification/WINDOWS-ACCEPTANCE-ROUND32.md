# WINDOWS ACCEPTANCE — ROUNDS 32+33+34

## Artifact under test

**Superseded artifacts:** the rc.17 build from `33b9173` (SHA-256
`d07a7d02…572f`) and the rc.18 build from `ee3da3d` (SHA-256 `7acdf6c7…5f16a`)
are both version-orphaned — do NOT use them. The current gate artifact is the
**rc.19** build (hash recorded below after the final build); it additionally
carries round 34 (AI providers: tenant-preference routing clamp, OpenAI,
Ollama installed/running detection + consent-first model pull), so the
acceptance matrix gains: AI provider setup, Ollama detection, and the
"On this device" routing check. The table below describes the superseded rc.18
build until re-stamped:

| Field | Value |
|---|---|
| Installer | `apps/desktop/dist/NeuroPause-Setup.exe` (NSIS, x64) |
| Version | 1.0.0-rc.18 |
| Size | 111,852,099 bytes (~107 MB) |
| **SHA-256** | `7acdf6c769ee4ac340f10f3f7a4a652e331a6bf9669285ad8aaf3e5264b5f16a` |
| Update payload | `NeuroPause-1.0.0-rc.18-win.zip` |
| Provenance | Embedded `build-info.json`: `commit: ee3da3d`, `branch: fix/round23-flush-barrier-recorder`, `dirty: false`, `buildTime: 2026-08-14T10:37:22.379Z` |
| Built by | `npm run package:win` (in `apps/desktop`, macOS host, clean tree at HEAD=ee3da3d) |
| Verified by | `node scripts/verify-release-artifacts.cjs --platform win` — 6/6 PASS; plus `grep -a` inside `app.asar` for the round-32/33 markers (`claimOwnerIdentity`, `Tenant resolution LOST/RECOVERED`, `quarantined-`, `refreshInFlight` — 16 hits) |

This build additionally carries round 33: corrupt-store quarantine (org chart /
workspaces / audit trail survive a torn write in a `.quarantined-<ts>` file —
if the Windows machine's fault was a corrupt `org.json`, THIS build preserves
the evidence instead of reseeding over it), the auth refresh-lifecycle fixes,
and the O-11 fail-closed predicate at all four sites. Step A below gains one
check: after launch, list `%APPDATA%\NeuroPause\*.quarantined-*` — any hit is
the original corrupt file and belongs in the support bundle.

Pre-commit builds of the same version were moved to `dist/pre-commit-archive/`
before this build — an artifact matching the SHA-256 above is the ONLY one that
counts for this gate. On the Windows machine, verify before installing:

```powershell
Get-FileHash .\NeuroPause-Setup.exe -Algorithm SHA256
# must equal 7ACDF6C769EE4AC340F10F3F7A4A652E331A6BF9669285AD8AAF3E5264B5F16A
```

In-app cross-check after install: the Release Diagnostics surface must show
version `1.0.0-rc.18`, commit `ee3da3d`, dirty `false`.

## Log to capture

`%APPDATA%\NeuroPause\logs\app.log` (rotated; grab the whole `logs\` folder for
the bundle). All tenant diagnostics are redacted at source — local parts of
emails are reduced to a length, domains kept — so the file is safe to send.

## Acceptance procedure

**A. Reproduce-first (the machine that showed the fault).** Do NOT uninstall
first: the fault state persists in `%APPDATA%\NeuroPause`, and we want the new
build to *observe* it before any cleanup.

1. Install `NeuroPause-Setup.exe` over the existing install. Launch.
2. If the refusal is present, the log MUST now contain
   `Tenant resolution LOST — first refusal after a working session` (or
   `Tenant refused` lines with `refusalIndex`/`suppressedSinceLastLine`), each
   carrying the predicate set: `reason`, `msSinceLastSuccess`, `loaded`,
   `sessionEmailShape`, `workspaceFound`, `organizationFound`, `memberCount`,
   `humanMembersWithEmail`, `sessionMatchedAMember`, `ownerExists`,
   `ownerClaimed`, `ownerOrgMatches`, `sessionMatchesOwner`, `memberStatus`,
   `memberInWorkspace`. **This is the round-31 measurement — capture it before
   anything else.**
3. If the owner row was the O-11 corrupt shape, the round-32 claim path may
   self-heal on launch: look for `Seeded owner bound to the signed-in account`,
   followed by `Tenant resolution RECOVERED` with the outage duration.
4. Note which screens showed errors while refusing, then restart the app and
   record whether resolution recovers (`RECOVERED` line) — pre-round-32 a
   restart was the only recovery; now sign-in can be.

**B. Fresh-install matrix (clean profile).** Rename `%APPDATA%\NeuroPause`
aside (keep it — it is evidence), then:

1. Fresh installation → first launch → sign in.
2. Organization + workspace resolution: Enterprise view loads the org chart;
   Administration loads; no `no organization member is bound to this account`.
3. Active tenant context: log contains no `Tenant refused` lines after sign-in.
4. Data page: history panel populates; no `no handler registered for dp:history`.
5. Import and Export flows complete.
6. Business and Assistant views load and respond.
7. Restart persistence: quit, relaunch — same org/workspace/tenant restored,
   no `Tenant resolution LOST` on a healthy profile.
8. Repeated launch ×5: no IPC registration race (no `no handler registered`
   for ANY channel), no runtime-init errors
   (`Runtime core failed to initialize`), no deadlock at the splash/gate.
9. Owner-row hardening spot-checks (round 32):
   - People → edit the Owner: role/status/email fields must not take effect
     (silently revert on refresh) — O-13;
   - a member holding `people:manage` must NOT be able to become Owner by
     re-addressing the owner row — O-13;
   - member rename must not erase the member's email after restart — O-11.

**C. Bundle.** Return: `logs\` folder (both profiles), the noted screens, and
the `Get-FileHash` output.

## PASS criteria

PASS = every item in B clean on the from-commit installer, AND (from A) either
the fault reproduced and the LOST/refused diagnostic captured its predicates,
or the fault no longer reproduces on the machine that showed it (state which).
Anything else is FAIL with the log attached. Unit tests, typecheck, and the
build itself are necessary but NOT sufficient — this gate closes only on
Windows runtime evidence.
