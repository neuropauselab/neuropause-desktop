# SEAM-B.19 / GATE-R.13 — NARROW CREDENTIAL → FIRST GOVERNED EXTERNAL EFFECT

**VERDICT: `CREDENTIAL_GATE_BLOCKED` — cause: ARTIFACT PARITY, measured (§40).**
**EXTERNAL_EFFECT = 0 · BUILD_COUNT = 0 · no registration, no consent, no token, no Graph call.**
STATUS: **PREPARED_NOT_EXECUTED.** What *was* completed: the authority boundary the ceremony depends on
is now proven at test level, and the ceremony's verification predicate is fixed **before** any result
exists.

## 1 · Gate identity · 2 · Source commit · 3 · Artifact identity
Gate SEAM-B.19 / GATE-R.13 · source HEAD at start **`2a5c24e`** (B.18 close) · branch
`cert/data-import-cst-integration` · candidate artifacts: armed `out/` (built 2026-08-24 17:18:22 from
`a7a7d51`) and the B.13 package `dist-seam-b13/` (from `a7a7d51`).

## 4 · Custody
Tree: protected ` M certification/baseline.json` + untracked `dist-seam-b13/` (the retained B.13
evidence artifact) — both pre-existing, neither touched. NP-008 ARMED (86 files, `e40a47a2…`, seed
chunk). 7/7 governed hashes. CST and all frozen surfaces untouched; gate-detector PROCEED on the one
new path before creating it. No rebuild, no packaging, no baseline re-freeze.

## 5 · Objective
Close `CREDENTIAL → TOKEN → GOVERNED REQUEST → EFFECT → READ-BACK → VERIFICATION` for one bounded
`contacts.create`, without widening the authority surface.

## 6 · Scope proof — and §40's decisive measurement
The narrow profile exists **in source** (B.18): `contacts` resolves to 7 scopes — openid, profile,
email, offline_access, User.Read, Contacts.Read, Contacts.ReadWrite.

**It does not exist in any executable artifact.** Measured directly, not inferred:
| Artifact | `NEUROPAUSE_M365_SCOPE_PROFILE` | `m365ScopesForProfile` / `M365_SCOPE_SETS` |
|---|---|---|
| armed `out/main/index.js` (17:18:22, from `a7a7d51`) | **0** | **0** |
| `dist-seam-b13/…/app.asar` (from `a7a7d51`) | **0** | — |

Both still carry the pre-B.18 flat 22-scope list. **Consequence:** launching either artifact for the
ceremony would present a consent screen containing `Mail.Send`, `Files.ReadWrite.All`,
`Directory.Read.All`, `User.Read.All` and the Teams scopes — which §8 defines as a **STOP** condition.
The ceremony therefore cannot be run on any artifact that exists today.
**SOURCE ≠ BUILD ≠ ARTIFACT ≠ RUNTIME — this gate is the case that proves it.** The operator may still
create the Entra app registration (portal work, artifact-independent), but **consent cannot be given**
until an artifact carrying the narrow profile exists.

## 7 · Credential proof
**NONE — and none was attempted.** No app registration created, no consent requested, no browser
opened, no token minted, no credential typed or read. The S16 containment (recorded 2026-08-19: app
registration deleted, consent revoked) still stands, so no prior credential is usable.

## 8 · Operator gates (unchanged, still separate, both open)
**GATE 1 — credential/consent:** *"I authorize establishment of the narrow Microsoft 365 Contacts
delegated credential for this bounded ceremony."* — now additionally blocked by §6 until a
narrow-profile artifact exists.
**GATE 2 — execution:** *"I authorize SEAM-B.19 to execute the prepared contacts.create cohort action
against the isolated ceremony account's own Contacts folder exactly as specified in the evidence
envelope."* Credential consent is not action authorization; the two are not merged.

## 9 · Request identity (frozen ahead of execution)
LIVE_RUN_ID **`COHORT-LIVE-B16-001`** (carried unchanged from B.16 — not renamed, since the ceremony's
action, target and markers are unchanged). requestId/transitionId/idempotencyKey are minted by the
existing cohort path: idem = `sha256(canonicalize{tenantId, connectorId, accountId, actionId, params})`
over the durable `m365-governed-actions.json` ledger; the transition id and request id derive from it.
No parallel idempotency mechanism is introduced.

