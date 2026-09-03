# DECISION MEMO — S59 GOVERNED APPROVAL HIERARCHY (D8 · D9 · D10 · D11)

**Session:** ERP S59 · **Status:** POLICY-BLOCKED — the operator policy is approved, but the enforcement MECHANISM it requires does not exist and building it is a new authority hierarchy (S59 STOP condition: "a policy requires a new authority hierarchy"; and the operator's own qualifier "where the existing engine supports configuration" — it does not). **No code was written for these four.**

## The measured blocker (shared by all four)

The platform workflow runtime (`workflowRuntime.ts`) is the ONLY approval engine, and by explicit design it has **"NO threshold, hierarchy"** (`workflowRuntime.ts:18`): a single hard-coded `REQUIRES_APPROVAL` binding for exactly one operation (`SubmitPurchaseRequest`), a single decider vocabulary (`procurement:manage`), and no configuration, no materiality threshold, no second-person/dual-control, no per-domain decider roles, and no immutable request/approve record beyond the generic decision/audit trail.

D8–D11 each require one or more of: a **materiality threshold** (D9, D10), a **separable executor≠approver SoD** in a full submit→approve→execute flow (D8, D9, D10), a **second-person dual-control + immutable request/approve/period record** (D11). None of these mechanisms exist. Adding them is a real, deliberate extension of the approval engine — a bounded but non-trivial framework slice — and the operator policy itself conditions the threshold work on "where the existing engine supports configuration," which today it does not. Guessing a threshold, a decider role, or a dual-control shape would be inventing authority policy, which the directive forbids.

## Per-item scope (once the engine gains configurable approval)

Each below reuses the SAME extended engine + the command bus + `creator_cannot_approve` SoD + `glPosting` — no parallel authorization engine, per the directive.

- **D8 — Payroll post + salary disbursement.** Needs: a governed `PostPayrollRun` + `DisburseSalary` command each behind a REQUIRES_APPROVAL binding; a payroll/finance decider role; executor≠approver SoD; optional disbursement-amount threshold. Disbursement is money-movement-adjacent (Dr Salaries Payable / Cr Cash) → SoD is the load-bearing control.
- **D9 — Fixed assets (capitalize / postDepreciation / dispose).** Needs: governed commands + approval for MATERIAL actions (capitalization/disposal) with a **policy-configurable** value threshold; SoD. The threshold config mechanism must exist first.
- **D10 — Stock adjustments / cycle counts.** Needs: normal count capture stays operational; ECONOMIC variances above a **configured materiality** require a governed command + approval + SoD (the classic shrinkage control). Threshold config first.
- **D11 — Accounting-period reopen (HIGHLY RESTRICTED).** Needs the most: a governed `ReopenAccountingPeriod` command requiring an explicit authorized finance role, **second-person approval** (dual control), an auditable business reason, SoD, and an **immutable record of who requested, who approved, which period** — a mini dual-control workflow the engine has none of today. (S55 already closed the EDIT-door reopen forgery via the store-anchored `closedAt` guard; this is the ACTION's authority layer.)

## Minimum information needed from the operator (to unblock)

1. **Threshold model:** is materiality a single global amount, per-domain, or per-tenant-configurable? (Determines whether the engine gains a config store or a fixed constant.)
2. **Decider roles:** which permission(s) may approve payroll, fixed-asset, stock, and period-reopen actions (new roles, or existing `operations:manage`/a finance role)?
3. **SoD rule:** executor≠approver everywhere (the `creator_cannot_approve` extension), or per-domain.
4. **D11 dual-control:** confirm second-person approval + the required immutable request/approve record fields (requester, approver, period, reason, timestamps).

## Safest temporary state (in force now)

Unchanged: all four surfaces remain RBAC-guarded, module-guarded, kernel-journaled GL (double-post prevented), S55 token-guards store-anchored — **POLICY-BLOCKED, not RED** (reachable-by-design pending the decisions). Nothing invented; no parallel engine built.
