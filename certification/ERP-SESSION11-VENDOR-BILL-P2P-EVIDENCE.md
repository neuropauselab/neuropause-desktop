# ERP — SESSION 11: VENDOR-BILL LINE ITEMS → LINE-LEVEL 3-WAY MATCH → LIVE GRNI RELIEF

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base:** Session 10 (`8c8fa2f`)
**Label:** TEST-VERIFIED. No frozen surface touched; no accounting policy invented; standard costing preserved;
CST/idempotency/reversal machinery unchanged (GRNI relief is a derived-lines change only).

Closes the Session 10 escalation (D7): the header-only vendor bill now carries durable line items, so the existing
line-level `threeWayMatch` engine can gate a PO-sourced bill and the live finance path relieves GRNI with a
purchase-price variance. Reproduce → implement → test → negative-control → regression.

---

## A · FILES CHANGED

```
MOD  src/main/erp/postingRules.ts                                  + deriveGoodsBillPosting (pure): Dr GRNI / Dr tax / Dr-or-Cr PPV / Cr AP
NEW  src/main/enterprise/modules/finance/goodsBillMatch.ts         evaluateGoodsBill: resolve PO+receipts (scoped) → reuse threeWayMatch → relief lines
MOD  src/main/enterprise/modules/finance/vendorBillModule.ts       `lines` JSON field + structural validate + fail-closed approve gate
MOD  src/main/enterprise/modules/finance/glPosting.ts              handleVendorBillChangeForGl: goods-bill branch posts relief; service bills unchanged
NEW  src/main/enterprise/modules/finance/session11VendorBillP2P.test.ts   16 pins (unit + live e2e + reversal + tenancy)
NEW  certification/ERP-SESSION11-VENDOR-BILL-P2P-EVIDENCE.md        this document
```

Frozen surfaces (`packages/shared`, `cst/`, `contracts.ts`, `channels.ts`, `runtimeCore.ts`,
`connectors/index.ts`, `executionGate.ts`) untouched. `certification/baseline.json` (custody-protected) not staged.

---

## B · DATA-MODEL CHANGES

