# SEAM-B.22 / GATE-R.16 — CREDENTIAL / CONSENT CEREMONY

## 1 · Executive verdict

**`CREDENTIAL_CONSENT_NOT_ESTABLISHED`** (§25, third form: *human action did not occur*).

No Entra registration was created, no consent screen was opened, no credential was obtained, no
browser was opened, no network call was made. **GATE 0 passed on every predicate.** GATE 1's human
steps were neither performed nor simulated.

**EXTERNAL_EFFECT = 0 · NETWORK_CALLS = 0 · GRAPH_EFFECT = 0 · BUILD_COUNT_DELTA = 0 ·
SOURCE_CHANGES = 0 · SECRET_LEAK = 0 · GATE_2 = NOT_STARTED.**

**The seam's real product is not the verdict — it is what the fleet and the disk measurements found
about the ceremony that is about to be run.** Two conditions were discovered that were not visible
at B.21 and that change the runbook rather than decorate it (§24 F-B22-2 and F-B22-3 below). Both
were found by measuring the *wrong* space at B.21 and the *right* one here.

## 2–4 · Gate identity · HEAD

SEAM-B.22 / GATE-R.16 · branch `cert/data-import-cst-integration`.
**HEAD_BEFORE `6d3af31`** · **HEAD_AFTER**: this commit (documentation only).

## 5–6 · Source changes · build count

**SOURCE_CHANGES = 0. BUILD_COUNT_DELTA = 0.** No product source, no manifest, no OAuth source, no
executor, no verification architecture, no redirect config, no scope config was modified. Nothing
was built, packaged, signed or published. B3 was deliberately **NOT** fixed (§15 of the directive).

Proven, not asserted: the full main suite was re-run to completion — **896 files / 9354 passed /
7 skipped, exit 0** — byte-identical to the B.21 baseline. A measured number, not a prior report.

## 7–8 · Artifact identity · custody measurements

| # | Measurement | Value | Status |
|---|---|---|---|
| 1 | B.20 artifact sha256 | `c357a426a2822e56dcb2f26a0cc91417dd0e01eda5b9fdaaa5f3ab1996412e00` | **EXACT** |
| 2 | B.20 artifact size | 6,617,224 bytes | **EXACT** |
| 3 | B.20 artifact mtime | 2026-08-24T21:59:22Z | **UNCHANGED** |
| 4 | armed `out/` | `e40a47a2051b6e2e8aa90450c04a917c98d6a3189188455ed53cb0ebbb5f27d8`, 86 files, seed chunk present | **PRESERVED** |
| 5 | B.13 ASAR | `4add8d3fcc0104bac83c7b2a54be4d800dfd72dfd18f8221934984dbb92bed2c` | **PRESERVED** |
| 6 | B.13 DMG | `d4d5802f9f77b1a486f5e3bf94de9f8be403620d289c7e7f68bcc333fc1e186c` | **PRESERVED** |
| 7 | governed source hashes | 7/7 OK | **INTACT** |
| 8 | git status | only ` M certification/baseline.json` (pre-existing, custody-protected) + 2 untracked artifact dirs | **CLEAN** |
| 9 | HEAD | `6d3af31` | recorded |
| 10 | baseline | `CERT-40616b9`, frozen 2026-08-21T19:06:39Z | see below |

