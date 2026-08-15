# PHASE B — CST INTEGRATION DESIGN (Data IMPORT · `dp:import`)

**Direction:** frozen `@neuropause/cst 1.3.0` (SOURCE) → NeuroPause Desktop (TARGET).
**Scope:** ONE action, ONE adapter boundary, ONE authoritative governance verdict.
The existing `applyImportPlan` effect is preserved. **No broad refactoring. No
source modification. No second CST implementation.** Design only — no code yet.

Contract = the kernel's `dist/src/*.d.ts` (types, stores, kernel). Extracted
read-only to `/tmp/cst-k`; nothing from `dist/src/**` is copied into Desktop
modules — the package is consumed as a dependency (Stage A).

## 0. The one authoritative boundary (no two verdicts may disagree)

Today the import path has two *kinds* of gate: (a) **transport admission** — the
secure-IPC chain (sender-trust → auth → permission `data:import` → Zod) and
`data:approve` for high-risk tables; and (b) **row/table approval** flags. Neither
is a consequential-transition governance *verdict*.

**Decision:** the **CST kernel verdict is the single authoritative governance
verdict** for the import transition. The others are re-typed so they cannot
silently disagree:
- Transport admission stays as **fail-closed admission control** — it can only
  *refuse to admit* a request; it never independently authorizes execution. If it
  admits, the CST kernel decides. (A refusal short-circuits before CST — no
  disagreement is possible.)
- The per-table `approved` flags + `data:approve` become **inputs** to the single
  CST request (the `Approval` object + `PolicyDecision`), not a competing verdict.

So: exactly one verdict gates the effect — `outcome.verdict`. `HOLD`/`DENY` ⇒ the
effect does not run. `ALLOW` + won claim + revalidation ⇒ it runs once.

## 1. Request mapping — Desktop `DataPlaneImportRequest` → CST `TransitionRequest`

`DataPlaneImportRequest = { planId, approvals[] }` (contracts.ts:2732); the `plan`
(server-side, `plans.get(planId)`) carries per-table rows each with
`action: 'create'|'update'|'skip'`.

| CST field | Source in Desktop | Notes / honesty |
|---|---|---|
| `transitionId` | `dp_<planId>` | stable per plan |
| `requestId` | new per invocation | |
| `actor` | `deps.actor` → `{id, type:'HUMAN'\|'CONNECTOR', tenantId}` | never `AI` here → `modelCannotSelfAuthorize` holds by construction |
| `action` | `'data.import'` | |
| `target` | `{tenantId, resourceType:'dataplane-import', resourceId:planId, version:<destination fingerprint>}` | see §3 `resources` — version model declared honestly |
| `purpose` / `intent` | plan purpose / "bulk import approved tables" | required, non-empty |
| `relationships?` | **omitted → declared NOT a relationship action** in policy | import has no relationship dependency; declaring one would be control-noise (stores.d.ts:143). `relationshipAssessment` reports `NOT_APPLICABLE`, honestly, not `ASSESSED_NONE_FOUND` |
| `expectedPostState` | **declared BEFORE execution**: per approved table, `{created: #create-rows, updated: #update-rows}` from `row.action` (analyzer) minus skips/dupes | real, pre-declared; if uncomputable ⇒ leave undefined ⇒ VERIFY = UNKNOWN (never VERIFIED) |
| `consequence` | `'C3'` | tenant data write, reversible |
| `reversibility` | `'REVERSIBLE'` | `deindex` path exists |
| `policyVersion` | governance/policy version | |
| `idempotencyKey` | `hash(tenantId + planId + normalized(approvals))` | transition-level; row-level `externalKey` dedup remains *inside* the effect |
| `evidence[]` | the plan's source-file evidence refs | |
| `quantities?` | `{ rows: totalApprovedRows }` | bound by `approval.constraints.maxRows` if policy sets a ceiling |
| `approval?` | built from the per-table `approved` + `data:approve` right | binds action+scope+resourceVersion+purpose+expiry (types.d.ts:55) |
| `recoveryOf?` | set only when this import is a governed recovery re-run | keeps recovery governed |

## 2. Stage map (the canonical order, preserved)

```
Desktop dp:import handler
  → [transport admission: fail-closed IPC + data:import/data:approve]   (admit only)
  → build CST TransitionRequest (§1)                                     IDENTIFY/UNDERSTAND
  → kernel.run(req, effect):
       PolicyStore.evaluate → verdict ALLOW/HOLD/DENY                     GOVERN  ← the one verdict
       ClaimStore.claimAtomic(tenant+planId)                             CLAIM (before execute)
       IdempotencyStore.acquire(idempotencyKey)  (intent BEFORE effect)  IDEMPOTENCY
       preStateRevalidation  ← wraps matchAgainstDestination()          REVALIDATE (immediately before)
       effect(req, token) = applyImportPlan(plan, decisions, deps)       EXECUTE (existing effect, preserved)
       observe: readBack(moduleId, recordId) from the destination        OBSERVE authoritative post-state
       verify: expectedPostState ≡ observed (structural / predicate)     VERIFY → VERIFIED/DEVIATION/UNKNOWN
       IdempotencyStore.complete(key, outcome)                           record whole outcome
       EvidenceStore.append per stage + TransitionOutcome envelope       EVIDENCE
  → return DataPlaneRunResult AND persist the CST outcome envelope
```

`effect` returns transport-level `{accepted}` only (kernel.d.ts:40); it does **not**
self-report VERIFIED. Verification is the kernel's separate stage over the
authoritative `readBack`.

