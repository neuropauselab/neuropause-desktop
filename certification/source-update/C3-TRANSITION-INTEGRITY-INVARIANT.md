# INVARIANT — C3 Transition Integrity (Data IMPORT, v1)

**Frozen v1 rule (P13C, from the F-1 review):**

> A Data Import is **one governed consequential transition**. When the submitted
> plan contains one or more high-risk (C3) tables, the transition is classified
> at **C3 by presence**. If the required approval is absent for any applicable
> high-risk table, the **complete** import transition is **HOLD** and **no table
> mutation from that transition is executed**.

## Ordering — classification precedes authorization

```
C3 classification  ≠  approval
C3 classification happens FIRST (by declared risk / presence).
Approval then determines whether the C3 transition MAY PROCEED.
```

Consequence is determined by the **requested transition and its declared risk**,
never by whether authorization has already been granted. This is what prevents
the F-1 defect from returning in another form (an unapproved high-risk table can
never downgrade the transition to C1 and pass as a vacuous no-op).

## Atomic boundary — no partial execution

The governed unit is the **whole transition**, not independently authorized table
mutations. A mixed plan therefore behaves atomically:

```
Plan: [ Customers HIGH-RISK/UNAPPROVED, Products LOW-RISK, Orders LOW-RISK ]
   → C3 detected (presence)
   → approval absent
   → HOLD  (APPROVAL_REQUIRED)
   → ZERO effects   (Products and Orders are NOT partially executed)
```

Partial execution is deliberately **out of scope for v1**: it would require a new
formal contract for partial authorization, partial execution, partial
verification, compensation/rollback, evidence partitioning, and partial recovery
— none of which Phase C/D established. Whole-transition HOLD is the safer, simpler
boundary for this architecture.

## The resulting import contract (states kept distinct)

| Scenario | Verdict | Effect | Outcome |
|---|---|---|---|
| Low-risk authorized import | ALLOW | yes | VERIFIED_SUCCESS |
| Authorized import, nothing requires mutation | ALLOW | no | **VERIFIED_NOOP** |
| High-risk + valid approval | ALLOW | yes | VERIFIED_SUCCESS |
| High-risk + missing approval | **HOLD** | **no** | not verified (APPROVAL_REQUIRED) |
| Mixed plan, any high-risk unapproved | **HOLD** | **no** (atomic) | not verified |
| Unauthorized import | DENY | no | not verified |
| Stale pre-state | HOLD | no | not verified |
| Reported write absent | — | incomplete | DEVIATION / VERIFIED_FAILURE |
| Unobservable post-state | — | unknown | UNKNOWN |

`VERIFIED_NOOP` is an adapter-level refinement of the kernel's `VERIFIED_SUCCESS`
(authorized, zero records written, zero failures). The frozen kernel is
**unmodified**; the distinction lives only in
`main/cst/importTransition.ts` (`ImportSemanticOutcome`).

## Where enforced
- `apps/desktop/src/main/cst/importTransition.ts` — `hasHighRisk` (presence) →
  C3; approval supplied only when every high-risk table is approved.
- Handler `dataPlane/index.ts` surfaces a HOLD/DENY as a thrown CST reason
  (`Import HOLD by governance (APPROVAL_REQUIRED)…`), never a fabricated success.
- Controls: `importTransition.negative.test.ts` (F1-A..F, MIXED-A/B); wiring
  tests updated to the invariant (`dataPlane/wiring.test.ts`).
