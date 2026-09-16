# SESSION 58 — OPERATOR POLICY DECISION REGISTER

**Baseline / HEAD:** `a605862` (S57 business-policy closure) · branch `cert/data-import-cst-integration`
**Class:** DOCUMENTATION ONLY — no code, no policy invented. **Implementation this session: NONE.**
**Purpose:** the exact decision sheet the operator must fill in. Every item below is drawn verbatim from the three source memos + the S57 certification; no new option is introduced. Once each `DECISION =` line is answered, implementation is a bounded, mechanical session on the existing engines (no new architecture).

> **How to use this sheet.** For each item, write your answer on the `DECISION =` line (and, where a threshold/role/semantic is requested, the `IF REQUIRED, SUPPLY =` line). "Adopt current state" is always a valid, complete answer — it CLOSES the item as DECIDED, it does not leave it open. The engineering cost column tells you what a session would then do; it is not a request to build anything now.

**Canonical enforcement mechanisms that already exist (nothing new is needed to enforce a decision):**
- **Approval enforcement:** the platform workflow runtime (`workflowRuntime.ts` — `REQUIRES_APPROVAL`, today bound to exactly one op, `SubmitPurchaseRequest`); its decider vocabulary today is `procurement:manage`, so a NEW decider role is the one thing an approval decision may require.
- **Segregation of duties:** `BILL_APPROVAL_POLICY.sod` (`creator_cannot_approve`, …) — the repo's own declared SoD vocabulary; S57 already applied it to expense claims.
- **Governed execution:** the command bus (a new `DomainCommandType` member wrapping an EXISTING module action, verbatim — the S45/S49/S57 promotion class) + durable journal/idempotency/event/outbox/audit.
- **GL integrity:** `glPosting.ts` compensating-entry booking + the journal-post kernel (deterministic entry numbers; double-post prevented); S55 store-anchored the posted/closed/reconciled token guards.
- **Edit-door fences:** the module `validate` hook pattern (the S46 payment/invoice fences) for blocking an accidental economic mutation once a policy says it must be governed.

---

## A · SALES ORDER APPROVAL

### D1 — Sales Order approval
1. **Decision ID:** D1
2. **Current state:** No approval step. `OrderStatus = pending|shipped|fulfilled|closed|cancelled` (no submitted/approved state). An operator with `sales:manage` can create AND ship — no second pair of eyes; O2C SoD undefined. Matrix marks Approve/Submit/Confirm **N/A — POLICY UNDEFINED**.
3. **Exact business question:** Does any Sales Order require approval before it can ship?
4. **DECISION REQUIRED:** choose **OPTION A** — current behavior IS the policy (closes as DECIDED-NO-APPROVAL) — OR **OPTION B/C** — approval required.
5. **IF B/C, SUPPLY:** threshold or trigger (amount / credit-term / customer); approving role; approval chain; whether approval is required before *confirmation*; whether a material economic edit REOPENS approval; SoD rule (may the creator approve?).
6. **Existing canonical enforcement:** the platform workflow runtime (add a `REQUIRES_APPROVAL` binding + a new order `submitted/approved` status pair + a decider permission) + the command bus; SoD via `creator_cannot_approve`.
7. **Consequence of each option:** **A** → shipping stays one-operator; the memo CLOSES; zero engineering. **B/C** → one bounded session adds the order approval states + workflow rule + decider role + UI; adds friction (a second approver) to every order over the threshold.

`DECISION =` ______________________  `IF REQUIRED, SUPPLY =` ______________________

---

## B · O2C RESIDUAL SEMANTICS

### D2 — Partial credit notes
1. **ID:** D2
2. **Current state:** Full `IssueCreditNote`/`CancelCreditNote` are governed (S57), booking the note's own GL verbatim. PARTIAL credit-note semantics do not exist anywhere in the repo.
3. **Exact business question:** May a credit note be issued for PART of an invoice, and if so how is the partial amount computed and reconciled against the invoice balance?
4. **DECISION REQUIRED:** partial credit notes ALLOWED (supply semantics) — or NOT (full-document only; leave POLICY-BLOCKED).
5. **IF ALLOWED, SUPPLY:** the partial-amount rule (free amount ≤ invoice balance? line-level?); how it reduces AR / outstanding; whether multiple partials may accumulate up to the invoice total.
6. **Existing canonical enforcement:** the credit-note module + `glPosting`; the invoice reconcile-then-post pattern (as payments use). NO computation exists to promote — it must be supplied.
7. **Consequence:** ALLOW → a new bounded session models the partial computation + reconciliation. NOT → full credit notes only; partial refunds handled outside the system or via a full-cancel-and-reissue.

