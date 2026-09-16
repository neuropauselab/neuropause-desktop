# SESSION 102 — ENTERPRISE APPROVAL-ENGINE RECONCILIATION & AUTHORITY CONTROL-PLANE CERTIFICATION

**Class:** approval reconciliation + authority re-certification — ZERO production change. **Outcome: the three approval subsystems are reconciled into one clear governed control model; the canonical authority path is defined; no engine was unified by force and no threshold/SoD policy was invented or adopted. The founder-level question is answered: authority is the governed action + RBAC scope + machine-owned status, and no other door bypasses it.** Baseline S101 GREEN. Full canonical map + reasoning: DECISION-MEMO-S102.

## 1. The three approval subsystems (discovered, source-cited)

1. **Machine-owned status + governed action + RBAC** — the LIVE canonical authority for every consequential ERP economic transition (certified S94–S101).
2. **S20 workflow runtime** (`ApprovalInstance`, `ApprovalInstanceStore`) — the durable request→approval-instance lifecycle, live for the PR submit→approval→convert flow.
3. **erp/approvalEngine** (`DEFAULT_SPEND_POLICY` $10k/$100k, `BILL_APPROVAL_POLICY` creator_cannot_approve) — reusable policy infrastructure, consulted only at the Update/SetStatus door via `canEnterStatus`.
4. (CST kernel Approval — a separate LiveBrain proposal subsystem, out of ERP scope.)

## 2. Canonical approval decision (PHASE 2) — no false unification

The three operate at three different layers (domain action vs stateful workflow instance vs stateless status-policy) and are NOT duplicates. **The canonical enterprise approval path for consequential ERP actions is subsystem 1** (governed action + RBAC + machine-owned status), with **subsystem 2** providing the durable PR approval instance that the PR→PO conversion gate reads. **Subsystem 3 is reusable infrastructure whose adoption as the exclusive PR/PO approval authority is an explicit operator ruling (S90); it is deliberately NOT wired further in S102.** Unifying them into one engine would be a false unification.

## 3. The two approval-carrying documents behave DIFFERENTLY (the decisive finding)

- **finance-vendor-bills — engine DORMANT (single-door).** Status is marker-derived (`approvedAt`) and the markers are validate-fenced, so the Update/SetStatus door can never reach `approved`; `canEnterStatus`/`BILL_APPROVAL_POLICY` never fires. The **approve action + RBAC is the sole gate**. There is no bypass — and no live creator≠approver SoD on bill approval (POLICY-OPEN; adopting it would break the certified single-operator P2P flow where one operator creates + approves).
- **procurement-orders — DUAL-DOOR (both RBAC-gated).** The PO validate deliberately does not fence `approved`/`sent` because the Update door is gated by `canEnterStatus(DEFAULT_SPEND_POLICY)` (active in production); the approve action is gated by RBAC + `poTransition`. Both doors authorize `procurement:manage` FIRST, so **RBAC is the consistent floor**; the spend policy is an additional edit-door constraint, not the exclusive authority. Making it exclusive / applying the tiers is an operator ruling (S90), not invented.

**No governance bypass exists on either document.** Neither an ADOPTED single authority is circumvented: bills have one door (RBAC); POs have two doors that both enforce the RBAC floor, with the spend policy a stricter optional overlay. The remaining question is the operator ruling on exclusive spend-policy adoption.

## 4. Authority / SoD / threshold matrix (A · B · C · D)

| Item | Class | Evidence |
|---|---|---|
| Machine-owned-status + governed-action + RBAC authority | A implemented+certified | S94–S101; S102 re-asserts PO/bill/production RBAC floor |
| S20 ApprovalInstance integrity (idempotent, tenant-scoped, single-flight, terminal, restart-durable) | A | requestApproval one-PENDING; decide APPROVE/REJECT; replay idempotent; approve-after-reject → CONFLICT; cross-tenant → NOT_FOUND; survives restart |
| Expense-claim creator≠approver SoD | A | self-approve refused, 0 GL; a different operator approves once |
| Vendor-bill approve = RBAC-only (engine dormant) | A (single consistent gate) | status marker-machine-owned; Update can't forge `approved`/`approvedAt`, 0 GL |
| PO approval = dual-door, RBAC floor on both | A (no bypass) | SetStatus can't set domain status; approved→draft reversal refused; unauthorized refused on BOTH action + edit doors |
| PO/bill creator≠approver SoD + spend thresholds | C policy-open | declared infrastructure; adoption = operator ruling (S90); would break single-operator P2P; thresholds not applied |
| PR/PO threshold tiers + role hierarchy; expense multi-level; reversal SoD; period-reopen dual-control | C policy-open | unadopted; not invented |
| Payroll/disbursement approval; stock-adjustment/cycle-count approval + materiality; mfg variance/scrap approval | D not-implemented | GL mechanics real; authority layer absent; unauthorized actor fail-closed |

