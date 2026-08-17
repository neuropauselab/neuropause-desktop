# Phase I-A.3 — NeuroPause OS — First-Customer Pilot Validation Report

**Validate-only gate (READ / EXECUTE / VALIDATE). No commit, no push, no code change.** Source-level facts are
labeled as such; empirical pilot facts this environment cannot produce are labeled NOT-EXECUTED / BLOCKED-ENV —
nothing is upgraded from source evidence to a live-pilot claim. Labels: `[PROVEN]` `[PROVEN-ABSENT]`
`[VERIFIED-LIVE]` `[NOT-EXECUTED]` `[BLOCKED-ENV]` `[OPEN]` `[REQUIRED]` `[NOT-CLAIMED]`.

## 1. Exact baseline commit `[PROVEN]`
**`634c9b7`** (parent `ffa2863`), branch `cert/data-import-cst-integration`, working tree clean of code changes.
Chain: `90527b4 → dc9e8f3 → 8846371 → cc184d0 → d2c9827 → ffa2863 → 634c9b7`. Certification impact of the Wave-1
commit: **NONE** (additive Increment-2A seam only; §24).

### Phase A — baseline reproduction (this gate, fresh) `[PROVEN]`
- **Full main suite: 8520 passed / 3 skipped** (808 files) — includes M365 coverage guard, Cohort-1/2A/2B-i/2B-ii,
  denial-before-effect, Boundary-B enforcement, durable admission + restart, holds, and Wave-1 Inc-1/2A/3.
- **UI suite: 207 passed** (26 files). Typecheck (node+web): clean. Lint (Wave-1 surfaces, `--max-warnings 0`):
  clean. `git diff --check`: clean.

### Phase B — product inventory (re-affirmed from prior audits) `[PROVEN]`
The pilot product is the connected `apps/desktop` runtime (real + connected): runtimeCore bootstrap, renderer + IPC,
AI engine (3 real providers + privacy clamp), auth (OAuth/PKCE + keychain), tenant/workspace state, M365 connectors
+ certified governed IPC path, HoldsView + operatorConsole, ~64 tenant-scoped stores, backend (optional). The ~46
other `@neuropause/*` packages are **DISCONNECTED / DEFERRED / TOOLING** and are **NOT** wired in for the pilot (§23).

## 2. Artifact identity `[NOT-EXECUTED / BLOCKED-ENV]`
`electron-vite build` from `634c9b7` compiled to `out/` (exit 0, `[PROVEN]` buildable). **No pilot installer** was
packaged/stamped/signed/notarized. The existing `dist/` artifacts are `rc.20`/`efe8196` — **NOT** `634c9b7` — and
are not used.
## 3. Artifact hash `[NOT-EXECUTED]` — no distributable artifact produced.
## 4. Signature `[BLOCKED-ENV]` — signing credentials unavailable. Not signed; not claimed.
## 5. Notarization `[BLOCKED-ENV]` — notarization credentials unavailable. Not notarized; not claimed.
## 6. Environment `[PROVEN]` — developer working copy (macOS), **not** a clean/disposable VM. Not clean-machine.
## 7. Installation `[NOT-EXECUTED / BLOCKED-ENV]` — no clean install (no installer, no clean env).
## 8. Startup `[NOT-EXECUTED / BLOCKED-ENV]` — no clean-machine first startup.
## 9. Authentication `[NOT-EXECUTED / BLOCKED-ENV]` — no pilot credentials/tenant. Auth code real (source).
## 10. AI `[NOT-EXECUTED live]` / `[PROVEN source]` — engine + 3 providers + privacy clamp real; no live run.
## 11. M365 `[NOT-EXECUTED live]` / `[PROVEN tests]` — governed spine proven in suites; no live pilot tenant.
## 12. Positive workflow `[NOT-EXECUTED live]` — ACKNOWLEDGED-not-VERIFIED honesty proven in tests.
## 13. Denial `[PROVEN tests]` / `[NOT-EXECUTED live]` — `effectCalls===0 ∧ action.run===0` green in the suite.
## 14. UNKNOWN `[PROVEN tests]` / `[NOT-EXECUTED live]` — authoritative UNKNOWN→hold, deduped (Inc-2A 9/9).
## 15. HOLD `[PROVEN tests]` — durable, tenant-scoped, existing HoldStore reused.
## 16. Reconciliation `[PROVEN tests]` / `[NOT-EXECUTED live]` — resolution records disposition, executes nothing.
## 17. Restart `[PROVEN single-process tests]` / `[NOT-EXECUTED live]` — cross-process/power-loss NOT-CLAIMED.
## 18. Evidence `[PROVEN tests]` — Inc-3 timeline: ordered, effect always NOT_VERIFIED, gaps said (13/13).
## 19. Security `[PROVEN tests]` / `[NOT-EXECUTED live]` — renderer ≠ authority; hold-resolution non-executing;
AI ≠ direct effect; tenant/account isolation upstream. No live cross-tenant probing.
## 20. Operator experience `[PROVEN tests]` — the outcome states (APPROVAL_REQUIRED / ACKNOWLEDGED / OUTCOME_UNKNOWN
/ EXECUTION_FAILED / HELD / DENIED / RESOLVED) + evidence timeline render honestly; never implies VERIFIED_SUCCESS.
## 21. Five-user acceptance `[NOT-EXECUTED / BLOCKED-ENV]` — **0 / 5** (no artifact, no clean env, no real users).
See `PHASE-I-A3-NEUROPAUSE-OS-FIVE-USER-INTERNAL-ACCEPTANCE.md`. **Not claimed.**