`DECISION =` ______________________  `IF ALLOWED, SUPPLY =` ______________________

### D3 — Reopen an already-paid invoice
1. **ID:** D3
2. **Current state:** No reopen-paid path exists. A paid invoice is terminal.
3. **Exact business question:** May an invoice that is already fully paid be reopened (e.g. to correct or reverse), and what happens to the settled receipts and GL?
4. **DECISION REQUIRED:** reopen-paid ALLOWED (supply semantics) — or NOT (terminal; corrections go through credit/debit notes).
5. **IF ALLOWED, SUPPLY:** what reopening does to the allocated receipts (unallocate? reverse?), the GL treatment, and who may authorize it.
6. **Existing canonical enforcement:** would be a new governed command over the invoice module + `glPosting` compensating entries. NO semantics exist to promote.
7. **Consequence:** ALLOW → bounded session + likely an approval binding (this is a reversal of a terminal state). NOT → corrections to paid invoices are credit/debit notes only (already governed).

`DECISION =` ______________________  `IF ALLOWED, SUPPLY =` ______________________

### D4 — Reversal / void of a CLEARED customer (or vendor) payment
1. **ID:** D4
2. **Current state:** `ClearCustomerPayment`/`ClearVendorPayment` (pending→cleared, booking cash GL) are governed (S57). Reversing/voiding an ALREADY-cleared payment is untouched — no governed path, semantics undefined.
3. **Exact business question:** May a cleared payment be reversed/voided (bounced cheque, misapplied receipt), and how does that unwind the cash GL and the invoice settlement?
4. **DECISION REQUIRED:** cleared-payment reversal ALLOWED (supply semantics) — or NOT (leave POLICY-BLOCKED; corrections via a new offsetting payment).
5. **IF ALLOWED, SUPPLY:** the reversal GL (compensating Dr/Cr), how the invoice returns to outstanding, and who may authorize.
6. **Existing canonical enforcement:** a new governed command over the payment module + `glPosting` compensating entries; the payment `validate` fence pattern to keep it off the edit door.
7. **Consequence:** ALLOW → bounded session, likely approval-bound. NOT → a bounced/misapplied receipt is corrected by recording an offsetting payment; the cleared row stays as evidence.

`DECISION =` ______________________  `IF ALLOWED, SUPPLY =` ______________________

### D5 — Issued-invoice economic-field ADJUSTMENT (amount / taxRate / exchangeRate)
1. **ID:** D5
2. **Current state:** DEFINED-legacy: editing an issued invoice's economic fields books GL ADJUSTMENT entries via `glPosting` (a deliberate drift-correction design), reachable on the legacy update door. Currently a **pilot fence** (operators told not to do it); NOT mechanically blocked.
3. **Exact business question:** Should economic-field adjustments on an issued invoice remain a defined-legacy edit, become a GOVERNED command, or be BLOCKED (corrections only via credit/debit notes)?
4. **DECISION REQUIRED:** KEEP defined-legacy (lift the pilot fence) — or GOVERN (promote to a command + fence the edit door) — or BLOCK (validate-hook fence; corrections via notes only).
5. **IF GOVERN, SUPPLY:** whether an adjustment needs approval + decider role. **IF BLOCK, SUPPLY:** nothing (uses the S46 fence pattern).
6. **Existing canonical enforcement:** `glPosting` adjustment entries (exist today); the invoice `validate` fence (S46 pattern) for GOVERN/BLOCK; the command bus for GOVERN.
7. **Consequence:** KEEP → the pilot fence is the only control (operator condition, not mechanical). GOVERN → journaled/audited adjustments, approvable. BLOCK → issued invoices become economically immutable; every correction is a note.

`DECISION =` ______________________  `IF GOVERN, SUPPLY =` ______________________

