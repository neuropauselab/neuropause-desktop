# Phase I-A.3 Step 5 — Durable Consumption Schema Design

## 1. Status
**READ-ONLY DESIGN. No code, no commit, no push.** Baseline HEAD `fafafc7`. Tags
`[PROVEN]`/`[INFERRED]`/`[DESIGN]`/`[OPEN]`. **CLAIM ≠ AUTHORITY** — the durable record
proves *"this decision was admitted to this execution,"* never *"this claim grants
authority."* **Final decision: READY FOR IMPLEMENTATION (Option B) — pending the frozen-
surface authorization gate.**

## 2. Source-grounded problem
The persisted `ExecutionSession` carries no `decisionId`/`nonce`/`bindingDigest`
(`executeEngine.ts:80-102`); the persist is **fire-and-forget** (`:111`, not awaited before
`await executor` `:130`); `interrupted-not-rerun` ≠ claim single-use. No durable fact proves
consumption. `[PROVEN]`

## 3. Current execution persistence `[PROVEN]`
`ExecutionStore.save(session)` (`executionStore.ts:116`) = whole-array upsert-by-id + prune
+ `persist()`. `persist()` (`:186`) serializes on a `writeChain` → `writeNow()` (`:192`) =
temp write + **atomic `fs.rename`** (`:196-198`). **No `fsync`.** **No atomic
insert-if-absent / conditional-by-key operation exists.** `loadAllSync()` (`:102`) loads all
on boot.

## 4. Decision identity `[PROVEN]`+`[INFERRED]`
`decisionId = proposal.verdict.requestId` (= governance `req.id`, `governance/index.ts:46`).
Authoritative (governance), immutable on the proposal, unique per governance evaluation
`[INFERRED]`. The claim already carries it (Step 2).

## 5. Execution identity `[PROVEN]`
`ExecutionSession.id = exec_${now}_${seq++}` (`executeEngine.ts:79`) — per-execution,
durable, unique within a run (`seq` in-memory, resets on restart). A replay ⇒ new id.

## 6. Claim identity `[PROVEN]`
Claim = `{decisionId, nonce, bindingDigest, issuedAt, expiresAt}` (Step 1). Carried
in-process on `req.params.claim` (Step 3), never serialized to the renderer.

## 7. Binding identity `[PROVEN]`
The binding is **not persisted** today (session omits `params`). `bindingDigest` =
`sha256(canonicalize(8-field binding))` (Step 1).

## 8. Minimum durable fields (evaluated individually)
| Field | Purpose | Source | Unique | After restart? | For concurrency? | Redundant? | Verdict |
|---|---|---|---|---|---|---|---|
| `decisionId` | single-use key | `verdict.requestId` | yes | **required** | **required** | no | **PERSIST** |
| `bindingDigest` | binding integrity across restart / detect `decisionId`+different-binding | claim | per binding | **required** | no (key is decisionId) | no | **PERSIST** |
| `claimNonce` | audit / claim-instance | claim | per mint | optional | no | partly (decisionId is the key) | **PERSIST (audit; optional to the invariant)** |
Minimum for the **invariant**: `decisionId` + `bindingDigest`. `claimNonce` is stored for
audit/traceability but is not the uniqueness key.

## 9. Uniqueness invariant `[DESIGN]`+`[INFERRED]`
**Uniqueness key = `decisionId`.** Compared: `decisionId` (chosen); `decisionId+bindingDigest`
(would wrongly allow the *same* decision to re-execute with a different binding — a decision
authorizes exactly one binding, so this is not wanted); `decisionId+nonce` (would allow a
second claim for the same decision — not wanted). **Q3:** a `JobProposal` has one `verdict`
and one `execution` binding, so **one decision ⇒ one binding ⇒ at most one consequential
execution** `[INFERRED]` — `decisionId` alone is the sufficient single-use key. **Q4:**
`bindingDigest` is required for **binding validation/integrity** (and to catch a `decisionId`
presented with a different binding), **not** as part of the replay-uniqueness key.

## 10. Atomicity model `[PROVEN]`(no store primitive) + `[DESIGN]`
**`ExecutionStore` has NO atomic reserve** (§3) — `save` is a whole-file upsert; a durable
check-then-write is **not** atomic. Therefore atomicity comes from the **single-threaded
synchronous prefix** of `ExecuteEngine.execute` (`:108-130`, up to the first `await`):
```
if req.params.claim:
   D = claim.decisionId
   if consumedSet.has(D):  DENY            // check
   consumedSet.add(D)                       // reserve  (no await between check & reserve ⇒ atomic in-process)
session = { …, decisionId:D, bindingDigest, claimNonce }
this.sessions.set(id, session)
await persist(session)                      // durable BEFORE the effect
await executor(req)
```
`consumedSet` is seeded on boot from persisted `decisionId`s. This prevents
`A:check → B:check → A:consume → B:consume`. `[DESIGN]`

