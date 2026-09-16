# SEAM-B.24 / GATE-R.18 — OPERATOR CREDENTIAL CEREMONY (NARROW ENTRA CONTACTS AUTHORITY)

## Executive verdict

**`CLIENT_ID_NOT_ESTABLISHED`** — the narrowest truthful verdict, chosen because it is the one I can
*measure*. The ceremony's credential inputs are absent from the launching environment
(`NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID` **UNSET**, `NEUROPAUSE_MICROSOFT_ENTRA_TENANT_ID` **UNSET**,
`NEUROPAUSE_M365_SCOPE_PROFILE` **UNSET**), so the human ceremony did not begin. I deliberately did
not report `REGISTRATION_NOT_AVAILABLE`: whether a registration exists in the Entra portal is a fact
about Azure I cannot observe from here, and asserting it would be inference dressed as measurement.

**`LAUNCH_COMMAND_NOT_ESTABLISHED` is now CLOSED — and that is this seam's contribution.** The
directive assigned exactly one task that did not depend on the human: measure the launch semantics
B.23's dead agent left open, *without inventing a command*. That is done, and along the way the fleet
found **a cross-profile blocker no prior seam had recorded**.

```
SEAM:                 B.24 / GATE-R.18
HEAD_BEFORE:          38050c5          HEAD_AFTER: this commit (docs only)
VERDICT:              CLIENT_ID_NOT_ESTABLISHED
ARTIFACT_SHA:         c357a426a2822e56dcb2f26a0cc91417dd0e01eda5b9fdaaa5f3ab1996412e00
ARTIFACT_PRESERVED:   YES        SOURCE_CHANGES: 0        BUILD_COUNT_DELTA: 0
GOVERNED_HASHES:      7/7        GATE_0: PASS (parity 13/13 exit 0 · boundary 17/17)
CLIENT_ID_ENV:        UNSET      TENANT_ID_ENV: UNSET     SCOPE_PROFILE_ENV: unset
REGISTRATION:         NONE (not evidenced; not asserted either way)
FRESH_PROFILE:        NOT_CREATED (deliberately — see §Profile)
FIRST_RUN_ONBOARDING: REQUIRED (measured)   ONBOARDING_COMPLETED: NOT_REACHED
CONNECTOR_UI:         NOT_REACHED   BROWSER: NOT_OPENED   CONSENT_SCREEN: NOT_REACHED
CONSENT_REVIEW:       NOT_REACHED   HUMAN_APPROVAL: NOT_REACHED
GRANTED_SCOPES:       []            GRANTED_SCOPE_COUNT: 0    EXPECTED_GRANT_COUNT: 6
FORBIDDEN_SCOPE_INTERSECTION: EMPTY (vacuously — no grant exists)
RESOURCE_QUALIFIED_SCOPE: NOT_MEASURED   ACCOUNT_COUNT: 0   NEW_ACCOUNT: NONE
OAUTH_NETWORK_ACTIVITY: NOT_STARTED
GRAPH_BUSINESS_EFFECT: 0   CONTACT_POST: 0   CONTACT_READ: 0
GATE_2: NOT_STARTED        SECRET_LEAK: 0
FIRST_BROKEN_EDGE:    ARTIFACT → CREDENTIAL
```

## GATE 0 — PASS on all ten

| # | Measurement | Value | Status |
|---|---|---|---|
| 1–3 | B.20 artifact | `c357a426…` · **6,617,224 bytes** · mtime 2026-08-24T21:59:22Z | **EXACT** |
| 4 | armed `out/` | `e40a47a2051b6e2e8aa90450c04a917c98d6a3189188455ed53cb0ebbb5f27d8`, 86 files | **UNCHANGED** |
| 5 | B.13 ASAR | `4add8d3fcc0104bac83c7b2a54be4d800dfd72dfd18f8221934984dbb92bed2c` | **UNCHANGED** |
| 6 | B.13 DMG | `d4d5802f9f77b1a486f5e3bf94de9f8be403620d289c7e7f68bcc333fc1e186c` | **UNCHANGED** |
| 7 | governed hashes | 7/7 | **INTACT** |
| 8 | parity verifier | **13/13, true exit 0** | **PASS** |
| 9 | boundary verifier | **17/17** | **PASS** |
| 10 | custody drift | only the pre-existing protected `baseline.json` + 2 untracked artifact dirs | **NONE** |

