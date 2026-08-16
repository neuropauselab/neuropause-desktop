# Phase I-A.3 — M365 IPC Restart-Durability Design Investigation (READ-ONLY)

Cohort-1 governed-action path. **No production/test/frozen-surface change, no commit, no push.**
Baseline HEAD `90527b4`, branch `cert/data-import-cst-integration`. Labels: `[PROVEN]`/`[INFERRED]`/
`[DESIGN]`/`[OPEN]`/`[NOT PROVEN]`.

## 1. Repository state `[PROVEN]`
HEAD `90527b4` (`cert(m365): close H-FINDING-4 cohort-1 governed actions`); working tree CLEAN.
Matches the certification checkpoint.

## 2. Scope
Whether the Cohort-1 M365 IPC governed-action path can obtain **restart-durable single-use
admission/idempotency** within the declared Node-20 runtime and frozen-surface constraints, without a
new authority model or weakened semantics. **Read-only** — no implementation.

## 3. Certification question
"Can NeuroPause OS currently certify restart-durable single-use admission for the Cohort-1 M365 IPC
governed-action path?" **Answer: NO — OPEN; specifically DESIGN-READY BUT IMPLEMENTATION REQUIRES A
SEPARATE GATE** (see §18).

## 4. Current Cohort-1 persistence architecture `[PROVEN]`
`connectors/index.ts` builds `m365ActionPorts = createGovernedActionPorts()` → `governedAction.ts`
`createGovernedActionPorts()` returns `{ claims: new ClaimStore(), idempotency: new IdempotencyStore() }`
— the CST **in-memory** stores (`@neuropause/cst/dist/src/stores.js`). The kernel receives these ports;
`reconcile → { known:false }` (Profile A). So admission/idempotency are **process-lifetime only**: on
restart the maps are empty and prior admissions are forgotten.

## 5. CST durability architecture `[PROVEN]`
- **Kernel** (`node_modules/@neuropause/cst/src/kernel.ts`): the restart-safe *control flow* already
  exists and is store-agnostic — `claims.claimAtomic` (NP-NC-07 single-winner), `idempotency.acquire`
  → `fresh|IN_FLIGHT|DONE` (NP-NC-08), preflight reconcile (NP-NC-16), IN_FLIGHT→reconcile→HOLD (never
  re-execute, NP-NC-13), fencing tokens, denial-before-effect. The kernel's assurance LEVEL is set by
  the injected stores + reconciler.
- **In-memory stores** (`stores.js` `ClaimStore`/`IdempotencyStore`): in-process atomic claim +
  process-lifetime intents. Not durable.
- **DurableStore** (`durable.ts`): SQLite-backed — `claims` PRIMARY KEY (single-winner at the storage
  engine), `intents` written before the effect that OUTLIVE the process, `tokens` (fencing),
  `takeoverIfExpired` (lease), WAL. Adapters `DurableClaimStore`/`DurableIdempotencyStore` satisfy the
  kernel's port shapes. **It provides genuine restart-durable single-process (and cross-process for a
  shared file) durability — but only where `node:sqlite` runs.**

## 6. Runtime / Node constraints `[PROVEN]`
- `package.json` engines: `node >=20.11.0`; `apps/desktop` electron `42.8.1`.
- **`CST-1.3.0-DEFECTS-FOUND.md` D-CST-B [PROVEN]:** the CST barrel re-exports `durable.js`, which does
  `import { DatabaseSync } from 'node:sqlite'`; `node:sqlite` is experimental **only in Node ≥22**, so
  importing it throws `ERR_UNKNOWN_BUILTIN_MODULE` on **Node 20 (this host; the Desktop toolchain)**.
  D-CST-A: `package.json main` points at a non-existent `dist/index.js` (barrel broken anyway).
- `importTransition.ts:11-16` and `governedAction.ts:27` **declare** the in-memory choice: submodules
  are imported to avoid `durable.js`/`node:sqlite`, "a declared, single-process durability gap
  (source O-6)."
- **No `node:sqlite`/`DatabaseSync`/`DurableStore` is used anywhere in app source** (only two comment
  references). `[PROVEN]`
**Conclusion:** under the DECLARED Node-20 floor (and the Node-20 test/toolchain host), `node:sqlite`
is **unavailable** and the CST DurableStore is **not loadable**. `[PROVEN]`