## 10 · Capability contract (expressed in this repository's actual primitives)
`m365.contacts.create` — purpose: create exactly one bounded contact in the signed-in user's default
Contacts folder. Operation `POST /me/contacts`; target `m365:/me/contacts` of the authenticated
ceremony account. Cohort membership: **COHORT2B_I** ("reversible internal data mutations — no external
communication, no hard delete"). Consequence **C3** ⇒ approval-bound; reversibility REVERSIBLE with
in-product governed rollback `contacts.delete` (**not invoked** by this gate). Execution constraints:
`maxEffects = 1`, no notification, no other principal. Scope requirement `Contacts.ReadWrite`
(documented). Observation: `GET /me/contacts/{id}`. Verification: the predicate in §19.

**Vocabulary the directive assumes but this repository does not have — measured, not invented:**
`EvidenceEnvelope`, `MicroTrace`, `NeuroChain` and any `permitId` primitive return **zero non-test
hits** across `apps/desktop/src` and `packages/shared/src`. Per the directive's own "do not create a
second audit ledger", nothing was manufactured. What actually plays these roles: **permit** = the CST
kernel's ALLOW verdict + its claim/fencing token; **evidence** = the durable idempotency ledger (which
stores the whole kernel outcome), `audit.log` (channel-level), `app.log`, and — for non-cohort paths —
the `ActionRecord` store. `readiness` (34 non-test sites) and `riskClass` (2) do exist and are reused.

## 11–13 · Policy · approval · permit
Unchanged and untouched: the kernel is the runtime decision authority; `confirmed: true` mints the C3
Approval bound to transitionId + action + scope (B.15 pinned the mismatch refusal directly). No permit
concept is added.

## 14–17 · Execution · provider response · external effect · observation
**NOT EXECUTED.** No placeholder values are recorded.