No build, no package, no signing, no publish, no source change. `.env.entra` **was not read, not
printed, not sourced**.

## THE LAUNCH COMMAND — MEASURED, NOT INVENTED

```bash
REPO=/Users/saurabhpatel/Desktop/neuropause-desktop
PROFILE="/tmp/np-ceremony-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$PROFILE" && [ -z "$(ls -A "$PROFILE")" ] && echo "PROFILE EMPTY: $PROFILE"

env -u ELECTRON_RENDERER_URL -u NP_E2E_BUILD -u NEUROPAUSE_E2E \
  NODE_ENV=production \
  NEUROPAUSE_M365_SCOPE_PROFILE=contacts \
  NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID='<PASTE_CLIENT_ID>' \
  NEUROPAUSE_MICROSOFT_ENTRA_TENANT_ID='<PASTE_TENANT_ID>' \
  "$REPO/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "$REPO/apps/desktop/out-seam-b20/main/index.js" \
  --user-data-dir="$PROFILE"
```

Neither placeholder was filled, read, or inferred from any source.

**Derivation, every element traced.** *The binary:* exactly one runnable Electron exists —
`journalRuntime.e2e.cjs:69-74` passes no `executablePath`, so playwright resolves
`require("electron/index.js")`, which from `apps/desktop` lands at the repo root and computes
`dist/Electron.app/Contents/MacOS/Electron` (v42.8.1, Mach-O arm64). Not on PATH; no
`/Applications/Electron.app`; `apps/desktop/node_modules` has no `.bin`. *The arg shape:*
`journalRuntime.e2e.cjs:70` — `args: [ALT_MAIN, '--user-data-dir=' + profile]` — the repository's own
measured invocation semantics for exactly this artifact class, which **B.10 ran for real**.

**The one inference, isolated and named rather than hidden:** playwright always prepends
`--inspect=0 --remote-debugging-port=0` (and `-r <loader.js>` when `executablePath` is absent), so the
harness execs six args and the shell equivalent drops playwright's three instrumentation switches.
The app has never been launched in this repo without them. The inference is well-supported —
**`process.argv` occurs 0 times in the whole bundle, so the app parses no CLI arguments at all** — and
omitting `--remote-debugging-port=0` is the right call for a credential ceremony, since it would open
a CDP port during an OAuth flow. Recorded as INFERENCE, not measurement.

**Form is load-bearing:** any *directory-form* launch rooted at `apps/desktop` resolves that
`package.json`'s `main` and would load **the armed `out/` build**, not the B.20 artifact. The
positional-**file** form is mandatory.

## RENDERER AND PRELOAD RESOLVE CORRECTLY FROM THE ALTERNATE outDir

This was the potentially ceremony-blocking unknown, and it resolves in the ceremony's favour. Both
paths are built `__dirname`-relative — `join(__dirname, "../preload/index.js")` and
`join(__dirname, "../renderer/index.html")` — never via `app.getAppPath()`, never against a hardcoded
`"out/"`. The bundle is genuine CJS (`import.meta` 0, `fileURLToPath` 0, no `__dirname =`
assignment), so `__dirname` is Node's native value: the directory of the executing script. The string
`out-seam-b20` occurs **0** times in both bundles, as do `out/main`, `out/preload`, `out/renderer`
and `app.asar` — **the artifact is position-independent**. Every target verified to exist, including
the two subresources `index.html` references via *relative* `./assets/…` hrefs (an absolute
`/assets/…` would have resolved to filesystem root and blanked the window). IPC works: the preload
exposes `neuropause`, and `isTrustedSender` returns true for any `file://` sender before consulting
the allowlist — which matters, because under ceremony conditions the allowlist is empty.

