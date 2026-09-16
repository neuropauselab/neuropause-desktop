# SEAM-B.23 / GATE-R.17 — GATE 1 NARROW ENTRA CREDENTIAL / CONSENT CEREMONY

## 1 · Executive verdict

**`CREDENTIAL_CONSENT_NOT_ESTABLISHED`.** No Entra registration was created, no credential was
supplied, no consent screen was opened, no browser launched, no OAuth traffic occurred. The human
preconditions of GATE 1 were not satisfied, so the ceremony did not begin.

**GATE 0 passed on every predicate.** `SOURCE_CHANGES 0 · BUILD_COUNT_DELTA 0 ·
OAUTH_NETWORK NOT_STARTED · GRAPH_BUSINESS_EFFECT 0 · CONTACT_POST 0 · GATE_2 NOT_STARTED ·
SECRET_LEAK 0.`

**But the seam is not empty, and this is why it earns its own record: the fleet found a
`BLOCKS_CEREMONY` defect in the ceremony instructions themselves.** Had the operator followed the
directive's environment block literally, the ceremony would have failed — and in one of the two
cases it would have failed **silently, against the wrong authority**. Three further corrections
change the acceptance test itself. Finding these before the ceremony is worth more than discovering
them during it.

## 2–6 · Gate identity · HEAD · source · build

SEAM-B.23 / GATE-R.17 · 25 Aug 2026 · branch `cert/data-import-cst-integration`.
**HEAD_BEFORE `c6cff91`** · **HEAD_AFTER** this commit (documentation only).
**SOURCE_CHANGES = 0** — no product source, manifest, OAuth, executor, verification, redirect or
scope configuration was touched. **BUILD_COUNT_DELTA = 0** — nothing built, packaged, signed or
published. The five deferred findings (F-B22-3, F-B22-6, F-B22-7, B1, B3) remain deliberately
unfixed: *a credential ceremony is not a refactoring gate.*

## 7–8 · Artifact identity and custody

| # | Measurement | Value | Status |
|---|---|---|---|
| 1–3 | B.20 artifact | `c357a426a2822e56dcb2f26a0cc91417dd0e01eda5b9fdaaa5f3ab1996412e00` · **6,617,224 bytes** · mtime 2026-08-24T21:59:22Z | **EXACT** |
| 4 | armed `out/` | `e40a47a2051b6e2e8aa90450c04a917c98d6a3189188455ed53cb0ebbb5f27d8`, 86 files | **UNTOUCHED** |
| 5 | B.13 ASAR | `4add8d3fcc0104bac83c7b2a54be4d800dfd72dfd18f8221934984dbb92bed2c` | **UNTOUCHED** |
| 6 | B.13 DMG | `d4d5802f9f77b1a486f5e3bf94de9f8be403620d289c7e7f68bcc333fc1e186c` | **UNTOUCHED** |
| 7 | governed hashes | 7/7 OK | **INTACT** |
| 8 | boundary verifier | **17/17** | **PASS** |
| 9 | parity verifier | **13/13, true exit 0** | **PASS** |
| 10 | git status | only the pre-existing protected `baseline.json` + 2 untracked artifact dirs | **NO DRIFT** |

No `GATE_0_ARTIFACT_DRIFT`. **Ceremony vehicle completeness additionally measured** (my own check,
not delegated): `out-seam-b20/` carries all three limbs — `main` 1 file, `preload` 1 file,
`renderer` 78 files including `index.html`. A missing renderer would have blocked the ceremony
outright; it does not.

## 9–10 · Registration and redirect configuration

**REGISTRATION: NOT CREATED.** The directive requires a *new, dedicated* public-client registration,
established by the human in the Entra portal. None exists, and I neither fabricated one, reused the
`.env.entra` registration, reused `dynamics365`, nor sourced any `.env` file. **`.env.entra` was not
read, not printed, not sourced** — it remains an explicit STOP hazard.

Credential presence measured by **both** namings (values never read):

