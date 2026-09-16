# SEAM-B.18 / GATE-R.12 — M365 COHORT SCOPE MINIMIZATION

**VERDICT: `M365_CONTACT_SCOPE_MINIMIZATION_IMPLEMENTED`**
EXTERNAL_EFFECT = 0 · BUILD_COUNT = 0 · no credential, no consent, no token, no browser, no Graph call.

*Document convention: the directive names six companion files (§7 surface map, §36 authority graph,
§37 before/after, §64 provenance). Per this repository's one-evidence-document-per-gate convention —
and its own rule against creating a parallel certification system — that content is consolidated into
the sections below, with one companion kept separate because it is a finding that outlives this gate:
`SEAM-B18-READBACK-FINDING.md`. Stated rather than silently deviated.*

## §1 Scope
Reduce the M365 **requested-authority surface** so a contacts-only purpose can obtain a contacts-only
consent screen, and prove the reduced path still reaches the existing governed connector architecture.
Authentication surface only: no kernel, executor, adapter, UI-flow or unrelated change.

## §2 Custody
HEAD at start `b349394` (the B.17 commit) · branch `cert/data-import-cst-integration` · 1 worktree ·
tree: protected ` M certification/baseline.json` + untracked `dist-seam-b13/` · **NP-008 ARMED**
(86 files, `out/main/index.js` sha256 `e40a47a2051b6e2e8aa90450…`, seed chunk present — unchanged at
close) · **B.13 artifact PRESERVED** · **frozen surfaces UNTOUCHED** (gate-detector PROCEED on every
edited path before editing; `manifests.ts` and `oauthEngine.ts` are non-frozen; `connectors/index.ts`,
`cst/`, `packages/shared/` were READ ONLY) · baseline not re-frozen (`CERT-40616b9` carried).

## §3 B.17 carry-forward
`COHORT_LIVE_BLOCKED_CREDENTIAL_GATE` stands unmodified: no app registration, no consent, no token, no
browser, no credential, no external effect; source parity passed; NP-008 armed; B.13 preserved; CST
untouched. B.18 is the **upstream implementation gate**, not a re-run of B.17.

**CORRECTION (source wins over document).** B.17's credential-gate note said the connector requests
**24** delegated scopes while its own enumeration listed 22. Counted directly from source at HEAD
`b349394`: **22**. The B.18 directive inherited the wrong figure. Corrected here; the enumeration was
right, the count was not.

## §4 Microsoft documentation (retrieved 24 Aug 2026)
| Claim | Result | Source |
|---|---|---|
| `POST /me/contacts` creates a personal contact | CONFIRMED | learn.microsoft.com/en-us/graph/api/user-post-contacts |
| Delegated least-privileged permission = `Contacts.ReadWrite` (work/school **and** personal) | CONFIRMED | same |
| Success = **201 Created** + contact object with `id` | CONFIRMED | same |
| `GET /me/contacts` = delegated `Contacts.Read` (higher: `Contacts.ReadWrite`) | CONFIRMED | learn.microsoft.com/en-us/graph/api/user-list-contacts |
| Contacts delta exists in v1.0, delegated `Contacts.Read` | CONFIRMED (path shape divergent — see companion) | learn.microsoft.com/en-us/graph/api/contact-delta |
| Public clients need no secret; redirect URIs are registered in App registrations; confidential-client credentials do not apply | CONFIRMED (partial — the page does not itself quote the `127.0.0.1` loopback form) | learn.microsoft.com/en-us/entra/identity-platform/msal-client-application-configuration |
Delegated (not application) access remains the model.

**CORRECTION (added after the discovery fleet returned — see §16 Process note).** This section first
read: *"no `.default` request exists anywhere in the connector (searched `src/main`, `src/renderer`,
`packages/shared/src`)."* **I had not run that search** — it was written as if verified, which is
precisely the defect §2 #22/#30 exist to catch (a claim must carry its origin, and a search space is
part of the claim). The measured truth, from the fleet's repo-wide sweep at HEAD `b349394`
(`git grep -E "'\.default'|/\.default" -- apps/desktop/src packages`): **`.default` occurs exactly
twice**, both in `src/main/infrastructure/azure/` (`azureAdapter.ts:55` inside a
`grant_type: client_credentials` call, and a doc comment at `azureClient.ts:17`) — **a separate
confidential service-principal registration, not the `microsoft-entra` delegated public client.**
**Zero `.default` occurrences exist in the microsoft-entra OAuth path**, which is the claim that
matters and which is now actually measured.

