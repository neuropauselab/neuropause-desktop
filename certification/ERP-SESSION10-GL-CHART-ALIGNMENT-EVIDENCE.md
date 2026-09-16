# ERP — SESSION 10: GL CHART ALIGNMENT + COGS TRUTHFULNESS (partial gate; GRNI/match escalated)

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `a38dfac`
**Label:** TEST-VERIFIED. Operator-ruled decisions applied (AskUserQuestion, this session): AP = 2000 · COGS = new
code 5050 · three-way match on PO/GR-sourced bills only · within-tolerance variance → a Purchase Price Variance
account. No frozen surface touched. No accounting policy invented.

**Honest gate status:** Session 10's §18 GREEN criterion ("vendor bills correctly pass through the established
three-way-match/GRNI lifecycle") is **NOT fully met this session**, for an evidence-backed reason discovered during
the mandated inspect-before-modify step (below). What IS delivered and proven: the account-code integrity core — the
AP/Tax-Payable and COGS/Operating-Expenses collisions, and the COGS costing-label untruth. The GRNI-relief + line-
level three-way-match wiring is **escalated** with a specific next decision.

---

## 1 · WHAT WAS DELIVERED (non-frozen, tested, committed)

**(a) Canonical chart alignment — the account-code collisions resolved.** The finance chart (frozen
`packages/shared`, literal-test-pinned) is authoritative; the non-frozen ERP `postingRules.ts` chart was aligned to
it:
- **Accounts Payable 2100 → 2000** (`postingRules.ts` `STOCK_ACCOUNTS.accountsPayable`). 2100 is Tax Payable in the
  finance chart; ERP AP had squatted it. Now matches finance AP exactly.
- **COGS 5000 → 5050** (`STOCK_ACCOUNTS.cogs`). 5000 is Operating Expenses in the finance chart; ERP COGS had
  collided with it, so a goods purchase's bill-expense and dispatch-COGS both landed in one merged 5000 account. COGS
  now has its own code, distinct and auditable.
- **Purchase Price Variance 5920 added** (`STOCK_ACCOUNTS.purchasePriceVariance` + `STOCK_ACCOUNT_DEFS`), the ruled
  standard-cost variance target, reserved for the GRNI-relief wiring.
- The factually-wrong header comment (which read "2100 (payable)" and was the origin of the drift) is corrected to
  state the real finance chart.

**(b) COGS costing-label truthfulness.** The live inventory→GL bridge (`inventoryGlBridge.ts`) and the delivery
document specs (`documentSpecs.ts`) called `deriveCogsPosting({ method: 'weighted_average' })` while the mechanism
posts the product's **standard cost** (Session 5-Fix). Changed to `method: 'standard'` so no memo/report claims a
weighted-average the system does not compute. The Session 5-Fix costing model is unchanged.

**(c) Dormant supplier-bill leg RETAINED (not retired) — a corrected sequencing decision.** The memo's D6 recommended
retiring the dormant `documentSpecs` `finance-vendor-bills` posting leg for single ownership. During implementation
this was found premature: that leg's `deriveSupplierBillPosting` is the **only GRNI-relief derivation in the
codebase**, and its two integration tests (`documentAdapter.test.ts`, `erpIntegration.test.ts`) are the only
coverage that a receive→bill cycle nets GRNI to zero. Retiring it **before** its live replacement exists would
delete the mechanism and its coverage. It is therefore retained (its AP code now follows the alignment: 2000), with
an in-code NOTE that consolidation to a single owner travels **with** the live GRNI-relief wiring. This honors "don't
fake green" and "never leave a red tree" without removing a mechanism before its replacement.

---

## 2 · WHY GRNI RELIEF + THREE-WAY MATCH ARE ESCALATED (inspect-before-modify finding)

The mandated source trace established that the **live finance vendor bill is header-only**: `vendorBillModule.ts`
carries a single `amount`/`taxAmount`/`total` and an optional `sourcePurchaseOrder` reference — **no line items**.
The goods receipt (`goodsReceiptModule.ts`) is likewise single-product/header-only. The ruled control (§D4) is the
existing `threeWayMatch` engine, which is **line-based** (it matches ordered/received/billed quantity and unit price
per product line).

A line-level three-way match **cannot be correctly applied to header-only bills**: with no per-line detail, the
engine would compare a single synthesized value and **misclassify the legitimate standard-vs-actual price variance as
a MISMATCH** (blocking every bill that has any PPV — the opposite of correct). Value-level GRNI relief is
unambiguous only for the simple full-receipt/full-bill case and becomes ambiguous for partial or multi-receipt bills
(it cannot tell a price variance from a quantity over-bill without quantities).

Per the STOP discipline (never fake a control; never guess money-path semantics), the GRNI-relief + match wiring is
returned as one further decision rather than implemented on a model that cannot support the ruled control:

> **DECISION D7 (next):** To wire live GRNI relief + the ruled line-level three-way match, the finance **vendor bill
> must carry line items** (product, quantity, unit price) so the existing `threeWayMatch` engine can be reused
> correctly. Two paths:
> - **(a) Add vendor-bill line items first** (its own gate), then reuse the line-level `threeWayMatch` and post
>   Dr GRNI / Dr-or-Cr PPV 5920 / Dr GST / Cr AP 2000 on the live finance path — the fully-correct control.
> - **(b) Value-level relief now** — relieve GRNI at the PO-accrued value with PPV for the difference, honestly
>   labelled a value/two-way control (not the ruled line-level match), with partial/multi-receipt cases held for
>   review. Lower fidelity; interim.
>
> D3 (GRNI relief), D4 (three-way match) and D6 (retire the dormant leg) all land together once D7 is ruled.

