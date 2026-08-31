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

---

# ROUND 61 AMENDMENT — WHY THE rc.20 RUN COULD NOT FINISH, AND WHAT CHANGES

## The correction

The rc.20 run recorded B3/B5/B6/B9 as *"gated behind signing in, which needs the
cloud auth backend — unavailable in this offline VM."* **That diagnosis was
wrong about the product.** It was correct about that binary only.

Measured in the staging tree the rc.20 installer was built from
(`apps/desktop/dist/win-unpacked/resources/app.asar`, 58,543,363 B):

| Marker | Count | Meaning |
|---|---|---|
| `Sign in to your AI operating layer` | 1 | the sign-in wall **is** in rc.20 |
| `Working locally` | **0** | local-first mode is **not** |
| `device.invalid` | **0** | the device-local principal namespace is **not** |
| `LocalModeBanner` | **0** | — |
| `dp:history` / `dp:import` / `dp:export` | 5 / 6 / 16 | the import & export flows **are** present |
| `assistant:conversations` | 5 | the Assistant read path **is** present |
| `protectedOwnerIdForTarget` | 3 | round-40 owner hardening **is** present |

The flows B5/B6/B9 exercise all shipped in rc.20. **Only the way in was
missing.** rc.20 was cut from `efe8196` on **2026-08-15**; local-first mode
(S17) landed in `89f3c45` on **2026-08-18** — three days later. The acceptance
artifact is now **390 commits** behind HEAD.

So step B1's *"first launch → sign in"* was an instruction the binary could not
satisfy offline, and no check caught that before a machine session was spent on
it. The residuals were attributed to a missing backend when the real cause was
a missing entry path.

Instrument note: the bundle is **not minified** (verified independently), and
the markers above are string literals with positive controls in the same pass
(`local-` 22, `No AI model` 15), so the zeros are genuine absences rather than
mangling. Scope limit, stated deliberately: these are facts about the **staging
tree**, not about bytes extracted from `NeuroPause-Setup.exe` — NSIS cannot be
unpacked on the macOS host (no 7-Zip in any form), so installer-payload
identity is available only from a Windows run. The Windows guest independently
read `version=1.0.0-rc.20 commit=efe8196 dirty=False` from the installed app,
which corroborates the staging tree at the provenance level.

## Mandatory pre-flight (new — run this BEFORE booking a machine session)

```bash
cd apps/desktop
node scripts/verify-acceptance-artifact.cjs --resources <staging-resources-dir>
```

It exits non-zero and names the acceptance items that are **not drivable** on
the artifact. Against rc.20 it reports, in milliseconds, exactly the set the
last Windows session discovered by hand:

```
ACCEPTANCE ITEMS NOT DRIVABLE ON THIS ARTIFACT: B1, B3, B5, B6, B9
```

Never spend a machine session on items this check has already excluded — they
will fail for want of the feature, not for want of the platform.

## Section B is re-based: local-first, no backend required

**B1 is REPLACED.** *Old:* "Fresh installation → first launch → sign in."
*New:* **"Fresh installation → first launch → the app enters device-local mode
with no account and no wall; the shell mounts."** The banner reads *"Working
locally — your data stays on this device."*

Sign-in is now a **detour, not a precondition**. Every item below is drivable
with `backendUrl: null` on an artifact that contains local-first mode:

- **B3 active tenant context** — resolves through the device-local principal
  (`local-<id>@device.invalid`) and `workspace-default`. PASS = no persistent
  `Tenant refused` after the boot-window bracket.
- **B5 import / export** — the Data section is reachable from the sidebar in
  local mode; the `dp:*` handlers are tenant-scoped, not auth-scoped.
- **B6 Business / Assistant** — both render in local mode. With Ollama running,
  B10's Local-badged answer is driven here too; without it, the honest offline
  refusal is the expected result.
- **B9 owner-row hardening** — the local principal claims the owner row on
  first run, so O-11/O-13 and the round-40 provisioned-owner guards are all
  exercisable offline.

Items that genuinely still require a signed-in cloud session are **only** those
that read or write cloud state, and they are recorded as such rather than
folded into the B-item list.

## Two gaps in the rc.20 record, now named

- **B10 and B11 were never reported at all** — neither as PASS nor as residual.
  B11 is the round-40 provisioned-owner protection, i.e. §B item 4, the last
  release blocker. It has never been driven on Windows and was not recorded as
  undriven. Both must appear explicitly in the next run's results.
- The graceful `Shutdown flush complete` line still needs a driven `app.quit`
  (tray/menu), not a force-kill.

## Artifact requirement for the next run

The next Windows session must use an artifact that **passes the pre-flight
above**, which rc.20 does not. That artifact does not exist yet: producing it
requires the release-discipline bump first (the tree currently declares
`1.0.0-rc.20` while sitting 390 commits past the `v1.0.0-rc.20` tag — see Gate
27), because building at the current stamp would emit a second, different
binary calling itself rc.20. **Order: bump version → build → pre-flight → run.**

Windows execution itself is available on this host — QEMU and the Windows 11
ARM64 guest from the rc.20 session are both still present, and the in-repo
`run-windows-vm` skill drives them. "Machine-blocked" is no longer the accurate
description of this gate; **artifact-blocked** is.
