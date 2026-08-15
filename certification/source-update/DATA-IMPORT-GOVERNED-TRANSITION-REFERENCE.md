# Data Import — Canonical Governed-Transition Reference (v1, FROZEN)

**Phase F — Reference Freeze.** This document freezes the NeuroPause Desktop **Data
Import** governed transition as the *canonical reference implementation* for
consequential state transitions. It is a **reference contract**, not new code: it
records what the frozen baseline already does and what future transitions may copy.
It does **not** modify the implementation, the kernel, or any semantics.

> **Scope discipline.** "Canonical reference" means *Data Import is the template*.
> It does **not** mean every NeuroPause transition is governed correctly because
> Data Import is. Future transitions inherit the **contract**, not a blanket
> certification (see F7 / F-FREEZE-12).

---

## F1 — Baseline identity (do not silently re-point)

| Field | Value |
|---|---|
| Transition | NeuroPause Desktop — Data Import governed transition |
| Baseline commit | **`fcb3a312fa178f04ca670299ba05ac6bbb626255`** (`fcb3a31`) |
| Branch | `cert/data-import-cst-integration` (local, unpushed) |
| CST kernel artifact | `apps/desktop/vendor/neuropause-cst-1.3.0.tgz` |
| Kernel tarball SHA-256 | `293d056047346631c72dd117b50733162b5ae08448f3c2bdedd73703cbceb431` |
| Installed `kernel.js` SHA-256 | `7b7be2fb9b68050148de3dafb1f15290f1d17e1ea7efe44eba4471c34a45e5b0` |
| Adapter (sole new module) | `apps/desktop/src/main/cst/importTransition.ts` |
| Single call site | `apps/desktop/src/main/dataPlane/index.ts` (`dp:import` handler) |
| Preserved effect | `applyImportPlan` (unchanged) |
| Frozen baseline source | NEUROPAUSE-FINAL — zero drift |

The **environment record** for this baseline is the one captured in
`PHASE-E-APP-LEVEL-EVIDENCE.md` §E-ENV (macOS 26.5.2 / Darwin 25.5.0, arm64, Node
v20.20.2, npm 10.8.2, Electron 42.8.1). **Do not** update the environment and keep
calling it the same baseline — a new environment is a new baseline record.

---

## F2 — Canonical transition model (frozen)

```
REQUEST
   │
   ▼
PLAN / CLASSIFY            (risk, consequence class, approval requirement)
   │
   ▼
GOVERN  ── DENY ─────────► NO EFFECT
   │   ── HOLD ─────────► NO EFFECT
   ▼
CLAIM                      (won claim required to proceed)
   │
   ▼
REVALIDATE ── stale ─────► HOLD / NO EFFECT
   │
   ▼
EXECUTE                    (applyImportPlan — the preserved effect)
   │
   ▼
OBSERVE ── unobservable ─► UNKNOWN
   │
   ▼
VERIFY  ── mismatch ─────► DEVIATION
   │
   ▼
EVIDENCE
   │
   ▼
TRANSITION OUTCOME
```

**The fundamental semantic distinction is a reference invariant** (not merely
something Data Import happens to test):

```
SEEN ≠ CLAIMED ≠ EXECUTED ≠ EFFECT_CONFIRMED ≠ VERIFIED ≠ EVIDENCED
```

Each stage is a distinct fact. A later stage never back-fills an earlier one; an
earlier stage never implies a later one.

---

## F3 — C3 consequence semantics (frozen)

Classification precedes authorization. Consequence is a function of the **requested
transition and its declared risk**, never of whether approval already exists.

```
Low-risk only            →  C1  →  ALLOW
Any high-risk table      →  C3  (by PRESENCE)
                             → approval required for every applicable high-risk component
                             → missing approval?  → HOLD → NO EFFECT
```

**Whole-transition atomicity (the F-1 correction, R2):**

```
LOW-RISK APPROVED  +  HIGH-RISK UNAPPROVED   →   WHOLE TRANSITION HOLD   →   NO PARTIAL EXECUTION
```

