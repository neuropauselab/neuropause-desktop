# SESSION 78 — ENTERPRISE AUTHORITY & ACCOUNTING POLICY CLOSURE

**Class:** authority/accounting policy implementation gate. Baseline S77 `7c04172`. **The operator supplied no new policy values in this gate** (S58 operator-policy register lines 217/219 remain blank fill-ins; S57 marks these items "C — POLICY-BLOCKED, no thresholds/roles/chains anywhere"). Per the CRITICAL STOP RULE, nothing was fabricated and **no production source was changed**. Release track PAUSED. Reused-only analysis; no duplicate infrastructure.

## Method

For each priority: confirmed the exact implementation, checked whether an authoritative value exists (in code, `DOCUMENT_SPECS`, `postingRules`, or the S57/S58 operator register), implemented only defined portions (all already in code), and left every undefined authority/policy fail-closed with a memo. Two §20 source-wins corrections to S77 memos were applied (see below). D12 and bank-reconciled reversal were NOT reopened.

---

## 1 · Policies already closed (defined + implemented; nothing to add)

- **D12 PO approve/send** — `DEFAULT_SPEND_POLICY` (manager → finance ≥10k → executive ≥100k, SoD creator≠approver) enforced via `documentAdapter` gatedStatuses. Not reopened.
- **Bank-reconciled reversal (NO branch)** — fail-closed refusal + immutable original + immutable reconciliation marker, **already pinned** (`session61PaymentReversal.test.ts:208-211`, `bankWriteBack.test.ts`). Preserved, not reopened.
- **Payroll GL ownership + posting** — `payrollRunModule.post` books the accrual through the single W1 GL seam; `salaryDisbursementModule.disburse` books Dr Salaries Payable / Cr Cash + bank advice (S58 §D8). RBAC-governed, GL-integral, kernel-journaled.
- **Inventory adjustment / cycle-count accounting** — books real GL to `STOCK_ACCOUNTS.inventoryAdjustment = '5010'` via `deriveInventoryAdjustmentPosting` (shrinkage debits 5010, count-up credits 5010), tested `erp/erp.test.ts:411/440/446`. RBAC-governed.
- **Manufacturing variance accounting** — `materialVariance = '5900'`, `productionVariance = '5910'`, `purchasePriceVariance = '5920'` defined in `postingRules.ts`; variance posting decided in Session 5. RBAC-governed.

## 2 · Policies implemented during S78

**None.** No operator values were supplied, and every decision that *was* defined by existing authoritative policy is already implemented in code (§1). Implementing the outstanding gates would require inventing thresholds/roles/approval requirements/recognition models — forbidden by the CRITICAL STOP RULE.

## 3 · Policies still requiring operator decision (fail-closed, memo'd — none invented)

| Priority | What is undefined | Fail-closed today | Memo |
|---|---|---|---|
| **D8 Payroll** | Approval requirement + approver role + threshold + executor≠approver SoD + disbursement authority (posting + GL ownership already closed) | payroll post / salary disburse run under RBAC only; no approval gate | S60-APPROVAL-CONTROL-PLANE, DEEP-FINANCE-HR-AUTHORITY, S58 §D8 |
| **D10 Stock adj / cycle count** | **Approval gate only** — variance materiality threshold + approver + SoD (accounting = CLOSED, account 5010) | adjustments/reconciles post under RBAC only; no approval gate | S77-CYCLE-COUNT-STOCK-ADJUSTMENT (corrected §20) |
| **Manufacturing variance / scrap** | Variance/scrap approval gate + scrap-specific write-off *mapping* (variance accounts 5900/5910 = CLOSED) | variance settles under RBAC; no approval gate | S77-MANUFACTURING-VARIANCE-SCRAP-APPROVAL (corrected §20) |
| **Maintenance cost → GL** | Repair-vs-capex rule + threshold + which GL accounts (no maintenance/repairs account exists) + labor/spare-part posting + approval | no maintenance-cost GL posting occurs | S74-MAINTENANCE-COST-ACCOUNTING |
| **Project cost / revenue → GL** | Revenue-recognition model + project-cost/WIP mapping + capitalization + labor-cost method + budget-variance/write-off + approval (accounts 4000/1350 exist; the *model* does not) | Projects hands off a draft invoice only; no project-cost/revenue GL | S75-PROJECT-COST-REVENUE-ACCOUNTING |
| **Bank-reconciled reversal (YES branch)** | Whether ever permitted + authorizer + compensating treatment + invoice/bill linkage | permanently refused (NO branch closed) | S60-PAYMENT-REVERSAL-AND-DELETE-BOUNDARY, S61-PAYMENT-REVERSAL-ACCOUNTING |
| **Posting ownership** | Option A/B/C final selection | current de-facto = Option C (adapter gates, domain posts) | **S78-POSTING-OWNERSHIP-RECOMMENDATION (new)** — recommends C, not implemented |

