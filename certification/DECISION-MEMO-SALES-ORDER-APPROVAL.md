# DECISION MEMO — SALES ORDER APPROVAL POLICY

**Session:** ERP S45 · **Status:** OPEN — human decision required · **Class:** business policy, NOT invented

> **S57 ADDENDUM (2026-09-03): RE-EXAMINED AND DELIBERATELY LEFT OPEN.** The S57 policy-closure
> gate re-searched the repository for decision material: no sales-side threshold, role chain, or
> approval binding exists anywhere (the quote discount-ceiling `approvalStatus` is computed but
> consumed by no enforcement point — binding it would require an approver definition that does
> not exist). Interpretations A/B/C below remain exactly open. **The one decision S57 needs from
> the operator: choose A (current state IS the policy — the memo closes as DECIDED-NO-APPROVAL),
> or supply B/C's threshold + decider role — implementation is then one bounded session on the
> existing approval engine.** Nothing was invented; the safest temporary state stays in force.

## Unresolved policy

Whether Sales Orders require an approval step (submit → approve/reject → confirm) before they can
ship — and if so: thresholds, roles, and segregation-of-duties rules.

## Evidence found (all measured at HEAD, search spaces stated)

- The sales-orders document spec carries **no approval block** (`documentSpecs.ts` — sales-orders absent
  from `DOCUMENT_SPECS` approval bindings).
- The platform workflow policy REQUIRES_APPROVAL for exactly **one** operation:
  `SubmitPurchaseRequest@procurement-requests` (`workflowRuntime.ts:46-51`); every O2C operation is ALLOW.
- The order status machine has **no submitted/approved state at all**:
  `OrderStatus = pending|shipped|fulfilled|closed|cancelled` (`packages/shared/src/types/orders.ts:16`).
- The repo's own discipline note: *"UNDEFINED policy (§22)… deliberately absent, not invented"*
  (`workflowContract.ts:14-18`).
- The sales module has zero references to `approvalEngine`/`approvalStore`
  (search space: `src/main/enterprise/modules/sales/*.ts`, excluding tests).

## Possible interpretations

A. Sales orders need no approval (B2B pilot with trusted operators) — the current state is the policy.
B. Sales orders above an amount threshold need approval — requires: new statuses, workflow rule,
   decider permission (the workflow vocabulary today has only `procurement:manage` as a decider —
   `workflowRuntime.ts:31`), and UI.
C. Approval on credit terms / specific customers — requires credit policy that does not exist.

## Affected workflows

Sales Order create → ship. Today an operator with `sales:manage` can create AND ship without a second
pair of eyes. (Segregation of duties for O2C is likewise undefined.)

## Safest temporary state (in force now)

No approval step; the order status machine + RBAC (`sales:manage`) govern. The matrix marks the
Approve/Reject/Submit/Confirm stages **N/A — POLICY UNDEFINED** (not GREEN, not RED).

## Exact decision required

1. Does any Sales Order require approval before shipping? (YES / NO)
2. If YES: threshold or trigger, approver role, SoD rule (may the creator approve?), and whether the
   platform workflow runtime (currently production-orphaned) becomes the enforcement seam.