Implemented at `importTransition.ts`: `const consequence = hasHighRisk ? 'C3' : 'C1'`;
approval is supplied only when **every** high-risk table is approved. An unapproved
high-risk table can never downgrade the transition to C1 or pass as a vacuous no-op.

> **Frozen v1 choice.** Partial execution is deliberately out of scope. A future
> engineer must **not** "optimize" this into partial execution unless a new
> transactional contract (partial authorization / execution / verification /
> compensation / evidence partitioning / partial recovery) is separately designed,
> tested, and certified. See `C3-TRANSITION-INTEGRITY-INVARIANT.md`.

---

## F4 — NOOP semantics (frozen)

Zero writes is **never** automatically success and **never** automatically failure —
the outcome must explain *why* zero writes occurred.

```
VERIFIED_SUCCESS  → authorized execution produced a confirmed new effect
VERIFIED_NOOP     → authorized, valid transition; nothing new to change (0 writes, 0 failures)
FAILURE / DEVIATION / UNKNOWN → something prevented or invalidated verification
```

`expectedPostState = { importResolved: true }` is **non-vacuous** (it is not
"all-written-records-present", which is vacuously true for zero writes).
`VERIFIED_NOOP` is an adapter-level refinement of the kernel's `VERIFIED_SUCCESS`;
the frozen kernel is unmodified. The distinction lives only in
`importTransition.ts` (`ImportSemanticOutcome`).

---

## F5 — Evidence hierarchy (frozen — never upgrade indirect to direct)

Two distinct classes of evidence, kept separate:

- **Direct mutation evidence (Phase D).** Negative control MIXED-A:
  `effectRuns = 0`, both destination stores observed unchanged — the authoritative,
  direct proof of the atomic boundary under controlled test.
- **Application-level corroboration (Phase E, cross-run).** E5-E HOLD; E5-F later
  creates the previously-absent record. This *corroborates* the behaviour through the
  launched application; it does **not** retroactively become a direct `effectRuns=0`
  measurement.

**Frozen assurance principle (bigger than Data Import):** never upgrade indirect
evidence into direct proof merely because the conclusion is plausible.
`UNKNOWN ↛ VERIFIED`. `ABSENCE ↛ PROOF`.

---

## F6 — Durability boundary (frozen, declared, not concealed)

```
Current application → CST kernel → in-memory claim/idempotency/evidence stores → process lifetime
```

This baseline does **not** establish: crash-durable CST evidence; cross-restart
kernel claim durability; multi-host ownership; distributed fencing; universal replay
protection; universal transition detection. The kernel's own `node:sqlite` durable
path requires Node ≥ 22; the Desktop runtime is Node 20 (Electron 42) — a **declared
architectural boundary**. The durable row-level `externalKey` idempotency is a
separate property of the preserved import effect (`applyImportPlan`), not of the
in-memory kernel stores.

---

## F7 — Template, not universal proof

Justified: *"Data Import is the canonical NeuroPause governed-transition reference
implementation."*
**Not** justified: *"All NeuroPause transitions are governed correctly because Data
Import is."*

```
                 NEUROPAUSE GOVERNED TRANSITION CONTRACT
                                  │
             ┌────────────────────┼────────────────────┐
             ▼                    ▼                    ▼
       Data Import          Future Transition A   Future Transition B
             │
             ▼
      CANONICAL REFERENCE
             │
      ┌──────┴────────┐
      ▼               ▼
 semantics        implementation
 reference           pattern
```

Future transitions inherit the **contract**, not blindly the Data Import
implementation. A generalized abstraction is to be **derived from repeated
transitions**, never speculated from this single example (see F8).

---

## F8 — Prohibited during and after this freeze

Do **not**, as a consequence of Phase F: create a generic "UniversalTransition"
abstraction; refactor Data Import into a framework; move the adapter; redesign the
kernel; introduce distributed persistence; change C3 semantics; change NOOP
semantics; expand Data Import into other transitions; "solve" Node 22 durability; or
reorganize unrelated documentation. First prove one transition completely, then
freeze it, then derive abstractions from *repeated* transitions.

