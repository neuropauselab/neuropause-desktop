# SEAM-B.17 — CREDENTIAL GATE (§5)

**STATUS: NOT CLEARED — BLOCKED ON A MEASURED SCOPE-MINIMIZATION CONFLICT (see §C).**
Nothing was created, consented, or connected. EXTERNAL_EFFECT = 0.

## §A · What this gate must record (operator-supplied, currently EMPTY)
| Field | Value |
|---|---|
| TENANT | NOT_ESTABLISHED |
| APP REGISTRATION ID | NOT_ESTABLISHED |
| CLIENT ID | NOT_ESTABLISHED |
| REDIRECT URI | required by the shipped manifest: `http://127.0.0.1:42817/callback`, registered under **Mobile and desktop applications** (the manifest's own comment: "Web platform rejects http + 127.0.0.1") |
| ACCOUNT | NOT_ESTABLISHED (must be a dedicated ceremony account) |
| ACCOUNT TYPE | must be: dedicated / non-production / non-customer / non-personal-primary |
| PERMISSION TYPE | **delegated** (public client, PKCE, no secret — `clientSecretEnv: null` in the manifest) |
| PERMISSIONS REQUESTED | **see §C — the shipped manifest requests 24 scopes, not 1** |
| PERMISSIONS GRANTED | NOT_ESTABLISHED |
| CONSENT ACTOR / TIME | NOT_ESTABLISHED |
| TOKEN ISSUER / AUDIENCE / SCOPES / EXPIRY | NOT_ESTABLISHED (non-secret claims only, never the token) |
| PROFILE DIRECTORY | NOT_ESTABLISHED (a fresh, dedicated `--user-data-dir`) |
| STATUS | **BLOCKED** |

Client id is supplied at runtime via the env var `NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID`; tenant via
`NEUROPAUSE_MICROSOFT_ENTRA_TENANT_ID` (defaults `common`). **No secret material is recorded here, ever.**

## §B · Phase 3 — Microsoft Graph documentation verified (2026-08-24)
| Claim | Result | Source |
|---|---|---|
| Create a personal contact = `POST /me/contacts` | **CONFIRMED** | learn.microsoft.com/en-us/graph/api/user-post-contacts |
| Required delegated permission = `Contacts.ReadWrite` (least privileged, work/school **and** personal) | **CONFIRMED** | same |
| Success = **201 Created** + contact object with `id` | **CONFIRMED** | same |
| List contacts = `GET /me/contacts`, delegated least-privileged `Contacts.Read` (higher `Contacts.ReadWrite`), 200 OK | **CONFIRMED** | learn.microsoft.com/en-us/graph/api/user-list-contacts |
| **`$search` on `/me/contacts`** | **NOT DOCUMENTED — CHANGED vs the envelope's assumption.** The v1.0 page documents only `$filter` on `emailAddresses/any(a:a/address eq '…')`, and states filtering is limited to that sub-property. The repo's `contacts.search` adapter issues `$search="…"`. | same |
| Contacts delta exists in v1.0 | **CONFIRMED**, delegated least-privileged `Contacts.Read` | learn.microsoft.com/en-us/graph/api/contact-delta |
| Delta path shape | **DIVERGENT**: the v1.0 page documents **folder-scoped** `GET /me/contactFolders/{id}/contacts/delta`; the repo's sync uses `GET /me/contacts/delta`. Not asserted to fail — recorded as undocumented-on-that-page. | same |
| Public client needs no secret; credentials section applies to *confidential* clients; redirect URI configured in App registrations | **CONFIRMED (partial)** — the MSAL page confirms public-client/no-secret and redirect-URI registration, but does not itself quote the `http://127.0.0.1:<port>` loopback form; that form is the repo manifest's recorded requirement. | learn.microsoft.com/en-us/entra/identity-platform/msal-client-application-configuration |

**Consequence for the ceremony's read-back (§24/§78):** the primary in-product read-back must be
**`contacts.detectDuplicates`** — a documented `GET /me/contacts?$select=id,displayName,givenName,surname,emailAddresses&$top=200` shape — with `contacts.search` demoted to BEST-EFFORT (its `$search` is undocumented for this resource), and the delta read-back likewise BEST-EFFORT. This changes the envelope's read-back ordering; it changes no code.

## §C · THE BLOCKER — scope minimization conflict (measured, STOP-class under §4)
The directive's §4 requires the ceremony to request **only** `Contacts.ReadWrite` (+ contacts read), and says
verbatim: *"If the consent screen presents anything broader than the ceremony specification: STOP."*

**The shipped `microsoft-entra` connector manifest requests 24 delegated scopes on every connect**
(`apps/desktop/src/main/connectors/manifests.ts`, `oauth.scopes`, verbatim list): `openid`, `profile`,
`email`, `offline_access`, `User.Read`, `User.Read.All`, `Group.Read.All`, `Directory.Read.All`,
`Mail.Read`, `Calendars.Read`, `Files.Read`, `Contacts.Read`, `Team.ReadBasic.All`, **`Mail.ReadWrite`,
`Mail.Send`**, `Calendars.ReadWrite`, `Files.ReadWrite.All`, `Contacts.ReadWrite`, `Chat.ReadWrite`,
`ChannelMessage.Send`, `Channel.Create`, `ChannelMember.Read.All`. The file's own comment records that
the Teams channel scopes need **admin consent**.

So the OAuth flow this ceremony would drive **cannot** present a `Contacts.ReadWrite`-only consent screen.
It would present `Mail.Send`, `Files.ReadWrite.All`, `Directory.Read.All` and the rest — categorically
broader than §4 permits, and it is the same defect S15 already recorded as **F-1 (scope reality /
manifest-minimization work item)**, resurfacing at exactly the gate designed to catch it.

**Narrowing the request requires editing `manifests.ts` — a PRODUCTION SOURCE CHANGE, which B.17 §44
explicitly does not authorize** ("No production source changes are authorized by B.17… STOP before
modifying source and create a separate gate classification"). A different app registration does not help:
the scope list is client-side, so any client id drives the same request.

**Therefore the credential gate cannot be cleared without an operator ruling.** The options, none chosen:
1. **MINIMIZE-FIRST (recommended):** a separate, narrowly scoped implementation gate that makes the M365
   connect flow able to request a reduced scope set (e.g. a ceremony/minimal profile), then return to B.17.
   Closes F-1; keeps §4 intact.
2. **RELAX §4 EXPLICITLY:** the operator rules that, for this ceremony on a disposable account, the broad
   delegated consent is acceptable — recorded as a deliberate exception with the consent screen's actual
   grant captured verbatim. §4 as written forbids this without that explicit relaxation.
3. **DEFER:** leave cohort API→EFFECT unverified and select a different first broken edge.

## §D · If the gate is later cleared — operator steps (instructions only; nothing automated)
1. Create a **new** Entra app registration in a disposable/dedicated tenant; platform **Mobile and desktop
   applications**; redirect `http://127.0.0.1:42817/callback`; public client (no secret).
2. Configure delegated permissions per the ruling in §C.
3. Export `NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID` (+ `…_TENANT_ID` for a single-tenant app) into the launch
   environment. **The operator types every credential; Claude types none.**
4. Launch the **armed** artifact (no rebuild) on a fresh `--user-data-dir`; kill-verify first per the
   P1/S15 runbook discipline.
5. Sign in as the ceremony account and connect the connector; **read the consent screen and abort if it
   exceeds the ruled scope set.**
6. Return here and fill §A from non-secret facts only; then, and only then, the §13 execution
   authorization gate applies.

## §E · Custody at the time of writing
HEAD `346d081` · NP-008 **ARMED** (86 files, `out/main/index.js` sha256 `e40a47a2051b6e2e8aa90450…`,
seed chunk present) · B.13 artifact PRESERVED · CST UNTOUCHED · 7/7 governed hashes OK · BUILD_COUNT 0 ·
EXTERNAL_EFFECT 0 · secret scan: no secret material recorded in this file.