## 3. The six ports — adapters + honest gaps

| Port | Backing | Honesty note |
|---|---|---|
| `time` | kernel `SystemTime` (or Desktop clock wrapper over `deps.now`) | `maxSkewMs` declared |
| `policy` | new `PolicyStore(grants, version)` built from the **actor's real permissions** (`data:import`, `data:approve`, destination-module WRITE); `sodActions ⊇ {high-risk import}`; import **not** in `relationshipActions` | grants derive from the same authz the IPC layer uses — one source of authority, not a second |
| `claims` | kernel `ClaimStore` (in-process) keyed `tenant+planId` | **GAP declared:** in-memory ⇒ single-process exclusivity (matches the one Desktop main process); NOT durable across restart, NOT multi-host (mirrors source `O-6`). Not faked as durable. |
| `idempotency` | kernel `IdempotencyStore` (in-process), transition-level | **GAP declared:** non-durable across app restart. Row-level `externalKey` dedup (durable in the store) remains the second layer inside the effect. Replays within a session return the ORIGINAL outcome (no second effect). |
| `resources` | adapter over the Desktop tenant stores: `observe` = `readBack` of created record ids; `version` = a **destination fingerprint** (hash of the destination record-set for the target module) | The import target has no natural monotonic version; the fingerprint is the honest pre-state token. `compareAndSet` fencing is available but the primary pre-state guard here is `matchAgainstDestination`; declared, not hidden. |
| `evidence` | kernel `EvidenceStore` **+ bridge each stage into the existing `deps.audit`** | The CST envelope references `ProvenanceStore`; it does **not** replace provenance (a second provenance would be a second answer that can disagree — importer.ts:95). |

## 4. Guards — all 18 ON, and how each is honestly satisfied for import

`actorAuthorized`·`tenantIsolation` ← policy + tenant-scoped stores;
`approvalExpiry/binding/scope` ← the built `Approval`; `evidenceFreshness` ← plan
evidence refs + policy freshness; `atomicClaim` ← `claimAtomic`; `idempotency` ←
intent-before-effect; `preStateRevalidation` ← `matchAgainstDestination`;
`postconditionVerification` ← readBack vs expected; `recoveryGoverned` ←
`recoveryOf` path runs the same kernel; `modelCannotSelfAuthorize` ← actor is
HUMAN/CONNECTOR, never AI; `reconcileUnknownReplay` ← `reconcile` returns
`{known:false}` for an unknown replay ⇒ stays UNKNOWN (never inferred done);
`constraintsEnforced` ← `maxRows`; `separationOfDuties` ← `data:approve` ≠
`data:import`; `preflightReconcile` ← checked before claim; `relationshipContext`
← policy declares import non-relational ⇒ `NOT_APPLICABLE` (not bypassed);
`observationSubjectBinding` ← the readBack observation carries its subject (the
record id / plan), so "wrote row X" cannot verify "row Y".

## 5. Invariants this design must not weaken (explicit)

- **SEEN ≠ EXECUTED ≠ EFFECT_CONFIRMED ≠ VERIFIED** — kept: readBack is separate
  from the effect's return; verify is a distinct stage.
- **UNKNOWN never → VERIFIED** — if `expectedPostState` is undefined or the
  destination read fails, outcome is UNKNOWN, not VERIFIED.
- **ABSENCE ≠ PROOF** — a `NOT_FOUND` on readBack is not proof the write happened
  or didn't; it maps to UNKNOWN / DEVIATION per what was expected, never silently
  to success.
- **Replay ≠ second effect** — idempotency intent before the effect; completed key
  replays the original outcome.
- **Claim before execute; revalidate immediately before execute** — order fixed by
  the kernel; the effect is unreachable before both.
- **HOLD/DENY ⇒ no effect.**
- **Recovery governed** — a recovery re-run carries `recoveryOf` and runs the same
  kernel; no bypass path.
- **No fabrication** — no fake persistence, no fake provider guarantee, no fake
  external state, no fake verification. External providers are out of scope for
  this action (local writes only).

## 6. What Phase C will add (smallest change)

1. **Stage A dep:** vendor `neuropause-cst-1.3.0.tgz` (hash `293d0560…ceb431`) as a
   `file:` dependency of `apps/desktop`; wire the kernel `verify` into CI (honest
   env caveat: full suite needs Node 22 + TS 6; prebuilt suites pass in-scope).
2. **One adapter module** `apps/desktop/src/main/cst/importTransition.ts` — builds
   the request, constructs the 6 ports, defines `effect` = existing
   `applyImportPlan`, runs `kernel.run`, returns both the Desktop result and the
   CST outcome envelope.
3. **One call-site change** in `dataPlane/index.ts` import handler: wrap the
   existing `applyImportPlan(...)` call in `kernel.run(req, effect)`. Nothing else
   in the data plane changes.
4. **Tests** (Phase D negative controls) against the integrated path.

## 7. Declared gaps carried forward (lowest honest level)

- Claim/idempotency durability: **in-process only** (single host, non-durable
  across restart) — PARTIAL, mirrors source `O-6`; not represented as durable.
- Verification is VERIFIED only when a pre-declared expected count exists; else
  UNKNOWN — by design.
- This governs **one** action. Coverage of other Desktop transitions: **NOT
  ESTABLISHED.**

**STATUS: PHASE C READY** (pending your go-ahead). Source unmodified; no code edited.
