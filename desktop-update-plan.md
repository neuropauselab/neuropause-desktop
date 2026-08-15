# DESKTOP UPDATE PLAN — integrating the NeuroPause final baseline

**Direction (one-way):** `NeuroPause final` (SOURCE, frozen) → `NeuroPause Desktop` (TARGET).
**SOURCE:** `/Users/saurabhpatel/Downloads/NEUROPAUSE-FINAL` (not a git repo, hash-verified INTACT).
**TARGET:** `/Users/saurabhpatel/Desktop/neuropause-desktop` @ `2b37cba` (clean), `1.0.0-rc.20`.
**Nothing is committed by this plan.** Phase 19 gates all commits on explicit approval.

## What the source can and cannot supply

The source is the frozen constitutional baseline, not an app. Only **one** artefact
is directly integrable: **`@neuropause/cst 1.3.0`** — the CST kernel (zero deps,
prebuilt `dist/`, `CstKernel.run(request, effect)` + 18 guards + the canonical
type vocabulary). `NPC-1.2` and `NPMS-1.4` are normative specs the Desktop
**conforms to**, not code to copy. Per USE-28 the Desktop is "a product built
against the baseline" — mine to edit freely; the baseline is what it conforms to.

## Difference map (SOURCE vs TARGET)

| Concern | SOURCE (authoritative semantics) | TARGET today | Class |
|---|---|---|---|
| CST kernel | `@neuropause/cst 1.3.0` `CstKernel.run()` | **absent** (no `CstKernel`; the one `TransitionRequest` hit is unrelated `MedicalDeviceLotTransitionRequest`) | **D — SOURCE-ONLY / REQUIRED** |
| Execution flow | canonical order in `kernel.d.ts` | own execution engine (39 files), `aiAuthzGate`/`runtimeAuthz` (31), `governanceStore` (18), idempotency (18) — similar, not identical, not the kernel | **F — CONFLICTING (adapt, don't duplicate)** |
| Verdict/verification vocabulary | closed `Verdict`/`VerificationOutcome`/`OutcomeClass`/`AssessmentState`/`EpistemicStatus`/`ReasonCode` | Desktop uses its own ad-hoc statuses | **A — SOURCE NEWER / REQUIRED (contracts)** |
| Relationship context (4 states, not boolean) | `AssessmentState`, `RelationshipRef.epistemicStatus` | not modelled as 4 states | **A — SOURCE NEWER** |
| Atomic ownership claim / fencing token | `claims` port + `FencingToken` | no `fencing`/`atomicClaim` by name | **D — SOURCE-ONLY / REQUIRED** |
| MicroTrace / NeuroChain | evidence envelope + timeline | **absent by those names** (0 files) | **D — SOURCE-ONLY** (Desktop has logs/audit, not this evidence model) |
| Tenancy / workspace / auth / AI routing / connectors / installer / UI / packaging | — (not in source) | Desktop-owned | **E — TARGET-ONLY (keep; platform adapters, Phase 4/14)** |
| Certification evidence | source has its own frozen logs | Desktop's `certification/` is historical | **I — EVIDENCE (remains historical, Phase 16)** |
| Node/TS toolchain | Node v22.22.2 / TS 6.0.3 (kernel `verify`) | Node 20.20.2 in this env | **H — ENVIRONMENT-SPECIFIC** |

**No second CST implementation exists to reconcile** (Phase 8 satisfied: the
Desktop has no `CstKernel`). The integration is *additive consumption*, not a
rewrite of the existing engine.

## Proposed integration — smallest changes, in three reviewable stages

Following the baseline's own retrofit rule (USE-07: **never a rewrite; one call
site; add the validator and let it fail; claim the lowest honest level**):

**Stage A — foundational, behaviour-neutral (no runtime path changes)**
1. Vendor `@neuropause/cst 1.3.0` into the Desktop from the frozen `.tgz`
   (hash-pinned to `293d0560…ceb431`; committed under e.g.
   `apps/desktop/vendor/neuropause-cst-1.3.0.tgz`, added as a `file:` dependency),
   so the authoritative kernel is present without changing any behaviour.
2. Wire the kernel's `verify` into Desktop CI (USE-16/USE-17: validator on day
   one, while it checks almost nothing) — with the honest env caveat (needs Node
   22 + TS 6 for the full suite; the prebuilt `dist/` negative-controls +
   mutations + erp suites run today and pass 21/21, 16/16, 16/16).

**Stage B — one call site (the single most consequential action)** ← NEEDS YOUR DECISION
- Implement the 6 `KernelDeps` ports as **adapters over existing Desktop stores**
  (time→clock, policy→governanceStore, claims→a new atomic-claim store,
  idempotency→existing idempotency, resources→tenant stores, evidence→audit/log),
  and route ONE action through `kernel.run(request, effect)` with the real side
  effect as `effect`.
- **USE-06 makes the choice of that action a human decision.** Candidates in the
  Desktop (most→least consequential): **backup RESTORE** (overwrites every tenant
  store — "deletes data"), **data IMPORT** (writes tenant records), an AI
  execution that "sends something external". Payment is preview-only/refused
  (PG-08 not evidenced — must stay refused, USE-20), so it is **not** a candidate.

**Stage C — retrofit discipline**
- Registers from the code as-is; the envelope the code actually implements
  (including missing terms as declared gaps); let the validator fail and **record
  defects** rather than weaken checks; claim the lowest honest conformance level
  with the defect list attached.

## Files by disposition

1. **Update:** `apps/desktop/package.json` (+ lockfile) — add the `cst` dependency (Stage A).
2. **Add:** vendored `.tgz`; a `cst/` adapter module (ports + one call site) (Stage B); CI wiring; tests.
3. **Leave untouched:** the entire existing execution engine / tenancy / UI / packaging behaviour (Phase 7 "smallest changes"; Phase 14 platform boundaries).
4. **Manual conflict resolution:** which action becomes the first kernel call site (Stage B decision).
5. **Regenerate:** lockfile only.
6. **Historical evidence:** all of `certification/` (incl. windows-runtime-evidence-rc20) — unchanged (Phase 16).
7. **Desktop-specific config:** platform adapters, entry points, installer — unchanged (Phase 4).
8. **Authoritative from source:** the CST kernel semantics + type vocabulary (consumed, not copied).

## STOP conditions hit (Phase 3)

- **Architectural decision required (not mine to take):** the Stage-B call site
  (USE-06 assigns this to a human). Proceeding to edit the execution path before
  that decision would be the "enthusiastic undetectable amendment" the corpus
  warns against (USE-25).
- **Version:** do **not** relabel the Desktop "final"/"certified" (Phase 15/USE-11).
  Consuming `@neuropause/cst 1.3.0` is a dependency addition; the Desktop stays
  `1.0.0-rc.20` unless you decide a bump.

## Recommendation

Approve **Stage A now** (behaviour-neutral: vendor the frozen kernel + CI
validator), and **choose the Stage-B call site** so I can implement the single
adapter + one call site under change control, with tests, and report honestly —
without touching the rest of the Desktop.