### D6 — DELETE-door reversal behavior (issued invoices / cleared payments)
1. **ID:** D6
2. **Current state:** DEFINED-legacy: the DELETE door posts GL reversals for issued invoices / cleared payments (a defined `glPosting` "voiding un-pays" behavior). Currently a **pilot fence** (no deletes on issued/cleared rows); NOT mechanically blocked.
3. **Exact business question:** Should DELETE remain a defined-legacy GL-reversing void, be replaced by an explicit governed cancel/void command, or be BLOCKED on economically-active rows?
4. **DECISION REQUIRED:** KEEP defined-legacy — or REPLACE with a governed cancel/void (D4/D3-adjacent) — or BLOCK delete on issued/cleared rows.
5. **IF BLOCK, SUPPLY:** nothing (validate/delete-guard fence). **IF REPLACE, SUPPLY:** the same reversal semantics as the matching D3/D4 item.
6. **Existing canonical enforcement:** the delete handler + `glPosting`; a delete-guard in the module (analogous to the S46 validate fence).
7. **Consequence:** KEEP → deletion silently books reversals (pilot fence is the only guard). REPLACE → an explicit auditable void command; delete refuses on active rows. BLOCK → issued/cleared rows cannot be deleted; reversal is a note/void.

`DECISION =` ______________________  `IF REQUIRED, SUPPLY =` ______________________

### D7 — Importer economic rows
1. **ID:** D7
2. **Current state:** The importer reviewer-update path bypasses `hooks.validate` by design (bulk ingestion); it can write economic rows (payments/invoices) around the module guards. Currently a **pilot fence** (do not import economic rows); documented as a separate controlled ingestion surface.
3. **Exact business question:** May the importer create/modify economically-significant rows (payments, invoices, GL-affecting records), and under what control?
4. **DECISION REQUIRED:** importer economic rows PERMITTED (under a stated control) — or PROHIBITED (ingestion limited to non-economic master/reference data; the fence becomes policy).
5. **IF PERMITTED, SUPPLY:** which entity types; whether imported economic rows post GL or land as drafts requiring a governed action; whether a pre-import approval is required.
6. **Existing canonical enforcement:** the importer ingestion path; a pre-import policy gate or a "drafts-only for economic types" rule (no new validation framework — reuse the module actions to activate them).
7. **Consequence:** PERMITTED → a bounded session adds the ingestion-class rule (likely drafts-only + a governed activation). PROHIBITED → the pilot fence becomes the stated policy; economic data is entered through the governed UI only.

`DECISION =` ______________________  `IF PERMITTED, SUPPLY =` ______________________

---

## C · DEEP FINANCE AUTHORITY

> For each: the minimum requested is **who may execute · who must approve · threshold (if any) · SoD requirement (if any)**. "Current RBAC is the policy" is a complete answer that CLOSES the item.

### D8 — Payroll posting + salary disbursement approval
1. **ID:** D8
2. **Current state:** `payrollRunModule` POST books the payroll accrual; `salaryDisbursementModule` DISBURSE books Dr Salaries Payable / Cr Cash and emits the bank advice (money-movement-adjacent). RBAC-only (`operations:manage`); no approval, no SoD, no governed command. GL integrity inherited (kernel-journaled).
3. **Exact business question:** Do payroll POST and salary DISBURSE require approval / SoD before they book, and do they become governed commands?
4. **DECISION REQUIRED:** ADOPT current RBAC — or REQUIRE approval (supply the minimum below).
5. **IF REQUIRED, SUPPLY:** who may execute (post/disburse); who must approve; threshold (e.g. disbursement amount); SoD (may the preparer disburse?).
6. **Existing canonical enforcement:** the workflow runtime (approval binding + decider role) + command-bus promotion of the post/disburse actions; SoD via `creator_cannot_approve`.
7. **Consequence:** ADOPT → money-movement-adjacent disbursement stays one-operator (RBAC only). REQUIRE → a bounded session governs + gates it; adds a payroll approver.

`DECISION =` ______________________  `IF REQUIRED, SUPPLY =` ______________________

### D9 — Fixed-asset authority (capitalize / postDepreciation / dispose)
1. **ID:** D9
2. **Current state:** `fixedAssetModule` capitalize/postDepreciation/dispose each book real GL on the legacy action door under `operations:manage`. No approval/SoD/command.
3. **Exact business question:** Do fixed-asset capitalize/depreciate/dispose require approval before booking, and become governed commands?
4. **DECISION REQUIRED:** ADOPT current RBAC — or REQUIRE approval (supply the minimum).
5. **IF REQUIRED, SUPPLY:** who may execute; who must approve; threshold (capitalization/disposal value); SoD.
6. **Existing canonical enforcement:** workflow runtime + command-bus promotion; `glPosting`.
7. **Consequence:** ADOPT → asset GL stays RBAC-gated. REQUIRE → governed + approvable (typical for disposals above a threshold).