## 18 · Read-back design (per B.18's finding, kept visible)
**CORRECTED after the discovery fleet landed — the superseded text is kept visible (§2 #21).**
This section first read: *"Primary oracle: `GET /me/contacts/{id}` using the id returned by the 201 —
the documented per-contact read."* **That oracle does not exist in this repository.** Measured by the
fleet over a stated search space and confirmed against source: the five production `me/contacts` URL
constructions are `POST /me/contacts`, `PATCH /me/contacts/{id}`, `DELETE /me/contacts/{id}`,
`GET /me/contacts` + `$search`, `GET /me/contacts` + `$select&$top=200`, plus the collection delta —
**no `GET` by contact id exists anywhere**; the only id-bearing paths are the two mutations. I had
specified a Graph endpoint that Microsoft documents but this product cannot currently call.

**Corrected primary oracle: the documented list read already implemented as `contacts.detectDuplicates`**
— `GET /me/contacts?$select=id,displayName,givenName,surname,emailAddresses&$top=200` — matching the
created id and the ceremony markers within the returned collection. It is a documented shape, it is a
governed cohort READ action, and it is inside the contacts profile's grant.
**Secondary:** `GET /me/contacts` (list). A per-id read would require new code and therefore a separate
implementation gate — it is not assumed here.

**And a second correction of scope, measured by the fleet:** the product's verification machinery is
wired for `mail.send` **only**, at three independent layers (the reconciler's row predicate
`actionId === 'mail.send'`, the oracle's query shape, and the target type), with
`executionGate.ts:68` still carrying `productionWired: false` for `verifyEffect`. **Nothing about
product verification is wired for contacts.** So the §19 predicate below is a **ceremony-level
comparison performed against the documented read** — it is explicitly *not* the product's verification
pipeline, and this gate does not claim otherwise. Wiring product verification for contacts would be its
own gate.
`contacts.search`'s `$search` shape remains **undocumented for this resource** and is explicitly **not**
the primary oracle; the sync delta path's divergence from the documented folder-scoped shape likewise
stands unfixed and visible (`SEAM-B18-READBACK-FINDING.md`).

## 19 · Verification predicate — FIXED BEFORE EXECUTION (§43)
`VERIFIED_SUCCESS` **iff all** of: provider status `201` · response carries a non-empty contact `id` ·
the corrected read-back (§18) returns `200` · **exactly one** returned contact has
`id === createdId` · `givenName === "SEAM-B16"` · `surname === "COHORT-LIVE-B16-001"` · the contact
belongs to the authenticated ceremony account's own default Contacts folder · no contradictory
observation. (Predicate updated only where §18's oracle correction forced it — the match is now made
within the documented collection read rather than by a per-id fetch; it is still fixed before any
result exists.) Anything less is **not** VERIFIED_SUCCESS:
201-without-read-back is `EXTERNAL_EFFECT_OBSERVED / NOT_VERIFIED`; timeout after dispatch is
`UNKNOWN` with **no automatic retry** (B.15: TIMEOUT_IS_NOT_CANCELLATION); read-back mismatch is
`VERIFICATION_FAILED`; marker already present before execution is `PREEXISTING_MARKER` → stop.

## 20 · What this gate DID prove — the authority boundary, before any credential
New pins: `apps/desktop/src/main/connectors/contactsProfileBoundary.test.ts` — **6, green first run**,
driving the **REAL `M365Executor`** with the real action catalog, a contacts-profile grant
(`m365ScopesForProfile('contacts')` — the same function the manifest uses), and a **recording HTTP
client that counts every call that would have reached Graph**:
- **Control:** `contacts.create` passes the scope gate and produces **exactly one** call — `POST` to
  `/me/contacts`. The boundary is not simply refusing everything.
- **§27 TESTS 4/5/6 (+calendar):** `mail.send`, `drive.upload`, `teams.sendChannelMessage`,
  `calendar.create` are each refused with the executor's "Missing Graph permission(s)" naming the exact
  missing scope — and **zero Graph calls occur across all four refusals**.
- The refusal names the missing permission **without disclosing the granted set** (a prober learns
  nothing extra).
- **§27 TEST 10:** an unconfirmed mutating create is held before the scope gate and before the network.
- An unowned account is refused first, with the same message an unknown account gets, no network call.
- The profile also covers the read-back capability (`Contacts.Read`), so observation stays inside the
  boundary.

## 21 · Failures
None encountered; nothing was executed live. No code was modified to make anything pass.

## 22 · Limitations (carried + new)
The proof above is the **executor's scope gate only** — not consent, not a token, not a kernel verdict,
not an external effect (§35's categories kept separate: this is TEST_VERIFIED, not
LIVE_PROVIDER_OBSERVED). Carried unchanged: a cohort run produces **no ActionRecord row** today; no
shipped renderer UI drives a cohort action; Boundary-B semantic/non-cryptographic; sandbox-agent-confirm
residual; 17/17 negative classes (coverage, not certification); distribution/notarization unproven;
public-claim quarantine; the read-back parity finding. **New:** artifact parity (§6) and the four absent
primitives (§10).

## 23 · Maturity change
**None.** `COHORT_API_EFFECT` remains **NOT_VERIFIED**; module/composition/runtime/artifact/packaged/
production-acceptance and distribution are all unchanged. What improved is boundary assurance at test
level, which is explicitly not live execution.

## 24 · Tests and custody at close
New 6 pins · **full main 896 files / 9354 passed / 7 skipped** vs B.18's 895 / 9348 / 7 — delta exactly
+1 file / +6 tests, zero existing tests modified · typecheck node clean · lint clean · secret scan: no
credential material anywhere in the changed files (no token, code, or secret exists to leak — none was
obtained) · 7/7 governed hashes · NP-008 ARMED · B.13 artifact preserved · BUILD_COUNT 0 ·
EXTERNAL_EFFECT 0.

## 24b · Process note (stated precisely, per the B.18 correction)
A two-agent discovery fleet was launched for the §31 map and the §27 harness. **At the time this
document was written it was still in flight** — that is an in-flight instrument reading, not a result,
and no claim is made about what it did or did not find. It was **not incorporated**, and nothing in
this gate depends on it: every measurement above was taken first-hand (direct source reads, direct
artifact greps, and the executed pin file). If its results land later and contradict anything here,
the correction belongs in the register, not in a quiet edit.

**RECONCILED — the fleet returned 2/2 shortly after the commit, and that rule was applied.**
It **corroborated** the absent-primitives finding with a stronger sweep than mine (`EvidenceEnvelope`
**0 matches repo-wide, any file type**; `MicroTrace`/`NeuroChain` **0 code matches**, only two
documentation lines that themselves record the absence) and the artifact/boundary measurements.
It **contradicted one committed claim**: the primary read-back oracle I specified,
`GET /me/contacts/{id}`, **does not exist in this product** — §18 is corrected above, and the
consequence (the ceremony verifies against the documented list read, and product verification is
mail.send-only at three layers) is recorded there rather than quietly patched. The lesson stands in the
other direction this time: *waiting for the instrument would have been cheaper than correcting the
record* — but correcting it is what keeps the record worth reading.

## 25 · First broken edge
**SOURCE → BUILD → ARTIFACT** — upstream of the credential gate. B.18 moved the blocker from
"broad scope" to "credential-gate ready"; this gate measured that *readiness in source is not readiness
in the artifact*.

## 26 · NEXT SINGLE ACTION
**The operator authorizes a build envelope that produces an artifact containing the narrow profile** —
the same five-point decision B.12 recorded (armed-`out/` fate + re-arm · command/order with
`--publish never` · side-writes · dirty-tree/version provenance · signing posture), now with one added
requirement: the resulting artifact must be **measured** to contain `NEUROPAUSE_M365_SCOPE_PROFILE`
before any consent screen is opened. Only then do GATE 1 and GATE 2 apply, in that order.