## 11. Persistence ordering `[PROVEN]`+`[DESIGN]`
Distinguish **requested** (call `persist`) from **committed** (the awaited `fs.rename`).
Today persist is fire-and-forget ⇒ the record may not be committed before the effect. The
design **awaits `persist()` before `await executor`** so the atomic rename completes first,
making the `decisionId` durable for a **process restart** before the effect. **Residual
`[OPEN]`:** no `fsync`, so a hard power-loss between rename and OS flush is an uncovered
window (closable with `fsync` — a further, separate change). **Cost `[PROVEN]`:** `save`
rewrites the whole file, so awaited-per-effect persistence adds latency + write
amplification — an accepted tradeoff for durable single-use.

## 12. Claim lifecycle `[DESIGN]`
`UNCONSUMED → CONSUMED`. **CONSUMED ⟺ a persisted (committed) session bears `decisionId=D`.**
CONSUMED **never** means "effect occurred."

## 13. Execution lifecycle `[PROVEN]`
Existing `ExecutionState`: `NOT_STARTED/queued → running → {completed|failed|interrupted|cancelled}`.
Orthogonal to the claim lifecycle: a session may be `interrupted` (outcome UNKNOWN) yet
CONSUMED (admitted). No enum merge.

## 14. Crash-before-effect (before durable admission) `[DESIGN]`
Crash before the awaited `persist` commits ⇒ **no durable `decisionId`** ⇒ on restart the
claim is **not** recorded consumed. The in-memory reserve is also gone. A resubmission would
be treated as first admission. Safe (no effect occurred, no record) — but note: the
*window* is bounded by the awaited rename (§11).

## 15. Crash-after-admission, before effect `[DESIGN]`
Persist committed (`decisionId=D` durable); crash; effect did **not** occur. Restart:
`D ∈ consumedSet` ⇒ replay **DENIED**. **Chosen semantics: CONSUMED is permanent; a genuine
retry requires a NEW governance decision (new `requestId`).** Fail-safe: favours
no-duplicate over auto-retry; preserves `consumption ≠ effect success`. (Availability cost
accepted.)

## 16. Crash-after-effect, before result `[DESIGN]`
Persist committed; effect occurred; crash before `finish`. Restart: session `interrupted`
(outcome **UNKNOWN**, H-J), `D ∈ consumedSet` ⇒ replay **DENIED** (no blind duplicate).
Whether the external effect occurred is a separate UNKNOWN fact; reconciliation is future
work (not invented). No provider idempotency assumed (`mail.send` non-idempotent).

## 17. Concurrent replay `[DESIGN]`
Two same-claim submissions: the first prefix reserves `D` (synchronous, §10); the second
sees `D ∈ consumedSet` ⇒ DENY. Winner = first synchronous reserve; loser = governance
refusal, no effect. Uniqueness key `D`; conflict = in-memory set; durability = §11.

## 18. Cross-restart replay `[DESIGN]`
Process 2 boot → `loadAllSync` seeds `consumedSet` from persisted `decisionId`s. Replay of
`N`/`D` ⇒ `D ∈ consumedSet` ⇒ **DENY**. Durable source = persisted sessions; **no in-memory-
only registry is the authority.**