**`verify-freeze.sh` reports ANCESTRY OK · SOURCE FAIL — and that is NOT custody drift.** The
script's SOURCE limb compares all tracked source against the baseline commit; it does not
distinguish frozen from non-frozen. I did not accept its coarse verdict as a frozen-surface
measurement (§2 #24). I ran `gate-detector.sh` — the authoritative machine projection of §2/§6 —
against **every one of the 18 files it names**: **18/18 PROCEED, zero GATE_REQUIRED, zero
SENSITIVE, zero FROZEN.** The failing set is exactly the non-frozen deliverables landed by seams
B.8–B.20, i.e. the baseline lagging landed work — the F-P25 conflation class, already recorded in
§1. **No frozen surface moved.** Stop condition 5 measured, not assumed.

## 9 · GATE 0 predicates

- **Artifact parity verifier**, execution-based (extracts the artifact's compiled authority logic and
  runs it in a `node:vm` sandbox with no net/fs/electron): **13/13 PASS, true exit 0.**
  Contacts profile = exactly the 7 expected scopes · 15 forbidden scopes, none present ·
  contacts ∩ {mail, files, calendar, directory, teams} = ∅ · full profile still set-equal to the
  historical 22 · unset⇒full, unknown⇒full, contacts⇒contacts · consent card ≡ request, both
  directions · no embedded secret pattern · redirect preserved · delegated only.
- **Contacts boundary verification: 17/17 PASS.**
- Grep was **not** used as the authority oracle anywhere in GATE 0.

## 10–11 · Registration and redirect configuration

**REGISTRATION: NONE.** Not created, and none inferred. Measured by name and presence only, values
never read: `NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID` **UNSET** · `..._TENANT_ID` **UNSET** ·
`NEUROPAUSE_M365_SCOPE_PROFILE` **UNSET** · `NEUROPAUSE_AZURE_*` **UNSET**.

Redirect, measured **from the artifact**: `loopbackPort 42817` · `callbackPath "/callback"` ·
`usePkce true` · `clientSecretEnv null` · `tokenAuthStyle "body"` · `extraTokenParams {}` ·
`extraAuthParams { prompt: "select_account" }` ⇒ the registration must carry exactly
**`http://127.0.0.1:42817/callback`** under *Mobile and desktop applications*. Unmodified.

**Authority, newly measured this seam:** `ENTRA_TENANT = (process.env[…TENANT_ID] ?? "").trim() ||
"common"`, so `ENTRA_AUTHORITY = https://login.microsoftonline.com/${ENTRA_TENANT}/oauth2/v2.0`.
**If the operator does not set the tenant id, the authority is `common`** — the registration's
supported-account-type must then admit the signing-in account. Setting `..._TENANT_ID` to the
ceremony tenant GUID is the tighter choice and is what the runbook specifies.

## 12 · Requested scopes

Under `NEUROPAUSE_M365_SCOPE_PROFILE=contacts`: exactly seven —
`openid profile email offline_access User.Read Contacts.Read Contacts.ReadWrite`.

**Newly measured structural property:** `ENTRA_OAUTH_SCOPES = m365ScopesForProfile(ENTRA_SCOPE_PROFILE)`
and `ENTRA_TENANT` are **module-level constants evaluated once at module load** (`manifests.ts:107-108`,
single site, top-level; corroborated independently by the fleet). The profile is therefore **frozen for
the lifetime of the process at the instant it starts**. This sharpens the standing rule: it is not
merely "set it on every launch" — **the variable must be in the environment of the process at exec
time, and cannot be changed while the app runs.**

## 13–14 · Consent screen · credential establishment

**NOT REACHED / NOT ESTABLISHED.** The consent screen was never opened, therefore never observed;
`CONSENT_STATUS = NOT_ESTABLISHED`; `CONSENT_ESCALATION = 0` (nothing was displayed to escalate).
No credential was requested, received, printed, stored, logged or committed.

## 15 · Token authority measurement — and a correction to the directive's expectation

**`TOKEN_AUTHORITY_NOT_MEASURED` (no token exists).** But the fleet established *how* it will be
measurable, and it is not the way §12 of the directive anticipated:

**THE PRODUCT NEVER DECODES A TOKEN.** `RawTokenResponse` has no `id_token` member; `id_token`
occurs **zero** times in the measured artifact; **`scp` is read nowhere in `src/main`**. So there is
no `scp` claim for this seam or any future one to inspect through the product.

What the product *does* — and this is the stronger property — is **record the provider's returned
`scope` verbatim and gate on it**: `normalizeTokens` sets `scopes: parseScopes(raw.scope)`
(`oauthEngine.ts:89`), stored unconditionally as `grantedScopes: tokens.scopes`
(`connectorService.ts:655`), read by the executor's gate (`connectors/index.ts:396` →
`m365/executor.ts:106-110`) and re-checked inside the CST kernel (`sendTransition.ts:182`,
`governedAction.ts:271`). The earlier **fail-open** shape — `tokens.scopes.length ? tokens.scopes :
manifest.oauth.scopes`, i.e. *recording what was asked as though it were what was granted* — was
removed as a P0 and is held out by an enumeration pin (`grantedScopeFailClosed.test.ts:54-72`). An
absent scope list stores `[]`, which **refuses**. Exactly two write sites exist repo-wide, both fed
by a fresh interactive authorize; **the refresh path deliberately does not touch the stored list.**

**Consequence for GATE 1's acceptance test, recorded before it is run:** the authority to measure is
`grantedScopes`, and **a returned set SMALLER than seven is normal, correct, and must not be
"fixed."** The provider decides what it returns. Restoring any manifest fallback to make the number
look like seven would re-introduce the exact P0 the pin exists to prevent.

