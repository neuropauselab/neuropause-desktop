# S73 GATE 3 — HR WHOLE-USER JOURNEY CERTIFICATION

**Class:** HR completion gate under S73. Reuse-only; no new infrastructure; **no invented HR/payroll policy**; no release work. One controlled gate, one commit.

## Journey proven (non-policy-blocked HR lifecycle)

**Employee onboard → Leave request → approve → Expense claim → SoD-guarded approval (creator≠approver) → Employee exit (offboard).**

## Evidence

**Sandbox-runnable governed test** — `src/main/enterprise/modules/hr/session73HrJourney.test.ts`, 4/4 green, real HR module handlers + real ledger/journal for the accrual, tenant-scoped registry:
1. **Employee** onboard → `exit` (offboard) governed; audit emitted.
2. **Leave** request (against a real employee) → `approve` → `approved`.
3. **Expense claim** SoD: the creator (`alice`) is REFUSED approval of their own claim — *"segregation of duties (another operator must decide it)"* — and a different operator (`bob`) approves, booking the accrual (Dr Employee Expenses / Cr Expense Claims Payable) through the same idempotent GL seam. This is the DEFINED `BILL_APPROVAL_POLICY` `creator_cannot_approve` control (S57), not invented policy.
4. **Tenant isolation:** an employee created in tenant-B is invisible in tenant-A.

**Real-Electron harness** — `e2e/s73HrJourney.e2e.cjs` (onboard→leave-approve→expense→exit), Mac-pending.

## POLICY-BLOCKED (NOT driven, NOT invented) — D8

Payroll run `post` + `generatePayslips` (GL accruals) and salary `disburse` require an approval authority (executor≠approver SoD, threshold, decider role, disbursement GL treatment) that is UNDEFINED. Per S73 §9 these transitions are STOPPED and left to the approval control-plane once the operator supplies the inputs — see `DECISION-MEMO-S60-APPROVAL-CONTROL-PLANE.md` / `DECISION-MEMO-DEEP-FINANCE-HR-AUTHORITY.md`. The payroll *mechanism* exists and is framework-governed (RBAC/tenancy/audit/GL); only its *approval gate* is blocked.

## Status

**HR journey = GREEN for the non-policy-blocked lifecycle** (employee/leave/expense-with-SoD), real-Electron harness ready for Mac. **Payroll post/disburse = POLICY-BLOCKED (D8)** pending the operator's approval-authority inputs. typecheck/eslint clean; no production source changed (test + harness + cert only). Whole-app matrix HR row: GREEN(lifecycle) + POLICY-BLOCKED(payroll authority).
