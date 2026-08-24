# SEAM-B.14 / GATE-R.8 — EXECUTOR GOVERNANCE / B1-B2 AUTHORIZATION BOUNDARY

## §1 Scope
Measure whether governance survives the executor boundary: the B1/B2 seam, the complete executor
closure (process/network/filesystem), authority/policy/approval binding through executor invocation,
AI-to-executor paths, failure/recovery/evidence semantics. **Build-independent, measurement-only:
BUILD_COUNT = 0, EXTERNAL_EFFECT = 0, zero source changes, zero frozen touches.** B.13 not reopened;
its artifact and the NP-008 armed state preserved untouched.

## §2 Custody
HEAD `8d411bc` (the B.13 commit — expected) · branch `cert/data-import-cst-integration` · 1 worktree ·
tree = protected ` M certification/baseline.json` + retained `dist-seam-b13/` · **NP-008 ARMED = TRUE**
(86 files, seed chunk, sentinel ×1 — verified at open and close) · kernel tarball `293d056…` intact ·
freeze ANCESTRY OK / SOURCE FAIL (standing classified baseline-lag) · B.13 artifact preserved
(`dist-seam-b13/NeuroPause-arm64.dmg` present).

## §3 Source parity
**7/7 B.8–B.13 governed-file hashes byte-identical** at gate open and close. No source file changed
during this gate (docs-only commit).

## §4 Executor inventory (EXECUTOR_COUNT and classification)
Measured, non-test `src/main` (search spaces in the fleet record):
1. **M365Executor** (`connectors/m365/executor.ts:63`) — E3 (controlled external effect). Own gates:
   `ownsAccount` → `mutates ∧ confirmed !== true` refusal → Graph-scope validation → token → one
   `action.run` Graph call; sole `writeCount` incrementer (the S19/F-5 context confirmed).
   **Exactly 2 production call sites**: `runtimeCore.ts:2521` (worker path, Boundary-B-governed) and
   `connectors/index.ts:683` (IPC residue — reads only, proven below).
2. **journal-post executor** (B.8) — E2 (local durable mutation), write inside `kernel.run` (re-cited).
3. **Process executors**: `pluginHost.ts` fork of the bundled shim running plugin code — **E4**
   (plugin-trust boundary; enable gated `cloud:operate`-class authz, `runtimeAuthz.ts:293`);
   `processAdapter.ts` spawn of operator/registry-configured commands — **E3**; `aiConfigIpc.ts`
   `execFile('ollama','--version')` — **E1**; `signingStatus.ts` `execFile('codesign','-dv',…)` — **E1**;
   `sandbox/desktop/playwrightDriver.ts` — launches the app's own binary against an isolated profile
   (E3, `sandbox:manage`-gated). **No E5 exists: zero `osascript`/AppleScript/`system(`/shell-string
   execution in non-test main** (sweep stated).
4. **Network executors** (family census): m365 Graph adapters (writes ONLY through the three governed
   routes below), AI providers (data-only round-trips), backend/cloud clients (auth-gated reads/sync),
   updater (no silent install), companion gateway (in-process server). No network write escapes the
   governed routes (W2 record).

## §5 Dependency closure
Process: 5 spawner files (above), each with its authorization chain quoted in the fleet record.
Network: no `fetch`/socket in the journal closure (B.11 re-cited); Graph writes only via `action.run`
at exactly 3 sites — `m365/executor.ts:134`, `cst/sendTransition.ts:273`, `cst/governedAction.ts:351`
(+ the non-Graph infra mirror). Filesystem: governed stores + plugin `plugin-data/<id>.json` +
user-action-gated save dialogs; no IPC-supplied arbitrary-path write found (spaces stated).