**⚠ ONE NAMED PRECONDITION — `ELECTRON_RENDERER_URL` MUST BE UNSET.** `config.isDev =
!app.isPackaged` is **true** for an unpackaged positional-file launch, so that env var is the *only*
thing standing between the ceremony and the dev branch. If it happens to be exported in the
operator's shell, the app calls `loadURL` against a dev server that is not running — and **no
`did-fail-load` handler exists (0 occurrences)** — so the operator sees a **silent blank window** and
never reaches Connect. The command above guards it with `env -u`.

**Near-miss worth recording as a design property:** `out/renderer/index.html` still exists on disk.
Had resolution been written against `"out/"` or `getAppPath()`, the ceremony would not have blanked —
it would have **silently loaded the stale pre-B.18 renderer while the operator saw a working
window**. The failure would have been invisible rather than obvious. It does not occur; the margin is
worth keeping.

**Recorded bound (verifier):** because the artifact runs **unpackaged**, `config.isDev` is true and
**seven dev-permissive behaviours are active**. `env -u ELECTRON_RENDERER_URL` mitigates exactly
**one** of them and must not be presented as covering the rest.

## ⚠ NEW FINDING — F-B24-1: THE OAUTH LOOPBACK PORT IS KERNEL-GLOBAL, NOT PROFILE-SCOPED

The fresh-profile control does **not** cover this, and no prior seam recorded it. The Entra loopback
binds a fixed TCP port — `loopbackPort: 42817` (`manifests.ts:688`) — and `startLoopbackServer`
rejects with a named error (`auth/loopbackServer.ts:92`):

> `Loopback port 42817 is in use. Close whatever is using it and try connecting again.`

**TCP ports are not profile-scoped.** Any NeuroPause/Electron instance on *any* `--user-data-dir`
that is mid-connect holds 42817, and **GATE 1's consent step fails** — at the consent step, not the
launch step, which is why the single-instance analysis misses it. Measured: `"in use"`, `"kill"`,
`"running instance"` all occur **0** times in the B.21 and B.22 evidence.

**Pre-launch check for the runbook:** confirm nothing holds `127.0.0.1:42817` before clicking Connect
(`lsof -nP -iTCP:42817 -sTCP:LISTEN`). If consent fails with that exact string, another instance
mid-OAuth is the cause.

## Single-instance lock — the fresh profile is immune, for a simpler reason than scoping

A genuinely fresh `--user-data-dir` contains no `SingletonLock`, so the lock is acquired
unconditionally **regardless of how it is scoped** — the ceremony conclusion does not need the
contested Chromium-binding inference, and resting a runbook on that inference would be unnecessary
risk. (Scoping is nonetheless corroborated: three profiles on this machine each hold their own
`Singleton{Lock,Socket,Cookie}` triple with distinct dead PIDs. It is an **inherited, unpinned
platform behaviour** — `SingletonLock`/`singleInstance`/`second-instance` occur **0** times across
1,172 test files, so nothing in this repo fails if it changes.)

**If the lock is ever lost, the failure is near-silent, and the signature is a misdiagnosis trap.**
The `!gotLock` branch is exactly `app.quit();` — no dialog, no message (`showErrorBox` 0,
`showMessageBox` 0, `"another instance"` 0). Because `app.quit()` is asynchronous, module execution
continues and emits the *same* "Starting in development mode" line a successful launch prints. The
only visible symptom is the **primary instance's `second-instance` handler calling `showMainWindow()`
— an OLD window jumping to the front.** Combined with tenant and profile being frozen at process
start, an operator who relaunches with `NEUROPAUSE_M365_SCOPE_PROFILE=contacts` set could be handed a
window belonging to a process that froze the **full 22-scope** profile. **A window appearing is not
evidence that the new launch won.** The distinguishing measurement: a losing instance never attaches
the file sink, so `<profile>/logs/app.log` is never created.

