# DECISION MEMO — S60 GOVERNED APPROVAL CONTROL-PLANE (D8 · D9 · D10 · D11)

**Session:** ERP S60 · **Status:** POLICY-BLOCKED — the operator specified the control-plane's SHAPE more fully this session (domain-scoped policy · tenant-configurable thresholds · roles · multi-step chains · executor≠approver · materiality · immutable decision records · fail-closed). But the **specific thresholds, decider roles, and per-domain accounting** each binding needs are undefined, and the generic capability cannot be certified end-to-end without binding to at least one domain whose semantics are defined. Building it now would either ship an **empty, untestable shell** or require **inventing authority policy and domain accounting** — both S60 STOP conditions ("new authority hierarchy required · domain accounting not represented · would weaken a certified invariant"). **No code was written for D8–D11.** The design below is the bounded slice, ready to build the moment the inputs land.

---

## The measured blocker (shared by all four)

The platform workflow runtime (`workflowRuntime.ts`) is the ONLY approval engine, and by explicit design (`workflowRuntime.ts:17-19`) it has **"NO threshold, hierarchy, delegation, escalation, expiration or self-approval rule."** Concretely:
- `evaluateWorkflow` binds **exactly one** operation (`SubmitPurchaseRequest`) to `REQUIRES_APPROVAL`; everything else returns `ALLOW`.
- The decider vocabulary is a single constant `DECIDE_PERMISSION = 'procurement:manage'`.
- There is **no** materiality threshold, **no** tenant-configurable policy store, **no** multi-step chain, **no** executor≠approver segregation on this engine, and **no** immutable request/approve decision record beyond the generic decision/audit trail.

D8–D11 each require one or more mechanisms the engine does not have. The operator's own qualifier — extend the canonical engine "where it supports configuration" — is the crux: **today it supports none.**

---

## The bounded engine-extension design (proposed, NOT built)

A single REUSABLE policy capability that extends the canonical workflow runtime minimally — **no second approval engine**, reusing the command bus, durable journal, audit/outbox, and `creator_cannot_approve` SoD vocabulary:

1. **A tenant-scoped approval-policy store** (`ApprovalPolicy`): `{ operation, domain, thresholdField?, thresholdAmount?, deciderPermissions[], steps: 1|2, requiresSecondPerson: boolean }`. Deny-by-default: an operation with no policy that is declared "consequential" is refused, never silently allowed.
2. **`evaluateWorkflow` becomes policy-driven**: instead of the hard-coded PR binding, it looks up the operation's policy under the active tenant scope and returns `REQUIRES_APPROVAL` when a threshold is crossed (materiality) or a policy demands it — falling back to the existing PR binding so current behavior is byte-identical.
3. **Executor≠approver** enforced by extending the `creator_cannot_approve` SoD check into the decide step for policy-gated operations.
4. **Multi-step / second-person** (`steps: 2`) for the highest-restriction operations (D11): two distinct approvers, each recorded.
5. **An immutable decision record**: requester, approver(s), operation, threshold evaluated, business reason, timestamps — append-only, the D2 idempotent-record pattern.

**Why this is not shippable this session:** points 1–5 are a substantial framework change that touches the ONE certified approval engine (invariant risk), and — decisively — the capability is **empty and untestable** until it is bound to a real domain operation with a real threshold, real decider role, and real accounting. Binding any of D8–D11 needs the inputs below. Shipping the shell alone would be a partial control (STOP), and shipping a binding with a guessed threshold/role/GL would be inventing authority + accounting (STOP).

---

## Per-item scope (once the engine gains configurable approval + the inputs land)

Each reuses the SAME extended engine + command bus + `creator_cannot_approve` SoD + `glPosting` — no parallel authorization engine.

- **D8 — Payroll post + salary disbursement.** Needs a governed `PostPayrollRun` + `DisburseSalary` behind a policy binding; a payroll/finance decider role; executor≠approver; an optional disbursement-amount threshold. Disbursement is money-movement (Dr Salaries Payable / Cr Cash) → SoD is the load-bearing control. **Undefined:** the disbursement GL treatment and the decider role.
- **D9 — Fixed assets (capitalize / postDepreciation / dispose).** Needs governed commands + approval for MATERIAL actions (capitalization/disposal) with a **policy-configurable** value threshold; SoD. **Undefined:** the materiality threshold value/model and whether depreciation posting is in-scope for approval.
- **D10 — Stock adjustments / cycle counts.** Normal count capture stays operational; ECONOMIC variances above a **configured materiality** require a governed command + approval + SoD (the classic shrinkage control). **Undefined:** the materiality threshold and the variance GL account.
- **D11 — Accounting-period reopen (HIGHLY RESTRICTED).** Needs the most: a governed `ReopenAccountingPeriod` requiring an explicit authorized finance role, **second-person approval** (dual control), an auditable business reason, SoD, and an **immutable record** of who requested, who approved, which period. (S55 already closed the EDIT-door reopen forgery via the store-anchored `closedAt` guard; this is the ACTION's authority layer.) **Undefined:** the finance role vocabulary and the dual-control record fields.

---

## Minimum information needed from the operator (to unblock)

1. **Threshold model** — is materiality a single global amount, per-domain, or per-tenant-configurable? (Determines whether the engine gains a config store or fixed constants. The operator said "tenant-configurable" — confirm the config surface and who edits it.)
2. **Decider roles** — which permission(s) may approve payroll, fixed-asset, stock, and period-reopen actions? New roles, or existing `operations:manage` / a finance role?
3. **SoD rule** — executor≠approver everywhere (the `creator_cannot_approve` extension), or per-domain.
4. **Per-domain accounting** — the disbursement GL (D8), depreciation/disposal scope (D9), and stock-variance account (D10) must be defined, or those bindings STOP on accounting even after the engine exists.
5. **D11 dual-control** — confirm second-person approval + the immutable request/approve record fields (requester, approver, period, reason, timestamps).

---

## Safest temporary state (in force now)

Unchanged: all four surfaces remain RBAC-guarded, module-guarded, kernel-journaled GL (double-post prevented), S55 token-guards store-anchored, the S57 `creator_cannot_approve` expense-claim SoD standing. **POLICY-BLOCKED, not RED** — reachable-by-design pending the decisions. Nothing invented; no parallel engine built; the certified single-approval-engine invariant untouched.