`DECISION =` ______________________  `IF REQUIRED, SUPPLY =` ______________________

### D10 — Stock adjustments / cycle counts
1. **ID:** D10
2. **Current state:** `stockAdjustmentModule` POST and `cycleCountModule` RECONCILE (the write-up/write-down = shrinkage channel) book real GL on the legacy action door under `operations:manage`/`inventory:manage`. No approval/SoD/command.
3. **Exact business question:** Do inventory adjustments / cycle-count reconciliations require approval (the classic shrinkage control) before booking, and become governed commands?
4. **DECISION REQUIRED:** ADOPT current RBAC — or REQUIRE approval (supply the minimum).
5. **IF REQUIRED, SUPPLY:** who may execute; who must approve; threshold (adjustment value/quantity); SoD (may the counter reconcile?).
6. **Existing canonical enforcement:** workflow runtime + command-bus promotion; `glPosting`.
7. **Consequence:** ADOPT → shrinkage bookings stay RBAC-gated (a known audit-sensitive area). REQUIRE → governed + approvable.

`DECISION =` ______________________  `IF REQUIRED, SUPPLY =` ______________________

### D11 — Accounting-period reopen
1. **ID:** D11
2. **Current state:** `accountingPeriodModule` REOPEN — the sole authority reversal over the GL close guard — is RBAC-only. (S55 closed the EDIT-door reopen forgery; the ACTION's authority is undecided.)
3. **Exact business question:** Who may reopen a closed accounting period, and is a reopen itself an auditable approval event?
4. **DECISION REQUIRED:** ADOPT current RBAC — or REQUIRE approval/named authority (supply the minimum).
5. **IF REQUIRED, SUPPLY:** who may reopen; who must approve; whether reopen requires a reason/record (auditable event); SoD.
6. **Existing canonical enforcement:** workflow runtime + command-bus promotion of REOPEN; the audit sink for the event.
7. **Consequence:** ADOPT → any `operations:manage` operator can reopen a closed period. REQUIRE → reopen becomes a governed, approved, auditable event (typical financial-controls expectation).

`DECISION =` ______________________  `IF REQUIRED, SUPPLY =` ______________________

### D12 — Receiving against a DRAFT purchase order
1. **ID:** D12
2. **Current state:** The GR `post` action receives against a DRAFT PO today, and this is LOAD-BEARING: the governed command lane has NO PO approve/send command, so the pinned command-lane P2P receives against a draft PO by construction (8 pinned test files). S55 fenced the CANCELLED half; the DRAFT half is a commitment-authority question (the buy-side twin of D1).
3. **Exact business question:** Must a PO be approved/sent before goods can be received against it?
4. **DECISION REQUIRED:** ALLOW receiving against a draft PO (current behavior IS the policy) — or REQUIRE PO approve/send first.
5. **IF REQUIRE, SUPPLY:** the PO approve/send authority (who approves/sends, threshold, SoD). *Note: this decision has an ENGINEERING PREREQUISITE — PO approve/send must become governed commands FIRST, then the fence lands with reworked pins (8 files). It is not a same-session mechanical change.*
6. **Existing canonical enforcement:** would require new `ApprovePurchaseOrder`/`SendPurchaseOrder` commands (do not exist) + the receipt fence; workflow runtime for approval.
7. **Consequence:** ALLOW → GR-against-draft stays (matches the current pinned lane). REQUIRE → a larger session: model PO approve/send commands, then re-pin the P2P lane behind them.

`DECISION =` ______________________  `IF REQUIRE, SUPPLY =` ______________________

---

## D · HR AUTHORITY

### D13 — Additional HR authority beyond the S57 expense-claim SoD
1. **ID:** D13
2. **Current state:** Expense-claim SELF-APPROVAL is refused (S57 — `creator_cannot_approve`, the repo's own SoD vocabulary; creator-REJECT stays open as withdrawal; creator-less importer rows uncompared). No other HR authority control exists.
3. **Exact business question:** Is any HR authority control required BEYOND the S57-closed expense-claim self-approval rule (e.g. expense thresholds, an approval chain, additional SoD)?
4. **DECISION REQUIRED:** NONE — the S57 SoD rule is sufficient for the pilot (CLOSE) — or ADDITIONAL controls required (name them; do not invent).
5. **IF ADDITIONAL, SUPPLY:** the specific control (threshold + approver role + SoD), stated by the operator; *S58 does not propose any.*
6. **Existing canonical enforcement:** `BILL_APPROVAL_POLICY.sod` + the workflow runtime; already applied to expense claims by S57.
7. **Consequence:** NONE → HR authority is CLOSED at the S57 state. ADDITIONAL → a bounded session applies the named control on the existing engine.

`DECISION =` ______________________  `IF ADDITIONAL, SUPPLY =` ______________________

---

## Phase 3 — EXISTING GREEN PRESERVED (verified)

S58 is documentation-only; it modifies NO code and therefore reopens nothing. The following remain exactly as S57/S55/S56 left them (unchanged by this session): the governed O2C promotion set, the payment `clear` path, shipment-document governance, the expense-claim SoD, the S55 governance fences, and the S56 packaged governance evidence. Working tree carries no source modification (only this new document + the pre-existing, unstaged `baseline.json`).

## Summary — what each decision unblocks

| ID | Item | If "adopt current / no" | If "govern / require" |
|----|------|--------------------------|------------------------|
| D1 | Sales-order approval | memo CLOSES, 0 eng | order approval states + workflow rule + decider role + UI |
| D2 | Partial credit notes | full notes only | model partial computation + reconciliation |
| D3 | Reopen paid invoice | notes only | governed reopen + likely approval |
| D4 | Clear-payment reversal | offsetting payment | governed reversal + compensating GL + approval |
| D5 | Issued-invoice econ adjust | keep fence / block | govern + fence edit door |
| D6 | DELETE-door reversal | keep fence / block | replace with governed void |
| D7 | Importer economic rows | prohibit (fence=policy) | drafts-only + governed activation |
| D8 | Payroll / disbursement | RBAC only | approval + SoD + command |
| D9 | Fixed assets | RBAC only | approval + command |
| D10 | Stock adj / cycle count | RBAC only | shrinkage approval + command |
| D11 | Period reopen | RBAC only | governed, approved, auditable |
| D12 | Draft-PO receiving | keep (matches pins) | PO approve/send commands FIRST (larger) |
| D13 | Additional HR authority | CLOSED at S57 | named control on existing engine |

---

# FINAL OUTPUT

**BASELINE:** `a605862`
**HEAD:** `a605862`

**POLICY DECISIONS REQUIRED:**

1. Sales Order Approval = ____________  (Option A = adopt current / no approval · OR B/C = threshold + approver role + chain + pre-confirmation? + edit-reopens-approval? + SoD)
2. Partial Credit Notes = ____________  (Allowed + partial-amount/reconcile semantics · OR full-notes-only)
3. Reopen Paid Invoice = ____________  (Allowed + receipt/GL/authority semantics · OR terminal — corrections via notes)
4. Clear-Payment Reversal = ____________  (Allowed + reversal GL + who authorizes · OR offsetting-payment only)
5. Issued-Invoice Economic Adjustment = ____________  (Keep defined-legacy · OR Govern (+approval?) · OR Block — notes only)
6. DELETE-Door Reversal = ____________  (Keep defined-legacy · OR Replace with governed void · OR Block on active rows)
7. Importer Economic Rows = ____________  (Prohibited — fence becomes policy · OR Permitted + class rule (types, drafts-only?, pre-import approval?))
8. Payroll/Disbursement = ____________  (Adopt current RBAC · OR who-executes + who-approves + threshold + SoD)
9. Fixed Assets = ____________  (Adopt current RBAC · OR who-executes + who-approves + threshold + SoD)
10. Stock Adjustments/Cycle Counts = ____________  (Adopt current RBAC · OR who-executes + who-approves + threshold + SoD)
11. Period Reopen = ____________  (Adopt current RBAC · OR who-may-reopen + who-approves + auditable-reason? + SoD)
12. Draft-PO Receiving = ____________  (Allow (matches current pins) · OR Require PO approve/send first — engineering prerequisite, larger session)
13. Additional HR Authority = ____________  (None — S57 SoD sufficient · OR named additional control (threshold + role + SoD))

**IMPLEMENTATION:** NONE — WAITING FOR OPERATOR DECISIONS

*No thresholds, roles, approval chains, accounting semantics, reversal semantics, or HR controls were invented. Each item cites its source memo and its existing canonical enforcement mechanism. STOP.*