| Variable | State |
|---|---|
| `CLIENT_ID` (the directive's name) | **UNSET** |
| `TENANT_ID` (the directive's name) | **UNSET** |
| `NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID` (the artifact's name) | **UNSET** |
| `NEUROPAUSE_MICROSOFT_ENTRA_TENANT_ID` (the artifact's name) | **UNSET** |
| `NEUROPAUSE_M365_SCOPE_PROFILE` | **UNSET** |

Redirect, from the artifact and unmodified: `loopbackPort 42817` · `callbackPath /callback` ·
`usePkce true` · `clientSecretEnv null` · `prompt select_account` ⇒ the registration must carry
exactly **`http://127.0.0.1:42817/callback`**.

## 11 · Requested scopes

Under `NEUROPAUSE_M365_SCOPE_PROFILE=contacts`, exactly seven:
`openid profile email offline_access User.Read Contacts.Read Contacts.ReadWrite`.
Business permissions: `Contacts.Read`, `Contacts.ReadWrite`. Forbidden set: 15, none present.

## 12–16 · Consent · credential · granted authority · account binding · fresh profile

All **NOT_REACHED**: `CONSENT_SCREEN_REVIEW = NOT_REACHED` · `HUMAN_APPROVAL = NO` ·
`GRANTED_SCOPES = NONE` · `NEW_ACCOUNT = NONE` · `FRESH_USER_DATA_DIR = NOT_CREATED`.

**No fresh profile was pre-created, deliberately.** The directive requires a directory that *"must
not previously exist"* and *"must be created specifically for this ceremony"*, verified empty at
launch. Creating one now and leaving it for days would manufacture the predicate rather than satisfy
it. The runbook creates it at ceremony time.

## 17 · **THE BLOCKING FINDING — F-B23-1: the directive's environment block names variables nothing reads**

The directive instructs the operator to export:

```
CLIENT_ID=<new ceremony registration client id>
TENANT_ID=<new ceremony tenant id>
```

**Both bare names are read by ZERO code paths.** Measured by exact substring counting (not the shell
`grep`, which resolves to ugrep here) across the whole 6,617,224-byte artifact **and** all 1,884
files of `src/main`: every `process.env.CLIENT_ID` / `process.env["CLIENT_ID"]` /
`process.env['CLIENT_ID']` form and each TENANT_ID equivalent = **0**. All 19 `CLIENT_ID` and all 6
`TENANT_ID` textual hits were individually inspected — every one is the *suffix of a prefixed name*
(`NEUROPAUSE_GITHUB_…`, `…_MICROSOFT_ENTRA_…`, etc.) or an unrelated local const
(`TENANT_ID = "default"`). All 24 dynamic `process.env[` sites were enumerated: each resolves a
prefixed name.

**The correct exports, measured from the artifact:**

```
export NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID=<new ceremony registration client id>
export NEUROPAUSE_MICROSOFT_ENTRA_TENANT_ID=<new ceremony tenant id>
export NEUROPAUSE_M365_SCOPE_PROFILE=contacts
```

### The asymmetry is the actual hazard — the two mistakes are not equally safe

**Wrong client-id name ⇒ LOUD, SAFE, FAIL-CLOSED.** `resolveCredentials` returns null and `connect()`
returns at its third guard — *before* `fireStatus('connecting')`, *before* the "Opening…" log,
*before* `oauthEngine.authorize`. **No browser opens, no network call, no token.** The exact
user-facing string, obtained by evaluating the compiled `setupHintFor` in a `node:vm` sandbox:

> `Set NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID to enable Microsoft Entra ID.`

It is also visible *before* clicking: `ConnectorDetail.tsx:125-126` renders it as an orange banner
whenever `!dto.configured`. **No baked fallback masks it** — `getBakedClientId` reads
`connectorClientIds`, measured empty (`{}`) in `apps/desktop/resources/build-info.json`. Setting the
directive's `CLIENT_ID` verbatim is byte-identical in effect to setting nothing at all.

**Wrong tenant name ⇒ SILENT.** `ENTRA_TENANT = (process.env[ENTRA_TENANT_ENV] ?? "").trim() ||
"common"`. A bare `TENANT_ID` is invisible; the authority silently becomes
`https://login.microsoftonline.com/common/oauth2/v2.0/authorize`. **Nothing warns, nothing logs, no
banner appears.** With the client id set correctly and the tenant set under the wrong name, the
connect proceeds and opens a browser against `/common/` — a partial success that looks entirely
normal until Microsoft answers. For a multi-tenant/personal-account registration `/common/` simply
works and **the mistake never surfaces at all**.

**Timing, and it is load-bearing:** `ENTRA_TENANT` and `ENTRA_SCOPE_PROFILE` are module-level
constants frozen at process start, while the client id is read *per connect*. So a wrong tenant or
profile **cannot be corrected in a running process** — the app must be relaunched. `readEnv` trims,
and empty/whitespace-only behaves exactly as unset.

## 18 · **F-B23-2 — the acceptance test itself was wrong: expect SIX, and SEVEN is a stop condition**

B.22's addendum said a granted set *"smaller than seven is normal."* True but uselessly vague. The
precise expectation is recorded in the repository's own committed test prose
(`grantedScopeFailClosed.test.ts:11-16`): **Microsoft does not echo `offline_access` in the granted
scope claim** — it consumes it to mint the refresh token. The r3 measurement stored **21 against 22
requested**.

**Therefore under the contacts profile the expected persisted `grantedScopes` is SIX:**
`openid profile email User.Read Contacts.Read Contacts.ReadWrite` — with `offline_access` **absent**.

And the inverse is the part that matters most: **a persisted set that equals the requested seven
EXACTLY is the fingerprint of the removed fail-open manifest fallback returning — it is itself a
stop condition, not reassurance.** A runbook step reading *"confirm grantedScopes shows the 7
scopes"* would either abort a healthy ceremony or wave through the one reading that should halt it.

## 19 · **F-B23-3 — NOT_ESTABLISHED and consequential: short-form vs resource-qualified scopes**

`hasScope` (`m365/executor.ts:57-61`, mirrored in `cst/sendTransition.ts:140-144` and
`cst/governedAction.ts:232-236`) does **exact string equality**, plus a single `.Read`→`.ReadWrite`
widening. If Microsoft returns fully-qualified scope URIs (`https://graph.microsoft.com/Contacts.Read`)
rather than short names, the stored values will not equal the manifest's short names and **every
action would be refused**. The r3 evidence implies short form, but that is PRIOR_REPORT about a
*different registration and a different profile*. **REACHABLE BUT NEVER MEASURED for the contacts
profile.** This must be settled by observation during the ceremony, not by inference now.

## 20 · Post-consent measurement procedure (secret-free, measured)

Read `grantedScopes` directly from `<CEREMONY_PROFILE>/connectors.json`: plain JSON, mode 0600,
written atomically (`connectors.json.tmp` then rename) **before `connect()` returns**, so **the app
need not be closed**. It holds no token material by construction — tokens live in the separate
encrypted `connector-vault.bin`, and `metadataCredentialGuard` scrubs credential-shaped strings at
both the write and load doors. Non-secret fields safe to record: `id`, `label`, `status`,
`workspaceId`, `connectedAt`, `grantedScopes`.

Bound recorded: `persist()` writes the **entire** account map — every connector, every workspace,
including unclaimed rows the app's own scoped reads never return. On a genuinely fresh profile that
is exactly one row; on any other profile it is not.

**No token decoding, and no `scp`.** `scp` occurs **0** times repo-wide and **0** times in the
ceremony bundle. The product does not decode provider access tokens and no such instrumentation was
added. (Precision: the product *does* decode its **own** HS256 tokens in `ecosystem/auth/jwt.ts` —
a different token class, reading no `scp`. The defensible negative is path-scoped, not product-wide.)

## 21 · Operator's on-screen path (previously unmeasured)

**Connectors → Connections → "Microsoft Entra ID" → "Connect"** → IPC `connectors:connect` →
`connectorService.connect` → **the consent page opens in the operator's DEFAULT BROWSER** via
`shell.openExternal`, not inside the app.

**Refutation worth carrying:** on a fresh profile the app *does* enter device-local mode and the
sign-in wall is **not** rendered — but the operator does **not** land on the shell. The shell is
mounted and then **covered edge-to-edge by the first-run takeover**, so the operator must pass
first-run onboarding before Connectors is reachable. A real ceremony step that no prior runbook named.

## 22 · Default-profile question — **now MEASURED, closing a standing NOT_ESTABLISHED**

For a flagless launch with the bundle file as a bare positional argument, `app.getName()` returns
`"Electron"` and userData resolves to
**`/Users/saurabhpatel/Library/Application Support/Electron`** — which already holds a **claimed**
`microsoft-entra` row that would become `accounts[0]`, with no code refusing it. Nothing in the
artifact calls `app.setName` or `app.setPath("userData")` (`setPath` 0, `setAppPath` 0).

Narrowed by the adversarial verifier and stated as such: this is true **only** for the flagless form
— it is **false for the prescribed GATE 1 command**, which carries `--user-data-dir`. The finding is
the *cost of omitting the flag*, which is precisely why the flag is mandatory.

## 23 · Deviations, corrections, stop conditions

**Stop conditions: all 22 walked, none fired.** Artifact/armed/ASAR/DMG unchanged; no source change;
no build; **`.env.entra` not sourced**; no registration reused; no client secret required or created;
no consent screen reached, so no escalation observable; GATE 2 not invoked; no secret in any output.

**Corrections recorded:** (a) F-B23-1 — the directive's own environment block, corrected above;
(b) F-B23-2 — B.22's "smaller than seven is normal" sharpened to "expect six, and seven is a stop
condition"; (c) a naming defect inherited by two committed documents — `connectorService.ts:650` and
`grantedScopeFailClosed.test.ts:23-24` both call `:359` *"the refresh path"* when it is the
**reconnect** path (§2 #20 class; the real refresh path writes `grantedScopes` nowhere, so after any
refresh the stored value is a historical record, not a description of the live token).

**RECON_STATUS = COMPLETE (12/13).** One agent (`recon:launch-form`) **died on an API error**, so
the exact copy-pasteable launch command is **partly unmeasured** — recorded as unmeasured, not
inferred. I measured the artifact-tree completeness myself; what is missing is the definitive
electron-binary selection and arg shape, which the runbook below therefore states conservatively.

## 24 · B1/B2/B3 and deferred findings

Carried unchanged and deliberately unfixed: **B1** (consent-time profile label and requested set are
not persisted, though `grantedScopes` is, so an excess check is computable), **B2** (the `.default`
claim is profile-scoped and must name the connector), **B3** (`extraAuthParams` applied after the
scope), **F-B22-3** (mechanism asymmetry), **F-B22-6** (no `app.isPackaged` guard on the baked
client-id fallback, unlike its sibling `backendUrl`), **F-B22-7** (permission viewer cannot show
excess authority).

## 25 · Maturity impact

**None advanced.** `ARTIFACT → CREDENTIAL` remains the first broken edge. Credential establishment
did not occur, so nothing downstream — effect, verification, future authorization — moved.
`COHORT_API_EFFECT = NOT_VERIFIED`. What improved is instruction quality: a ceremony that would have
failed now has corrected inputs.

## 26 · Next single action

**The operator performs GATE 1**, with the corrected runbook:

1. Create a **new, dedicated** Entra registration: **public client / Mobile and desktop
   applications**, delegated Microsoft Graph **exactly `Contacts.Read` + `Contacts.ReadWrite`**,
   redirect **exactly `http://127.0.0.1:42817/callback`**, **no client secret, no certificate, no
   application permissions**. Do not reuse `.env.entra`'s registration or `dynamics365`. Do **not**
   click *Grant admin consent*; if the tenant demands it, record `ADMIN_CONSENT_REQUIRED` and stop.
2. **⚠ Export the CORRECTED variable names** (F-B23-1) in the same shell that launches the app —
   `NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID`, `NEUROPAUSE_MICROSOFT_ENTRA_TENANT_ID`,
   `NEUROPAUSE_M365_SCOPE_PROFILE=contacts`. Do **not** `source .env.entra`. Remember the tenant and
   profile freeze at process start — a mistake there needs a relaunch, and the tenant mistake is
   **silent**.
3. Create a genuinely fresh, previously non-existent `--user-data-dir`; verify it is empty; do not
   copy any existing profile. Omitting the flag lands in the `Electron` profile, which already holds
   a claimed entra row (§22).
4. Launch **the measured artifact** (`out-seam-b20`, sha `c357a426…`). Do not rebuild, do not use
   `out/` or the B.13 package.
5. Pass first-run onboarding, then **Connectors → Connections → Microsoft Entra ID → Connect**. The
   consent page opens in the **default browser**.
6. **Read the consent screen before approving.** Expect Contacts (read), Contacts (read/write) and
   ordinary sign-in language only. **Mail, Files, Calendar, Teams, Directory, Dynamics,
   application-wide or admin-only access ⇒ do not click Accept**; record
   `CONSENT_ESCALATION_DETECTED` and stop. Never accept-then-investigate.
7. After consent, read `grantedScopes` from `<PROFILE>/connectors.json` — **expect six, and treat an
   exact seven as a stop condition** (F-B23-2). Check the forbidden-set intersection is empty and
   that both Contacts permissions are present. **Watch for resource-qualified scope strings**
   (F-B23-3) — if they appear, stop and record, because `hasScope` matches exactly.

**GATE 2 remains closed and unauthorized: no `POST /me/contacts`, no read-back, no contact
mutation.** Credential ≠ effect; consent ≠ effect; token ≠ effect; permission ≠ effect.
