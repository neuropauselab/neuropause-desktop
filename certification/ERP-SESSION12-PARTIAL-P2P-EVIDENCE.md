# ERP — SESSION 12: PARTIAL RECEIPTS + PARTIAL VENDOR BILLING

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base:** Session 11 GREEN (`4497b03`)
**Label:** TEST-VERIFIED. No frozen surface touched; no new costing method invented; standard costing preserved;
CST/idempotency/reversal machinery unchanged (GRNI relief remains a derived-lines change). Reuses the existing
`threeWayMatch` engine — no second matcher.

Completes the P2P lifecycle for legitimate partial receipts and partial billing. Session 11 held every partial bill
(`PARTIAL` → not postable); Session 12 makes a partial bill post its own portion, matched CUMULATIVELY against the
remaining receivable, while keeping every fail-closed control.

---

## A · POLICY DISCOVERED (no STOP required)

The repository already carries enough semantics — no new accounting policy was invented:
- **Cumulative billed quantity is derivable, not a new field:** sum the line items of the PO's prior POSTED
  (approved/paid) bills (they already reference the PO via `sourcePurchaseOrder`). Cancelled/draft bills do not count.
- **Remaining receivable = received − already-billed**, fed to the existing `threeWayMatch`, so `billed ≤ remaining`
  → `MATCHED`/`PARTIAL` (postable for its portion) and `billed > remaining` → `MISMATCH` (fail closed). The engine's
  own `PARTIAL` verdict is what makes partial billing a first-class, non-invented state.
- **Partial GRNI relief is an allocation of the already-accrued pool, not a costing method:** relief for a bill =
  its billed quantity × the accrued per-unit rate (accrued GRNI pool ÷ received quantity, read back from the actual
  posted receipt movements). This equals standard cost when standard cost is constant (the standard-costing norm),
  and — because it allocates the real accrued pool by quantity — cumulative relief across all of a PO's bills sums to
  the pool exactly, so **GRNI nets to zero once fully billed** regardless of standard-cost history. The costing BASIS
  is unchanged. The only genuine fork — cost-flow when standard cost *changes mid-PO* — is sidestepped by the
  pool-average allocation (it needs no FIFO/LIFO choice); a specific cost-flow would be a future refinement (§K).

Because the semantics are mechanically determined, the STOP rule did not fire.

---

## B · FILES CHANGED

```
MOD  src/main/enterprise/modules/finance/goodsBillMatch.ts        cumulative match (remaining receivable) + partial pool-allocated relief; `matched`→`postable` (MATCHED|PARTIAL)
MOD  src/main/enterprise/modules/finance/glPosting.ts             goods.matched → goods.postable
MOD  src/main/enterprise/modules/finance/vendorBillModule.ts      evaluation.matched → evaluation.postable
NEW  src/main/enterprise/modules/finance/session12PartialP2P.test.ts   11 pins (4 reproduction cases + cumulative + multi-receipt + PPV-partial + idempotency + reversal + tenancy)
NEW  certification/ERP-SESSION12-PARTIAL-P2P-EVIDENCE.md          this document
```

Frozen surfaces untouched. `certification/baseline.json` (custody-protected) not staged.

---

## C · PARTIAL RECEIPT / BILLING BEHAVIOUR (reproduction: PO 100, receive 40, std cost 10)

| Case | Session 11 (before) | Session 12 (after) |
|---|---|---|
| A — bill 40 (== received) | MATCHED → posts, GRNI 0 | MATCHED → posts, GRNI 0 (unchanged) |
| B — bill 20 (< received) | **PARTIAL → HELD** (no posting) | **PARTIAL → posts its portion**; relieves 200; GRNI 200 outstanding |
| C — bill 60 (> received 40) | MISMATCH → HELD | MISMATCH → HELD (unchanged, fail closed) |
| D — bill 100 (>> received 40) | MISMATCH → HELD | MISMATCH → HELD (unchanged, fail closed) |

Cumulative: bill 20 then bill 20 (received 40) → both post, GRNI nets 0. Multiple receipts: receive 40 + receive 30
(accrued 700) → bill 50 then bill 20 → GRNI nets 0. A partial bill with a within-tolerance overprice books PPV on
the billed portion (relieve 200 at standard, PPV 1, AP 201).

---

## D · GRNI PROOF

`GRNI accrual − cumulative matched relief = remaining legitimate GRNI`. After a partial bill, GRNI stays outstanding
for the received-but-unbilled portion (case B: accrued 400 − relieved 200 = **200 outstanding**). After the final
bill, **GRNI = 0** (cumulative and multi-receipt tests). GRNI is never relieved for goods not received — relief is
bounded by billed ≤ remaining receivable, and the accrued pool is read from actual posted `receive` movements only.

---

## E · THREE-WAY-MATCH PROOF