GRNI stranding is therefore **not yet closed**; the chart alignment makes the resulting double-expense *visible and
auditable* (COGS 5050 distinct from Operating Expenses 5000) rather than hidden in one merged account, but
eliminating it is the D7 step.

---

## 3 · TESTS + EVIDENCE

| Check | Result |
|---|---|
| New pins `session10GlOwnership.test.ts` (chart + no-collision + derivations + live bridge label + reproduction) | **12/12** |
| `src/main/erp` (erp, erpIntegration, documentAdapter, documentWiring) + inventoryGlBridge + productionCostingAndVariance | **137/137** |
| Blast radius — all `src/main/enterprise` | **1321/1321** (unchanged from baseline) |
| `src/main/medicalDevice` + `src/main/erp` | **220** (208 baseline + 12 new pins) |
| `typecheck` (tsc node + web) | clean |
| ESLint on the 5 changed files | clean (exit 0) |
| `electron-vite build` | clean (exit 0) |
| Negative control | mutate COGS 5050→5000 **and** AP 2000→2100 (reintroduce both collisions) → **9/12 fail** → restore **byte-identical** (sha256 `0501af69…` both sides) |

**Repo-wide `npm run lint` note (pre-existing, not this change):** `eslint .` reports a large backlog concentrated in
**test files** unrelated to this change (e.g. `cst/sendTransition.negative.test.ts`, unmodified at HEAD). The 5 files
this session touched are eslint-clean. This looks like an environment difference (test files being linted in the
sandbox that the Mac `lint` config ignores); flagged for confirmation on the Mac. No lint regression is introduced by
Session 10.

---

## 4 · ACCOUNTING INVARIANTS PROVEN

- **No cross-chart collision:** the finance chart ∩ stock chart = exactly `{2000}` (Accounts Payable, intentionally
  the same account); nothing else overlaps. Tax Payable 2100 and Operating Expenses 5000 are each single-meaning
  again.
- **COGS ≠ Operating Expenses:** a dispatch books COGS to 5050; a service bill books Operating Expenses to 5000 —
  distinct, auditable accounts.
- **AP ≠ Tax Payable:** supplier payable books to 2000, never 2100.
- **Costing truthful:** the live COGS entry's memo says `standard`, never `weighted_average`; the mechanism is
  standard cost (Session 5-Fix), unchanged.
- **Derivations balanced + idempotent:** all existing `postingRules`/bridge/erp invariants (balance guard,
  `MOV-`/`BILL-`/`GRN-` references, reversal) unchanged and green.

---

## 5 · FILES CHANGED

```
MOD  apps/desktop/src/main/erp/postingRules.ts                 STOCK_ACCOUNTS: AP 2100→2000, COGS 5000→5050, + PPV 5920; corrected header comment
MOD  apps/desktop/src/main/erp/stockAccounts.ts                STOCK_ACCOUNT_DEFS: + Purchase Price Variance 5920 (expense)
MOD  apps/desktop/src/main/erp/documentSpecs.ts                COGS specs method 'weighted_average'→'standard'; dormant supplier-bill leg RETAINED with a Session-10 NOTE
MOD  apps/desktop/src/main/enterprise/modules/inventory/inventoryGlBridge.ts   live COGS method 'weighted_average'→'standard' (truthful)
NEW  apps/desktop/src/main/erp/session10GlOwnership.test.ts     12 pins: literal codes, no-collision (consumer→producer), derivations, live-bridge label, reproduction
NEW  certification/ERP-SESSION10-GL-OWNERSHIP-DECISION-MEMO.md  the STOP memo + rulings
NEW  certification/ERP-SESSION10-GL-CHART-ALIGNMENT-EVIDENCE.md this document
NEW  certification/ERP-SESSION9-CAPABILITY-AUDIT.md             the Session 9 capability audit (predecessor)
```

Frozen surfaces (`packages/shared`, `cst/`, etc.) untouched. `certification/baseline.json` (custody-protected,
pre-existing working-tree modification) NOT staged.

---

## 6 · REMAINING RISKS / OPEN

- **GRNI still stranded on the live finance path** until D7 is ruled and GRNI relief is wired — the chart alignment
  makes the double-expense visible (two distinct accounts) but does not eliminate it.
- **Two vendor-bill posting derivations still exist** (the live finance path via `handleVendorBillChangeForGl`, and
  the dormant `deriveSupplierBillPosting` leg retained for coverage). Consolidation lands with D7.
- **COGS code change (5000→5050) is a chart migration:** in a store with existing COGS postings at 5000, new
  postings go to 5050 — a real deployment would need a remap/migration of historical COGS. Noted for any data with
  history (dev/test is unaffected).
- **`npm run lint` repo-wide backlog** (pre-existing, test files) to confirm on the Mac.

## 7 · BOUNDARY STATEMENT

Session 10 delivered the account-integrity core (chart alignment + COGS truthfulness), fully tested and non-frozen,
and escalated the GRNI-relief/three-way-match lifecycle with a precise data-model decision (D7). No frozen surface
was touched, no accounting policy was invented, and the dormant GRNI-relief derivation was deliberately retained
rather than removed before its replacement exists. The Session 10 §18 gate is partially met: the collision/
truthfulness half is GREEN; the GRNI/match half awaits D7.
