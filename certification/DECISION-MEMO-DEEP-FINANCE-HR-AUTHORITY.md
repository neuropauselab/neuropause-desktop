# DECISION MEMO — DEEP-FINANCE + HR AUTHORITY GOVERNANCE

**Session:** ERP S55 · **Status:** OPEN — human decisions required · **Class:** business policy, NOT invented

The S55 repository-wide census found these ECONOMIC/AUTHORITY surfaces live on the legacy action
door with coarse RBAC and NO approval policy, NO SoD, NO governed command, and (until now) NO
memo. Execution integrity is largely inherited (GL flows through the governed journal-post kernel
with deterministic entry numbers — double-posting is prevented; S55 additionally store-anchored
the posted/closed/reconciled token guards). **What is missing is the AUTHORITY layer, and that is
a business decision, not an engineering default.**

## 1 · HR chain (payroll post · salary disbursement · expense claims)

- `payrollRunModule` POST books the payroll accrual; `salaryDisbursementModule` DISBURSE books
  **Dr Salaries Payable / Cr Cash** and emits the bank advice (money-movement-adjacent);
  `expenseClaimModule` APPROVE books the accrual and stamps `decidedBy` = the acting operator —
  **nothing compares creator vs decider, so a claimant with `operations:manage` approves their
  own claim.** The repo HAS a SoD vocabulary (`BILL_APPROVAL_POLICY.sod:
  ['creator_cannot_approve', …]`) but only bills bind it.
- **Decisions required:** does the HR chain need an approval policy (thresholds/roles/SoD)? Is
  self-approval of expense claims prohibited? Do payroll/disbursement become governed commands?

## 2 · Fixed assets · stock adjustments · cycle counts · period reopen

- `fixedAssetModule` capitalize/postDepreciation/dispose, `stockAdjustmentModule` POST and
  `cycleCountModule` RECONCILE (the inventory write-up/write-down = shrinkage channel) each book
  real GL on the legacy action door under `operations:manage`/`inventory:manage`.
- `accountingPeriodModule` REOPEN — the sole authority reversal over the GL close guard — is
  RBAC-only. (S55 closed the EDIT-door reopen forgery; the ACTION's authority question is this
  memo's.)
- **Decisions required:** which of these transitions require approval or become governed
  commands; who may reopen a closed period, and is a reopen itself an auditable approval event?

## 3 · Receiving against a DRAFT purchase order (F-S50-1, the deferred half)

- The GR `post` action receives against a **draft** PO today, and this is LOAD-BEARING: the
  governed command lane itself has no PO approve/send command, so the pinned command-lane P2P
  receives against a draft PO by construction (8 pinned test files). S55 fenced the CANCELLED
  half (no flow legitimately receives against a cancelled PO — measured); the DRAFT half is a
  **commitment-authority** question — the buy-side twin of the sales-order-approval memo.
- **Decision required:** must a PO be approved/sent before goods can be received against it? If
  yes: PO approve/send become governed commands first, then the fence lands with the reworked
  pins.

## 4 · Credit/debit notes — register re-measurement (§2 #21)

The O2C reversal memo's statement "no cancel/credit-note member exists" is still true of
`DomainCommandType`, **but `creditNoteModule` and `debitNoteModule` now EXIST and book/reverse
real GL via the legacy action door.** The policy question (which reversals become governed
commands) is unchanged and covers them; the MECHANISM now exists — a future decision should not
be misled by the older "unmodeled" phrasing.

## Safest temporary state (in force now)

Everything stays exactly as the repository defines it: RBAC-guarded, module-guarded, kernel-
journaled GL, S55 token guards store-anchored. The matrix marks these surfaces
**POLICY-BLOCKED**, not RED — reachable-by-design pending the decisions above, mirrored on the
S45 memos' discipline.