## §6 Governance boundary — THE CENTRAL RESULT
**The B1/B2 identity, resolved from the original documents (§2 #21/#25 correction):** B1 and B2 are the
two mechanism-UNIFICATION OPTIONS from
`PHASE-I-A3-CROSS-INGRESS-RECONCILIATION-DESIGN-INVESTIGATION.md` (B1 = route M365 IPC through
Boundary B; B2 = shared identity/decision/consumption), **ruled `OPTION D — the two governance
mechanisms should intentionally remain separate; certify EFFECT-DOMAIN COVERAGE, not mechanism
equivalence`** (quoted verbatim in the fleet record). H-FINDING-3's ungoverned worker path was **CLOSED
by Boundary B** (its own evidence doc says so). The GATE-BUILD-0 letters (A–E) were a DIFFERENT
vocabulary (P0 target list, "executor routing (B)"); CLAUDE.md §1's SEAM-22 entry FUSED the two into
"the B1/B2 worker-path kernel bypass" — **a stale-premise label: the register carried an
FG-envelope-owed item for an ungoverned bypass that no longer exists.** This gate corrects the register.

**Measured at HEAD: NO UNGOVERNED MUTATING ROUTE EXISTS.** Every route to a mutating Graph write passes
exactly one of: (a) `governedSend` (CST kernel; sole consumer `connectors/index.ts:616`, the
`mail.send` guard's fall-through provably unreachable); (b) `governedAction` (CST kernel; 28-action
cohort, `connectors/index.ts:660`); (c) the **worker chain** — `WorkforceProposalApprove` IPC (human
approval, authoritative approver) → fail-closed claim mint → `executeEngine` durable SINGLE-USE
decisionId consumption → **Boundary B verify (deny ⇒ no effect)** → `runBinding` → executor (with its
own `confirmed`/scope/ownsAccount gates; UNKNOWN ⇒ durable hold). The IPC executor-direct residue
(`connectors/index.ts:683`) carries **only the 5 `mutates:false` reads** — the 29/29 mutating = 1
kernel-send + 28 kernel-cohort routing re-verified id-by-id at HEAD. The renderer structurally cannot
inject the worker path (`ExecuteRunRequest` is `.strict()` with no params/binding/claim). Honest bound
(§2 #33-shape, stated): Boundary B is **semantic, not cryptographic** (its own header says so) — the
control is the in-process-only transport enforced by the `.strict()` contracts: designed and asserted,
not incidental.

## §7–§9 Authority / policy / approval binding
**AUTHORITY_ACTION_BOUND · APPROVAL_CONTEXT_BOUND · TARGET_BOUND — PROVEN** (mechanisms named):
kernel checks `a.transitionId === req.transitionId`, `a.action === req.action`, scope === target
(DENY `APPROVAL_MISMATCH`/`APPROVAL_SCOPE_VIOLATION`); grants are per-action; params are
closure-captured BEFORE `kernel.run` and hashed into the idempotency identity (send: pipe-string;
cohort: fail-closed `canonicalize`; journal: rev-anchored) — **zero param-mutation sites across the
seven adapter/gate files** (sweep stated). The effect ignores the kernel's `req` echo and uses the
captured locals — the executed params ARE the validated/approved objects. Proposal lane: single-use
stash, operator-edit → SKIP, expiry → DENIED (pinned). §2 #31-shaped note recorded: params-immutability
holds by construction-order + absence-of-mutators, pinned indirectly (idem hash), not by a dedicated
freeze/pin.

## §10 Executor invocation
Kernel-wrapped paths: effect strictly inside `kernel.run` after claim + revalidation + durable-intent
acquire, at-most-once (`effectCalls` — "NEVER retried"). Worker path: invocation strictly after human
approval + claim + durable consumption + Boundary B. No caller→executor shortcut exists (call-site
census: 2 production sites, both governed).

## §11–§13 Process / network / filesystem boundaries
See §4/§5. **PROCESS_BOUNDARY: PROVEN with stated trust bounds** (plugin-fork E4 and operator-configured
processAdapter E3 are capability boundaries by design — authorization precedes the spawn; what the child
DOES is outside the import graph, no OS sandbox; §2 #31 discipline: stated, never relied on).
**NETWORK_BOUNDARY: PROVEN** for mutating writes (three governed routes only). **FILESYSTEM_BOUNDARY:
PROVEN** for governed stores; plugin storage is host-mediated (`storage.get/set` over IPC to the main
process, `plugin-data/<id>.json` only — the shim itself does no fs).

## §14 External-effect firewall
EXTERNAL_EFFECT = 0 this gate. No live executor was driven; all dynamic evidence came from the existing
mock/module suites (below). The M365 executor's external capability is classified (E3), not exercised.

## §15–§16 Positive and negative tests
**467 passed / 2 skipped** across the 28 focused suites re-run at HEAD this gate (kernel negatives ×4
adapters, cohort concurrency/restart, constitutional invariants 26, journal 18+9, liveBrain gate/lane/
boundary/identity, executeEngine durable consumption, verifyEffect, readBack ×3, authzGate, tenancy
channel authority, runtimeAuthz) — plus the earlier 112-test core pass. **§34 mapping: 15/17 negative
classes PINNED by named existing tests** (the full 17-row table with file:test cites is in the fleet
record). **2 PARTIAL/UNPINNED, recorded as the gate's concrete test-gap findings:**
1. **approval-for-different-ACTION at the kernel layer** — the kernel refuses it (`a.action ===
   req.action`) but no in-app pin varies the ACTION there (the importTransition scope pin varies the
   RESOURCE; the boundDecisionClaim pin covers the claim layer, a different mechanism).
2. **secure-bridge IPC timeout** (`withTimeout`, `secureBridge.ts:162-166`) — transport-level
   timeout/lost-response IS pinned (UNKNOWN, never retried, flagship H-J), but no test drives the
   bridge-level timeout path.

## §17 Replay
PINNED and re-run green at every layer: kernel DONE-replay duplicate-suppression (send HOLD-for-
reconciliation; cohort durable-restart no-second-effect; journal B8-07/08), executeEngine single-use
decisionId (incl. restart hydration), executionGate single-use fingerprint, door-level already-posted.

## §18 Concurrency
CONCURRENCY_SCOPE = SINGLE_PROCESS_EVENT_LOOP + unconditional single-instance lock (carried, unchanged).
Concurrent-duplicate pins re-run green (cohort ×4, executeEngine, journal B8-14). No multi-process claim.

## §19 Failure classification
Distinct, no ERROR collapse (B.11 map carried; re-cited at HEAD): policy DENY `AUTHORIZATION_FAILURE` ·
approval HOLD/DENY family · CAS `STALE_RESOURCE` · idempotency three surfaces · **executor-throw ⇒
HOLD `OUTCOME_UNKNOWN` with the durable intent left IN_FLIGHT ⇒ next attempt HOLDs
`RECONCILIATION_REQUIRED`** (NP-CST-38: an exception is NOT a determination that nothing happened) ·
transport lost-response ⇒ UNKNOWN, effect once, NO retry (flagship pin) · verification
DEVIATION/VERIFY_FAILED.

## §20 Verification
Executor-return ≠ effect-verified, enforced structurally: 202 = ACKNOWLEDGED only; terminals only via
the D-16 classifier over independent/authoritative observation (send: reconciler + unique-match oracle;
journal: in-kernel authoritative re-read, provenance honestly named, plus separate-process read-back of
evidence). §30 graph verdicts recorded per path (fleet record): mail.send 7 PROVEN / 2 PARTIAL
(API→EFFECT provider-ack-only — one live S15/S16 instance; EFFECT→OBSERVATION conditional on
corroboration preconditions); journal.post 8 PROVEN / 1 PARTIAL (no ongoing independent oracle);
cohort PROVEN through EXECUTOR→API with **API→EFFECT PARTIAL — no cohort action has ever been
live-run**.

## §21 Evidence
Per-attempt ActionRecord (B.11 §25 ledger re-cited): actor/action/decision/execution/verification
persisted; executor identity carried as `connectorId`/`accountId` naming; purpose/policyVersion/
approval-object/raw-params NOT_PERSISTED (stated). Worker path: claims + durable consumption records +
holds; no parallel ledger created by this gate.

## §22 Recovery
UNKNOWN → HOLD → reconciliation (send) or honest standing UNKNOWN (journal — no reconciler consumer;
door refuses retry). **No auto-retry of any non-idempotent executor exists** (sweep stated; the
adapter's rate-limiter waits BEFORE a single fetch — transport retries never double a write; the
at-most-once effect counters are pinned).

## §23 Known limits
All B.13 §46 limits carried unchanged (corrupt-ledger app-fatal boot · importer posted-row debt ·
comment drift · single-process concurrency scope · package B/D/F not executed · rc.20 provenance ·
notarization/distribution unproven · public-claim quarantine · legal-name conflict). NEW from this gate:
the two unpinned negative classes (§15-16 above) · the Boundary-B semantic-not-cryptographic bound ·
the sandbox-agent residual (an authorized `sandbox:manage` holder — including the S4 AI QA agent under
that authority — can drive UI selectors against an isolated instance of the app's own binary; governed
at the effect layer, capability-only at the automation layer; no pin asserts the sandbox-agent-confirm
case) · params-immutability pinned only indirectly.

## §24 Maturity
Executor-governance model **B/C (architectural + implemented)** · executor governance (kernel routes)
**D/E (tested, and for journal.post runtime/packaged-verified via B.10/B.13)** · worker-path governance
**D (tested: claim/consumption/Boundary-B pins green)** · production authorization **F = NO** (nothing
this gate authorizes execution). System maturities unchanged: module E4 · composition E3 · runtime E3 ·
artifact E3 · packaged runtime E3 · production acceptance E3 · distribution E0.

## §25 Verdict
**`EXECUTOR_GOVERNANCE_MEASUREMENT_COMPLETE`** — the seam is sufficiently measured; no execution was
authorized or performed. The central correction: **the standing "B1/B2 executor-governance FG envelope
owed" register item rested on a stale premise** — no ungoverned worker-path bypass exists at HEAD
(closed by Boundary B; OPTION D rules the mechanisms intentionally separate). An FG envelope would be
needed only to OVERTURN Option D and unify the mechanisms — a design decision, not a defect fix — and
nothing measured here recommends it.

## §26 Next single action
**A narrowly scoped, non-frozen TEST envelope pinning the two unpinned §34 classes** (kernel
approval-action-mismatch driven in-app; secure-bridge timeout path) — the smallest first broken edge
in the measured matrix.
