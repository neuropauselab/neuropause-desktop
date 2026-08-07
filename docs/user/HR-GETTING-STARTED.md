# HR & Payroll — Getting Started

**For pilot users · v1.0.0-rc.14 lineage.** Business → HR & Payroll. Fifteen modules forming one spine: people → time → pay → statutory.

## 1. People

**Employees → New Employee**: number, name, role, department, salary. Optional: a manager (the org chain is cycle-guarded), a salary structure template, a shift, bank details (IFSC validated), and statutory ids (UAN/PAN/ESIC validated when present). **Recruitment**: post a job, add candidates, move them through the pipeline — **Hire** creates the Employee record through the register's own guards.

## 2. Time

**Shifts** define working patterns (times, weekly offs). **Holidays** is the company calendar. **Leave Requests** flow pending → approved/rejected with overlap guards. **Attendance Periods** is the payroll input: one statement per employee per month — *Import Leave* prefills paid/unpaid days from approved leave (holidays excluded) and expected working days from the shift; **Confirm** makes it the statement payroll reads. No confirmed statement = full-month pay, stated explicitly.

## 3. Pay

**Payroll Runs**: pick the month, process — statutory math (PF/ESI/PT/TDS) runs per employee, loss-of-pay days prorate on the calendar-day factor, and the run posts its GL accrual idempotently. **Salary Disbursement** clears net pay with a deterministic bank advice. **Payslips** and the **Payroll Register** derive from the run; **Statutory Filings** produces the PF ECR with real non-contributory days.

## 4. Watch it on the dashboard

The HR dashboard charts active headcount by department (exited employees never count) and the family's live status mix. **Expense Claims** route submitted → approved and post Dr Employee Expenses / Cr Claims Payable on approval. **OKRs** track objectives with derived progress.