## 22. Failures classification `[PROVEN]`
No CODE / TEST failures. All non-executed items classify as **ENVIRONMENT_FAILURE / CREDENTIAL_FAILURE /
PACKAGING_FAILURE (environment-blocked)** — not code, test, or product defects. No frozen-surface problem was
encountered or touched.

## 23. Blockers (environment, not code) `[BLOCKED-ENV]`
signing credentials · notarization credentials · disposable clean machine · pilot M365 tenant/account · five real
internal users. None is a product/code blocker.

## 24. Certification impact `[PROVEN]` — **NONE**
The commit touched only `connectors/index.ts` (+68) + `runtimeCore.ts` (+9), additive (the Increment-2A seam); no
CST/governedAction/m365-actions/executor/actionSdk/durableIdempotencyStore/sendTransition/ExecuteEngine/
ExecutionStore/boundaryB/worker/storeScope/shared/package/Node change; no cohort membership change (coverage guard
green). M365 IPC 29/29 stays CERTIFIED; worker/CST parity NOT PROVEN.

## 25. Non-claims `[NOT-CLAIMED]`
worker/CST equivalence · universal M365 governance · Azure/infra or automation consequential governance ·
cross-process durability · power-loss/fsync durability · provider idempotency/reversibility · external-effect /
verification success · universal NeuroPause governance · signed/notarized pilot artifact · clean-machine or
five-user validation. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ PILOT-VALIDATED ≠ UNIVERSAL; UNKNOWN ≠ SUCCESS ≠
FAILURE; ACKNOWLEDGED ≠ VERIFIED_SUCCESS.**

## Pilot scope declaration (PROPOSED / REQUIRED before live use) `[REQUIRED]`
No runtime allow-list exists (documentation-level control). **IN SCOPE:** the certified M365 IPC governed write path;
a declared bounded workflow set; one declared tenant + bounded account(s); five named internal users; the bounded
operator procedures (manual reconciliation, controlled single-process restart, no blind retry). **OUT OF SCOPE:**
worker/CST equivalence; Azure/infra + automation consequential governance; universal M365/NeuroPause governance;
cross-process/power-loss durability; provider idempotency; universal verification.

