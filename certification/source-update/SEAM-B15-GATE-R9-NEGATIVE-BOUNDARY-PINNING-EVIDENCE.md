# SEAM-B.15 / GATE-R.9 — NEGATIVE-BOUNDARY PINNING

## §1 Scope
Pin the exactly-two PARTIAL negative classes from B.14's §34 map. Nothing else. TEST_ONLY (zero
production-source changes), BUILD_COUNT = 0, EXTERNAL_EFFECT = 0.

## §2 Custody
HEAD `73d21a5` (the B.14 docs commit — the anticipated later docs-only HEAD; measured, not assumed) ·
branch `cert/data-import-cst-integration` · 1 worktree · NP-008 **ARMED** at open and close (86 files,
seed chunk, sentinel ×1) · `out/` PRESERVED · B.13 artifact PRESERVED (`dist-seam-b13/` untouched) ·
B.14 evidence present · frozen surfaces untouched · CST untouched (the kernel consumed read-only from
the installed package). Gate-detector PROCEED on both new test paths BEFORE creation — both placed
deliberately OUTSIDE frozen `cst/` and sensitive dirs (`src/main/` root beside
`constitutionalInvariants.test.ts`; `src/main/ipc/` beside `runtimeAuthz.test.ts`).

## §3 Baseline
BEFORE: 892 files / 9328 passed / 7 skipped; negative classes 15/17 PINNED.

## §4 Source parity
SOURCE_PARITY_START = SOURCE_PARITY_END: 7/7 governed hashes OK; `ipc/secureBridge.ts` sha
`456d311d…` and the installed kernel `kernel.js` sha `7b7be2fb…` recorded and unchanged (no production
file modified — `git diff --name-only` at close shows only the two new test files + docs).

## §5–§7 Target A — kernel approval-action mismatch
**Insertion point measured from the installed kernel** (the exact runtime object every adapter
consumes): the action limb is the FIRST conjunct of scopeOk (`a.action === req.action`, kernel.js:147);
an action-only mismatch (transitionId bound, scope matching, HUMAN approver, SoD inert, unconsumed,
unexpired, actor GRANTED the request's action so policy passes) fires **DENY
`APPROVAL_SCOPE_VIOLATION`** — deliberately distinct from `APPROVAL_MISMATCH`, which is exclusively the
transitionId binding (kernel.js:142-144). **Test:** `src/main/approvalActionBinding.test.ts` (3 tests) —
the in-app-shaped construction copied from the non-frozen journalPostTransition adapter (deep-path
kernel imports, per-call stores, C3, brand functions). CONTROL: approval(A)+request(A) → ALLOW /
executed / VERIFIED_SUCCESS / 1 effect call (the fixture is live). **THE PIN: approval(A)+request(B) →
DENY `APPROVAL_SCOPE_VIOLATION`, `executed:false`, `outcomeClass:'NOT_ATTEMPTED'`,
`verification:'NOT_APPLICABLE'`, executor invocations 0, effects 0.** §24 row 3: no approval at C3 →
HOLD `APPROVAL_REQUIRED`, effects 0. **TARGET A = PINNED.** §11 recorded: the kernel's enforcement is
now DIRECTLY pinned; the adapters' coupling (approval.action ≡ request.action by construction) remains
INDIRECT protection — not upgraded.

## §8–§11 Target B — secure-bridge withTimeout
**Semantics measured from source before testing** (secureBridge.ts:119-134, 143-167): the timeout
rejects the CALLER (`IpcError`, `` `Request timed out: ${channel}` ``) while the handler promise keeps
running — **TIMEOUT_IS_NOT_CANCELLATION** (no AbortController, no signal; a late settle
resolves/rejects an already-settled wrapper — a spec-level no-op); auth, RBAC, and Zod validation run
BEFORE and OUTSIDE the timeout wrap; `def.timeoutMs ?? DEFAULT_TIMEOUT_MS(30_000)` honored verbatim,
no floor/clamp. **Test:** `src/main/ipc/secureBridgeTimeout.test.ts` (6 tests) driving the REAL
`runSecureHandler` (the channelAuthorityTenancy harness precedent; electron mocked at the platform
boundary only). Pinned: control completion · **timeout rejection with the named error, exactly one
invocation, no fabricated success** · **LATE COMPLETION measured: the handler's side effect lands
AFTER the caller's rejection, the settled rejection is unchanged, no second invocation** (recorded as
the measured semantics per §19 — cancellation was NOT silently implemented) · late REJECTION equally
discarded, no unhandled rejection escapes · **a timeout can never bypass authorization** (unauthenticated
and missing-authorize both refuse pre-timeout with 0 invocations) · §24 row 4: a retry is a FULL new
pass through the gate — no unauthorized duplicate path. **TARGET B = PINNED.**
**TIMEOUT_IS_NOT_CANCELLATION is recorded as a measured architectural fact** (a possible future seam,
not a defect classified here): the caller stops waiting; the executor is not cancelled; late results
are discarded; for consequential work the kernel-layer at-most-once/UNKNOWN machinery (B.14 §19-21)
remains the effect-safety authority.

