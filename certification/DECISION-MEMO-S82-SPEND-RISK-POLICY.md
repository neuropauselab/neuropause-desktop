# DECISION MEMO — S82 Spend Analytics + Supplier Risk: method & policy assumptions

**Class:** design/policy record for the S82 governed procurement spend-analytics + supplier-risk registers.
**Discipline:** no numerical risk policy, weight, threshold, category taxonomy or currency-conversion rule is invented. Every number a register carries is produced by a formula that already ships; where a choice was unavoidable it is a *reuse of an existing repo convention* or a *universal, stated assumption*, recorded here for the operator.

## Canonical sources reused (no duplicates created)

| Need | Authoritative source reused |
|---|---|
| PO money | `calculatePurchaseTotal` (`packages/shared/src/types/procurement.ts:228`) — subtotal − discount + tax. The stored `total` field is never trusted. |
| ORDERED set | POs not draft/cancelled — the exact `procurementSpend` set of `deriveProcurementInsights` (`procurement.ts:388`). |
| COMMITTED set | `COMMITTED_PO_STATUSES` (`packages/shared/src/types/budgetControls.ts:30` — approved/sent/received, the FW-5 commitment-control set). |
| OPEN set | `OPEN_PO_STATUSES` (`procurement.ts:47` — draft/approved/sent, the in-flight set). |
| INVOICED set | approved + paid vendor bills — the booked-payable convention: only `approved` bills age in `deriveApAging` (`vendorBills.ts:191`); drafts are merely created and cancelled are dead (the same exclusion convention the PO spend set uses). |
| PAID | cleared vendor payments — the settlement source of truth (`vendorPayments.ts` header: "a vendor bill is paid when — and only when — its cleared payments cover its total"). |
| Vendor risk score | `calculateVendorRisk` (`procurement.ts:278`) — called, never rewritten, never re-weighted. |
| Delivery evidence | the `DeliveryRow` builder of `deriveProcurementInsights` (`procurement.ts:392-399`): receipts with status `received` → {expectedDate, receiptDate, quantityOrdered, quantityReceived}. Reproduced verbatim in `deliveryRowsFromReceipts`. |
| High-risk cutoff | **score >= 60** — the repo's existing cutoff (`deriveProcurementInsights`, `procurement.ts:405`). Re-declared as `HIGH_RISK_SCORE_CUTOFF` only because the source keeps it inline; the VALUE is the repo's. |
| On-time / late | `calculateDeliveryPerformance` (`procurement.ts:254`) and the `rec > exp` late rule of `deriveProcurementInsights` (`procurement.ts:400-404`). |
| Scorecard weights | the 0.6 × on-time + 0.4 × accuracy-fit weights live in `calculateSupplierPerformance` (`procurement.ts:267-275`) / `deriveSupplierPerformance` (`supplierPerformance.ts:110`) — S82 does NOT re-apply or re-tune them; the delivery evidence feeds `calculateVendorRisk` and the weights stay where they ship. |
| Open payable exposure | the `deriveApAging` open-payable rule (`vendorBills.ts:188-195`): approved bills with `outstanding > 0`; partial payments reduce what is open (W1.11). |
| Contract standing | `contractWindowState` / `contractDaysRemaining` (`vendorContracts.ts:60,71`); expiring-soon = open ∧ daysRemaining ≤ the contract's OWN `renewalNoticeDays` (`evaluateContractGate`'s rule, `vendorContracts.ts:175-177`); case-insensitive trimmed-name supplier match (same function). |
| Supplier join | TRIMMED NAME with the `(unattributed)` fallback — the `deriveSupplierPerformance` precedent (`supplierPerformance.ts:74`). Missing names are grouped there AND counted in the register's exclusions, never hidden. |
| Register pattern | `supplierPerformanceModule` / `apAgingModule` — create = generate, immutable `generatedAt` fence, honest empty note, `procurement:read` / `procurement:manage`, group Procurement. |
| Tenant isolation / RBAC | `EnterpriseRecordStore` (`scopeOrDeny`) + module `permissions` — inherited, no new authority path. |

