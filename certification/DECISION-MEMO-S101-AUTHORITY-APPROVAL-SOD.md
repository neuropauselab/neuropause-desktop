# DECISION MEMO — S101: authority / approval / segregation-of-duties — implemented vs policy-open

**Purpose.** Record, from source, which ERP authority/approval/SoD controls are IMPLEMENTED (and certified by S101) versus POLICY-OPEN / NOT-IMPLEMENTED (deliberately not invented). S101 invented no authority policy; no production code changed. Classification per the directive: A implemented+certifiable · B implemented-but-defective · C policy-open · D not-implemented.

## The authority model (source-wins)

Authority is a **flat set of permission scopes** (`<domain>:read`/`<domain>:manage`), not a role hierarchy or threshold ladder. The command bus authorizes exactly one permission per command (`commandBus.ts` `authorizeAndRoute`); the module action/update/delete doors authorize the module's write permission. **The actor is server-resolved** from `authService.getStatus()` (`localIdentity.ts sessionEmailFor`) — the renderer cannot supply or forge it. A generic threshold+SoD engine exists (`erp/approvalEngine.ts`, real $10k/$100k tiers and `creator_cannot_approve` rules) but is **unwired** to the PR/PO approve actions — it is consulted only at the generic Update/SetStatus doors via `canEnterStatus`, and PR/PO have no documentSpec that reaches it on the live path.

## A · IMPLEMENTED + CERTIFIABLE (certified by S101)

1. **Expense-claim SoD (creator ≠ approver)** — the one live SoD rule (`expenseClaimModule.ts:237-241`). It is **airtight across every door**: the `status` field is machine-owned (`readOnly` + validate forces `submitted` on every edit, and refuses edits to decided claims), and `EnterpriseModuleSetStatus` is schema-limited to record statuses (`active/archived/deleted`) so it cannot set `fields.status='approved'`. Therefore the ONLY path to `approved` is the `approve` action, which carries the SoD check and posts the GL accrual. A creator cannot self-approve via the action, the edit door, or SetStatus; a different operator can; the decided claim is terminal. **Economic consequence proven: a self-approval attempt books ZERO GL.**
2. **PR→PO conversion hard gate** — `conversion.ts:33-35` refuses conversion unless the PR is `approved`, and `purchaseRequestModule.ts` validate refuses hand-setting `approved` via the edit door (machine-owned). Only the governed `ApprovePurchaseRequest` reaches `approved`.
3. **Payment/reversal authority (S61/S62/S64 fences)** — a cleared payment cannot be deleted (`ECONOMIC_DELETE_GUARD`), reversal is a canonical module record (not a raw delete), at-most-one effective reversal per payment, and a **bank-reconciled payment fails closed** on reversal.
4. **Actor attribution** — server-resolved; the SoD comparison uses `ctx.actor()` (session), so the renderer cannot forge a different approver identity.
5. **Machine-owned status fences** — S98 F-S98-1 (production), S60 (issued invoice), S45 (sales order), and the accounting-period closed-record immutability (S55) all hold.
6. **RBAC fail-closed** — every consequential command/action requires its permission; an unauthorized (advisory/AI) principal is refused with ZERO inventory/GL side effect.

## B · IMPLEMENTED-BUT-DEFECTIVE

None found. (The period-reopen "no dual-control" is a MISSING policy, not a software defect — classified C below per the directive's rule that a missing policy is not a defect.)

## C · POLICY-OPEN (rule undefined / engine unwired — NOT invented)

- **PR/PO approval SoD (creator ≠ approver)** — the engine supports it and even declares the policy for these documents, but it is unwired on the live PR/PO approve path (DECISION-MEMO-S90). Wiring it is an operator ruling + gate, not a defect.
- **Threshold approval tiers** ($10k finance / $100k executive) — defined in `approvalEngine.ts` but unwired to the PO `approve` action.
- **Expense multi-level / threshold authority** — single tier only; higher tiers absent.
- **Payment-reversal SoD / threshold** — reversal is gated by a single `operations:manage` scope; no creator/approver split, no amount gate.
- **Accounting-period reopen dual-control** — reopen is gated by `operations:manage` (no unauthorized reopen path exists), but there is no second-approver, reason-code, or reopen-specific attribution field. Dual-control is undefined policy.

## D · NOT-IMPLEMENTED (no authority layer — economic mechanics ARE real; authority absent)

- **Payroll / disbursement authority** — `payrollRunModule.post` and `salaryDisbursementModule.disburse` post real GL and are immutable once posted, but there is NO approval, SoD, threshold, or maker-checker. Gated only by `operations:manage`.
- **Stock-adjustment / cycle-count approval + materiality** — `stockAdjustmentModule.post` / `cycleCountModule.reconcile` post a canonical `adjustment` movement + GL unconditionally, gated only by `warehouse:manage`. No approval-before-mutation, no materiality threshold.
- **Manufacturing variance / scrap approval + materiality** — production variance settles automatically on order completion (`onChange`); no approval, no scrap/write-off approval module exists.

## The load-bearing safety property (proven, not policy)

For every D and C item, the **critical economic-consequence question is answered YES-fail-closed**: an UNAUTHORIZED actor (lacking the scope) cannot cause the economic side effect. The missing layer is a SECOND approver / threshold / SoD — undefined policy — not a bypass. There is no path by which an unauthorized, self-approving, forged, or terminal-state actor causes an economic mutation. **A missing approval policy is documented here, not converted into code to make the gate green.**

## Operator decisions required (none invented)

Monetary approval thresholds and tiers; PR/PO segregation of duties; payroll/disbursement approval + SoD; stock-adjustment approval + materiality; manufacturing variance/scrap approval + materiality; accounting-period reopen dual-control; payment-reversal SoD. Each is an operator ruling that would be implemented behind a presented gate reusing the existing `approvalEngine`/workflow runtime — never invented to close S101.
