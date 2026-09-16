# SESSION 77 — ENTERPRISE POLICY DECISION CLOSURE

**Class:** discovery-first policy-closure gate. Baseline S76 (real-Electron whole-app acceptance GREEN on Mac, 6/6 journeys, 88 assertions). **The operator supplied no new decision values in this gate**, so per the implementation rule S77 implements only what is *already explicitly defined by existing product policy* (which is already in code) and produces precise decision memos for everything genuinely undefined. **No production source changed.** No release/notarization/tag/publish work. Release track PAUSED.

## Method

For each decision: located the exact implementation, mapped affected commands/stores/approval/GL/UI/tests, determined implemented-vs-undefined, and — where operator input is required — STOPPED with a memo rather than inventing thresholds, roles, GL accounts, or authority. All reuse the existing `approvalEngine` / document-adapter approval gate, command bus, journal, outbox, audit, RBAC/tenancy. No duplicate infrastructure.

---

## 1 · Decisions ALREADY CLOSED by existing implementation

### D12 — PO approve / send  → **CLOSED (defined + enforced)**
- **Where:** `procurement-orders` in `erp/documentSpecs.ts` carries `approval: { policy: DEFAULT_SPEND_POLICY, amountField: 'total', gatedStatuses: ['approved','issued','sent'] }`; enforced in `erp/documentAdapter.ts:313-314` (`guardStatus` → `evaluateApproval`); status transitions + immutability in `enterprise/modules/procurement/purchaseOrderModule.ts` (`approve` draft→approved, `send` approved→sent; approved/sent→draft silent revert refused).
- **Answers:** approval authority = `DEFAULT_SPEND_POLICY` role chain **manager/admin → finance/admin (≥10,000) → executive/admin (≥100,000)**; threshold = 10,000 / 100,000; role chain = those three steps by amount; **creator≠approver = enforced** (`sod: ['creator_cannot_approve','approver_cannot_repeat_step']`); approval transition = `approve` (gated); send/release transition = `send` (gated); **immutable against generic edit = yes** (gated statuses re-checked; silent revert to draft refused, Cancel required). Nothing to implement.

### BANK-RECONCILED PAYMENT REVERSAL → **CLOSED as permanent fail-closed refusal (the "if-no" branch)**
- **Where:** `enterprise/modules/finance/paymentReversalModule.ts:149-152` refuses reversing a payment carrying `bankReconciledAt` ("cannot be reversed here — see the bank correction workflow"); `paymentModule.ts:201-216` makes a bank-reconciled payment immutable (edits refused).
- **Answers (current defined semantics):** can a bank-reconciled payment be reversed? **No — refused here, fail-closed.** Original payment immutable? **Yes.** The **"if-yes" branch** (whether to ever permit it, the authorizer, compensating treatment, invoice/bill linkage) remains an operator decision — see §2.

### PAYROLL GL OWNERSHIP (part of D8) → **CLOSED**
- **Where:** `enterprise/modules/hr/payrollRunModule.ts` — `post` books the payroll accrual into the real GL through the W1 runtime seam; the two payroll accounts are ensured via the Ledger Accounts module; a posted run is immutable. GL posting ownership for payroll is defined and singular.

### POSTING OWNERSHIP (Session-2) → partially settled, one branch still open (see §2/§7)
- The GL-ownership consolidation is already largely enforced (Session 11/13: vendor-bill posting has ONE authoritative live owner; the adapter `postOn.posted` leg was retired). The residual Session-2 Option A/B/C choice is analyzed in §7 and remains the operator's.

---

## 2 · Decisions REQUIRING explicit operator input (STOPPED, memo'd — none invented)

| Decision | Undefined part | Memo |
|---|---|---|
| **D8 — Payroll authority** | Approval gate, SoD, threshold/materiality, decider role, disbursement authorization (posting + GL ownership ARE defined; payroll is NOT in `DOCUMENT_SPECS`, so no approval spec gates it) | `DECISION-MEMO-S60-APPROVAL-CONTROL-PLANE.md`, `DECISION-MEMO-DEEP-FINANCE-HR-AUTHORITY.md` |
| **D10 — Cycle-count / stock-adjustment** | Variance materiality threshold, approver + SoD, write-off/shrinkage GL treatment | `DECISION-MEMO-S77-CYCLE-COUNT-STOCK-ADJUSTMENT.md` (new) |
| **Manufacturing variance / scrap** | Variance/scrap approval threshold + approver + SoD, scrap write-off GL treatment (variance *posting* already decided in Session 5) | `DECISION-MEMO-S77-MANUFACTURING-VARIANCE-SCRAP-APPROVAL.md` (new) |
| **Maintenance cost → GL** | Repair-vs-capex rule + threshold, labor + spare-part consumption GL accounts, approval | `DECISION-MEMO-S74-MAINTENANCE-COST-ACCOUNTING.md` |
| **Project cost / revenue → GL** | Revenue-recognition model, project-cost/WIP accounts, capitalization, labor-cost method, budget-variance/write-off, materiality/approval | `DECISION-MEMO-S75-PROJECT-COST-REVENUE-ACCOUNTING.md` |
| **Bank-reconciled reversal ("if-yes" branch)** | Whether ever permitted, authorizer, compensating treatment, invoice/bill linkage | `DECISION-MEMO-S60-PAYMENT-REVERSAL-AND-DELETE-BOUNDARY.md`, `DECISION-MEMO-S61-PAYMENT-REVERSAL-ACCOUNTING.md` |
| **Posting ownership (Session-2)** | Option A/B/C final selection (analysis in §7) | `ERP-SESSION2-POSTING-PARITY-DECISION.md`, `ERP-SESSION10-GL-OWNERSHIP-DECISION-MEMO.md` |

