# SEAM-B.16 / GATE-R.10 — COHORT FIRST-LIVE VERIFICATION

## STATUS: PREPARED_NOT_EXECUTED
**EXTERNAL_EFFECT = 0 · BUILD_COUNT = 0 · no live action has occurred. This document is the envelope;
execution requires the operator's explicit, specific authorization (§14 below) AND the credential gate.**

## §1 Scope
Close the register's only unproven governed arrow — COHORT API → EFFECT — with ONE bounded, reversible
cohort action through the complete path: cohort IPC ingress → governedAction → kernel → executor →
Graph → effect → independent read-back → verification. One effect, ever.

## §2 Custody (CUSTODY_OPEN)
HEAD `f5c0f46` (the B.15 commit — expected) · branch `cert/data-import-cst-integration` · 1 worktree ·
NP-008 **ARMED** (86 files, seed chunk, sentinel ×1) · `out/` PRESERVED · B.13 artifact PRESERVED ·
B.15 evidence present · kernel tarball intact · 7/7 governed hashes OK.

## §3 Source parity
Zero source drift since B.13/B.14: `git diff --stat 8d411bc..HEAD` = B.15's two test files + docs only.
Cohort routing re-measured at HEAD: the four cohorts (13+3+9+3 = 28 ids, verbatim in the fleet record) +
`mail.send` = 29; `mutates: true` count in the adapters = 29 — **29/29 mutating actions governed-routed,
unchanged.**

## §4 Cohort inventory / the exact chain (§52)
COHORT ENTRYPOINT: channel `'connectors:m365.execute'` (`packages/shared/src/ipc/channels.ts:225`;
renderer-invokable, `:1318`), request `M365ActionExecuteRequest` with `confirmed` defaulting false
(`contracts.ts:464-470`) + FG-14 `correlationId` (`:489`) · ROUTING: frozen `connectors/index.ts:588-592`
(def, `audit: true`, `timeoutMs: SYNC_TIMEOUT_MS`) → cohort-membership gate `:652-659` → `governedAction`
call `:660-675` (authoritative `deps.actor() ?? ''`, `deps.workspaceId()`, ownsAccount/scopes/token
ports) · GOVERNED ACTION: `cst/governedAction.ts` — canonicalize→sha256 idem (`:251-260`, fail-closed),
`confirmed` → C3 Approval mint (`:283`), kernel `:335-337`, at-most-once effect closure `:339-354`
(`action.run` at `:351`), `kernel.run` `:367` · EXECUTOR/PROVIDER: the per-action adapter's single Graph
call (below) · READ-BACK: per-candidate (below) · EVIDENCE: see §22.
**Recorded ingress fact:** exactly ONE shipped renderer invoke site exists and it is hardcoded to
`mail.send` (`M365WritePanel.tsx:106`) — no shipped UI drives a cohort action. The channel itself is the
cohort API (preload/runtime allowlisted), so the ceremony drives it directly via
`window.neuropause.invoke` from the running app — the REAL ingress (bridge → frozen handler → cohort
branch), with the absent button recorded as a fact, not routed around.

## §5 Candidate comparison (§53)
| Candidate | Reversible | Isolated | External effect | Read-back | Risk | Recommendation |
|---|---|---|---|---|---|---|
| **contacts.create** | in-product governed `contacts.delete` | `/me/contacts` — private folder, no notification, no other principal | 1 contact object | **STRONGEST: in-product cohort READ `contacts.search` (mutates:false) + `contacts.detectDuplicates` + sync contacts-delta + raw-GET pattern** | lowest | **SELECTED** |
| mail.saveDraft | in-product governed `mail.delete` | zero-recipient draft is adapter-legal (`to: []` passes) | 1 draft | **WEAKEST: NO in-product path reads Drafts** (oracle = sentItems+inbox only; sync pulls inbox only) — read-back would need a new reader | low | rejected on read-back |
| drive.createFolder | in-product governed `drive.delete` | private OneDrive; conflictBehavior rename | 1 folder | sync drive-delta or raw GET only; scope `Files.ReadWrite.All` is the broadest | low-mid | runner-up |
| (calendar.create zero-attendee) | 2A conservative C3/IRREVERSIBLE label | isolated w/o attendees | 1 event | — | mid | rejected (2A label) |
| (teams.createChannel) | — | **team-visible** | — | — | high | rejected (not isolated) |