Also established: **application permissions cannot appear on this path.** `roles` requires the
client_credentials grant; `oauthEngine` implements only authorization_code and refresh_token. The
single `client_credentials`/`.default` implementation is `infrastructure/azure/azureAdapter.ts:48-56`,
needs three separate env vars including a secret, and is architecturally isolated — an import-edge
check from `infrastructure/azure/` into the connector path returned **empty**.

## 16 · Account binding — **F-B22-2 and F-B22-3, the seam's material findings**

**F-B22-2 · PATH A IS NOT HYPOTHETICAL. A BROAD 46-SCOPE `microsoft-entra` ACCOUNT ROW EXISTS ON
DISK RIGHT NOW.** B.21 recorded path A conditionally ("*only if* `connectors.json` already holds a
row"). I measured the condition instead of restating it. Three profiles hold a `microsoft-entra`
row (scope **names** are non-secret evidence under §22; no token material was read):

| Profile | rows | granted scopes | holds `Contacts.ReadWrite` | status |
|---|---|---|---|---|
| `Electron` (Electron's default) | 1 | **3** — `Mail.Send User.Read offline_access` | **no** | connected |
| `NeuroPause-Mock` | 1 | 3 | no | connected |
| `@neuropause.p13c-bak-20260812-165454/desktop` | 1 | **46**, incl. `Mail.Send`, `Mail.ReadWrite`, `Files.ReadWrite.All`, `Directory.Read.All`, `User.Read.All`, all Teams scopes | **YES** | `reauth_required` |

*Precision correction to §1:* F-1 recorded the S15 token as "broad ~47-scope". The persisted grant
measures **46**. The `reauth_required` status is consistent with the operator having revoked consent
during S16 containment while the local row survived.

**F-B22-3 · THE ASYMMETRY — AND IT CUTS THE WRONG WAY FOR *THIS* CEREMONY.** The panel binds
`dto.accounts[0]` at `EntraConnectorPanel.tsx:132` (propose) and `:348` (the `accountId` handed to
`M365WritePanel`, whose only execute call is `M365WritePanel.tsx:106`). The fleet narrowed the
selection precisely: it is the **first-inserted surviving row whose `connectorId === 'microsoft-entra'`
AND whose `workspaceId` is the ACTIVE workspace** — Map insertion order, no sort anywhere on the
path. So it is **deterministically oldest-first**: a newly consented narrow account can **never**
become `accounts[0]` while an older row survives in that workspace. `multiAccount: true`, so a
second connect is not blocked and nothing asserts single-account-ness.

Now combine that with the scope gate. **For `mail.send`, a narrow account is refused loudly. For
`contacts.create`, a broad account is accepted SILENTLY** — because a 46-scope grant contains
`Contacts.ReadWrite`, so the gate passes, and the contact is created **in the wrong mailbox with no
refusal anywhere in the system.** The very breadth that would trip every other capability is
invisible to this one.

**A fresh `--user-data-dir` is therefore not hygiene — it is the single control standing between
this ceremony and a silent wrong-mailbox write.** And per §2 #31 it is an **operator procedure with
no backing assertion**: no code detects the condition, and no test fails if the ceremony is run on a
populated profile. Recorded as a finding, not as a mitigation.

Confirmed fail-closed on the other two paths: the ceremony's direct-IPC route takes a
**caller-supplied** `accountId` (`connectors/index.ts:618/663/683`) and does not touch `accounts[0]`
at all; the worker path denies `BINDING_MISMATCH` on `accountId === undefined` (`boundaryB.ts:61`).

## 17 · Fresh profile proof

**NOT_REACHED** — no launch occurred, so every predicate in §24 of the directive
(`PROFILE_CREATED_NEW`, `NO_PREVIOUS_ACCOUNT_STATE`, `NO_PREVIOUS_TOKEN_CACHE`,
`NO_PREVIOUS_REFRESH_TOKEN`, `SELECTED_ACCOUNT`) is honestly unestablished rather than assumed.

I deliberately did **not** pre-create the directory. Freshness is a property measured **at launch**;
a directory created now and used days later is not demonstrably fresh, and pre-creating one would
manufacture a predicate rather than satisfy it. The runbook specifies its creation at ceremony time.

**What a fresh profile does and does not reset — measured, so the claim is not taken on trust.** The
product's credential store is `connector-vault.bin`, resolved as
`join(app.getPath('userData'), 'connector-vault.bin')` (`connectorVault.ts:106-107`) — **inside**
userData. Account rows live in `connectors.json`, likewise inside userData. Credential residue map
across the machine:

- vaults present in `Electron` (328 B), `NeuroPause-Mock` (328 B), `@neuropause.p13c-bak-…/desktop` (8,837 B);
- **`NeuroPause-S15-run2` holds NO vault and NO `connectors.json`** — no product credential material
  survives in the S15 profile, though the profile directory itself was never deleted;
- **zero** keychain entries named NeuroPause.

Because both stores are inside userData, a fresh `--user-data-dir` genuinely yields no prior token,
no prior account, no prior consent state. The claim is now measured rather than assumed.

## 18–20 · Network · external effect · Graph effect

**NETWORK_CALLS = 0. EXTERNAL_EFFECT = 0. GRAPH_EFFECT = 0. COHORT_API_EFFECT = NOT_VERIFIED.**
No endpoint was contacted, no credential tested, no endpoint probed. `GATE_2 = NOT_STARTED`: no
`POST /me/contacts`, no `GET /me/contacts`, no PATCH, no DELETE, no mutation of any kind.

## 21 · Stop conditions

All 23 walked. **None fired.** Notable ones measured rather than waved past: (1)–(4) artifact/armed/
ASAR/DMG all byte-identical; (5) frozen surfaces — 18/18 PROCEED via gate-detector; (6)–(7) no build,
no source change; (14)–(15) not reached, no launch occurred; (17) `NEUROPAUSE_M365_SCOPE_PROFILE` is
UNSET — which is precisely **why** no launch occurred, so the predicate is satisfied-by-abstention
rather than violated; (20)–(21) no Graph mutation, GATE 2 untouched; (23) no source fix appeared
necessary, and B3 was deliberately left unfixed.

**Two conditions needing an explicit ruling rather than a silent pass:**

**Stop 8 — "credential appears in repository": NOT TRIGGERED, stated precisely.** The repository
*working directory* contains `.env`, `.env.entra`, `.env.github`, `.env.local-stack`. All four are
**untracked and gitignored** (`.gitignore:40` matches `.env.*`); `git ls-files` returns empty for
each. Nothing entered the repository's tracked content, and nothing can be committed accidentally.

**Stop 9 — "client secret exists": DOES NOT APPLY TO THE CEREMONY REGISTRATION, and I am not
stretching it to fit.** `.env.entra` carries the key name
`NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_SECRET` with a non-empty value (presence and length class only —
**the value was never read, printed, or passed to any tool**), mtime **2026-07-10**, six weeks before
this seam and before S15 itself. It belongs to a **pre-existing** registration. The ceremony
registration does not exist, so it cannot have a secret. Nothing in this programme requested,
created, stored, printed, logged or committed it: **no `SECRET_BOUNDARY_VIOLATION` occurred.**

Crucially, **the measured artifact cannot read it**: `NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_SECRET`
occurs **zero** times in the artifact, and `clientSecretEnv: null` occurs four times. The entra
connector is a public client by construction, and P11 of the parity verifier **asserts** it — a
mechanism with a failing assertion behind it, not incidental protection.

## 22 · Deviations and corrections

**None from the directive's constraints.** Corrections made against my own prior work:

1. **§2 #30, self-caught.** My B.21 evidence recorded *"no `.env` files in `apps/desktop`"* — true as
   scoped, and **the wrong search space**. The files are at the repository **root**. A complete
   search of the wrong space is indistinguishable from a complete answer; the finding below existed
   at B.21 and was invisible because of where I looked.
2. **F-1 precision**: "~47-scope token" → the persisted grant measures **46**.
3. **Instrument integrity, discovered by the fleet and verified first-hand:** `grep` on this machine
   is a **shell function resolving to ugrep 7.5.0**, not GNU/BSD grep. The fleet re-measured its
   zero-occurrence claims with an exact-substring Node counter rather than trusting the alias. My own
   counts were cross-checked the same way where they were load-bearing. This belongs to the §2 #24
   family: *a red — or a zero — obtained from an unverified instrument is evidence about the
   instrument.*
4. **Line-number correction inside the fleet's own output:** the baked-client-id consumer is
   `connectors/credentials.ts:32`, not `:33` (caught by the adversarial verifier reading it
   first-hand).

## 23 · Recon status

**RECON_STATUS = COMPLETE** before any reconciliation was written, and before this document was
begun — **15/15 agents finished, 0 errors, 0 empty results**, 505 tool calls, ~2.09M subagent tokens.
Four recon lenses (token authority · refresh and cache · account selection · configuration channels)
each followed by adversarial verifiers instructed to **refute**, defaulting to refuted when unable to
confirm first-hand.

**The adversarial phase did its job — it refuted or narrowed 10 of 11 material claims**, including
several from its own side of the fleet. No recon result contradicted a first-hand measurement of
mine; two **extended** them (the account-row census and the artifact-sandbox scenario), and one
**corrected my search space** (item 1 above). Where the fleet and I agreed, the agreement is
independent: I measured the artifact and the disk, the fleet measured the source and the sandbox.

Reconciled fleet answers:
- **Q1 — can the token carry authority beyond Contacts.Read + Contacts.ReadWrite? NO** for the
  recorded grant (§15 above), with the caveats being on the **request** side, not the record.
- **Q2 — can selection/refresh/cache/config escape narrow authority? YES**, and the escapes are
  operator-environment-shaped, not code-shaped. Enumerated in §24.

## 24 · Findings — B.21's B1/B2/B3 carried forward, plus this seam's

**B1 (carried, re-measured and CONFIRMED):** no product path persists which **profile** an account
was consented under. `ConnectedAccount` carries `grantedScopes` and **no profile field**
(`packages/shared/src/types/connectors.ts:199`); nothing compares the two. Narrow consent is not
durably bound to the account. **The env var remains the whole control.**

**B2 (carried, unchanged):** "this artifact requests only seven Graph scopes" is false as stated —
the artifact contains a `.default` app-only request for a **separate, inert** Azure registration.
The true claim names the connector. Re-verified: the isolation is structural (no import edge).

**B3 (carried, DELIBERATELY NOT FIXED per §15):** `oauthEngine.ts:165` applies `extraAuthParams`
with `.set` **after** the scope parameter is written, so a manifest key named `scope` would silently
replace the profile-derived value. No manifest has one; no mechanism enforces it; no assertion fails
if it breaks. Future hardening gate.

**F-B22-1 · THE `.env.entra` TRAP — the highest-value finding, and its shape is what makes it
dangerous.** The file is written in **`export KEY="value"` form — i.e. shaped to be `source`d** —
and carries exactly `CLIENT_ID`, `CLIENT_SECRET`, `TENANT_ID`. It does **not** carry
`NEUROPAUSE_M365_SCOPE_PROFILE`. So the file that looks like *"the Entra credentials file"* supplies
precisely the two variables that **bind a registration and redirect the authority to its tenant**,
and omits the one variable that **narrows the request**.

The fleet proved the consequence by **executing the artifact's own compiled scope-resolution code in
a `node:vm` sandbox** (execution-based, not grep-based): with the entra vars set and the profile
unset — scenario S5 — the result is **`profile=full`, `scopeCount=22`, `hasMailSend=true`**, with the
authority carrying the injected tenant. **That is the SEAM-B.17 STOP condition, reachable by one
`source` command with zero code change.**

Bounding it honestly, because the adversarial verifier refuted the strongest framing: **the file is
not "staged for the ceremony."** `grep -rn "env.entra" certification/` = **0** — no ceremony document
prescribes sourcing it; nothing auto-loads it (**0** `dotenv` occurrences in the artifact, verified
with an exact-substring counter, and zero auto-loaders repo-wide); and it predates S15. Sourcing it
would be a deliberate operator act. It is a **loaded foot-gun sitting next to the ceremony**, not a
booby-trap wired into it.

**NOT_ESTABLISHED, and it is the single most important unknown in this seam:** *which* registration
that CLIENT_ID names, and whether it still exists. Resolving it requires either reading the value or
a network call — both forbidden here. If it names a registration deleted during S16 containment,
auth fails loudly (safe). If it names a still-live older one, auth succeeds **against the wrong
app** (dangerous). **Only the operator can resolve this, and the runbook makes it a precondition.**

**F-B22-2 · the broad 46-scope account row exists on disk** (§16). Path A upgraded from conditional
to instantiated.

**F-B22-3 · `contacts.create` accepts a broad account silently** (§16). The asymmetry that makes
F-B22-2 consequential for *this specific* ceremony.

**F-B22-4 · the build-info baking channel — a real residual bound, currently inert.**
`generate-build-info.cjs:64-68` harvests every `/^NEUROPAUSE_[A-Z0-9_]+_CLIENT_ID$/` from the build
shell into `resources/build-info.json`; `buildInfo.ts:90-92` exposes it; `connectors/credentials.ts:32`
consumes it as `readEnv(oauth.clientIdEnv) ?? getBakedClientId(oauth.clientIdEnv)`. The entra client
id matches the regex. **Measured inert:** both `build-info.json` files on disk (repo `resources/` and
the B.13 packaged copy) carry `connectorClientIds: {}` — **zero entries**. **Measured unreachable for
the ceremony vehicle:** launching `electron <…>/out-seam-b20/main/index.js` sets appPath to
`out-seam-b20/main`, and all three candidate paths are absent, so `getBakedClientId()` returns null
unconditionally. **The residual bound is real and future-dated:** `electron-builder.yml:13-15` ships
`resources/build-info.json` into `Contents/Resources`, which *is* candidate 1 — so a future
`npm run package:*` executed in a shell where `.env.entra` had been sourced would **durably bake** a
registration that binds on a clean-environment packaged launch. **No verifier inspects
`connectorClientIds`.** Recorded; not fixed (no source change is authorized here).

**F-B22-5 · S15 containment is incomplete.** The `NeuroPause-S15-run2` profile directory still
exists (credential-empty), and `.env.entra` still holds a live-shaped client id, secret and tenant id
from 2026-07-10. §1 records containment as the step after S16. Recorded as programme hygiene; it is
not a ceremony blocker because the ceremony uses a fresh profile and a new registration.

## 25 · Maturity impact — kept strictly separate

Credential establishment did not occur, so **no edge advanced**. Stated against §31/§34 so no false
maturity is inferred:

- ARCHITECTURE → IMPLEMENTATION: established previously.
- IMPLEMENTATION → ARTIFACT: established at B.20 (`ARTIFACT_PARITY_ESTABLISHED`), re-verified 13/13.
- **ARTIFACT → CREDENTIAL: NOT ESTABLISHED — unchanged.** This is still the first broken edge.
- CREDENTIAL → EFFECT: not started. EFFECT → VERIFICATION: not started.
  VERIFICATION → FUTURE AUTHORIZATION: not started.

What this seam *did* advance is the **quality of the preconditions**: two conditions that would have
silently corrupted the ceremony's meaning (F-B22-2/3) and one that could have bound the wrong
registration (F-B22-1) are now measured and have runbook countermeasures. **A precondition
discovered before a ceremony is worth more than a finding filed after one.**

## 26 · Next single action

**The operator performs GATE 1.** The runbook, with the two new preconditions marked ⚠ NEW:

1. **⚠ NEW — do NOT `source .env.entra`, and do not reuse the registration it names** (F-B22-1).
   Launch from a shell where `NEUROPAUSE_MICROSOFT_ENTRA_*` are unset except as set explicitly in
   step 3. If that file's registration is obsolete, deleting the file is the cleaner resolution —
   operator's call, outside this seam's authority.
2. Create a **new, dedicated** Entra registration: **delegated only**; Microsoft Graph permissions
   **exactly `Contacts.Read` + `Contacts.ReadWrite`**; platform *Mobile and desktop applications*;
   redirect **exactly `http://127.0.0.1:42817/callback`**; **public client — no secret, no
   certificate, no application permission**. Do not reuse it for `dynamics365`.
3. Export, in the **same shell that will exec the app** (the profile is frozen at process start):
   `NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID`, `NEUROPAUSE_MICROSOFT_ENTRA_TENANT_ID` (setting the tenant
   GUID is tighter than the `common` default), and **`NEUROPAUSE_M365_SCOPE_PROFILE=contacts`** —
   on **every** launch, not only the first, because the refresh path re-requests the module-resolved
   profile list.
4. **⚠ NEW — launch on a genuinely fresh `--user-data-dir` created at ceremony time**, e.g.
   `mkdir -p /tmp/np-b23-ceremony-$(date +%s)`, outside tracked repository state. This is the only
   control preventing `accounts[0]` from binding the pre-existing 46-scope row, and for
   `contacts.create` that row would be accepted **silently** (F-B22-2/3). Verify the directory is
   empty before launching.
5. Launch **the measured artifact** — `out-seam-b20/main/index.js`, sha `c357a426…`. Do not rebuild.
6. **Read the consent screen before approving.** Expect only Contacts (read), Contacts (read/write),
   and sign-in. **Mail, Files, Calendar, Teams, Directory, Dynamics, application-wide or admin-only
   access ⇒ do not click Accept; record `CONSENT_ESCALATION_DETECTED` and stop.** Do not accept and
   investigate afterwards; do not retry with a broader registration.
7. After consent, the authority to measure is the stored `grantedScopes` (the provider's returned
   `scope`), **not** a decoded `scp` claim — the product never decodes tokens. **A returned set
   smaller than seven is normal and must not be "fixed."**

**GATE 2 — the first governed `POST /me/contacts` and its read-back — remains separate, closed, and
unauthorized.** Credential establishment would not license it: a token does not establish permission
beyond its measured claims, and a consent screen does not establish provider-side effect.

---

# ADDENDUM · 25 Aug 2026 — RE-MEASUREMENT UNDER A RE-ISSUED DIRECTIVE

**Why this is an addendum and not a second evidence file.** The B.22 directive was re-issued
verbatim. Its §0 states `Current HEAD: 6d3af31` — the **pre-B.22** HEAD — so its premise predates the
work that landed against it (§2 #21, §2 #25: a directive's premise expires when work lands against
it). B.22 is closed at `183a7f2`. I did not reopen it, did not re-run its identical 15-agent fleet
against byte-identical source, and did not write a duplicate record. What I did do is **re-measure**,
because a measurement is a claim with a date.

**VERDICT UNCHANGED: `CREDENTIAL_CONSENT_NOT_ESTABLISHED`.**

**GATE 0 re-run, all pass:** artifact `c357a426…` / 6,617,224 B / mtime unchanged · armed `out/`
`e40a47a2…` (86 files, seed chunk) · B.13 dmg `d4d5802f…` · asar `4add8d3f…` · governed hashes 7/7 ·
git status unchanged · **parity verifier 13/13, true exit 0** · **boundary 17/17**. No custody drift.

**GATE 1 measured, not assumed: still not performed.** All three env vars UNSET · no new ceremony
profile · **no `connector-vault.bin` anywhere newer than the B.22 close** (a consent would have
produced one) · `.env.entra` mtime still 2026-07-10. **The `6d3af31 → 183a7f2` delta is docs-only —
CLAUDE.md plus the B.22 evidence, zero source change** — which is what licenses carrying the prior
fleet's conclusions forward rather than re-deriving them.

**RECON_STATUS = COMPLETE (6/7).** A focused fleet was run on the *first* fleet's explicitly recorded
`NOT_ESTABLISHED` items — new work, not a re-run. **One agent died on an API error**
(`recon:default-userdata`), so its question is recorded below as unmeasured rather than answered:
§2 #23 — *not reachable*, *reachable but never executed*, and *never measured* are different objects.

## A1 · CORRECTION — F-B22-2 IS REFUTED AS STATED, BY MY OWN RE-MEASUREMENT

I wrote: *"path A is instantiated, not hypothetical."* **That is false at HEAD, and the superseded
text stays visible above.** The fleet challenged it and I verified the correction first-hand:

| Profile | scopes | `workspaceId` | holds `Contacts.ReadWrite` | selectable? |
|---|---|---|---|---|
| `Electron` | 3 | **PRESENT** (claimed) | **no** | yes |
| `NeuroPause-Mock` | 3 | **PRESENT** (claimed) | **no** | yes |
| `@neuropause.p13c-bak-…/desktop` | **46** | **ABSENT — UNCLAIMED** | **yes** | **no** |

`connectorStore.all()` returns `[]` when no workspace is bound and otherwise filters
`a.workspaceId === workspace` (`connectorStore.ts:125-128`); `unclaimed()` is a **separate** read
whose docstring says such rows are *"deliberately not adopted into the active workspace — that is the
guess this change removes"* (`:168-174`). **So the one row that holds `Contacts.ReadWrite` can never
reach `accounts[0]`, and the two rows that can be selected do not hold it** — a `contacts.create` on
either would be refused loudly by the executor's scope gate.

**Corrected statement:** the dangerous combination — *a selectable row that already holds
`Contacts.ReadWrite`* — **does not exist on disk today**. F-B22-3's *mechanism* claim survives
intact (the code would accept such a row silently, and that asymmetry against `mail.send` is real);
what is withdrawn is the claim that it is currently **instantiated**. The fresh-profile requirement
still stands, but its honest justification is now the two *claimed* 3-scope rows plus the general
mechanism — not the 46-scope backup row I pointed at.

**And the ordering itself is INCIDENTAL PROTECTION, not a mechanism (§2 #31)** — a sharper result
than my original finding. `accounts[0]` is the first-inserted **claimed** row of that connector **in
the active workspace** (Map insertion order — not `connectedAt`, which nothing on the path reads).
No code declares the ordering, no docstring mentions it, and **no test pins it**: the only
multi-account store test deliberately `.sort()`s both sides and is explicitly order-independent, so
**a `.sort()` added at `toDto` would silently change which account the ceremony sends from and zero
assertions would fail.**

## A2 · CORRECTION — F-B22-4's "zero entries" WAS MEASURED ON AN INCOMPLETE SEARCH SPACE

I wrote: *"both `build-info.json` files on disk … carry `connectorClientIds: {}` — zero entries."*
**There are FOUR product `build-info.json` files, and two of them — the 15-Aug rc.20 artifacts under
`apps/desktop/dist/` — each carry ONE baked client id.** Neither is the entra key and neither sits on
a ceremony candidate path, so **the ceremony verdict is unchanged** — but the statement was false as
stated because I never examined `dist/`.

**This is my second §2 #30 failure in this seam** (the first was scoping the `.env` search to
`apps/desktop`). Both had the same shape: a confident negative over a space narrower than the claim.
Recorded as a pattern, not as two incidents.

## A3 · NEW — F-B22-6: THE GUARD EXISTS FOR THE SIBLING FIELD AND NOT FOR THIS ONE

The strongest new finding, because it carries its own precedent. The *same* leak was found and fixed
for `backendUrl`: `config.ts:23-41` documents a **13-Aug-2026 reproduction in which a leftover
`build-info.json` made `npm run dev` authenticate against production**, and the fix was
`defaultBackendUrl() { if (!app.isPackaged) return LOCAL_BACKEND_URL; … }` — present verbatim in the
artifact. **`credentials.ts:32` consumes `getBakedClientId()` with no `app.isPackaged` guard at all.**

So the client-id channel never received the equivalent protection, and in **dev** it is reachable:
`npm run dev` / `electron .` from `apps/desktop` sets appPath to `apps/desktop`, making candidate 3
`apps/desktop/resources/build-info.json` — **which exists today** (0 keys). Under §2 #31 today's
safety is incidental: **name the mechanism enforcing it — there is none; name the assertion that
fails when it breaks — there is none, because no test or verifier anywhere inspects
`connectorClientIds`.** A hardening gate with a ready-made pattern to copy. **Not fixed here** — this
seam authorizes no source change.

## A4 · NEW — F-B22-7: THE PERMISSION VIEWER CANNOT SHOW EXCESS AUTHORITY

`EntraConnectorPanel.tsx:358-378` renders the permission list by iterating **`dto.scopes` — the
resolved profile's *described* set** — marking each granted or not. So under the contacts profile a
46-scope account renders **7 rows, and its 39 excess scopes render nowhere.** The one surface that
looks like it would show a user "this account holds more than you think" structurally cannot. A
UI-truth finding in the §4 sense; recorded, not fixed.

## A5 · B1 SHARPENED — half of it was wrong in my favour

B1 said no record binds an account to a profile *and* implied the data is unavailable. **The
mechanism half is confirmed** (repo-wide census: `scopeProfile`, `consentProfile`, `profileMismatch`,
`requestedScopes`, `excessScopes` all occur **0** times; every production `grantedScopes` read is a
lower-bound subset check or a count). **The data half is false as stated:** `grantedScopes` **is**
persisted (`packages/shared/src/types/connectors.ts:199`) and `m365ScopesForProfile` is pure, so the
operationally decisive predicate — *does this row hold scopes outside the resolved profile's set?* —
**is computable today with no schema change.** What is genuinely absent is narrower: the consent-time
**profile label** and the **requested** set (the request exists only in the authorize URL and is
never logged). Honest bound on any such check: `grantedScopes` stores `[]` when the provider omits
`scope`, conflating *told nothing* with *granted nothing* — sound but incomplete.

## A6 · CLOSED — tenant injection is LOW and is not being inflated

Extracting the compiled authority construction and evaluating it against adversarial tenant strings
with real URL parsing: **the host cannot be moved off `login.microsoftonline.com`.** Path-segment
manipulation is possible and unencoded (an inconsistency with the sibling path that does use
`encodeURIComponent`), but the decisive property holds. The variable is operator-set only; no product
path writes it. Recorded as LOW, no action.

## A7 · NOT_ESTABLISHED — carried forward honestly

- **Which profile a launch WITHOUT `--user-data-dir` would use.** The assigned agent died mid-run;
  the question is **unmeasured, not answered**. It matters only if the operator omits the flag, which
  the runbook forbids — but it is not closed, and I am not closing it by inference.
- **Which registration `.env.entra`'s client id names, and whether it still exists** (needs the value
  or a network call — both forbidden). Unchanged from the main record.
- Whether any connectors.json changed since B.22: mtimes all predate it, but no independent custody
  record exists for them.

## A8 · Accounting for the addendum

`SOURCE_CHANGES 0 · BUILD_COUNT_DELTA 0 · NETWORK_CALLS 0 · EXTERNAL_EFFECT 0 · GRAPH_EFFECT 0 ·
SECRET_LEAK 0 · GATE_2 NOT_STARTED · COHORT_API_EFFECT NOT_VERIFIED.` No maturity edge advanced.
**FIRST BROKEN EDGE unchanged: ARTIFACT → CREDENTIAL.** The next single action remains §26 above,
with one amendment: the fresh-profile step's justification is corrected per A1 — it remains
**mandatory**, on the general mechanism and the two claimed rows, not on the 46-scope row.
