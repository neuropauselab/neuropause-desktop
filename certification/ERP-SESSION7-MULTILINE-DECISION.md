# ERP — SESSION 7: MULTI-LINE RECEIPTS/DISPATCHES · VERIFIED + TWO DECISIONS (ESCALATED)

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `37324af`
**Status:** the ONE multi-line inventory document that exists (the production order) is **verified correct** and
committed as hardening; **two genuine decisions are escalated** (multi-line atomicity policy; whether multi-line
receipt/dispatch *documents* should exist). **No production code changed** — per the STOP rule, the undefined
policies are surfaced rather than guessed. Reuses the Session 5-Fix standard-cost seam + Session 6 reversal; no new
costing model.

---

## CURRENT BEHAVIOR (inspected + reproduced)

- **Purchase receipts and sales dispatches are SINGLE-LINE.** A goods receipt carries one `product` +
  `quantityReceived`; a sales order carries one `product`. Each posts exactly **one** movement. There is **no
  multi-line receipt/dispatch document** that produces N movements. (The Phase-6 `documentLines`/`documentAdapter`
  layer models multi-line documents, but its posting is **dormant** — Session 2 — and it derives **GL only**, never
  per-line inventory movements.)
- **The production order is the one multi-line inventory document.** `START` iterates the BOM components and posts
  one `production_consumption` movement per component (and `mesDispatch`/`executionModule` similarly on the MES
  path). This is verified correct end-to-end (see below).
- **Multi-line posting is NON-ATOMIC.** The `START` loop posts each line immediately and **returns on the first
  line that fails** (`if (!consumed) return { ok:false }`), leaving earlier lines posted. The enterprise framework
  has **no cross-write transaction/rollback** — each `store.create` commits independently. So a mid-document
  failure yields a **partially posted** document.

## WHAT IS VERIFIED (committed hardening — no decision needed)

`multiLineTransactionIntegrity.test.ts` (7/7) drives a 2-component production order (RM-1 ×3 @ std 5, RM-2 ×2 @ std
7, build qty 2) through the REAL plan → allocate → start, and proves for the multi-line document that exists:
- **N lines → exactly N movements** — 2 consumption movements, none dropped, none duplicated; quantities correct
  (6 and 4).
- **Per-SKU standard cost** — RM-1 @ 5, RM-2 @ 7 resolved independently (Session 5-Fix).
- **Balanced GL, summed per line** — WIP Dr 58 (= 30 + 28), Inventory Cr 58; total debits == total credits.
- **Document→movement traceability** — every consumption references the order id.
- **Multi-line void/reversal (Session 6)** — voiding both lines posts exactly two `MOV-<id>-REV` reversals; WIP and
  Inventory return to net zero; originals immutable; no duplicate reversal.
- **Document-level idempotency** — re-running `START` on a `running` order is refused by the status guard (no
  duplicate consumption).
- **Tenant isolation + authorization** — movements/GL are scope-bound (another tenant sees none); `inventory:manage`
  asserted per movement.

A single-line control confirms a goods receipt posts exactly one movement. Negative control: breaking the
consumption loop after the first line (mutation) fails 4 multi-line pins → restored → 7/7 — the tests bind to the
multi-line processing.

## DECISION 1 (STOP) — MULTI-LINE ATOMICITY POLICY

A multi-line document posts its lines **non-atomically**; a failure after line 1 leaves a partially posted document.
The correct policy is **not defined in the repository**, so it must be ruled, not guessed:
- **Option A — all-or-nothing (compensating).** On a mid-document failure, reverse the already-posted lines
  (reusing the Session 6 `MOV-<id>-REV` reversal) so the document posts fully or not at all. No DB transaction
  needed; it composes with the existing append-only ledger. **Recommended** — it gives clean document semantics with
  machinery that already exists.
- **Option B — partial fulfilment + line-level status.** Keep posted lines, mark the document partially fulfilled,
  track per-line status, and allow a resume/retry of the unposted lines (idempotent per line). Matches real
  warehouse practice (receive what arrived) but needs a line-status model and a resume action.
- **Option C — keep current (best-effort partial), documented.** Least work; leaves partially-posted documents on
  failure with no compensation — not recommended for financial integrity.

**Accounting/ERP consequence:** under standard costing, a partially posted document leaves WIP/Inventory/GL in a
real-but-incomplete state; only Option A guarantees the GL always reflects a whole document. Evidence of the
ambiguity: the `START` loop's first-failure-return is pinned by test 9; nothing in the repo defines the intended
recovery.

## DECISION 2 (STOP) — SHOULD MULTI-LINE RECEIPT/DISPATCH *DOCUMENTS* EXIST?

Receipts/dispatches are single-line today. Adding N-line goods receipts / dispatches (one document, many SKUs) is a
**capability decision**, and it would inherit Decision 1's atomicity policy. Options: (a) leave single-line (the
ledger already supports many independent movements — a user posts N single-line receipts); (b) add multi-line
documents with a lines store feeding N movements through the existing `postStockMovement` seam under the chosen
atomicity policy. This is a product-scope decision, not a bug.

## GATE CRITERION — PARTIAL

For the multi-line document that EXISTS (production order), the gate is met on the happy path + reversal:
complete, correctly costed, traceable, idempotent inventory + GL for every line, with correct posted-movement
reversal. The one gap is **deterministic failure behavior**, whose policy (Decision 1) is undefined — hence
escalated rather than marked fully GREEN.

## FILES CHANGED

```
NEW  src/main/enterprise/modules/manufacturing/multiLineTransactionIntegrity.test.ts  7 pins (verification + reproduction)
NEW  certification/ERP-SESSION7-MULTILINE-DECISION.md                                 this memo
```
No production code changed.

## VERIFICATION RESULTS

| Check | Result |
|---|---|
| Session 7 tests | **7/7** |
| Negative control (break the consumption loop → **4 failed**; restore byte-identical → 7/7) | **load-bearing, proven** |
| Blast radius — all `src/main/enterprise` | **1292 passed** |
| medicalDevice + erp | passed |
| `tsc` node + web · ESLint · build | clean |
| Session 5-Fix / Session 6 | not regressed |

## REMAINING BLOCKERS

Decision 1 (atomicity policy — recommended Option A, compensating all-or-nothing via Session 6 reversal) and
Decision 2 (whether to add multi-line receipt/dispatch documents). On a ruling, Session 7-fix implements the chosen
policy end-to-end with failure/partial/retry tests.