## §6 Selected action
**`contacts.create`** — COHORT2B_I ("REVERSIBLE internal data mutations — no external communication, no
hard delete", `governedAction.ts:118-128`), adapter `connectors/m365/contacts.ts:98` →
`POST https://graph.microsoft.com/v1.0/me/contacts` (`:47`), scope `Contacts.ReadWrite`, returns the
created contact id (`:48`). LIVE_RUN_ID: **COHORT-LIVE-B16-001**.

## §7 Target isolation
The ceremony account's OWN contacts folder (`/me/contacts`) in a DEDICATED test account/tenant
established at the credential gate — no other principal is notified or routed anything (measured: the
adapter's only call is the single POST; sharing/invitation paths are separate actions). Unique markers
make the object distinguishable from all prior artifacts: `givenName: "SEAM-B16"`,
`surname: "COHORT-LIVE-B16-001"`, `companyName: "NeuroPause-B16-Ceremony"`, `emails: []`.

## §8 Authority
Session actor (`deps.actor()` — authoritative; null ⇒ DENY, no effect) · `ownsAccount` +
`grantedScopes` from the connector store for the ceremony account · kernel policy grant per action ·
C3 ⇒ approval REQUIRED and minted only from `confirmed: true` (the human confirmation field) — the
B.15-pinned binding semantics (approval bound to transitionId + action + scope; action mismatch ⇒ DENY
`APPROVAL_SCOPE_VIOLATION`).

## §9 Policy · §10 Approval
The kernel is the single verdict authority (B.14). `confirmed: false` ⇒ HOLD (mapped
`requiresConfirmation`) — the envelope's negative precondition check runs this exact case live-safe
(no effect on HOLD, pinned). Approval = the operator's explicit confirmation of THIS action instance.

## §11 Parameter freeze
Params frozen in this envelope (above); the cohort path canonicalizes them into the idempotency
identity (`canonicalize → sha256`) — the executed params are the closure-captured validated objects
(B.14 zero-mutator sweep). PARAMETER_DIGEST computed at ceremony time from the canonical form and
recorded in the executed evidence.

## §12 Idempotency
idem = sha256(canonical{tenantId, connectorId, accountId, actionId, params}) over the durable
`m365-governed-actions.json` ledger (IN_FLIGHT written durably BEFORE the effect; DONE stores THE WHOLE
OUTCOME). **A same-params replay returns the stored outcome WITHOUT re-executing** (duplicateSuppressed
— pinned by the cohort durable-restart suite), so the §25 zero-effect live replay check is
architecture-permitted and included as an OPTIONAL authorized step.

## §13 External-effect firewall
NETWORK_DESTINATION_SET = `https://graph.microsoft.com/v1.0` (the adapter's single POST; base URL
`actionSdk.ts:12`) + `https://login.microsoftonline.com/<tenant>/oauth2/v2.0` (token). No webhook,
telemetry, secondary API, or delivery path exists in the action's closure (B.14 firewall sweep).
EXPECTED_EXTERNAL_EFFECT = exactly 1 contact object in the ceremony account.

## §14 Operator authorization — REQUIRED, NOT YET GIVEN
**Two standing human gates precede execution, in order:**
1. **LIVE_CREDENTIAL_GATE (recorded fact, not assumption):** the S16 containment was PERFORMED
   (operator-reported COMPLETE, 2026-08-19 — enterprise app deleted ⇒ consent revoked; app registration
   deleted; S15 profile removed). **No valid app registration exists; token minting is dead.** The
   ceremony requires: a NEW app registration + consent for the test account with `Contacts.ReadWrite`
   (+ `Contacts.Read` for the read-back) — operator-at-keyboard, exactly the SEAM-22 run-plan
   precondition. Vault-file presence on this machine (path-level booleans only, no contents read) is
   recorded in the fleet record; none can mint tokens against a deleted registration.
2. **THE SPECIFIC LIVE AUTHORIZATION (§41 form):** *"I authorize SEAM-B.16 to execute the prepared
   contacts.create cohort action (COHORT-LIVE-B16-001) against the isolated ceremony account's own
   contacts folder exactly as specified in the envelope."* Ambiguous phrasing will be re-asked.

## §15–§21 Live execution / result / effect count / read-back / verification / replay / failure
NOT EXECUTED. The ceremony script (mirrors the §59-class run-plan discipline, OPERATOR-ACTION vs
MACHINE-ACTION marked):
1. OPERATOR: clear the credential gate (registration + consent; dedicated fresh `--user-data-dir`
   profile per the S15/P1 runbook discipline; kill-verify first; NO rebuild — the armed `out/` at
   `a7a7d51` CONTAINS the cohort path, sha-matched `e40a47a2…` to the B.13 §43 record).
2. OPERATOR: launch the armed build plain-release env on the dedicated profile; sign in; connect the
   M365 account (OAuth loopback flow).
3. MACHINE (operator-witnessed): negative precondition — invoke the cohort channel with
   `confirmed: false` ⇒ expect HOLD/requiresConfirmation, zero effects.
4. MACHINE: THE ONE EFFECT — invoke `connectors:m365.execute` with
   `{connectorId, accountId, actionId: 'contacts.create', params: <frozen §7 markers>, confirmed: true,
   correlationId: 'COHORT-LIVE-B16-001'}` → capture the full IPC-returned outcome (verdict, semantic
   outcome, provider ack, created contact id = PROVIDER_OPERATION_ID).
5. MACHINE: independent read-back — the in-product cohort READ `contacts.search` for
   `COHORT-LIVE-B16-001` (a separate governed Graph GET) ⇒ the created id must appear;
   READ_BACK_MATCH recorded. (Secondary: sync contacts-delta.)
6. OPTIONAL (pre-authorized in the same envelope if the operator says so): the §25 zero-effect replay —
   identical invoke ⇒ duplicateSuppressed, no second object (re-verified by a second `contacts.search`
   count).
7. STOP. No cleanup (`contacts.delete` exists in-product but runs ONLY under a separate authorization —
   §24; the effect is evidence).
Timeout plan (§39): the channel's `SYNC_TIMEOUT_MS`; on timeout NO retry — read-back/reconciliation
decides (TIMEOUT_IS_NOT_CANCELLATION, B.15). Failure vocabulary: the §49 set, mapped to the kernel's
actual classes (HOLD/DENY reasons; UNKNOWN ⇒ the durable UNKNOWN hold path `connectors/index.ts:677-679`).

## §22 Evidence / provenance (measured reality — a recorded limit)
**A cohort run today produces NO ActionRecord row** — `actionRecord.observe` has exactly two production
call sites and neither is the cohort branch (the SEAM-22 item C, FG-gate-blocked on frozen
`connectors/index.ts`, still true at HEAD). The ceremony's durable traces: the idempotency ledger's
DONE record (carrying THE WHOLE kernel outcome), `audit.log` (channel-level), `app.log`, plus this
evidence document capturing the IPC-returned outcome, provider id, and read-back result. The
PROVENANCE RELATIONSHIP (intent→authority→policy→approval→decision→action→executor→provider→effect→
read-back→verification→evidence) is recorded here — NOT called "NeuroChain" (no such runtime component
exists in the repository).

## §23 Known limits
No cohort ActionRecord row (above — the post-ceremony FG envelope candidate) · no shipped cohort UI
(the ingress fact, §4) · read-back via `contacts.search` is in-product but same-process (a
separate-process read of the idempotency ledger's stored outcome supplements it) · all B.15 carried
limits unchanged (worker-path Boundary-B parallel governance per B.14's classification — U1's
"bypasses the kernel" phrasing is true of the KERNEL only; the parallel claim/Boundary-B governance
stands) · containment paradox carried (CONTROL-REGISTER: validating containment requires having sent).

## §24 Maturity
Unchanged this turn. On successful execution the ONLY promotion is the scoped statement
`COHORT_FIRST_LIVE_EFFECT: VERIFIED` / `COHORT_API_TO_EFFECT: E3 for contacts.create` — one action,
one provider, one target; 28/28 routed never becomes 28/28 live-verified (§31).

## §25 Verdict
**`COHORT_LIVE_VERIFICATION_READY`** — envelope complete; execution blocked, in order, on the
LIVE_CREDENTIAL_GATE (recorded containment) and the §41-specific operator authorization.

## §26 Next single action
**The operator clears the credential gate and, if proceeding, gives the §14.2 authorization verbatim.**
Nothing executes without both.