**And the lock is not a guard against the flagless hazard:** the lock in
`~/Library/Application Support/Electron` targets dead PID 91991, so it is stale and will be cleaned —
a flagless launch proceeds straight into that already-claimed `microsoft-entra` profile.

## First-run onboarding — measured, click by click

**TWO stacked takeovers** gate a fresh profile. Minimum path to Connectors is **three clicks**:

1. **"Skip setup for now"** (first-run takeover — `FirstRunExperience`, `fixed inset-0 z-[60]`,
   `role=dialog`, `aria-label="Welcome to NeuroPause"`)
2. **"Skip tour"** (`OnboardingWizard`, a second viewport-covering modal at `fixed inset-0 z-50`)
3. sidebar **"Connectors"** → **Connections** → **"Microsoft Entra ID"** → **"Connect"**

**Zero network calls beyond a loopback Ollama probe, zero sign-in, and no path by which onboarding
can create a connector account row.** Verifier refinement: the second modal appears after takeover 1
only on its *"Skip tour"* or completion exits, **not** after its *"Sign In"* exit — so do not take
the Sign In branch. Onboarding state persists to `<userData>/experience-profile…`.

**Onboarding is product-local state; consent is provider authority. They are different transitions
and must not be merged in the record.**

## Profile — deliberately NOT pre-created

The predicate is *previously non-existent → created at ceremony time → verified empty → launch*.
Creating the directory now to "get ready" would weaken exactly that provenance, and the directive
says so explicitly. The command above creates and verifies it inline.

## Stop conditions

All walked; **none fired**. Notably: artifact/armed/ASAR/DMG unchanged · no source change · no build ·
`.env.entra` not sourced · no registration reused · no client secret required or created · consent
screen never reached, so no escalation observable · GATE 2 not invoked · no secret in any output.

## Carried forward, deliberately unfixed

**F-B22-3** (scope asymmetry) · **F-B22-6** (build-info client-id fallback lacks the sibling
`app.isPackaged` guard) · **F-B22-7** (permission viewer cannot show excess authority) · **B1** (no
persisted consent-time profile label) · **B3** (`extraAuthParams` could overwrite scope) ·
**F-B23-3** (resource-qualified scope compatibility — still observationally unmeasured, and it stays
that way until a real grant exists). *This gate is not a refactoring gate.* No `SOURCE_DEFECT_OBSERVED`
blocked the ceremony.

## The acceptance test, restated so it is not misread at the moment it matters

**REQUESTED 7 → EXPECTED GRANTED 6.** Expect `openid profile email User.Read Contacts.Read
Contacts.ReadWrite`, with **`offline_access` absent** (Microsoft consumes it to mint the refresh
token and does not echo it). **An exact seven is a STOP — `GRANTED_SCOPE_FAILOPEN_FINGERPRINT`** — not
a better outcome. Read `grantedScopes` from `<PROFILE>/connectors.json` (plain JSON, 0600, atomic,
written before `connect()` returns, no token material — tokens live in the separate encrypted
`connector-vault.bin`). **Never** decode a token; `scp` occurs 0 times repo-wide and no such
instrumentation exists or may be added.

## Next single action

**The operator performs GATE 1.** Create the new dedicated **public-client, delegated-only**
registration (`Contacts.Read` + `Contacts.ReadWrite` only; redirect exactly
`http://127.0.0.1:42817/callback`; no secret, no certificate, no application permissions; do not
click *Grant admin consent* — if the tenant demands it, record `ADMIN_CONSENT_REQUIRED` and stop).
Then run the **measured command above**, pass the three onboarding clicks, reach
**Connectors → Microsoft Entra ID → Connect**, **read the consent screen before approving**, and stop
on anything beyond Contacts + sign-in. Check `lsof -nP -iTCP:42817 -sTCP:LISTEN` first (F-B24-1).

**GATE 2 remains closed and unauthorized.** Credential ≠ effect · consent ≠ effect · token ≠ effect ·
permission ≠ effect. No `POST /me/contacts`, no `GET /me/contacts`, no read-back — not even a
harmless GET.