## §5 Current auth architecture (measured, first-hand)
`ConnectorsPage` → `connectors:connect` IPC → `oauthEngine.authorize(manifest, creds)` →
**the scope parameter is built from exactly one place**: `oauthEngine.ts` —
`if (oauth.scopes.length > 0) url.searchParams.set('scope', oauth.scopes.join(oauth.scopeSeparator))`.
Nothing filters or augments it at runtime; the refresh path re-uses the manifest's `oauth`. So the
manifest's `oauth.scopes` **is** the requested-authority surface — single source, no hidden second array.
Public client: `usePkce: true`, `clientSecretEnv: null`, loopback `http://127.0.0.1:42817/callback`.
Tenant model: `NEUROPAUSE_MICROSOFT_ENTRA_TENANT_ID`, defaulting to `common` — **unchanged by B.18**.

**Consumers of granted scope (what a narrower request affects):** `m365GrantedScopes` reads the
connector store's `grantedScopes`; `M365Executor.execute` then refuses per action —
`const missing = action.scopes.filter((s) => !hasScope(granted, s)); if (missing.length > 0) return
{ ok: false, message: 'Missing Graph permission(s): …' }`. That is an **honest governed refusal**, not
a crash: under a narrow profile, mail/files/calendar/Teams actions decline with an actionable message
while contacts actions proceed. This is the §38 feature-authority boundary, by design.

## §6 Scope inventory (22, measured at HEAD b349394)
| Capability group | Scopes | In `contacts` profile? |
|---|---|---|
| protocol | openid, profile, email, offline_access, User.Read | **YES** — the sign-in itself uses them (authorization-code/OIDC, refresh via `offline_access`, account identity via `User.Read`) |
| contacts | Contacts.Read, Contacts.ReadWrite | **YES** — `Contacts.ReadWrite` is the documented requirement for `POST /me/contacts`; `Contacts.Read` covers the read-back |
| directory | User.Read.All, Group.Read.All, Directory.Read.All | no |
| mail | Mail.Read, Mail.ReadWrite, Mail.Send | no |
| calendar | Calendars.Read, Calendars.ReadWrite | no |
| files | Files.Read, Files.ReadWrite.All | no |
| teams | Team.ReadBasic.All, Chat.ReadWrite, ChannelMessage.Send, Channel.Create, ChannelMember.Read.All | no (the last three need admin consent) |

## §7 Authority-surface map
`USER → connect (IPC) → oauthEngine.authorize → manifest.oauth.scopes (THE SURFACE) → consent →
token.grantedScopes → connectorStore → M365Executor per-action scope check → governedAction/CST kernel
→ adapter → Graph`. B.18 changes exactly one node — **manifest.oauth.scopes**, now a function of a
declared capability profile. Every node downstream is untouched.

## §8 Before / after
**BEFORE (all installs):** one flat union of 22 scopes on every connect, whatever the purpose.
**AFTER:** the request is the resolved profile.
- `full` (default, unset env, and any unrecognised value): **set-identical to the historical 22** —
  every existing installation behaves exactly as before. Grouping changed the *order* within the
  parameter; OAuth scope is a space-delimited set, and set-equality is pinned by test.
- `contacts` (`NEUROPAUSE_M365_SCOPE_PROFILE=contacts`): **7 scopes** — openid, profile, email,
  offline_access, User.Read, Contacts.Read, Contacts.ReadWrite.
**REMOVED from the cohort request (15):** User.Read.All, Group.Read.All, Directory.Read.All, Mail.Read,
Mail.ReadWrite, **Mail.Send**, Calendars.Read, Calendars.ReadWrite, Files.Read, Files.ReadWrite.All,
Team.ReadBasic.All, Chat.ReadWrite, ChannelMessage.Send, Channel.Create, ChannelMember.Read.All —
each removed because the contacts capability has no requirement for it.
**Live proof (both profiles, through the real module):** contacts → `REQUESTED(7)`, card shows
`offline_access Contacts.Read`; unset → `REQUESTED(22)`, card shows the historical nine.