## 7. Existing NeuroPause durable mechanisms `[PROVEN]`
- **`ExecutionStore`** (`executionStore.ts:192-197`): race-safe atomic write — temp file
  (`${path}.${pid}.${rand}.tmp`) → `fs.writeFile(mode 0o600)` → `fs.rename(tmp, path)`. Node-20-safe,
  no `node:sqlite`. Has restart hydration (`loadAllSync` + `recoverInterrupted`) elsewhere in the repo.
  Durable for **process restart**; **no `fsync`** ⇒ a hard-power-loss window (declared). Worker-scoped
  (couples to `ExecutionSession`); pattern is `HealthHistoryStore`'s.
- This proves a **Node-20-compatible durable persistence primitive exists in-repo** — but as a
  *pattern*, not as a drop-in CST `ClaimStorePort`/`IdempotencyStorePort`.

## 8. Crash / restart semantics (per case) — current vs achievable
| Case | Current (in-memory) | With a durable CST store (design) |
|---|---|---|
| 1 Process lifetime | `[PROVEN]` | `[PROVEN]` |
| 2 Process restart | `[OPEN]` (state lost) | `[DESIGN]` (durable intents/claims) |
| 3 Concurrent duplicate | `[PROVEN]` in-process (atomicClaim) | `[DESIGN]` must preserve in-process atomicity |
| 4 Crash before effect | `[OPEN]` | `[DESIGN]` (IN_FLIGHT persisted before effect) |
| 5 Crash after admission, before effect | `[OPEN]` | `[DESIGN]` → reconcile→HOLD |
| 6 Crash during effect | `[OPEN]` (lost) | `[DESIGN]` IN_FLIGHT→reconcile, never re-execute |
| 7 Crash after effect, before result | `[OPEN]` | `[DESIGN]` IN_FLIGHT→HOLD (Profile A) |
| 8 Lease takeover | `[NOT PROVEN]` (in-mem ClaimStore has no lease) | `[DESIGN]` (needs `takeoverIfExpired`-equivalent) |
| 9 Reconciliation | `[PROVEN]` `{known:false}`→HOLD | `[PROVEN]` preserved (Profile A) |
| 10 Replay after restart | `[OPEN]` | `[DESIGN]` |
| 11 Multiple processes/instances | `[NOT PROVEN]` | `[NOT PROVEN]` under Node-20 (fs.rename is not cross-process check-reserve atomic; SQLite PRIMARY KEY would give it, but `node:sqlite` is unavailable) |
| 12 Power loss | `[NOT CLAIMED]` | `[NOT CLAIMED]` (no `fsync` in the ExecutionStore pattern) |
| 13 Corrupted/incomplete persistence | n/a | `[DESIGN]` (needs recovery/validation, cf. `recoverInterrupted`) |
| 14 Schema/version migration | n/a | `[DESIGN]` (new store schema) |

## 9. Concurrency semantics `[PROVEN]`/`[NOT PROVEN]`
In a single Electron main process, the CST `claimAtomic` is a synchronous single-winner (in-process,
no `await` before the claim) — PROVEN by the Cohort-1 concurrency test. Cross-process single-winner is
NOT PROVEN under Node-20 (would need SQLite PRIMARY KEY or an OS lock). Electron desktop is
single-main-process, so single-process is the operative scope (same as the worker `ExecutionStore`).

## 10. Reconciliation semantics `[PROVEN]`
Profile A: `reconcile → {known:false}`. On an IN_FLIGHT replay the kernel HOLDs (RECONCILIATION_REQUIRED)
and NEVER re-executes — safe under any store. Durable intents make this survive restart; the reconciler
itself stays `{known:false}` (no external oracle), which is honest and preserved.

## 11. Option A — use CST DurableStore `[OPEN / NOT IMPLEMENTABLE under current constraints]`
Feasibility: **blocked.** `node:sqlite` (Node ≥22) is unavailable on the declared Node-20 host (D-CST-B,
`[PROVEN]`); the barrel is also broken (D-CST-A). Wiring it would require a Node upgrade (forbidden) or a
Node-version-conditional import that still fails under Node-20 tests. Semantic compatibility would be
high (it satisfies the ports), but it cannot load. Frozen surfaces: would touch `governedAction.ts`/
`connectors/index.ts` (ports) — and depends on a runtime capability not established. **Rejected under
current constraints.**

## 12. Option B — adapt ExecutionStore directly `[OPEN]`
`ExecutionStore` is durable + Node-20-safe, but it is worker-scoped and typed to `ExecutionSession`; it
does NOT implement the CST `ClaimStorePort`/`IdempotencyStorePort` (`claimAtomic`, `acquire`/`complete`/
`release`). Reusing it directly = cross-domain coupling + a semantic mismatch. Not a drop-in. What is
reusable is its **atomic-rename durability PATTERN**, not the store itself.

