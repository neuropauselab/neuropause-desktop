# SESSION 101 — ENTERPRISE AUTHORITY, APPROVAL & SEGREGATION-OF-DUTIES CERTIFICATION

**Class:** authority-integrity certification — ZERO production change. **Outcome: NeuroPause's existing authority, approval, RBAC and segregation-of-duties controls actually protect the economic control plane — not merely the UI. An unauthorized, self-approving, forged, or terminal-state actor cannot cause an economic side effect.** The one live SoD rule (expense-claim creator≠approver) is airtight across every door; RBAC is fail-closed everywhere; machine-owned statuses block forged approval; payment-reversal + economic-delete guards hold; the actor is server-resolved and unforgeable. No approval engine was built; no authority policy was invented. Baseline S100 GREEN.

## 1. Authority model discovered (source-wins)

Authority is a **flat set of permission scopes** (`<domain>:read`/`<domain>:manage`), not a role hierarchy or threshold ladder. The command bus authorizes exactly one permission per command; the module doors authorize the module's write scope. **The actor is server-resolved** from the authenticated session (`localIdentity.sessionEmailFor`) — the renderer cannot forge it. A generic threshold+SoD engine (`erp/approvalEngine.ts`, real $10k/$100k tiers + `creator_cannot_approve`) exists but is **unwired** to the PR/PO approve actions (consulted only at the generic Update/SetStatus doors). Full authority + SoD matrix: DECISION-MEMO-S101.

## 2. Reproduce-first — NO bypass defect

The flagship investigation: can a creator self-approve their expense claim through a NON-action door (edit / SetStatus), skipping the SoD check + GL? **Answer: NO.** The claim `status` is machine-owned (`readOnly` + validate forces `submitted` on every edit; decided claims immutable), and `EnterpriseModuleSetStatus` is schema-limited to record statuses (`active`/`archived`/`deleted`) and never writes `fields.status`. So the ONLY path to `approved` is the `approve` action, which carries the SoD check and the GL posting. The SoD is airtight. No RED/YELLOW/GRAY defect found; no production change.

## 3. Authority / SoD matrix (A · B · C · D)

| Control | Class | Evidence |
|---|---|---|
| Expense-claim creator≠approver SoD | A implemented+certifiable | self-approve refused (action); can't forge via edit/SetStatus; different operator approves once (GL); zero GL on refusal; terminal |
| Actor attribution (server-resolved, unforgeable) | A | SoD compares `ctx.actor()` (session) to server-stamped `createdBy` |
| PR→PO conversion hard gate + machine-owned status | A | non-approved PR can't convert; edit-door `approved` refused; governed approve enables convert |
| Payment reversal + economic-delete guards (S61/S62/S64) | A | cleared payment undeletable; canonical reversal at-most-once; bank-reconciled fail-closed |
| Machine-owned status fences (S98 F-S98-1, S60, S45, S55) | A | forged production status→running/completed refused; closed-period edit refused |
| RBAC fail-closed across domains | A | unauthorized/advisory principal → refused, ZERO inventory/GL side effect |
| PR/PO approval SoD (creator≠approver) | C policy-open | engine exists, unwired (DECISION-MEMO-S90) — not invented |
| Threshold approval tiers ($10k/$100k) | C policy-open | defined, unwired to the approve action |
| Expense multi-level/threshold authority | C policy-open | single tier only |
| Payment-reversal SoD/threshold | C policy-open | single `operations:manage` scope |
| Accounting-period reopen dual-control | C policy-open | reopen gated by `operations:manage` (no unauthorized reopen); no second-approver |
| Payroll / disbursement authority | D not-implemented | GL posting + immutability real; approval/SoD/threshold absent |
| Stock-adjustment / cycle-count approval + materiality | D not-implemented | canonical `adjustment` movement + GL real; approval/threshold absent |
| Manufacturing variance / scrap approval + materiality | D not-implemented | variance auto-settles on completion; no approval/scrap module |

**No RED. No production change.** Every C/D item is fail-closed against an UNAUTHORIZED actor — the missing layer is a second approver / threshold (undefined policy), documented in DECISION-MEMO-S101, never converted to code.

## 4. Economic-consequence evidence (the load-bearing proof)

For every authority-controlled operation tested, an unauthorized / self-approving / forged / terminal-state actor is REFUSED with **zero inventory mutation, zero GL, zero AR/AP, zero finished goods, zero payment, zero duplicate**: expense self-approval → 0 GL; advisory stock-adjustment post → 0 adjustment movement + 0 GL; forged production status → 0 output movement; cleared-payment delete → refused (economic-delete guard); cross-tenant claim approval → target invisible, 0 GL.

## 5. Regression fences carried

S46 (governed-only doors), S55 (economic delete + closed-period immutability), S61/S62/S64 (payment reversal authority + immutable reversal), S95 (customer receipt cannot settle draft invoice), S97 (posted movement immutable), S98 (F-S98-1 machine-owned production status; no phantom FG/WIP), S99 (maintenance/project accounting untouched), S100 (cross-domain integrity). All GREEN.

## 6. Real-Electron result — PENDING operator Mac

`out-seam-s101` build → fresh-profile authority journey with a real restart (`apps/desktop/e2e/s101AuthorityJourney.e2e.cjs`):

```
cd apps/desktop
env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s101"
NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s101AuthorityJourney.e2e.cjs ; echo "exit=$?"
```

Proves in the running app (single local principal): the creator cannot self-approve their own expense claim (zero GL) and cannot forge `approved` via the edit door; the PR→PO conversion gate; cleared-payment undeletable + at-most-once reversal; closed-period actor attribution + edit immutability; F-S98-1; and that all state + the self-approval refusal survive a REAL restart. (The creator≠approver POSITIVE path and unauthorized/cross-tenant negatives need multiple principals/denied scopes and are covered by the focused test.) **S101 GREEN only on RESULT + exit 0 there.**

## 7. Focused + regression totals (sandbox)

`authoritySodControlPlane.test.ts` **9/9** (expense SoD across all doors; PR→PO gate; economic consequence; payment/reversal; period reopen; F-S98-1 + cross-tenant + AI; restart). Regression recorded on the run. Typecheck node clean; eslint clean.

## 8. Frozen-file changes

**None.** gate-detector PROCEED on all S101 files. No FG-S101 token. `certification/baseline.json` untouched.

## 9. Exact files changed

- **PRODUCTION: NONE.**
- **TEST (1):** `apps/desktop/src/main/platform/command/authoritySodControlPlane.test.ts` (new).
- **HARNESS (1):** `apps/desktop/e2e/s101AuthorityJourney.e2e.cjs` (new).
- **DOCS (2):** this cert + `DECISION-MEMO-S101-AUTHORITY-APPROVAL-SOD.md`.

## 10. Final S101 status — GREEN pending the operator's Mac journey

At the sandbox level, NeuroPause's authority/approval/RBAC/SoD controls are proven to protect the economic control plane: the one live SoD rule is airtight, RBAC is fail-closed, machine-owned statuses and economic-delete/reversal guards hold, and the actor is unforgeable. No unauthorized, self-approving, forged, or terminal-state actor can cause an economic side effect. Proven by 9/9 focused tests + regression (sandbox). No RED, no production change, no frozen change, no FG token, no invented policy; the policy-open/not-implemented authority layers are documented, not coded. `certification/baseline.json` untouched; release-track files untouched (paused). **The fresh-profile real-Electron authority journey with a real restart runs on the operator's Mac — S101 is marked GREEN only on RESULT + exit 0 there.**