The finance vendor bill gains ONE durable field: `lines` — a JSON array
`[{ sku, quantity, unitPrice, taxRatePercent? }]` on the bill record (the Session 7-Fix multi-line convention, kept
inside the enterprise module framework). No parallel vendor-bill model, no new store. Validation is structural
(valid JSON array; each line a SKU + positive quantity + non-negative price); **absent lines stay valid** (a goods
bill can be drafted without them but cannot be approved — see the gate), preserving the `vendorBillSourcePo` contract.
The frozen `vendorBillFromRecord` ignores the extra field. Deterministic relation: **Bill → PO** via
`sourcePurchaseOrder` (id or PO number), **PO → Goods Receipt(s)** via `goodsReceipt.purchaseOrder = PO.id`, matched
**by product SKU** (the engine's key).

---

## C · THREE-WAY-MATCH BEHAVIOUR

`goodsBillMatch.evaluateGoodsBill` reuses the existing pure `erp/threeWayMatch.ts` engine — **no second matcher**. It
builds `DocumentLine`-shaped order lines (from the PO header), receipt lines (from the PO's goods receipts), and bill
lines (from the parsed `lines`), then calls `threeWayMatch`. Routing:
- **Goods bill** (`sourcePurchaseOrder` present) → three-way match. `MATCHED` (`postable`) → relieve GRNI. Any other
  verdict (`MISMATCH` / `PARTIAL` / `BLOCKED` / `MANUAL_REVIEW`, or no PO / no lines / no receipt) → **HOLD, fail
  closed**: the approve action refuses, the bill stays `draft`, and no payable is booked.
- **Service bill** (no PO) → the existing Operating Expense path, entirely unchanged.

The gate lives in the `approve` action (fail-closed before the bill can become `approved`); the relief posts in
`onChange` via the same idempotent `JE-BILL-<n>` machinery. Tolerances are `threeWayMatch`'s own `DEFAULT_TOLERANCE`
(price 1% / 0.05, qty 0, over-receipt 5%) — nothing invented.

Pins: `MISMATCH (billed qty exceeds received)` and `MISMATCH (billed price beyond tolerance)` both leave the bill
draft with zero GL effect; a goods bill with **no line items** is held (the Session-10 reproduction, now a passing
fail-closed test).

---

## D · GRNI ACCOUNTING PROOF

Received value is read back from the ACTUAL posted receipt movements (`Σ quantity × posted unitCost`) — the GRNI that
was really accrued — so relief nets to zero even if the product's standard cost later changes. A MATCHED goods bill
books, through the single journal/CST seam:

```
Receipt (movement bridge, live):   Dr Inventory 1300    Cr GRNI 2150          (standard cost)
Bill approve (live finance path):  Dr GRNI 2150   [Dr Input Tax 1200]  [Dr/Cr PPV 5920]   Cr Accounts Payable 2000
```

Proven live (`MATCHED goods bill relieves GRNI to zero and books AP`): after a 100 × 10 receipt then a matched
100 × 10 bill, `net(GRNI) = 0` (credit 1000 − debit 1000), AP credit 1000, **no Operating Expense hit**. The full
cycle (`E2E`): receipt → matched bill → vendor payment leaves **`net(GRNI) = 0` and `net(AP) = 0`** (cash out 1000).

---

## E · PPV PROOF

`deriveGoodsBillPosting` books the standard-vs-actual difference to Purchase Price Variance 5920, direction
consistent with the existing production-variance convention (paying MORE than standard is an unfavourable Dr; less is
a favourable Cr) — the standard-cost basis is unchanged. Pins:
- unfavourable (bill 10.05 vs standard 10, within 1% tolerance) → **Dr PPV 5**, AP 1005, GRNI nets 0;
- favourable (bill 9.95) → **Cr PPV 5**, GRNI nets 0;
- unit: no-variance (billed == received) posts no PPV line; tax leg books to 1200; all balanced.
Beyond tolerance → HOLD (no PPV, no posting).

---

## F · GL OWNERSHIP PROOF

Production has ONE authoritative vendor-bill posting owner: `handleVendorBillChangeForGl` (the live finance path). A
goods bill relieves GRNI there; a service bill books Operating Expense there. The ERP document-adapter's
`finance-vendor-bills` `postOn.posted` leg (`deriveSupplierBillPosting`) is **dormant in production** — the adapter
fires on the record-level status, which is always `active`, never the domain `posted` (documented at
`documentSpecs.ts`). It was deliberately **retained, not retired**, because it is the only coverage carrier for the
`erpIntegration`/`documentAdapter` derivation tests and retiring it before this session's live path existed would
have removed a mechanism and its tests; it cannot double-post (proven inert). Consolidating it away is a clean
follow-up. ONE journal seam (`applyGlDerivedEntries` → journal `post` → CST) and ONE canonical account mapping
(Session 10: AP 2000, GRNI 2150, PPV 5920, COGS 5050, Inventory 1300) throughout.

---

## G · TEST COUNTS

| Suite | Result |
|---|---|
| `session11VendorBillP2P.test.ts` (5 unit + 6 gate + 1 service + 4 idempotency/reversal/e2e/tenancy) | **16/16** |
| Blast radius — all `src/main/enterprise` | **1337** (1321 baseline + 16) |
| `src/main/erp` + `src/main/medicalDevice` | **220** (unchanged) |
| `typecheck` (tsc node + web) | clean |
| `electron-vite build` | clean |
| ESLint on the 5 changed/new files | clean (exit 0) |

---

## H · NEGATIVE-CONTROL RESULTS

Each mutation makes the appropriate suite fail; each restore is byte-identical (sha256 verified).

| # | Mutation | Failing suite | Restored byte-identical |
|---|---|---|---|
| 1 | Bypass the approve match gate (`if (false && !matched)`) | session11 (mismatch tests) | ✓ |
| 2 | Bypass GRNI relief (goods bills fall to OpEx) | session11 (GRNI-nets-zero + e2e) | ✓ |
| 3 | AP off 2000 (`2000→9990`) | session10 literal pin + session11 e2e (AP can't net) | ✓ |
| 4 | PPV off 5920 (`5920→9992`) | session10 literal pin | ✓ |
| 5 | GRNI off 2150 (`2150→9991`) | session10 literal pin | ✓ |

Post-restore shas equal the pre-mutation baseline for all three touched files. (Directive items 8/9/10 — CST bypass,
idempotency removal, cross-tenant — are covered by existing, unmutated suites: the CST journal-post transition tests,
the `decideLifecycle` idempotency already pinned, and the tenancy/store-scope suites plus the new cross-tenant PO
test; they were not re-mutated to avoid touching frozen/kernel surfaces.)

---

## I · TYPECHECK / LINT / BUILD

`typecheck:node` + `typecheck:web` clean · `electron-vite build` clean · ESLint clean on all five changed/new files.
Repo-wide `npm run lint` carries the same pre-existing backlog in unmodified test files noted in Session 10 (a
sandbox-vs-Mac config difference); no lint regression is introduced here — please confirm on the Mac.

---

## J · COMMIT SHA

`<filled at commit>` — one commit, `erp(s11): …`. The user pushes from the Mac.

---

## K · REMAINING RISKS / BOUNDS (honest)

- **Partial billing is HELD, not posted.** `threeWayMatch` returns `PARTIAL` when billed < received; under the ruled
  MATCHED-only gate that fails closed (no partial GRNI relief). This is the conservative, non-invented behaviour —
  posting a partial relief needs a partial-billing policy (a future ruling), not guessed here.
- **Foreign-currency goods bills:** relief posts in functional amounts; for a non-USD goods bill the PPV line
  captures the combined price + FX variance (a stated simplification). Single-currency (the e2e and all pins) is
  exact. FX-on-purchase as a separate line is future work.
- **Pre-existing control-account seeding-order fragility (discovered, not introduced):** `seedControlAccountsIfEmpty`
  seeds Cash/AR/OpEx/etc only while the chart is empty; if stock activity (which lazily ensures stock accounts) is
  the very first GL posting on a fresh chart, the finance control accounts are never seeded and later cash/AR
  postings would be refused. Production seeds control accounts at boot; the test harness seeds them explicitly to
  mirror that. Flagged for a boot-seed hardening gate — out of scope here.
- **Dormant adapter leg retained** (see §F) — inert in production, formal removal is a follow-up.
- **PO and goods receipt remain single-product headers.** The bill is genuinely multi-line, matched by SKU; a
  multi-SKU PO would be multiple POs today. Extending PO/GR to multi-line is separate scope.

---

## L · STATUS: 🟢 GREEN

All sixteen §16 acceptance criteria are met and proven: durable bill line items · line-level three-way match on
PO/GR-sourced goods bills reusing the existing engine · mismatch fails closed · MATCHED bills post through the single
authoritative live GL owner · GRNI relieved to zero · within-tolerance variance → PPV 5920 · AP = 2000 · standard
costing truthful and unchanged · CST governs DRAFT→POSTED (downstream, untouched) · repeated approval cannot
double-post · reversal mirrors the booked relief · tenant boundaries hold (cross-tenant PO refused) · full regression
green · negative controls prove the gates · no frozen surface modified · end-to-end receipt → bill → payment leaves
GRNI reconciled to zero. GREEN with the explicitly-stated bounds in §K (partial billing held; FX-PPV simplification;
dormant leg retained-inert) — each a deliberate, non-invented boundary rather than an unmet criterion.

Session 11 is one integrity gate. Session 12 not started.
