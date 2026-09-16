# ERP — SESSION 10: GL POSTING-OWNERSHIP DECISION MEMO (STOP — ACCOUNTING RULING REQUIRED)

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `a38dfac`
**Status:** ⛔ **STOPPED at the inspect-before-modify boundary. No production code changed. No test changed. No
commit. Frozen surfaces untouched.** Per the Session 10 STOP rule (§16) and standing discipline ("never invent
accounting policy"), the canonical account mapping and the live-path GRNI/three-way-match policy are **not**
definitively established by the repository, so this memo returns the decision rather than guessing it.

**Label:** SOURCE-PROVEN (every load-bearing code path below verified by reading source at the cited file:line;
the crux account constants were read directly, not taken on the sweeps' word).

---

## 0 · WHY THIS IS A STOP (the rule that fired)

Session 10 §4 says: *if the repository does not establish a definitive mapping for AP, COGS, Operating Expense, Tax
Payable, GRNI → STOP and return a decision memo.* §16 adds: canonical AP account, COGS-vs-OpEx mapping, GRNI variance
treatment, three-way-match policy, quantity/price variance, tax treatment.

Measured result: **four of five mappings are contested, and the entire live-path P2P policy (GRNI relief, match
gating, variance) is undefined.** The one thing the repository *does* establish cleanly (the finance chart) is
frozen, and the thing that is wrong (the ERP `postingRules` chart) is non-frozen — which makes the fix direction
low-risk but still policy-gated. Details below.

---

## A · GL SOURCE-OF-TRUTH MAP (live, as of `a38dfac`)

There is **one journal-posting seam** — `applyGlDerivedEntries` (finance/glPosting.ts) → journal `post` →
CST-governed DRAFT→POSTED. Both "owners" post *through* it. The split is in **derivation** and, worse, in **which
chart the derivation uses**. The Session 9 audit's phrase "two posting owners" is refined here (per §2 #20/#21): the
integrity problem is **two account charts + a dormant duplicate supplier-bill derivation + an unwired matcher**, not
two competing journal writers.

| Domain | Live derivation owner | Wiring (file:line) | Chart used | Double-post today? |
|---|---|---|---|---|
| Goods receipt → GRNI | `postingRules.deriveGoodsReceiptPosting` **via movement bridge** | `goodsReceiptModule.ts:108` → `stockMovementModule.ts:177` → `inventoryGlBridge.ts:88` | STOCK_ACCOUNTS | No (latent only) |
| Vendor bill → AP | `glPosting.handleVendorBillChangeForGl` | `vendorBillModule.ts:176`; posts on `approved\|paid` | finance chart | No |
| Sales invoice → AR/Rev/Tax | `glPosting.handleInvoiceChangeForGl` | `invoiceModule.ts:196` | finance chart | No |
| Sales issue → COGS | `postingRules.deriveCogsPosting` **via bridge** | `shippingModule.ts:122` → bridge `inventoryGlBridge.ts:97` | STOCK_ACCOUNTS | No (latent only) |
| Stock adjustment | `postingRules.deriveInventoryAdjustmentPosting` **via bridge** | `inventoryGlBridge.ts:130` | STOCK_ACCOUNTS | No |
| Production consumption → WIP | `postingRules.deriveMaterialIssuePosting` **via bridge** | `executionModule.ts` → bridge `inventoryGlBridge.ts:106` | STOCK_ACCOUNTS | No (latent only) |
| Production completion → FG | `postingRules.deriveProductionCompletionPosting` **via bridge** | bridge `inventoryGlBridge.ts:116` | STOCK_ACCOUNTS | No (latent only) |
| Production variance → 5910 | `productionVarianceSettlement` (module-local seam) | `productionOrderModule.ts:153` | STOCK_ACCOUNTS | No |
| Customer / vendor payment | `glPosting.handle*PaymentChangeForGl` | `paymentModule.ts:266`, `vendorPaymentModule.ts:225` | finance chart | No |
| Payroll / expense / fixed asset / credit-debit notes | module-local seams via `applyGlDerivedEntries` | respective modules | finance chart | No |
| FX revaluation | `glPosting.handleFxRevaluationChangeForGl` | `fxRevaluationModule.ts:212` | finance chart | No |
| Reversal / void | `glPosting.reverseGlEntry` | `inventoryGlBridge.ts:166`; `glPosting.ts:273` | matches original | No (idempotent `-REV`) |
| **Vendor bill → GRNI relief** | `postingRules.deriveSupplierBillPosting` | **only** `documentSpecs.ts:91` (`postOn.posted`) | STOCK_ACCOUNTS | **DORMANT — never fires** |

**Dormancy proof (three independent locks on the supplier-bill adapter leg):** the document adapter posts only on
`status_changed`/`created` (`documentAdapter.ts:356`) but domain actions emit `updated`; it reads the **record-level**
status (`documentAdapter.ts:358`), which is always `active` (`enterpriseRecordStore.ts:455`), so `postOn['active']` is
undefined for every spec; and the bill status enum is `draft|approved|paid|cancelled` (`vendorBillModule.ts:92-97`) —
`posted` is unreachable. So the one derivation that would relieve GRNI and book AP correctly **has no live caller**.

**Net:** `postingRules.ts` is **half-live** — every inventory-movement posting (receive/issue/consumption/output/
adjustment) runs through the bridge and is correct in structure — and **half-dormant** — the supplier-bill/GRNI-relief
derivation never runs. The finance chart and the STOCK_ACCOUNTS chart have **never been posted into one ledger by any
test**, because finance tests run a finance-only chart and ERP tests run a stock-only chart.

---

## B · CANONICAL ACCOUNT MAPPING — SOURCE-VERIFIED CONFLICT TABLE

Finance chart lives in **frozen** `packages/shared/src/types/*` and is **literal-pinned** by passing tests (changing
a code breaks a test). The ERP chart lives in **non-frozen** `apps/desktop/src/main/erp/postingRules.ts` and is only
**symbolic-pinned** (tests read `STOCK_ACCOUNTS.x`, so they pass at any code value).

| Account | Finance chart (frozen) | ERP `STOCK_ACCOUNTS` (non-frozen) | Test-pinned truth | Verdict |
|---|---|---|---|---|
| Accounts Payable | **2000** `vendorBills.ts:27` | **2100** `postingRules.ts:41` | 2000 literal (`payableRevaluation.test.ts:29`, `vendorPayments`, `apMultiCurrency`); 2100 symbolic only | **CONFLICT** |
| Tax Payable | **2100** `generalLedger.ts:641` | — (2100 reused as AP) | 2100 literal (`glAutoPosting.test.ts:43`, `taxReport`) | **CONFLICT** (its code is squatted by ERP-AP) |
| Operating Expenses | **5000** `vendorBills.ts:29` | — (5000 reused as COGS) | 5000 literal (`adjustmentNotes`, `apMultiCurrency`) | **CONFLICT** (its code is squatted by ERP-COGS) |
| COGS | — (none) | **5000** `postingRules.ts:43` | 5000 symbolic only | **CONFLICT** (collides with OpEx) |
| GRNI | — (none) | **2150** `postingRules.ts:38` | 2150 sole owner | **CANONICAL 2150** |
| Inventory / WIP / FG | — | 1300 / 1350 / 1360 | sole owner | **CANONICAL** |
| Inv Adjustment / Material Var / Prod Var | — | 5010 / 5900 / 5910 | sole owner (5910 pinned) | **CANONICAL** |
| Cash / AR / GST Input / Revenue / Dep / FX | 1000 / 1100 / 1200 / 4000 / 5100 / 7810-7811 | — | literal-pinned | **CANONICAL** |

**Root cause, source-confirmed:** `postingRules.ts:24-29` header states *"the existing engine already uses … 2100
(payable)."* That is factually wrong — the finance chart uses **2100 for Tax Payable** and **2000 for AP**
(`generalLedger.ts:641`, `vendorBills.ts:27`). That single misread produced both the AP-code divergence and the 2100
collision; the 5000 collision is the same mistake for COGS vs Operating Expenses.

**Frozen-surface consequence (decisive for the fix):** the finance codes cannot be changed without an FG gate
(`packages/shared`). The ERP codes are non-frozen. The finance codes are also the standard, literal-test-pinned,
almost-certainly-correct ones. **So the only sane and lowest-risk direction is to align the non-frozen
`postingRules.ts` to the frozen finance chart — no FG gate required.** But *which* codes AP and COGS take is an
accounting-chart decision, so it is still a ruling (below), not mine to assume.

---

## C · THE DEFECT, REPRODUCED FROM SOURCE (receive → bill → dispatch, qty 100 @ standard cost 10)

```
1) Goods receipt   (MOV-…, bridge, live)   Dr Inventory 1300   1000
                                           Cr GRNI      2150         1000     ✓ posts
2) Vendor bill approve (JE-BILL-…, live)   Dr Op.Expense 5000  1000
                                           Cr A/P        2000        1000     ✓ posts, balanced
3) Sales dispatch  (MOV-…, bridge, live)   Dr COGS       5000  1000
                                           Cr Inventory 1300        1000     ✓ posts, balanced
```

Each entry balances (no guard trips), but the **model is incoherent**:
- **GRNI 2150 is stranded forever** — no live path ever debits it (the only reliever, `deriveSupplierBillPosting`, is
  dormant). GRNI grows without bound as a phantom liability.
- **The purchase is expensed twice to account 5000** — once as "Operating Expenses" at bill approval, once as "COGS"
  at dispatch — because ERP COGS (`5000`) **collides** with finance Operating Expenses (`5000`).
- The correct model books step 2 as **Dr GRNI 2150 / Cr AP 2000** (relieving the accrual, deferring cost to
  inventory), so cost hits P&L once, as COGS, at dispatch.

This is the "green pixel with no proof beneath" case: every entry is individually balanced and green, while the
ledger as a whole is wrong.

---

## D · E — COGS COSTING TRUTH

The live COGS derivation is `deriveCogsPosting({ method: 'weighted_average' })` (`inventoryGlBridge.ts:97-103`), but
the mechanism posts the supplied `unitCost`, which `postMovement.ts:27-40` resolves as the product's **standard
cost** (Session 5-Fix). No average is computed on this path. The FIFO/weighted-average math exists only in the
**report-only** Inventory Valuation register and drives neither the ledger nor COGS. **The live costing mechanism is
STANDARD COST; the `weighted_average` label is untrue.** (This is a truthfulness fix — align the label/memo/metadata
to `standard` — and is a separate item from the ownership decision; it does NOT require changing the Session 5-Fix
costing model.)

---

## D · DECISIONS REQUIRED (rule these; I will not guess any)

Each: the conflict · what runs today · financial consequence · my recommendation · affected modules/tests · frozen?

**D1 — Canonical Accounts Payable code.**
- Conflict: finance **2000** (literal-pinned) vs ERP **2100** (symbolic). 2100 is finance **Tax Payable**.
- Today: live vendor-bill path already books AP to **2000**; the ERP 2100-AP derivation is dormant.
- Consequence if unresolved: any future unification of the charts posts AP into Tax Payable (2100) or fails to resolve
  finance AP — corrupting both balances.
- **Recommendation: AP = 2000.** Change non-frozen `postingRules.ts:41` `accountsPayable: '2100' → '2000'`. No frozen
  change; ERP AP tests are symbolic so stay green; add a literal pin.
- Affected: `erp/postingRules.ts`; tests `erp.test.ts`, `erpIntegration.test.ts` (symbolic — unaffected). Frozen? **No.**

**D2 — Canonical COGS code (resolve the 5000 collision with Operating Expenses).**
- Conflict: ERP **COGS = 5000** collides with finance **Operating Expenses = 5000** (literal-pinned, frozen).
- Today: both post to 5000; a goods purchase double-hits 5000 (see §C).
- Consequence: P&L cannot distinguish cost of goods sold from operating expense; the two are summed in one account.
- **Recommendation: give COGS its own code** (e.g. **5050 "Cost of Goods Sold"**; operator confirms the number),
  changing non-frozen `postingRules.ts:43`. Keep Operating Expenses = 5000 (frozen, for non-inventory/service bills).
- Affected: `erp/postingRules.ts`; symbolic COGS tests unaffected; add a literal pin. Frozen? **No.**

**D3 — GRNI relief on the live vendor-bill path (the core integrity fix).**
- Conflict/gap: goods receipt accrues GRNI (Cr 2150) but no live bill path relieves it; the correct reliever is
  dormant.
- Consequence: stranded GRNI + purchase expensed at bill instead of deferred to COGS (§C).
- **Recommendation: route the finance `vendorBillModule.approve` posting through GRNI relief for goods bills** —
  book **Dr GRNI 2150 / Cr AP 2000** (reusing `deriveSupplierBillPosting`'s logic through the existing
  `applyGlDerivedEntries` seam), so a received-then-billed purchase nets GRNI to zero and defers cost to COGS at
  dispatch. **This requires distinguishing goods bills from service bills** (see D5).
- Affected: `finance/vendorBillModule.ts`, `finance/glPosting.ts` (or a shared derivation); new regression pins for
  GRNI-nets-to-zero on the *live* path. Frozen? **No** (both non-frozen); the journal seam and CST path are untouched.

**D4 — Three-way-match gating on the live path.**
- Gap: the `threeWayMatch` engine is pure, correct, tested — and **unwired**. `vendorBillModule.approve` posts AP
  with no match (fails open).
- Consequence: a bill with quantity/price mismatch against its PO/GR posts a payable anyway.
- **Recommendation: for bills sourced from a PO/GR, require `threeWayMatch` = MATCHED before posting; mismatch →
  fail closed (HOLD)**, reusing the existing engine (no parallel matcher). Whether *all* bills or only PO-sourced
  bills must match is the sub-decision.
- Affected: `finance/vendorBillModule.ts` (+ `erp/threeWayMatch.ts` as the gate); new fail-closed pins. Frozen? **No.**

**D5 — Goods-bill vs service-bill distinction, and price/quantity variance treatment.**
- Gap: the vendor bill module doesn't distinguish an inventory (goods) bill — which should relieve GRNI — from a
  service/expense bill — which correctly books Operating Expenses 5000. And there is **no purchase-price-variance
  (PPV) account**: today the matcher blocks out-of-tolerance bills rather than posting a variance.
- Consequence: without the distinction, D3 can't be applied selectively; without a variance policy, a legitimate
  small price difference either blocks the bill or is silently absorbed.
- **Recommendation:** (a) treat a bill linked to a PO/GR as a goods bill (relieve GRNI), else a service bill (OpEx);
  (b) for standard-cost receipts, post the receipt-vs-bill price difference to a **new PPV account** (operator
  assigns the code) rather than absorbing it — consistent with standard costing (do **not** switch to actual
  costing). If you prefer "block, don't post" for any variance, say so and I will not add a PPV account.
- Affected: `finance/vendorBillModule.ts`, `erp/postingRules.ts`, chart seed; new pins. Frozen? **No.**

**D6 (confirm, low-risk) — retire the dormant duplicate + close the latent double-post.**
- The dormant `documentSpecs` supplier-bill `postOn.posted` leg should be **retired** (it can never fire, and if it
  ever did it would double-book GRNI against the movement bridge). This also settles pending task #96 and the
  `ERP-SESSION2-POSTING-PARITY-DECISION.md` "Option A" recommendation.
- **Recommendation: single derivation ownership** — inventory-movement postings stay owned by the bridge; the
  vendor-bill/GRNI-relief posting is owned by the finance vendor-bill path (D3); the dormant adapter leg is removed.
- Affected: `erp/documentSpecs.ts` (remove the dead spec), tests referencing it. Frozen? **No.**

---

## E · WHAT SESSION 10 IMPLEMENTATION LOOKS LIKE ONCE RULED (NOT DONE)

On your ruling I will, under full discipline (reproduce-first with an executable pin, root-cause fix, negative
controls with byte-identical restore + sha, tsc node+web + lint + build, one commit, you push):
1. Reproduce the §C defect as a failing test on the **live** `createVendorBillModule` draft→approve path (today no
   such test exists — every green GRNI/match test uses stubs).
2. Align the non-frozen `postingRules.ts` chart to the frozen finance chart per D1/D2 (+ literal pins).
3. Wire GRNI relief (D3) and three-way-match gating (D4) into the live vendor-bill path, reusing existing engines and
   the single journal/CST seam.
4. Apply the goods/service distinction + variance policy per D5; retire the dormant leg per D6.
5. Fix the COGS `weighted_average` → `standard` label (§D-E truthfulness).
6. Prove: receive→bill→pay nets GRNI to zero; mismatched bill fails closed; no double-post; one chart; all prior
   finance/ERP/inventory/manufacturing/CST suites green + new pins; idempotency + tenancy + reversal invariants hold.

**No frozen surface is touched by any of the above** — the canonical chart already lives in frozen `packages/shared`
and is correct; the work is aligning the non-frozen ERP chart to it and wiring the live P2P lifecycle.

---

## F · BOUNDARY STATEMENT

Session 10 stopped at the inspect boundary as the gate requires. No production code, test, or configuration was
modified; nothing was committed; frozen surfaces were not touched. The conflicts and the stranding defect are
SOURCE-PROVEN at the cited file:line (the account constants were read directly in `packages/shared` and
`erp/postingRules.ts`). The repository establishes the **finance** chart canonically (frozen, literal-pinned) and the
inventory-only accounts canonically (GRNI 2150, Inventory/WIP/FG, variances), but it does **not** reconcile AP (2000
vs 2100), COGS-vs-OpEx (5000 collision), or the live-path GRNI-relief / three-way-match / variance policy — those are
the rulings requested above. Awaiting your decision on D1–D6; I will not proceed to implementation until then.