## 4 · Exact production files changed

**None.**

## 5 · New tests

**None** (no production change). Bank-reconciled refusal + immutability already pinned (cited §1). Governed-layer journey pins re-run this session as a drift check: 18/18 green.

## 6 · Governed-path evidence

No new governed action was added. The existing governed path (real UI → preload → IPC → adapter → boundary → command bus → authz → business policy → approval engine where required → domain command → durable txn → persistence → event → outbox → audit) is unchanged and was proven end-to-end on Mac in S76 (6/6 journeys, 88 assertions).

## 7 · GL / accounting evidence

Two §20 source-wins corrections applied to S77 memos: (a) D10 write-off **is** posted to account 5010 (my S77 draft wrongly said "unposted"); (b) manufacturing variance accounts 5900/5910/5920 exist and post. Both memos corrected. The generic chart (`postingRules.ts` STOCK_ACCOUNTS) is complete for inventory/variance/COGS/GRNI/AP; what is undefined is domain-specific *policy* (approval gates, revenue-recognition model, repair-vs-capex rule, scrap mapping, maintenance accounts), never the base chart.

## 8 · SoD / approval evidence

`DEFAULT_SPEND_POLICY` (spend) + `BILL_APPROVAL_POLICY` (bill) enforce role chains + thresholds + creator≠approver via `evaluateApproval`, gating PO/bill. Payroll/adjustment/variance are **not** attached to an approval spec (the gap in §3). Expense-claim SoD (`creator_cannot_approve`) proven in the S76 HR journey.

## 9 · Tenant-isolation evidence

Unchanged — all governed module paths resolve tenant via `scopeOrDeny`/`resolveTenantScope` in main; renderer-supplied tenant is never authoritative. Proven across the S73–S75 journey pins and the S76 Mac run.

## 10 · Full regression

No production/test source changed → nothing new to regress; S76 GREEN state stands (per operator baseline: full main GREEN, UI 455/455, typecheck:release + lint:release GREEN, 0 product RED). Drift check this session: governed journey pins 18/18. No build (docs-only).

## 11 · Remaining POLICY-BLOCKED items

The seven rows in §3 — D8 payroll approval · D10 adjustment approval gate · manufacturing variance/scrap approval + scrap mapping · maintenance cost→GL · project cost/revenue→GL · bank-reconciled reversal YES branch · posting-ownership A/B/C selection. All fail-closed, all memo'd, none invented.

## 12 · Remaining engineering defects

None newly found. Pre-existing recorded items unchanged (frozen `contracts.ts` lint escape). No product RED.

## 13 · Release status

**PAUSED** — no notarization, Authenticode, updater, publish, or tags touched.

---

## FINAL

**Implemented in S78:** none — no operator policy values were supplied, and all policy-defined portions are already in code.
**Corrected in S78 (docs, §20):** the S77 D10 and manufacturing-variance memos, to state accurately that the write-off/variance accounts (5010/5900/5910) exist and post; the true gap is the approval gate, not the accounting.
**Produced in S78:** the posting-ownership recommendation memo (recommends Option C — formalize the current split — explicitly NOT implemented).
**Everything else:** fail-closed, memo'd, awaiting operator decision values.

CRITICAL STOP RULE honored: no values fabricated. STOP — S79 / release engineering NOT started.