The existing `erp/threeWayMatch.ts` is reused, fed the REMAINING receivable per SKU (received − already billed):
- `billed == remaining` → `MATCHED` (bills the rest) → postable;
- `billed < remaining` → `PARTIAL` (bills part) → postable;
- `billed > remaining` → `MISMATCH` → **fail closed** (this is the cumulative over-billing guard — proven by
  "cumulative over-billing fails closed": bill 30 then bill 20 on received 40 → the second is refused, only 30
  relieved of 40 accrued);
- supplier/currency `BLOCKED`, over-receipt `MANUAL_REVIEW` → fail closed. No second matcher was written.

---

## F · IDEMPOTENCY / REVERSAL PROOF

Each bill posts its own `JE-BILL-<n>` (per-bill idempotency via the unchanged `decideLifecycle` guard). Repeated
approval of a partial bill posts once (`JE-BILL` count = 1; the second approve is refused because the bill is no
longer draft). Cancelling a partial bill reverses exactly its own relief (`decideLifecycle` mirrors the booked
lines): GRNI returns to accrued, AP flat, and — because cancelled bills no longer count toward already-billed — the
quantity is billable again (proven: cancel a 20 partial, then a fresh 40 bill matches and nets GRNI to 0).

---

## G · TEST RESULTS

| Suite | Result |
|---|---|
| `session12PartialP2P.test.ts` | **11/11** |
| `session11VendorBillP2P.test.ts` (backward-compat) | **16/16** |
| Blast radius — all `src/main/enterprise` | **1348** (Session 11 1337 + 11) |
| `src/main/erp` + `src/main/medicalDevice` | **220** (unchanged) |
| `typecheck` (tsc node + web) | clean |
| `electron-vite build` | clean |
| ESLint on the changed/new files | clean (exit 0) |

---

## H · NEGATIVE-CONTROL RESULTS

Each mutation fails the right suite; each restore is byte-identical (sha256 verified, post-restore == baseline).

| # | Mutation | Failing suite |
|---|---|---|
| 1 | Partial-match bypass (`postable = true` always) | session12 (C/D/over-billing) + session11 (mismatch) |
| 2 | Cumulative-quantity bypass (never count prior bills) | session12 (cumulative over-billing posts when it must not) |
| 3 | GRNI over-relief (relieve full received, not billed portion) | session12 (partial GRNI-outstanding assertions) |

Duplicate-posting idempotency (the unchanged frozen `decideLifecycle` `JE-BILL-<n>` guard) and tenant isolation (the
scoped record store) are enforced by unmutated machinery and proven by the passing idempotency and cross-tenant
tests; they were not source-mutated (frozen / store-level), consistent with Session 11.

---

## I · BUILD / TYPECHECK / LINT

`typecheck:node` + `typecheck:web` clean · `electron-vite build` clean · ESLint clean on all changed/new files.
Repo-wide `npm run lint` carries the same pre-existing test-file backlog noted since Session 10 (sandbox-vs-Mac
config); no regression from this change — confirm on the Mac.

---

## J · COMMIT SHA

`<filled at commit>` — one commit, `erp(s12): …`. The user pushes from the Mac.

---

## K · REMAINING RISKS / BOUNDS

- **Cost-flow when standard cost changes mid-PO:** GRNI relief allocates the accrued pool at the weighted-average
  per-unit rate (= standard cost when constant, the norm), so GRNI still nets to zero on full billing. A specific
  FIFO/LIFO cost-flow across receipts at different standard costs is a future policy, not needed for standard costing.
- **Foreign-currency goods bills:** relief posts the accrued pool portion in base currency; the PPV line absorbs the
  combined price + FX variance (Session 11 bound, unchanged). Single-currency is exact.
- **Pre-existing control-account seeding-order fragility** (surfaced in Session 11): the test harness seeds the
  control chart up front to mirror production boot; a boot-seed hardening gate remains a separate item.
- **Dormant adapter leg** retained-inert (Session 11) — formal removal is a follow-up.
- PO and goods receipt remain single-product headers; a multi-SKU procurement is multiple POs. The bill is genuinely
  multi-line and cumulative per SKU.

---

## L · STATUS: 🟢 GREEN

Partial receipts and partial vendor billing complete the P2P lifecycle: partial bills post their portion via the
existing three-way-match engine fed the remaining receivable; cumulative billed never exceeds cumulative received
(fail closed); GRNI relief allocates the accrued pool so remaining GRNI stays correctly outstanding and nets to zero
once fully billed; the Session 11 controls (fail-closed over-billing, mismatch, price tolerance, idempotency,
reversal, tenancy, AP 2000, standard costing, CST seam) are all preserved and re-proven. No accounting policy was
invented; the STOP rule did not fire. GREEN with the explicitly-stated bounds in §K. Session 13 not started.