Every one of these is left **fail-closed** in production: the gated transition/GL leg does not fire; nothing is fabricated.

---

## 3 · Decisions IMPLEMENTED during S77

**None.** The operator supplied no decision values, and the only decisions that were *already defined by existing product policy* (D12, bank-reconciled reversal refusal, payroll GL ownership) are **already implemented in code** — there was nothing to add. Implementing any of the §2 items without operator input would require inventing thresholds/roles/accounts, which is forbidden.

## 4 · Exact production files changed

**None.** S77 changed only certification/memo documents.

## 5 · Tests added

**None** (no production change). Governed-layer journey pins were re-run this session as a drift check — 6 files / **18 assertions pass** — confirming the mutation paths are intact at the S76 baseline.

## 6 · Full regression result

No production or test source changed in S77, so there is nothing new to regress; the S76 GREEN state stands (per the operator baseline: full main GREEN, UI 455/455, typecheck:release GREEN, lint:release GREEN, 0 product RED). Drift check this session: governed journey pins 18/18 green. No build required (docs-only).

## 7 · Posting-ownership (Session-2) — A/B/C consequence analysis (no automatic choice)

The decision is **which layer owns GL posting** for domain documents where both a domain-action path and a document-adapter path could post.
- **Option A — Domain-action owns posting (adapter posting retired):** the module `runAction`/GL seam is the single posting owner; the document adapter only gates approval. *Consequence:* one authoritative owner per document, simplest to reason about; matches the direction already taken (Session 13 retired the vendor-bill adapter `postOn.posted` leg). Code paths depending on it: `glPosting.ts`, `handleVendorBillChangeForGl`, the finance module GL seams. **Risk:** any document relying on adapter `postOn` for posting would need its leg migrated to the domain path first.
- **Option B — Document-adapter owns posting:** the adapter's `postOn` hooks are the single posting owner; modules stop posting. *Consequence:* centralizes posting in `documentAdapter.ts`, but the adapter keys `postOn` on record-level status (`active`), not the domain status — the documented reason the supplier-bill adapter leg never fired — so this option requires reworking the adapter's status model. Code paths: `documentAdapter.ts` `postOn`, `documentSpecs.ts` specs.
- **Option C — Split (adapter approval + domain posting), formalized:** keep approval gating in the adapter and posting in the domain path, and *formally certify* that split as the standing rule. *Consequence:* least code churn (it is the de-facto current state), but must be made explicit + invariant-pinned so a future document can't accidentally introduce a second posting owner.

**Dependent code paths (all options):** `erp/documentSpecs.ts`, `erp/documentAdapter.ts`, `enterprise/modules/finance/glPosting.ts`, the per-document `handle*ChangeForGl` owners. **No option is selected here** — this is the operator's architectural + accounting call (task tracked; `ERP-SESSION2-POSTING-PARITY-DECISION.md`).

## 8 · Remaining engineering defects

None newly found in this discovery gate. Pre-existing recorded items are unchanged (e.g. the frozen `contracts.ts` lint escape noted in prior sessions). No product RED.

## 9 · Release-track status

**PAUSED** — no notarization, Authenticode, updater, release publishing, or tags touched. No repackage.

---

## FINAL

**Policy decisions closed by existing implementation:** D12 (PO approve/send), bank-reconciled reversal refusal (if-no branch), payroll GL ownership.
**Policy decisions requiring operator input (fail-closed, memo'd):** D8 payroll approval/SoD/threshold/disbursement · D10 variance approval + write-off accounting · manufacturing variance/scrap approval + write-off · maintenance cost→GL · project cost/revenue→GL · bank-reconciled reversal (if-yes branch) · posting-ownership Option A/B/C.
**Implemented in S77:** none (no operator input; the policy-defined items were already in code).
**Release track:** PAUSED.

STOP after this gate — S78 / another implementation area is NOT started automatically.