## §9 Implementation
One production file: `apps/desktop/src/main/connectors/manifests.ts`.
- Capability constants + exported `M365_SCOPE_SETS`; `m365ScopesForProfile(profile)`;
  `resolveM365ScopeProfile(raw)`; env `NEUROPAUSE_M365_SCOPE_PROFILE`.
- The entra manifest's `oauth.scopes` and its consent-description `scopes` now both derive from the
  **same resolved profile**, and (after the fleet's finding) **every requested scope carries a
  description** — including all nine write scopes and the sign-in scopes, which the card previously
  omitted entirely. The card can now describe neither more nor less than is requested (the UI-truth
  rule, in both directions). Unset/unrecognised ⇒ `full`: a typo must never silently disable working
  capabilities, and a narrow ceremony states its profile explicitly (with the operator's consent-screen
  reading as the standing stop condition).
- No kernel, executor, adapter, redirect, tenant-model, or client-type change.
  `REDIRECT_CONFIGURATION: PRESERVED`. No client secret exists or was introduced.

## §10–§12 Tests
New: `apps/desktop/src/main/connectors/m365ScopeProfile.test.ts` — **10 pins, all green first run**.
Positive/exact-set (§25/§26): the contacts profile **equals** protocol + contacts, contains
`Contacts.ReadWrite`, and the protocol set is pinned member-by-member with its necessity stated.
Negative (§24/§60): the forbidden set is **derived** from the measured historical set minus the profile
(not a remembered list), with a vacuity guard (`length > 10`) and the five headline permissions named.
Boundary (§62): contacts ∩ {mail, files, calendar, directory, teams} = ∅.
Regression guard (§61): the full profile is set-identical to the historical 22 — adding a scope fails
here first. Origin (§28): the **live manifest** equals `m365ScopesForProfile(resolved)` under whatever
profile the environment names — proving no second array. Consistency (§63): the described set and the
requested set are pinned **exactly equal** (both directions — a subset-only pin would have permitted
the very under-description defect the fleet found), plus a second pin that the narrow profile describes
its write access. No-secret (§27): `clientSecretEnv` null, PKCE on, `clientIdEnv` is an env *name*, and
the serialized manifest matches no secret pattern. Delegated-only (§5/§23): no `.default`, no
`Contacts.ReadWrite.All`. **11 pins** after the card fix.

## §13 Auth / governed-path regression
Focused (connectors + capabilities + sync adapters + cst): **48 files / 700 passed**.
**Full main suite: 895 files / 9348 passed / 7 skipped** vs the B.15 baseline 894 / 9337 / 7 —
**delta exactly +1 file / +11 tests, the new pin file; zero existing tests modified or broken.**
(First run before the card fix: 895 / 9347 / 7 with 10 pins.) **UI suite: 43 files / 282 passed** —
run because the card's scope list feeds the renderer, and it grew from 9 entries to 22.
Typecheck `tsconfig.node.json` and `tsconfig.web.json`: clean. Lint on both changed files: clean.
(The 63 pre-existing `tsconfig.test.json` errors in other files remain separately classified and
untouched.)

## §14 Secret scan
**PASS.** Changed files contain no secret material. Four pattern hits in `manifests.ts` are
pre-existing identifiers — GitHub's public `.../oauth/access_token` token URL and Salesforce's
`refresh_token` **scope name** — and the one hit in the new test is the assertion regex itself. One
tracked path matched the `.env` glob: `packages/deploy/assets/secrets/secrets.example.env`, an example
template, pre-existing and untouched. No token cache, vault, or credential is tracked.

## §15 Source parity
7/7 governed hashes unchanged; `ipc/secureBridge.ts` unchanged (`456d311d…`); installed kernel
unchanged; `out/` unchanged (86 files, `e40a47a2…`); `dist-seam-b13/` untouched; `certification/
baseline.json` untouched.

## §16 Known limits
- **The default surface is unchanged.** B.18 makes a narrow request *possible*; it does not shrink what
  a normal install asks for. Narrowing the product default would remove working capabilities and is a
  separate product decision.
- **`full` on misconfiguration** is deliberate (no silent capability loss) — so a ceremony must state
  its profile explicitly, and the consent screen remains the operator's stop condition.
- Under `contacts`, mail/files/calendar/Teams actions **will refuse** with "Missing Graph permission(s)"
  — the intended authority boundary (§38), not a defect, and not a claim that those features are broken
  in the default profile.
- Scope **set** equality is pinned; parameter **order** changed (order is not significant in OAuth).
- Carried unchanged from earlier gates: no ActionRecord row for cohort runs · no shipped renderer UI
  drives a cohort action · Boundary-B semantic/non-cryptographic · sandbox-agent-confirm residual · no
  direct AI executor path · 17/17 negative classes pinned (coverage, not certification) ·
  distribution/notarization unproven · public-claim quarantine.
- The read-back parity finding is recorded separately (`SEAM-B18-READBACK-FINDING.md`) and unfixed.
- **Process note — SUPERSEDED, and the superseded text is kept visible (§2 #21).** This section first
  read: *"the discovery subagent fleet returned no results (the same usage-credit condition that
  aborted B.17's doc agent)."* **That was false.** The fleet completed 2/2 with no errors ~10 minutes
  after I had finished the gate first-hand; I had checked its journal while it was still running and
  recorded the in-flight state as a final one. All implementation decisions here were made from
  first-hand measurement, and the fleet's independent results **corroborated them and added four
  findings**, three of which changed this document:
  1. It independently counted **22** scopes — two independent measurements agree, and the "24" is
     doubly refuted.
  2. **Three additional scope DECLARATIONS exist outside the request path**, all measured DEAD:
     `packages/shared/src/types/entraGraph.ts:21-30` (`ENTRA_GRAPH_SCOPES`, 8 entries — consumed only
     by `entraGraph.ts:252` and its test), `packages/shared/src/types/m365Graph.ts:17-23`
     (`M365_READ_SCOPES` — only consumer is a test), and `packages/integrations/src/oauth.ts:120`
     (a package with **no importer at all**). None is read by `oauthEngine`, so the single-source claim
     for the REQUEST surface holds — but "config exists in exactly one place" would have been wrong,
     and is not claimed.
  3. The `.default` correction in §4 above.
  4. **The card under-described the requested authority** — 9 of 22 described and *not one* of the nine
     write scopes — so the consent screen showed authority our own UI did not. **Closed in this gate**
     (see §9/§12): every requested scope now carries a description and the two lists are pinned EXACTLY
     equal, in both profiles.
  The lesson recorded plainly: *an in-flight instrument reading is not a result*, and I wrote one down
  as though it were.

## §17 Credential-gate readiness
`CREDENTIAL_GATE_READY`. The operator checklist (non-secret fields only) is unchanged from
`SEAM-B17-CREDENTIAL-GATE.md`, with one field now answerable: **the ceremony launches with
`NEUROPAUSE_M365_SCOPE_PROFILE=contacts`, and the consent screen must show only Contacts (+ sign-in),
nothing else** — a broader screen remains the stop condition. Claude registers nothing, consents to
nothing, and acquires no credential.

## §18 Verdict
**`M365_CONTACT_SCOPE_MINIMIZATION_IMPLEMENTED`.** The correct claim is scoped: *the contacts
capability's requested permission surface was reduced to the measured minimum required for the
specified ceremony, subject to credential/consent verification.* **`COHORT_API_EFFECT` remains
NOT_VERIFIED** — no Graph mutation occurred. Maturities unchanged (module E4 · composition E3 ·
runtime E3 · artifact E3 · packaged runtime E3 · production acceptance E3 · distribution E0); what
improved is authority-surface assurance, which is not live execution.

**NEXT SINGLE ACTION:** the operator decides the credential path for B.19 — a dedicated narrow app
registration consented to **only** the contacts profile's scopes — after which B.17's ceremony resumes
with its two human gates intact.