## 19. Historical compatibility `[PROVEN]`+`[DESIGN]`
New fields **optional**, mirroring `ExecutionSession.tenantId?` (`:80-84`, "absent =
legacy/unresolved"). Legacy sessions have no `decisionId` ⇒ contribute nothing to
`consumedSet`. **No back-fill, no migration infrastructure.**

## 20. Frozen-surface impact
| File | Change | Class |
|---|---|---|
| `packages/shared/.../executeEngine.ts` (`ExecutionSession`) | +3 optional fields | **FROZEN — REQUIRES EXPLICIT AUTHORIZATION** |
| `apps/desktop/src/main/executeEngine.ts` | consumedSet check/reserve, stamp fields, **await persist** | **FROZEN — REQUIRES EXPLICIT AUTHORIZATION** |
| `apps/desktop/src/main/executionStore.ts` | none required (whole-session persisted; `loadAllSync` exists); optional later: `fsync` for power-loss | reused (UNCHANGED for v1) |
| `apps/desktop/src/main/runtimeCore.ts` (`runBinding`) | Boundary-B claim verify | **FROZEN — Step-4 gate** |
| `workforce/execution/workforceActionExecutor.ts` | forward `req.params.claim` | NON-FROZEN |
| `workforce/index.ts` / `router.ts` | mint + attach claim | NON-FROZEN |
| `packages/shared/.../contracts.ts` (`ExecuteRunRequest`) | **none** (`.strict()`, renderer-excluded) | UNCHANGED |

## 21. Migration
None. Optional fields; absent ⇒ legacy/non-governed. `loadAllSync` parses old files
unchanged. `[PROVEN]` the optional-field pattern is established.

## 22. Test design (DESIGN — expected results)
1 first admission → **ALLOW/consumed** · 2 duplicate → **DENY** · 3 same `decisionId`+diff
binding → **DENY (binding)** · 4 diff decision+valid binding → **ALLOW** · 5 concurrent
duplicate → **exactly one ALLOW** · 6 crash-before-admission → resubmission = first admission
(no record) · 7 crash-after-admission → **DENY** on replay (consumed, no effect; retry=new
decision) · 8 crash-after-effect/lost → **DENY** on replay (UNKNOWN, no blind duplicate) · 9
restart → consumed claim **DENY** · 10 legacy session (no claim) → non-governed, unaffected ·
11 non-governed exec → unaffected · 12 expired → **DENY** · 13 binding mismatch → **DENY** ·
14 tenant mismatch → **DENY** · 15 actor mismatch → **DENY** · 16 same decision+diff nonce →
**DENY** (decisionId key) · 17 diff decision+same binding → **ALLOW**.

## 23. Security properties
No valid/invalid/mismatched/expired/consumed claim ⇒ no consequential effect (at Boundary
B/engine); concurrent duplicate ⇒ ≤1 admission; cross-restart replay ⇒ DENY from durable
state. In-process by-reference preserved. Claim = evidence, not authority.

## 24. Non-properties
No cryptographic unforgeability vs a compromised local process; no power-loss durability
without `fsync` (residual); no proof the external effect occurred (UNKNOWN/reconciliation);
no provider idempotency; no cross-process transport; no policy-version provenance;
consumption ≠ effect success ≠ verification; UNKNOWN never silently → SUCCESS/retry.

## 25. Certification impact
**NO PASS** here. Once implemented + Tests 1-17 pass, the invariant *"a claim admits at most
one consequential execution for its decision, provable across concurrency/crash(process)/
restart"* is supported — with the declared power-loss/fsync residual. Until then, durable
single-use / cross-restart replay safety = **NOT PROVEN**; H-FINDING-3 OPEN.

## 26. Implementation prerequisites
1. **Authorize** the frozen changes (`ExecutionSession` +3 optional fields; `ExecuteEngine`
   consumedSet check/reserve + stamp + **await persist**). 2. Confirm `decisionId` as the
   single-use key. 3. Confirm CONSUMED-is-permanent (retry = new decision). 4. Confirm the
   power-loss/`fsync` residual is deferred. 5. Boundary-B verify = Step 4 (own gate). 6.
   Transport attach = non-frozen workforce change.

## 27. Recommended implementation sequence
(a) Transport attach `req.params.claim` (non-frozen) → (b) **Option-B durable schema +
engine check/reserve/await-persist/stamp** (frozen gate — this design) → (c) Boundary-B
verify at `runBinding` (Step 4, frozen gate) → (d) Tests 1-17 → (e) H-FINDING-3
reassessment. Each an authorized gate.

## 28. Final decision
**READY FOR IMPLEMENTATION — Option B**, minimal scope: `ExecutionSession` += optional
`decisionId`/`bindingDigest`/`claimNonce`; `ExecuteEngine.execute` gains an in-memory
`consumedSet` (seeded from persisted `decisionId`s), a synchronous check-then-reserve for
claim-bearing requests, field stamping, and an **awaited persist before the executor**;
`ExecutionStore` reused unchanged. **All within FROZEN surfaces → requires the explicit
authorization gate before code.** Residual (deferred): `fsync` for power-loss durability.
Not implemented in this gate.

---

## Final report
- **HEAD:** `fafafc7` · **Working tree:** clean except this + the prior investigation (uncommitted) · **Production files changed:** 0 · **Test files changed:** 0
- **Decision identity:** `decisionId = verdict.requestId`
- **Execution identity:** `ExecutionSession.id`
- **Claim identity:** `{decisionId, nonce, bindingDigest, issuedAt, expiresAt}` (in-process `req.params.claim`)
- **Binding identity:** `bindingDigest = sha256(canonicalize(8-field binding))`; binding not persisted today
- **Minimum durable fields:** `decisionId` + `bindingDigest` (+ `claimNonce` audit)
- **Uniqueness key:** `decisionId` (one decision ⇒ one binding ⇒ ≤1 execution)
- **Atomicity mechanism:** in-memory synchronous check-then-reserve in `ExecuteEngine`'s pre-`await` prefix (**no** atomic op in `ExecutionStore`)
- **Persistence ordering:** **await `persist()`** (atomic `fs.rename`) before the effect; today fire-and-forget; no `fsync` (residual)
- **Crash semantics:** before-admission → not consumed; after-admission → consumed permanent (retry = new decision); after-effect → consumed, UNKNOWN, no duplicate
- **Restart semantics:** boot seeds `consumedSet` from persisted `decisionId`s → replay DENY
- **Concurrency semantics:** synchronous reserve ⇒ exactly one admitted
- **Migration:** none (optional fields; legacy absent = non-governed)
- **Frozen surfaces:** `ExecutionSession` type + `executeEngine.ts` (this gate); `runBinding` (Step 4) — all require explicit authorization
- **Classification:** **OPTION B — READY FOR IMPLEMENTATION** (pending authorization)
- **H-FINDING-3:** OPEN
- **Permitted certification claim:** none yet — design only; no durable-single-use PASS
- **Non-claims:** cross-restart/power-loss durability, effect success, provider idempotency, universal governance
- **Next gate:** authorize the Option-B frozen changes (with Tests 1-17), before/with Step-4 Boundary-B enforcement
