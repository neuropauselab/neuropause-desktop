# ERP — SESSION 6: POSTED-MOVEMENT VOID → GL REVERSAL

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `3113162`
**Label:** TEST-VERIFIED · **Accounting decision required:** **NONE** (the void mechanism and reversal semantics are
already defined in the repository; this completes the intended-but-unbuilt seam). No moving-average/actual costing;
no parallel accounting path; reuses the existing `applyGlDerivedEntries` + append-only `-REV` convention.

---

## EXACT ROOT CAUSE / CURRENT BEHAVIOR (reproduced)

A stock movement carries `status: 'posted' | 'void'`; the inventory reconciler **excludes void from every balance**
(`inventory.ts` — `deriveStockLedger`/`productComputedStock` skip void). So voiding a movement correctly reverses
**inventory**. But the **GL did not follow**, for two reasons:

1. `postMovementToGl` skipped on `status === 'void'`, but it was called with `event.record.status` — the **entity
   lifecycle status** (`active`/`deleted`), never the movement's **field** status (`posted`/`void`). So the
   void-skip was **dead code** (checked the wrong value).
2. On a re-fired `onChange` for a voided movement it re-derived `MOV-<id>`, which `applyGlDerivedEntries`
   idempotently **skips** (already posted) — so nothing reversed.

Net: a voided posted movement reversed inventory while its `MOV-<id>` GL entry **remained** → **GL/inventory
drift**. The bridge comment already named the intended fix: *"reversing a posted entry is a separate, governed
seam."* Reproduced by `postedMovementReversal.test.ts` (7/8 failing before the fix).

## ACCOUNTING DECISION — NONE REQUIRED

Every STOP-rule item resolves from existing repository semantics, so no policy was invented:
- **reversal vs void** — already decided: the movement `status` field + the reconciler's void-exclusion **are** the
  void mechanism; GL-follows-void is the unbuilt half.
