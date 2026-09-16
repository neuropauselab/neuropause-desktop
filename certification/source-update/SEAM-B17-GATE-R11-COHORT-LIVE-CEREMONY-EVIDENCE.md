# SEAM-B.17 / GATE-R.11 — COHORT LIVE CEREMONY

## STATUS: PREPARED_NOT_EXECUTED — BLOCKED AT THE CREDENTIAL GATE
**EXTERNAL_EFFECT = 0 · BUILD_COUNT = 0 · no live action, no app registration, no consent, no token,
no browser opened, no credential typed.** Phases 1–4 executed; Phase 5 is the designed WAIT, and it is
now a WAIT ON A RULING, not merely on operator availability.

## §1 Scope
Execute exactly one prepared `contacts.create` cohort action through the real cohort ingress and verify
it independently. This turn covers custody, B.16 verification, Microsoft Graph documentation parity, and
operator credential instructions — then stops.

## §2 Custody
HEAD `346d081` (the B.16 prepare commit — expected) · branch `cert/data-import-cst-integration` ·
1 worktree · tree: protected ` M certification/baseline.json` + untracked `dist-seam-b13/` ·
**NP-008 ARMED** (86 files; `out/main/index.js` sha256 `e40a47a2051b6e2e8aa90450…`, identical to the
B.13 §43 re-arm record; seed chunk present) · **B.13 artifact PRESERVED** · **CST UNTOUCHED** ·
7/7 governed source hashes OK · B.16 evidence present.

## §3 Operator authorization
**ABSENT.** The §13 verbatim authorization has not been given, and per §12 it cannot be reached until the
credential gate clears. No inference of approval was made from any prior gate.

## §4 Credential gate
**NOT CLEARED.** Full record: `certification/source-update/SEAM-B17-CREDENTIAL-GATE.md`.
Two substantive results this turn:

**(a) Graph documentation parity (§52) — verified against current Microsoft Learn:** `POST /me/contacts`,
delegated `Contacts.ReadWrite`, **201 Created** + contact `id` — all CONFIRMED, matching the adapter.
Two divergences recorded honestly: **`$search` is not documented for `/me/contacts`** (only `$filter` on
`emailAddresses/any(...)`), which is what the repo's `contacts.search` uses; and the v1.0 **delta** page
documents the **folder-scoped** `/me/contactFolders/{id}/contacts/delta` while the repo's sync uses
`/me/contacts/delta`. Consequence: the ceremony's PRIMARY in-product read-back is re-ordered to
**`contacts.detectDuplicates`** (a documented `GET /me/contacts?$select=…&$top=200` shape), with
`contacts.search` and delta demoted to BEST-EFFORT. **No code changed** — only the envelope's plan.

**(b) THE BLOCKER — scope minimization conflict (STOP-class under §4 of the directive).** The shipped
`microsoft-entra` manifest requests **24 delegated scopes** on every connect — including `Mail.Send`,
`Mail.ReadWrite`, `Files.ReadWrite.All`, `Directory.Read.All`, `User.Read.All`, `Chat.ReadWrite`,
`Channel.Create` (the last three Teams scopes requiring admin consent). The directive requires a
`Contacts.ReadWrite`-only request and says *"If the consent screen presents anything broader than the
ceremony specification: STOP."* Narrowing it means editing `manifests.ts` — **a production source change
B.17 §44 forbids**. A different app registration cannot help: the scope list is client-side.
**This is S15's finding F-1 (scope reality / manifest minimization) surfacing at the gate built to catch
it.** Three operator options are laid out in the credential-gate doc (MINIMIZE-FIRST via a separate
implementation gate — recommended; RELAX §4 explicitly for a disposable account; or DEFER). **Claude
selected none.**

## §5 Artifact identity
Vehicle = the armed `out/` at the B.13 re-arm provenance (HEAD `a7a7d51`), sha re-matched this turn;
B.16 confirmed it CONTAINS the cohort path. **No rebuild, no packaging, no notarization, no
`dist/` mutation.** BUILD_COUNT = 0.

## §6 Profile isolation
Planned, not created: a fresh dedicated `--user-data-dir`, kill-verified before launch per the P1/S15
runbook discipline; `app.isPackaged`/bundle-hash checks at launch. Not executed.

## §7 Network boundary
Permitted destination set for the ceremony: `login.microsoftonline.com` (token) and
`graph.microsoft.com` (the single POST), plus Electron-internal/loopback (`http://127.0.0.1:42817/callback`).
**Observed this turn: zero ceremony network traffic.** The only network use was documentation retrieval
by the assistant (learn.microsoft.com), which is not an application effect.

## §8 Negative control · §9 Pre-effect snapshot · §10 Kernel authorization · §11 Provider execution ·
## §12 Effect count · §13 Durable ledger · §14 Application/audit evidence · §15 contacts.search read-back ·
## §16 contacts-delta read-back · §17 Idempotency · §18 Rollback status
**NOT EXECUTED** — all gated behind §4. No placeholder values are recorded (§58: nothing fabricated).
The prepared sequence is unchanged from B.16 except the read-back re-ordering in §4(a): negative control
(`confirmed:false` ⇒ HOLD, zero executor invocations) → pre-effect marker absence check → ONE
`contacts.create` → provider evidence → durable ledger DONE record → `contacts.detectDuplicates`
read-back (primary) → `contacts.search`/delta (best-effort) → reconcile → classify. No retry, no
rollback, no replay without separate authorization.

## §19 Credential containment
Not applicable this turn (nothing was created). The post-ceremony containment choice (KEEP / DISABLE /
DELETE / REVOKE CONSENT) remains the operator's and is not pre-selected.

## §20 External-effect accounting
Graph contact creations **0** · mail **0** · calendar **0** · files/drive **0** · other Graph mutation
**0** · customer effect **0** · production effect **0** · **EXTERNAL_EFFECT = 0**.

## §21 Source parity
7/7 governed hashes unchanged; `secureBridge.ts` and the installed kernel unchanged; **zero production
source modified**; frozen surfaces untouched; baseline not re-frozen (`CERT-40616b9` custody carried,
its known non-frozen divergence classified, not repaired).

## §22 Known limits (carried unchanged + new)
Carried: no ActionRecord row for cohort runs (item C, FG-blocked) · no shipped renderer UI drives a
cohort action · Boundary-B semantic/non-cryptographic · sandbox-agent-confirm residual · no direct AI
executor path · process-spawner trust bounds · at-most-once/reconciliation semantics · 17/17 negative
classes pinned (a coverage claim, not a security certification) · distribution/notarization unproven ·
public-claim quarantine. **New this turn:** the scope-minimization conflict (§4b) · `$search` for
`/me/contacts` undocumented in v1.0 · the delta path shape divergence · one tooling condition recorded
honestly: the Phase-3 documentation agent aborted on a usage-credit error and the verification was
re-run directly by the main loop (an environment condition, not a repository or documentation finding).

## §23 Maturity
Unchanged — module E4 · composition E3 · runtime E3 · artifact E3 · packaged runtime E3 · production
acceptance E3 · distribution E0. **COHORT_API_EFFECT remains NOT_VERIFIED** (it can only be established
by real observation, never inferred from tests).

## §24 Verdict
**`COHORT_LIVE_BLOCKED_CREDENTIAL_GATE`** — with the specific measured cause: the ceremony cannot request
a minimized scope set without a production source change that this gate does not authorize.

**NEXT SINGLE ACTION:** the operator rules the §C option — the recommended one being a separate,
narrowly scoped implementation gate that lets the M365 connect flow request a reduced scope set (closing
S15's F-1), after which B.17 resumes at the credential gate unchanged.