**No RED. No new bypass defect. No production change.**

## 5. Economic-consequence evidence

Every unauthorized / forged / terminal-state / cross-tenant attempt is refused with zero economic side effect: expense self-approval → 0 GL; unauthorized PO approve (action AND edit door) → status draft, 0 effect; vendor-bill status/marker forge → 0 GL; forged production status → 0 output movement; cross-tenant approval decide → NOT_FOUND, untouched; approve-after-reject → CONFLICT, terminal preserved.

## 6. Regression fences carried (all GREEN)

S46 (governed-only doors), S55 (economic delete + closed-period immutability), S61/S62/S64 (payment reversal), S95, S97, S98 (F-S98-1: forged production status refused, 0 FG/WIP), S99, S100, S101 (expense SoD, PR→PO gate, period-close, authority restart persistence).

## 7. Real-Electron result — PENDING operator Mac

`out-seam-s102` build → fresh-profile authority journey with a real restart (`apps/desktop/e2e/s102ApprovalAuthorityJourney.e2e.cjs`):

```
cd apps/desktop
env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s102"
NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s102ApprovalAuthorityJourney.e2e.cjs ; echo "exit=$?"
```

Proves in the running app: the S20 PR approval flow (submit→approve→convert) is the canonical PR path; expense self-approval refused; PO approve is RBAC-gated + machine transition, SetStatus can't forge, approved→draft reversal refused; vendor-bill status marker-machine-owned; cleared-payment undeletable + at-most-once reversal; closed-period immutability; F-S98-1; and that all approval + economic state and the refusals survive a REAL restart. **S102 GREEN only on RESULT + exit 0 there.**

## 8. Focused + regression totals (sandbox)

`approvalReconciliationControlPlane.test.ts` **8/8** (S20 approval-instance integrity ×4; PO dual-door RBAC floor; vendor-bill engine-dormant; F-S98-1; expense SoD). Regression recorded on the run. Typecheck node clean; eslint clean.

## 9. Frozen-file changes

**None.** gate-detector PROCEED on all S102 files. No FG-S102 token. `certification/baseline.json` untouched.

## 10. Exact files changed

- **PRODUCTION: NONE.**
- **TEST (1):** `apps/desktop/src/main/platform/command/approvalReconciliationControlPlane.test.ts` (new).
- **HARNESS (1):** `apps/desktop/e2e/s102ApprovalAuthorityJourney.e2e.cjs` (new).
- **DOCS (2):** this cert + `DECISION-MEMO-S102-CANONICAL-APPROVAL-PATH.md`.

## 11. Final S102 status — GREEN pending the operator's Mac journey

The three approval mechanisms are reconciled into one clear governed control model: the canonical authority for every consequential ERP economic action is the governed action + RBAC scope + machine-owned status; the S20 workflow provides the durable PR approval instance; the threshold/SoD engine is reusable infrastructure whose exclusive adoption is an operator ruling (not invented). No door bypasses the authority — proven across the action/edit/SetStatus/delete doors, cross-tenant, terminal-state, and restart. The one live SoD (expense creator≠approver) holds; the declared-but-unadopted SoD/thresholds and the not-implemented authority layers are documented in DECISION-MEMO-S102, not coded. Proven by 8/8 focused tests + regression (sandbox). No RED, no production change, no frozen change, no FG token, no invented policy. `certification/baseline.json` untouched; release-track files untouched (paused). **The fresh-profile real-Electron authority journey with a real restart runs on the operator's Mac — S102 is marked GREEN only on RESULT + exit 0 there.**