- **accounting date** — the reversal dates at void time, matching the finance `-REV` convention (*"keep dating at
  the time of the change"*).
- **original vs current standard cost** — the reversal reads and **negates the ORIGINAL posted lines**, so it
  reverses exactly what was booked (original cost), never a re-derivation.
- **GRNI / COGS / WIP / FG** — a balanced entry reversed by swapping debit/credit needs no per-account rules.
- **period close** — the reversal posts through the governed journal (`post`), so the existing period guard applies
  unchanged.
- **production variance after reversal** — the settlement already excludes void movements; see the recorded edge.

## IMPLEMENTED REVERSAL FLOW

```
Void a posted movement (fields.status: posted → void, via the governed update)
      ↓ onChange (authorized inventory:manage; tenant-scoped)
inventory reconciler recomputes (void excluded)  →  stock restored
      ↓
postMovementToGl(movement, id, ctx)   [reads movement.status]
      ↓ movement.status === 'void'
reverseGlEntry(ctx, "MOV-<id>", …)  →  reads the posted MOV-<id>, swaps every Dr/Cr,
      posts an explicit "MOV-<id>-REV" via applyGlDerivedEntries (governed journal post)
```

`reverseGlEntry` (in `finance/glPosting.ts`) is generic and idempotent: no-ops if `MOV-<id>` was never posted or if
`MOV-<id>-REV` already exists; the original entry is never modified (append-only).

## REPRESENTATIVE INVENTORY + GL ENTRIES

Receive 10 × RM-1 @ standard cost 5, then void:

| Step | Inventory (stock) | GL entry | Dr | Cr |
|---|---|---|---|---|
| Receive posted | 10 | `MOV-<id>` | Inventory 1300 = 50 | GRNI 2150 = 50 |
| **Void** | **0** | `MOV-<id>-REV` | GRNI 2150 = 50 | Inventory 1300 = 50 |

Net after void: Inventory 1300 = 0, GRNI 2150 = 0 — the GL matches the restored inventory. Sales issue reverses
Dr COGS/Cr Inventory → Dr Inventory/Cr COGS; production consumption reverses Dr WIP/Cr Inventory → Dr Inventory/Cr
WIP (at the Session 5-Fix standard cost — e.g. WIP 30 booked, WIP 30 reversed).

## IDEMPOTENCY / AUTHORIZATION / TENANCY

- **Idempotent / no duplicate reversal**: `MOV-<id>-REV` is a deterministic key; a duplicate void and a replayed
  `onChange` on a void movement post exactly **one** reversal (tested). Exactly two entries per movement
  (`MOV-<id>` + its `-REV`), never a third (tested).
- **Original immutability**: the `MOV-<id>` entry's lines are byte-identical before/after; the physical movement is
  retained (marked `void`), never deleted, with its economic fields (qty/cost) untouched (tested).
- **Authorization**: the void flows through the governed update, which asserts `inventory:manage`; a denied
  authorization **rejects the void and posts no reversal** (tested).
- **Tenant isolation**: the reversal reads scope-bound stores; it lands only in the owning tenant, and another
  tenant sees none of it (tested).

## TESTS (all 14 required points → 8 cases)

`modules/inventory/postedMovementReversal.test.ts` — **8/8**:
1/2/3 posted-movement reversal + inventory restoration + GL reversal · 4/5/14 original immutability + reversal
reference linkage + exactly-two-entries · 6/7 duplicate/replayed void → one reversal · 8 unauthorized void rejected ·
9 tenant isolation · 10 goods-receipt reversal · 11 sales-issue reversal · 12/13 production consumption reversal at
standard cost.

## RESULTS

| Check | Result |
|---|---|
| Session 6 tests | **8/8** |
| Reproduction (pre-fix) | **7 failed / 1 passed** — gap confirmed |
| Negative control (neuter the void branch → **7 failed**; restore byte-identical → 8/8) | **load-bearing, proven** |
| Blast radius — all `src/main/enterprise` | **162 files / 1285 passed** |
| Blast radius — `src/main/medicalDevice` + `src/main/erp` | **10 files / 208 passed** |
| `tsc` node + web | **exit 0** |
| ESLint (all touched files) | **clean** |
| `electron-vite build` | **exit 0** |
| Session 5-Fix | not regressed (production costing/variance tests green in the enterprise run) |

## FILES CHANGED

```
MOD  src/main/enterprise/modules/finance/glPosting.ts                  reverseGlEntry (append-only -REV, idempotent)
MOD  src/main/enterprise/modules/inventory/inventoryGlBridge.ts        postMovementToGl: void → reverse; read movement.status
MOD  src/main/enterprise/modules/inventory/stockMovementModule.ts      caller drops the (wrong) entity-status arg
NEW  src/main/enterprise/modules/inventory/postedMovementReversal.test.ts  8 pins (14 required cases)
NEW  certification/ERP-SESSION6-POSTED-MOVEMENT-REVERSAL-EVIDENCE.md   this document
```

## SUCCESS CRITERION

Posted-movement void now yields a coherent, auditable, financially correct reversal: inventory and GL both reverse,
the original posted transaction is immutable, an explicit `-REV` reversal is created, reversal is idempotent and
authorization/tenant-enforced, and no Session 5-Fix behavior regressed. **Session 6 GREEN.**

## REMAINING (recorded, not blocking)

- **Production variance re-settlement after a post-completion void**: `settleProductionVariance` already excludes
  void movements, so a *fresh* settlement recomputes correctly; but voiding a consumption/output movement AFTER an
  order's `VAR-<orderId>` was already posted does not auto-re-settle (the settlement is idempotent on `VAR-<orderId>`).
  A re-settlement trigger on post-completion void is a scoped follow-up (rare; the movement-level GL reversal itself
  is correct).
- No domain action currently drives a movement to `void` (it is reachable via the governed status update); a
  first-class per-domain "cancel → void" action (e.g. goods-receipt cancel) is a natural follow-up that this seam
  now makes safe.
