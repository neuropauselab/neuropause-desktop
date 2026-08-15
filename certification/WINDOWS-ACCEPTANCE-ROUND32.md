# WINDOWS ACCEPTANCE — ROUNDS 32+33+34 (+40)

## Artifact under test

**Superseded artifacts:** the rc.17 (`33b9173`, SHA-256 `d07a7d02…572f`),
rc.18 (`ee3da3d`, `7acdf6c7…5f16a`) and rc.19 (`ac2df21`, `8f54b360…9962`,
archived at `dist/release-archive/NeuroPause-Setup-rc.19.exe`) builds are all
version-orphaned — do NOT use them. The current gate artifact is the
**rc.20** build, made from the exact release tag in round 40:

| Field | Value |
|---|---|
| Installer | `apps/desktop/dist/NeuroPause-Setup.exe` (NSIS, x64) |
| Version | 1.0.0-rc.20 (tag `v1.0.0-rc.20`) |
| Size | 111,864,376 bytes (~107 MB) |
| **SHA-256** | `e861228f2af873a8d67036fbb0407a6e8acab07f3bb5b6f009815f824ac8bc90` |
| Update payload | `NeuroPause-1.0.0-rc.20-win.zip` (SHA-256 `8d620eaa30475d1f8b5bf723413180e52d95bc1cce2662599ddd6a0606e2eddd`) |
| Provenance | Embedded `build-info.json`: `commit: efe8196`, `branch: HEAD` (detached tag checkout — intentional), `dirty: false`, `buildTime: 2026-08-15T06:28:50.681Z` |
| Built by | `npm run package:win` (in `apps/desktop`, macOS host, clean detached checkout of `v1.0.0-rc.20`) |
| Verified by | `node scripts/verify-release-artifacts.cjs --platform win` — 6/6 PASS (feed v1.0.0-rc.20 ↔ binary sha512); plus `grep -a` inside `app.asar`: round-32/33 markers (`claimOwnerIdentity` 2, `Tenant resolution RECOVERED` 1, `quarantined-` 5, `refreshInFlight` 9) AND the round-37/39/40 markers (`Shutdown flush complete` 2, `announceTenantRecovery` 2, `assignProvisionedOwner` 2, `protectedOwnerIdForTarget` 3, `healProvisionedOwnerAnchors` 2); tenancy+enterprise+ai suites re-run from the tag: 257 files green |

This build carries everything rc.19 had (round 34 AI providers: tenant clamp,
OpenAI, Ollama detection + consent-first pull) PLUS rounds 35–40: fail-closed
boot router, runtime-state broadcast + boot-window retries, onboarding resume,
error-state honesty, shutdown flush barrier + restart-enforcing restore,
recovery-triggered AI reconfigure (a local-only user with running Ollama gets
LOCAL answers instead of "No AI model"), the unsplit workspace switcher, and
provisioned-org owner protection. Section B gains checks 10–11 below for the
new surfaces.

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
# must equal E861228F2AF873A8D67036FBB0407A6E8ACAB07F3BB5B6F009815F824AC8BC90
```

In-app cross-check after install: the Release Diagnostics surface must show
version `1.0.0-rc.20`, commit `efe8196`, dirty `false`.

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
10. AI local routing (rounds 34+39): choose "Keep it on this device" during
    first-run (or Settings → AI → Local Only). With Ollama running, an
    Assistant question about the workspace must answer with the **Local**
    provenance badge — NOT "No AI model" — including after a quit/relaunch
    (the boot-race regression). Without Ollama, the answer must honestly say
    AI is offline and nothing may leave the machine.
11. Provisioned-org owner protection (round 40): create a second organization,
    then as a `people:manage` member of it, attempt to edit the creator's
    email/role/status and to delete the creator and the Owner role — every
    attempt must be refused/stripped; the creator row survives untouched
    after refresh and relaunch.

**C. Bundle.** Return: `logs\` folder (both profiles), the noted screens, and
the `Get-FileHash` output.

## PASS criteria

PASS = every item in B clean on the from-commit installer, AND (from A) either
the fault reproduced and the LOST/refused diagnostic captured its predicates,
or the fault no longer reproduces on the machine that showed it (state which).
Anything else is FAIL with the log attached. Unit tests, typecheck, and the
build itself are necessary but NOT sufficient — this gate closes only on
Windows runtime evidence.