## Decision 1 — Lifecycle states are SEPARATE numbers, never one "spend" figure

Ordered / committed / open / received / invoiced / paid each keep their own column, each derived from its own already-shipped status set (table above). Note for the reader: TODAY the ordered set ({approved, sent, received}) and `COMMITTED_PO_STATUSES` coincide, so `orderedValue == committedValue` on every current register. Both are still reported because they cite different authorities (executive spend vs. FW-5 budget commitment) and are free to diverge if either canonical set ever changes — the register would track its sources, not a snapshot of their coincidence.

## Decision 2 — Period rollup = calendar month of the PO's created date

A calendar convention, not a policy: `YYYY-MM` of `createdAt` (the record envelope every PO carries). No fiscal calendar is invented — the repo defines none for procurement. Ordered POs whose date cannot be parsed are counted in `exclusions.undatedOrders`, stay in the totals, and are absent from the rollup — stated, not smoothed.

## Decision 3 — Per-supplier delivery evidence (attribution, not a new formula)

`deriveProcurementInsights` evaluates `calculateVendorRisk(s, rows)` with the GLOBAL received-receipt rows (`procurement.ts:405`) because it only needs an install-wide count. A per-supplier REGISTER row must not let vendor A wear vendor B's late deliveries, so S82 feeds the SAME builder's rows filtered to the row's supplier (trimmed-name join). The formula, its weights and the >= 60 cutoff are byte-identical; only the attribution of evidence is scoped to the supplier the row is about. The KPI seam count uses the same per-supplier rule, so seam and register always agree.

## Decision 4 — Suppliers without evidence: explicit, never fabricated

- A REGISTERED supplier with no transactions still gets a risk row — `calculateVendorRisk` scores master fields (rating / lead time / status) with the delivery term simply absent, exactly as the formula behaves on empty rows — and the row says "no received deliveries … unmeasured". `deliveryPerformancePct` is `null`, never a fabricated 100-as-data.
- A name seen ONLY in transactions (no supplier master) cannot be scored — the formula's inputs do not exist — so it is EXCLUDED and NAMED in `unregisteredSuppliers` + the note. The scorecard precedent (registered-but-unmeasured counted, not faked) applied in both directions.
- In the spend register the reverse rule holds: registered-but-untransacted suppliers get NO zero row (counted in the note), and unattributed transactions get the `(unattributed)` row plus exclusion counts.

## NOT DERIVABLE — excluded, with the absent field named

- **Spend by category**: neither `PurchaseOrder` nor `VendorBill` (nor `Supplier`, nor the product master used by procurement) carries any category/classification field — there is no `category`, `costCenter`, `commodityCode` or equivalent anywhere in the shared procurement or payable types. A category dimension would require inventing a taxonomy and a mapping; excluded, not approximated by product name or account guesswork.
- **Cross-currency normalization**: the repo's aging-register convention is to SUM NOMINAL AMOUNTS as recorded — `deriveApAging` adds `outstanding` across bills with no FX conversion (bills carry `exchangeRate` for GL functional posting, but the aging/register layer does not convert), and `apAgingModule` snapshots those nominal sums. S82 follows that exact convention: sums are nominal amounts as recorded, stated here as the convention rather than silently converting at an unspecified rate. A functional-currency spend view would be a separate, rate-dated derivation.

## Nothing invented — explicit list

Not invented: risk weights · risk thresholds (the >= 60 cutoff is cited, not chosen) · scorecard weights (0.6/0.4 stay in their shipped formulas) · exposure limits (the KPI condition ships UNCONFIGURED = null, fail-closed, until an operator sets one) · category taxonomy · FX conversion policy · fiscal calendar. Module ids are LOCAL consts (`procurement-spend-analytics` / `procurement-supplier-risk`, the `multiLineReceiptModule` precedent) — the frozen shared types are untouched. No operator value was fabricated; no STOP was required for correctness.