## 13. Option C — new Node-20-compatible durable CST store `[DESIGN]`
A NEW store implementing `ClaimStorePort` + `IdempotencyStorePort` with `ExecutionStore`-style atomic
`fs.rename` durability + restart hydration + a lease-takeover equivalent. Feasibility: **DESIGN-feasible**
for **single-process** restart-durable single-use (durable intents written before the effect; hydrate on
boot; the kernel's IN_FLIGHT→reconcile→HOLD then holds across restart). Concurrency: preserve in-process
atomicity (in-memory index over the durable file). Crash: durable IN_FLIGHT ⇒ restart HOLDs, never
re-executes. NOT covered: cross-process single-winner (fs limitation) and power loss (no `fsync`).
Implementation surface: a **new store file** + wiring in `governedAction.ts`/`connectors/index.ts`.
**Requires a new store ⇒ forbidden in this read-only gate ⇒ a separate implementation gate.** The CST
kernel needs NO change (port contract already supports it); Node/`package.json`/`contracts.ts` unchanged.

## 14. Option D — declare restart durability out of scope `[PROVEN — current state]`
The committed Cohort-1 state: process-lifetime idempotency PROVEN; restart durability explicitly OPEN
and NOT CLAIMED. Honest, zero new surface. This is the correct posture UNTIL Option C is authorized.

## 15. Frozen-surface impact `[DESIGN]`
A future implementation (Option C) would touch: `governedAction.ts` (wire durable ports),
`connectors/index.ts` (ports creation), and a **new store file** (not frozen). It would NOT touch: the
CST kernel, `sendTransition.ts`/`mail.ts`/`m365 executor`/`actionSdk.ts`, worker surfaces, `runtimeCore`,
`contracts.ts`, `package.json`, or the Node engine. In THIS gate: **nothing touched.**

## 16. Authority / decision / identity implications `[PROVEN]`
Durability changes only the STORE. It does NOT change authority (actor/tenant), the canonical
consequential-action identity, the CST decision/idempotency identities, ownership/scope/token checks, the
direct-action IPC model, `mail.send`, or worker Boundary-B. No new authority or decision contract is
required — the durable store persists the SAME transition identity the in-memory store holds today.

## 17. Migration implications `[DESIGN]`
A new durable store starts empty (no historical admissions to migrate). Schema versioning + corrupt-file
recovery (cf. `recoverInterrupted`) would be part of the new store. No change to existing persisted data;
additive.

## 18. Certification impact `[OPEN]`
Restart-durable single-use for Cohort-1 IPC is **NOT certifiable today**: the only loadable stores are
in-memory (process-lifetime), and the durable CST store depends on `node:sqlite`/Node ≥22 not established
in the declared Node-20 environment (`[PROVEN]` D-CST-B). It is **DESIGN-READY** via Option C (a
Node-20-compatible fs-durable CST store, single-process scope), which requires a **separate implementation
gate** (new store; forbidden here). The current committed certification (process-lifetime) is unaffected.

## 19. Recommended next gate `[DESIGN]`
A **separately-authorized implementation gate** for **Option C**: a Node-20-compatible durable CST
claim/idempotency store (atomic `fs.rename` pattern), wired into the governed-action ports, scoped to
**single-process restart durability**, with restart hydration + lease takeover; explicitly excluding
cross-process single-winner and power-loss durability. The kernel and Node runtime remain untouched. (The
remaining 15 M365 write actions are a separate, independent cohort gate.)

## 20. Explicit non-claims
NOT claimed: restart-durable IPC single-use (OPEN) · power-loss durability · cross-process/multi-instance
single-winner · that CST DurableStore is usable under Node-20 (it is not) · provider idempotency · effect
success · verification success · renderer exclusion · worker/IPC mechanism equivalence · universal
governance · universal certification. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ UNIVERSAL.**

## Permitted claim
> "The Cohort-1 M365 IPC governed-action path demonstrates atomic process-lifetime admission/idempotency,
> while restart-durable single-use remains OPEN because the currently wired CST stores are in-memory and
> the available durable CST implementation depends on `node:sqlite` (Node ≥22) not established in the
> declared Node-20 production environment. A Node-20-compatible durable store (Option C, patterned on the
> repository's atomic-rename ExecutionStore) is design-feasible for single-process restart durability but
> requires a separately-authorized implementation gate; cross-process and power-loss durability remain
> outside any demonstrated scope."

## STOP
Read-only investigation complete. No code, no tests, no commit, no push, no frozen surface changed.