## §12 External-effect firewall
EXTERNAL_EFFECT = 0 — mock handlers and an in-memory kernel world only; no network, no provider, no
store mutation outside test scope.

## §13 Test counts
New pins: 9/9 green (correct invocation re-verified from `apps/desktop` after a §2 #24 root-invocation
was caught and re-run). Combined focused suite: **178/178** across 11 files. Full regression at close:
**894 files / 9337 passed / 7 skipped** — delta over the B.14 baseline exactly the 2 new files / 9 new
tests. `typecheck` node clean · eslint clean on both new files. **Classified, not fixed:** the separate
`tsconfig.test.json` project carries **63 pre-existing errors in OTHER test files, 0 in the new files**
(pre-existing test-project drift; the slice discipline's node+web typechecks are clean; outside this
gate's scope).

## §14 Failure classification
No test failures occurred; the §27/§28 discipline was not exercised. The one in-flight correction was
an invocation artifact (root-cwd vitest run — caught, re-run correctly).

## §15 Verification
Both pins assert through the REAL enforcement objects (installed kernel; production `runSecureHandler`)
with executor-invocation and effect counters — refusals prove the effect NEVER ran, not merely that an
error string appeared.

## §16 Known limits (carried, §37 — none silently closed)
B1/B2 corrected + Option D governing · no ungoverned mutating route · M365 E3 / journal E2 / spawners
E1–E4 trust bounds · no direct AI executor path · replay/binding pins · single-process concurrency
scope · executor-throw OUTCOME_UNKNOWN → RECONCILIATION_REQUIRED · **cohort API→EFFECT PARTIAL (no
cohort action ever live-run)** · **sandbox-agent-confirm residual (unpinned)** · **Boundary-B
semantic/non-cryptographic bound** · corrupt-ledger app-fatal boot · importer posted-row debt ·
comment drift · rc.20 provenance · notarization/distribution unproven · public-claim quarantine ·
legal-name conflict · NEW: the 63-error pre-existing `tsconfig.test.json` drift (recorded).

## §17 Maturity
**EXECUTOR_NEGATIVE_BOUNDARY_COVERAGE: 17/17 PINNED.** All other maturities unchanged: module E4 ·
composition E3 · runtime E3 · artifact E3 · packaged runtime E3 · production acceptance E3 ·
distribution E0. Not a global security certification (§36/§48 honored: what is proven is exactly
"KERNEL APPROVAL-ACTION MISMATCH NEGATIVE PATH PINNED" and "SECURE-BRIDGE TIMEOUT NEGATIVE PATH
PINNED").

## §18 Verdict
**`EXECUTOR_NEGATIVE_BOUNDARIES_PINNED`** — Target A PINNED, Target B PINNED, 17/17.

## §19 Next single action
The register's deepest remaining unproven arrow on a governed path is **cohort API→EFFECT (PARTIAL —
no cohort action has ever been live-run)**; the sandbox residual and the Boundary-B bound are stated
trust bounds, not broken arrows. **Next single action: the operator-gated cohort first-live-verification
envelope** — one bounded, REVERSIBLE cohort action (e.g. `mail.saveDraft`) under the §59-class run-plan
discipline (⛔ real external effect ⇒ operator-executed ceremony; nothing runs without that envelope).
