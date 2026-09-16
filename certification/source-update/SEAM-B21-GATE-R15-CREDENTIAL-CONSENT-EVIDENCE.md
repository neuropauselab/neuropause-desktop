# SEAM-B.21 / GATE-R.15 — NARROW CREDENTIAL / CONSENT CEREMONY

**VERDICT: `CREDENTIAL_GATE_PREPARED_AWAITING_OPERATOR`.**
GATE 1 is prepared and **NOT EXECUTED**: no registration was created, no consent screen was opened, no
credential exists, no browser opened, no network call occurred.
**EXTERNAL_EFFECT = 0 · NETWORK_CALLS = 0 · BUILD_COUNT DELTA = 0 · SOURCE_CHANGES = 0.**

*Verdict vocabulary, stated precisely: this maps to neither §42 nor §43. §42's
`CREDENTIAL_CONSENT_ESTABLISHED` presupposes the human steps occurred — they have not. None of §43's
six blockers was observed either; nothing is blocked. The honest state is "prepared, awaiting the human
gate", and inventing a §43 label for it would misreport a clean state as a fault.*

## 1–5 · Gate identity, HEAD, artifact
SEAM-B.21 / GATE-R.15 · 24 Aug 2026 · HEAD before **`d841fb4`** · HEAD after: this commit · branch
`cert/data-import-cst-integration` · subject artifact `apps/desktop/out-seam-b20/main/index.js`.

**GATE 0 — artifact identity: PASS (exact).**
sha256 `c357a426a2822e56dcb2f26a0cc91417dd0e01eda5b9fdaaa5f3ab1996412e00` · 6,617,224 bytes ·
mtime 2026-08-24 21:59:22 — identical to the B.20 record. Not mutated, not rebuilt, not replaced.
**Custody: armed `out/` `e40a47a2…` (86 files, seed chunk present) · B.13 dmg `d4d5802f…` ·
B.13 asar `4add8d3f…` — all PRESERVED.** Governed hashes **7/7**. Frozen surfaces untouched.
**GATE 0.2 — no source mutation:** tree carries only the pre-existing protected ` M
certification/baseline.json` plus the two untracked artifact directories.

**A provenance bound the recon raised, and its resolution.** The artifact's mtime precedes HEAD
`d841fb4` by 7m36s — it was built from the working tree at `eccb5da`, exactly as B.20 recorded. Measured
delta `eccb5da → d841fb4`: `CLAUDE.md`, the B.20 evidence document, and
`apps/desktop/scripts/verify-m365-artifact-parity.cjs`. **None is an input to the bundle** — electron-vite
builds `src/main`, `src/preload`, `src/renderer`; `scripts/` is not in the graph. **Zero bundled-source
change between the build commit and HEAD**, so artifact ↔ HEAD product-code parity holds.

**GATE 0.1 — B.20 is closed and unreinterpreted:** `ARTIFACT_PARITY_ESTABLISHED`, BUILD_COUNT 1,
EXTERNAL_EFFECT 0, `COHORT_API_EFFECT = NOT_VERIFIED`. Re-running the B.20 verifier against the artifact
this seam: **13/13 PASS, exit 0.**

## 6 · Registration identity
**NONE — none was created, and none is inferred.** Measured (names and presence only, no values):
`NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID` **UNSET** · `NEUROPAUSE_MICROSOFT_ENTRA_TENANT_ID` **UNSET** ·
`NEUROPAUSE_M365_SCOPE_PROFILE` **UNSET** · no `.env` files in `apps/desktop`. No credential path is
configured in this environment.

## 7 · Redirect measurement — taken FROM THE ARTIFACT
`loopbackPort: 42817` · `callbackPath: "/callback"` · `usePkce: true` · `clientSecretEnv: null`
(public client) · `clientIdEnv: "NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID"` · `scopeSeparator: " "` ·
`extraAuthParams: { prompt: "select_account" }`. The loopback server composes
`http://127.0.0.1:${port}${path}` ⇒ **the registration must contain exactly
`http://127.0.0.1:42817/callback`** under *Mobile and desktop applications*. Redirect configuration is
**PRESERVED** — not modified for the ceremony's convenience.

## 8 · Requested-scope measurement
Under `NEUROPAUSE_M365_SCOPE_PROFILE=contacts` the artifact requests exactly seven:
`openid profile email offline_access User.Read Contacts.Read Contacts.ReadWrite` — established in B.20
by executing the artifact's own compiled logic, re-verified here.

## 9–11 · Consent surface · human gate · authentication
**NOT REACHED.** The consent screen was never opened, so it was never measured; no human gate decision
was taken; `AUTHENTICATION_STATE = NOT_ESTABLISHED`. Claude created nothing, approved nothing, and
requested no secret material through any channel.

## 12–19 · Runtime, provider, read-back
**NOT EXECUTED** (GATE 2 is separate and unauthorized). Provider call count **0**; no endpoint
contacted; no response; no read-back; no account correlation. `COHORT_API_EFFECT = NOT_VERIFIED`.

## 20 · Credential handling
No credential was requested, received, printed, stored, logged, or committed. No token, code, secret or
cache appears in this document or in the repository.

## 24 · Tests
§29 authority-boundary property preserved and re-run: **17/17 green** (`contactsProfileBoundary` +
`m365ScopeProfile`) — contacts.create allowed by the boundary; `mail.send`, `drive.upload`,
`teams.sendChannelMessage`, `calendar.create` each refused with **zero** Graph calls; the refusal does
not disclose the granted set. Full main suite baseline unchanged at **896/9354/7** (this seam adds no
test and changes no source).