---

## The reference contract (the questions a governed transition must answer)

| Question | Data Import answer |
|---|---|
| **What enters?** | An import request (`dp:import`: `planId` + per-table `approvals`), against a plan produced by `dp:analyze`. |
| **What is classified?** | Per-table risk → `requiresApproval`; transition consequence (`C1` low-risk / `C3` if any high-risk present); which high-risk components require approval. |
| **What governs?** | The frozen `@neuropause/cst 1.3.0` `CstKernel.run(request, effect)` — the single governance verdict. |
| **What prevents execution?** | `DENY`; `HOLD` (incl. C3 missing approval, whole-transition); lost/stale claim on revalidation; unauthorized actor/scope. |
| **What executes?** | The existing `applyImportPlan` effect, unchanged, only inside the kernel's `effect`, only on ALLOW + won claim + pre-state revalidation. |
| **What observes?** | The authoritative destination state via `readBack` (not the counters that wrote it). |
| **What verifies?** | `JSON.stringify(observed) === JSON.stringify(expectedPostState)`, with non-vacuous `expectedPostState = { importResolved: true }`. |
| **What outcomes exist?** | `VERIFIED_SUCCESS`, `VERIFIED_NOOP`, `VERIFIED_FAILURE`, `DEVIATION`, `UNKNOWN`, `HOLD`, `DENY`, `ESCALATE` (`ImportSemanticOutcome`). |
| **What evidence exists?** | The `TransitionOutcome` envelope + audit/provenance records + Phase D test evidence + Phase E application evidence. |
| **What is NOT proven?** | Universal transition coverage; distributed ownership; cross-restart CST durability; multi-host guarantees. |

---

## F9 — Phase F acceptance checklist

| ID | Criterion | Where frozen | Status |
|---|---|---|---|
| F-FREEZE-01 | `fcb3a31` identified as the canonical baseline | F1 | ✅ |
| F-FREEZE-02 | Exact CST artifact + SHA-256 recorded | F1 (`293d0560…`, `7b7be2fb…`) | ✅ |
| F-FREEZE-03 | Request / effect / verification contracts frozen | F2, contract table | ✅ |
| F-FREEZE-04 | C3-by-presence semantics frozen | F3 | ✅ |
| F-FREEZE-05 | Whole-transition HOLD semantics frozen | F3 | ✅ |
| F-FREEZE-06 | `VERIFIED_NOOP` semantics frozen | F4 | ✅ |
| F-FREEZE-07 | `UNKNOWN ≠ VERIFIED` frozen | F2, F5 | ✅ |
| F-FREEZE-08 | `ABSENCE ≠ PROOF` frozen | F5 | ✅ |
| F-FREEZE-09 | Evidence hierarchy (direct vs corroborating) frozen | F5 | ✅ |
| F-FREEZE-10 | Node 20 / in-memory durability limitation frozen | F6 | ✅ |
| F-FREEZE-11 | Scope explicitly limited to Data Import | F7, header | ✅ |
| F-FREEZE-12 | Future transitions need their **own** negative controls, regression, and application evidence — structural conformance alone is not certification | F7 | ✅ |

**Phase F passes when all twelve are recorded (above) and this document is committed
as a follow-on to `fcb3a31`.** It changes no implementation, kernel, or semantics.

---

## After Phase F (the intended sequence — not started here)

```
PHASE F  reference freeze  →  CANONICAL DATA IMPORT CONTRACT
   → PHASE G  second governed transition SELECTION (design only)
   → COMPARE against this reference  →  identify what is ACTUALLY common
   → implement second transition  →  negative controls  →  application evidence
   → ONLY THEN generalize shared abstractions (if the second transition proves reuse)
```

The next milestone is **not** another feature; it is establishing exactly what "a
NeuroPause governed transition" means before attempting to generalize it. A
second, genuinely different transition (e.g. a connector action or an AI-mediated
consequential action) is the real test of whether the CST contract is reusable —
and the evidence that would justify a platform-level abstraction.