## Pilot acceptance matrix (commit `634c9b7`)
| ID | Input | Expected | Observed | Evidence | Status |
|---|---|---|---|---|---|
| A1 Artifact provenance | build 634c9b7 | stamped installer = 634c9b7 | compiled `out/` only | build exit 0 | **BLOCKED-ENV** |
| A2 Signature | sign | signed | — | — | **BLOCKED-ENV** |
| A3 Notarization | notarize | notarized | — | — | **BLOCKED-ENV** |
| A4 Clean installation | install on clean VM | app present, version=634c9b7 | — | — | **NOT-EXECUTED** |
| A5 Startup | launch | starting→ready | — | — | **NOT-EXECUTED** |
| A6 Authentication | login | token in keychain | — | — | **BLOCKED-ENV** |
| A7 AI workflow | request | proposal, no direct effect | — | source real | **NOT-EXECUTED** live |
| A8 M365 connector | connect | tenant/account bound | — | — | **BLOCKED-ENV** |
| A9 Positive governed action | send | ACKNOWLEDGED (not verified) | — | tests | **NOT-EXECUTED** live |
| A10 Denial | unauthorized | DENY, effect=0 ∧ run=0 | green | governedAction suites | **PASS (tests)** / NOT-EXECUTED live |
| A11 UNKNOWN | net uncertainty | OUTCOME_UNKNOWN | green | Inc-2A 9/9 | **PASS (tests)** / NOT-EXECUTED live |
| A12 HOLD creation | UNKNOWN | one deduped tenant hold | green | Inc-2A | **PASS (tests)** / NOT-EXECUTED live |
| A13 Reconciliation | resolve | records, executes nothing | green | Inc-3 | **PASS (tests)** / NOT-EXECUTED live |
| A14 Restart | restart | no dup effect, hold persists | green (single-proc) | durable/Inc tests | **PASS (tests)** / NOT-EXECUTED live |
| A15 Evidence | inspect | ordered, NOT_VERIFIED effect | green | Inc-3 13/13 | **PASS (tests)** / NOT-EXECUTED live |
| A16 Security | boundary | renderer ≠ authority | green | tests | **PASS (tests)** / NOT-EXECUTED live |
| A17 Operator visibility | UI | honest states, no fake success | green | Inc-1/3 | **PASS (tests)** / NOT-EXECUTED live |
| A18 Tenant/account isolation | cross-tenant | denied/empty | green (upstream) | hold/P12 tests | **PASS (tests)** / NOT-EXECUTED live |
| A19 Five-user completion | 5 users | 5/5 complete | 0/5 | — | **NOT-EXECUTED** |
No row is upgraded from tests to live. A1-A6, A8, A19 are BLOCKED-ENV / NOT-EXECUTED; A10-A18 pass **in tests** only.

## 26. Final pilot decision — **C. BLOCKED BY ENVIRONMENT**
The repository at `634c9b7` is engineering-ready: full regression green, builds from the exact commit, no
certification impact, all pilot-critical behaviors (honest outcomes, UNKNOWN→hold, reconciliation, evidence timeline,
denial-before-effect, security boundaries) proven **in tests**. But first-customer pilot validation requires
empirical evidence this environment cannot produce — a signed+notarized artifact, a clean machine, a live M365 pilot
tenant, and five real users. Those are **BLOCKED BY ENVIRONMENT**, not by a code or product defect. Therefore the
decision is **C. BLOCKED BY ENVIRONMENT** — not PILOT-READY (source/test green is explicitly insufficient), and not
BLOCKED BY PRODUCT (no product workflow was shown to fail; none could be executed live).

## Next gate (on a real pilot environment) `[REQUIRED]`
Package `package:mac`/`package:win` from `634c9b7` → sign → notarize → `verify:release` (record hash+provenance) →
clean install → startup → auth to a declared pilot M365 tenant → drive the bounded workflows (positive / denial /
UNKNOWN→hold→reconcile) + restart → run the five-user acceptance → fill this matrix with executed evidence → then
re-evaluate the decision (A / B / D / E). Frozen deferred items (worker UNKNOWN; ExecutionStore fail-closed) remain
separately gated.

## Final state
No commit, no push, no code change this gate. HEAD `634c9b7`. Two new untracked reports (this + the five-user doc
from the prior gate). Empirical pilot evidence honestly recorded as NOT-EXECUTED / BLOCKED-ENV — none fabricated.