## 27 · Recon results (§39) — completed BEFORE this document was written, and load-bearing
Both agents returned; I waited rather than writing around them (the B.19 lesson). **Q1: is
`manifest.oauth.scopes` the only input to the authorize request? — YES**, one construction site, one
`response_type` in the whole artifact, no auto-reauth, no scope repair, no incremental consent;
`extraAuthParams` for entra carries no `scope` key. **Q2: does any credential/config path silently widen
the request? — NO PRODUCT PATH WIDENS THE REQUEST**; `resolveM365ScopeProfile` is a closed two-valued
function, so arbitrary text can never become a scope.

**Six measured paths to authority beyond the seven, with cause attributed:**
| # | Path | Cause | Bound |
|---|---|---|---|
| **A** | The connector panel binds `accounts[0]` — a **pre-existing broad account row** would be selected | **PRODUCT** | Only if `connectors.json` already holds a `microsoft-entra` row. **A fresh profile eliminates it.** Not a wider *request* — a wider *token already held*. |
| **B** | **Refresh re-requests 22 scopes when the profile env is absent at launch** (automatic path, no human), against an account consented for seven | **PRODUCT**, conditional on launch env | Entra refuses un-consented scopes on refresh, so the *effect* is bounded provider-side — **the request is not**. |
| **C** | Profile unset/typo ⇒ `full` (22) at connect | **PRODUCT default**, triggered by the operator's launch env | Fail-open **by design** and pinned; the consent screen is the stop condition. |
| **D** | Reusing the ceremony registration for `dynamics365` (adds `…/user_impersonation`) | **OPERATOR ONLY** | Needs a *separate* client-id env var plus a deliberate Connect click. **Nothing in the product connects it** — proven by enumerating all three main-side dispatchers, not one binding. |
| **E** | `generate-build-info.cjs` bakes every `*_CLIENT_ID` present at build time | **OPERATOR** (build env) | Secrets filtered. Note: **`NEUROPAUSE_M365_SCOPE_PROFILE` is NOT baked**, which is exactly why path C bites a packaged launch. |
| **F** | Azure app-only `graph.microsoft.com/.default` | **OPERATOR ONLY** | Requires three `NEUROPAUSE_AZURE_*` vars **including a client secret** the public-client ceremony registration does not have; inert here. |

**Three bounds recorded as findings, not caveats:**
**B1 — the env var is the whole control.** There is **no persisted record of which profile an account was
consented under, and nothing compares the two**. Narrow consent is not durably bound to the account.
**B2 — precision correction to my own B.20 language (§2 #20).** My B.20 §1 line compressed to "no
`.default`". Correctly scoped, the verifier's P11 asserts *no `.default` in any M365 connector profile* —
which is true. But the **artifact does contain** a `.default` app-only Graph request for a *different,
inert* Azure registration (`azureAdapter.ts:55`). Any claim of the form *"this artifact requests only
seven Graph scopes"* would be **false as stated**; the true claim names the connector. Corrected here.
**B3 — incidental protection (§2 #31).** `oauthEngine.ts:165` applies `extraAuthParams` with `.set`
**after** the scope parameter is written, so a manifest key literally named `scope` would silently
replace the profile-derived value. No manifest has one today; **no mechanism enforces it and no
assertion fails if it breaks.** Recorded for a future gate — not fixed here, because this seam
authorizes no source change.
**Recon correction accepted:** the connector id is **`dynamics365`**, not `microsoft-dynamics` (my
question's phrasing was wrong; source wins).

## 25–26 · Deviations and corrections
Deviation: none from the gate's constraints. Corrections: the two above (B2 precision; `dynamics365`
naming), plus one **instrument** correction of my own — a wait-loop I wrote used
`grep -c … || echo 0`, which emits **two** lines when the count is zero (grep exits 1 *and* the fallback
fires), so its `-ge 2` test errored every iteration and could never have terminated. The count itself
was correct; the loop was not. Replaced with a correct check and recorded rather than quietly dropped.

## 21–23 · Custody status at close
Frozen surfaces **UNTOUCHED** · armed build **PRESERVED** (`e40a47a2…`, 86 files, seed chunk) · B.13 dmg
and asar **PRESERVED** · B.20 artifact **UNCHANGED** (`c357a426…`) · NP-008 **ARMED**.

## 28 · Verdict
**`CREDENTIAL_GATE_PREPARED_AWAITING_OPERATOR`** — GATE 0 passed on every predicate; GATE 1's human
steps have not been performed and were not simulated.

## 29 · First broken edge
**ARTIFACT → CREDENTIAL**, unchanged — now with its six widening paths measured and attributed, which
is what the ceremony needed before a consent screen is ever opened.

## 30 · Next single action
**The operator performs GATE 1**, with the runbook the recon actually earned:
1. Create a dedicated narrow Entra registration — **delegated only**, Graph permissions exactly
   `Contacts.Read` + `Contacts.ReadWrite`; platform *Mobile and desktop applications*; redirect exactly
   `http://127.0.0.1:42817/callback`; public client (no secret).
2. Export `NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID` (+ `…_TENANT_ID` if single-tenant) **and
   `NEUROPAUSE_M365_SCOPE_PROFILE=contacts`** — the profile var is the *only* scope control and is
   **not** baked into builds, so it must be set on **every** launch, not just the first (path B).
3. Launch **the measured artifact** (`out-seam-b20`, sha `c357a426…`) on a **fresh `--user-data-dir`** —
   the fresh profile is what eliminates path A.
4. **Read the consent screen before approving.** Expect exactly Contacts + Contacts (write) + sign-in.
   Anything else — Mail, Files, Calendar, Teams, Directory — is a hard STOP, not a warning.
5. Do **not** reuse this registration for `dynamics365` (path D).
GATE 2 (the first provider effect) remains separate and unauthorized.
