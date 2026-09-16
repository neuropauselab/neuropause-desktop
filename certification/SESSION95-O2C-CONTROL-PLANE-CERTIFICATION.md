# SESSION 95 — END-TO-END ORDER-TO-CASH CONTROL-PLANE CERTIFICATION

**Class:** whole-workflow certification + ONE canonical fix. **Outcome: the COMPLETE governed Order-to-Cash lifecycle — Customer → Sales Order → Ship → Inventory issue → Customer Invoice → 3-way-less AR (issue) → AR Liability → Customer Receipt → AR Settlement — is certified as ONE governed ERP workflow, reusing ONLY the existing canonical modules/commands.** One real finding was reproduced and fixed by mirroring the buy-side (F-S95-1, YELLOW). No new approval / payment / workflow / inventory / accounting / command-bus engine; no duplicate IPC. No frozen change; no FG-S95 token. Baseline S94 GREEN. Release track PAUSED.

## 1. Live path traced (source-wins)

`UI → preload (window.neuropause) → IPC (secure bridge) → application boundary (server-resolved principal + tenant) → command bus (dispatchCommand) → authorization (ctx.authorize(PERMISSION_FOR_COMMAND)) → business policy (per-module validate + the order/invoice status machines) → domain command → durable transaction (DurableCommandJournal) → persistence (EnterpriseRecordStore) → event/outbox → governance audit → UI`. Every consequential O2C command rides the FG-ERP-LIVE-IPC path (S22).

## 2. Canonical modules/commands reused (nothing new)

CRM: `customerModule` (`crm-customers`). Sales: `orderModule` (`sales-orders`) + `inventoryLink.shipOrderStock`; commands `CreateSalesOrder` (S21), `ShipSalesOrder` (S27), `InvoiceSalesOrder` (S28). Finance: `invoiceModule` (`finance`) + `IssueCustomerInvoice` (S28, Dr AR / Cr Sales Revenue); `paymentModule` (`finance-payments`) + `ReceiveCustomerPayment` (S29, Dr Cash / Cr AR + reconcile); `paymentReversalModule` + `ECONOMIC_DELETE_GUARD` + `ReverseCustomerPayment` (S61). Durability/idempotency/event/outbox/audit: the Session-18 `DurableCommandJournal`. All reused; the only production edit is the F-S95-1 guard.

## 3. The finding — F-S95-1 (YELLOW, fixed)

A customer receipt could settle a **DRAFT (unissued)** invoice, booking Cr AR / Dr Cash against an AR that issuance never booked (revenue unrecognised, AR net-negative). This is the exact asymmetry with the buy side, which already refuses paying a draft bill ("approve it first"). **Reproduced, then FIXED by mirroring the buy-side guard** in `paymentModule.ts` validate: a `draft`/`cancelled` invoice is refused ("issue it first"); `issued`/`partially_paid` remain payable; `paid`/overpay stays handled by the existing guard. Strengthens a fail-closed control; invents nothing. Full write-up: DECISION-MEMO-S95.

## 4. Control matrix (RED / YELLOW / GRAY / POLICY-OPEN)

| # | Control | Status | Evidence |
|---|---|---|---|
| 1a | Create customer + Sales Order | GREEN | governed create; SO born `pending` |
| 1b | SO pending until explicit shipment; no inventory before shipment | GREEN | status `pending` after create; zero issue movements |
| 1c | SO **approval boundary** | GREEN (documented) | the canonical SO has **no separate approval action**; the boundary is the machine-owned status + `sales:manage` RBAC + deny-by-default create (born pending). No approval threshold invented — recorded characteristic, not a gap |
| 1d | Unauthorized shipment/first-consequential-action fails closed | GREEN | denied `sales:manage` → UNAUTHORIZED |
| 2a | Ship = explicit governed action; inventory issued exactly once | GREEN | one `issue` movement; replay ship refused, no double |
| 2b | Shipment lineage linked to SO | GREEN | movement `referenceRecord` = order id |
| 2c | Edit/delete cannot bypass the shipment state machine | GREEN | raw-door ship/convertToInvoice refused (S46 governed-only); status edit refused (machine-owned) |
| 3a | Draft invoice creates no AR; references the SO | GREEN | convert → draft invoice (`convertedInvoice`), no GL |
| 3b | No duplicate invoice on replay; issued economic edit governed | GREEN | re-convert refused (`convertedInvoice` guard); invoice markers governed |
| 4a | Issue books AR exactly once; re-issue cannot duplicate | GREEN | Dr AR / Cr Revenue once; re-issue refused |
| 4b | AR linked to invoice/customer | GREEN | invoice ↔ order ↔ customer lineage |
| 5a | **Draft/unissued invoice cannot be settled** | GREEN (F-S95-1 fixed) | receipt against a draft invoice refused; no receipt, no GL |
| 5b | Explicit operator receipt; exactly one cleared receipt; Dr Cash / Cr AR; AR settled | GREEN | one cleared payment; invoice `paid`, amountPaid = total |
| 5c | Same-key replay no double-receive; overpay + duplicate txn refused | GREEN | replay deduped; second full receipt + dup ref refused |
| 6a | Cleared receipt DELETE refused | GREEN | `ECONOMIC_DELETE_GUARD` |
| 6b | ReverseCustomerPayment is the canonical unwind; original immutable; invoice re-opened | GREEN | governed reversal; original byte-identical; amountPaid 0; at-most-one |
| 6c | Bank-reconciled reversal fail-closed | GREEN | `bankReconciledAt` set → reversal refused |
| 7 | Restart durability (counts + lineage + no double-post) | GREEN | rebuild over the same stores + real app restart |
| 8 | Security: forged/no/cross tenant, unauthorized, cross-tenant customer, replay | GREEN | UNRESOLVED_TENANT / CROSS_TENANT_CLAIM / UNAUTHORIZED / CUSTOMER_NOT_FOUND / replay deduped |
| 9 | AI/advisory cannot autonomously ship/issue/receive/reverse | GREEN | advisory context (no manage grants) refused on every consequential command (§13) |

**No RED, no GRAY. One YELLOW (F-S95-1) — reproduced and FIXED. One documented characteristic (1c: no separate SO approval action) — recorded, not invented.**

## 5. Real-Electron result — GREEN (operator Mac, 2026-09-04)

`out-seam-s95` build → fresh-profile journey with a real restart. **Passed every assertion + RESULT on the first run, exit 0** (47 assertions): FRESH isolated profile with NO seeded ERP state → customer → CreateSalesOrder (**pending until shipped**) → **raw-door ship/convertToInvoice + status edit all refused** → ShipSalesOrder (**inventory issued exactly one movement**, re-ship refused, no double) → InvoiceSalesOrder (**draft invoice, no AR**) → **a DRAFT invoice cannot be settled (S95 guard fired live — no receipt, no GL)** → IssueCustomerInvoice (**AR booked once**) → **no automatic receipt before the operator action** → ReceiveCustomerPayment (**one cleared receipt, Dr Cash / Cr AR**) → **AR SETTLED (invoice paid)** → same-key replay no double-receive → **second full receipt refused (overpay)** → **duplicate txn ref refused** → **cleared receipt DELETE refused** (governed reversal is the only unwind) → **REAL PROCESS RESTART on the same profile: every count (customer/SO/movement/invoice/receipt/journal) unchanged, the invoice still SETTLED, lineage survived, and a post-restart replayed receipt deduped with no duplicate GL.** The F-S95-1 fix is proven live: the draft-invoice guard refuses settlement in the real runtime. **GREEN end-to-end.**

## 6. Focused + regression totals

`o2cControlPlaneCertification.test.ts` **13/13** (full chain + exactly-once accounting; SO+shipment boundary incl. raw-door + status-edit refusal; invoice+AR once; the draft-invoice guard reproduce+fix; receipt overpay/dup/replay; reversal/delete boundary; restart durability; security; AI boundary). Regression: platform/command + sales + crm **344/344**; finance modules **314/314** (incl. the updated `paymentModule.test.ts`). Typecheck node clean; eslint clean. Full main + UI + build + journey PENDING operator Mac.

## 7. Frozen-file changes

**None.** gate-detector PROCEED on all S95 files incl. `paymentModule.ts`. `enterprise/index.ts`, `runtimeCore.ts`, `packages/shared`, `commandBus.ts`, `cst/` untouched. No FG-S95 token. `certification/baseline.json` untouched.

## 8. Exact files changed — PRODUCTION vs TEST/DOCS

- **PRODUCTION (1):** `apps/desktop/src/main/enterprise/modules/finance/paymentModule.ts` — the F-S95-1 draft/cancelled-invoice settlement guard (mirrors the buy-side).
- **TEST (2):** `apps/desktop/src/main/platform/command/o2cControlPlaneCertification.test.ts` (new); `apps/desktop/src/main/enterprise/modules/finance/paymentModule.test.ts` (fixture issues the invoice — corrected precondition).
- **HARNESS (1):** `apps/desktop/e2e/s95O2CControlPlaneJourney.e2e.cjs` (new).
- **DOCS (2):** this cert + `DECISION-MEMO-S95-DRAFT-INVOICE-SETTLEMENT-GUARD.md`.

## 9. Policy gaps (documented, not implemented)

The Sales Order has no separate approval action / threshold (deliberately — the status machine + RBAC is the boundary; not invented); advanced O2C credit limits / dunning / credit-note policy (none exists); reorder/AR-side line detail. Each is a future operator-gated decision; none blocks the S95 target.

## 10. Exact commit

One non-frozen commit (production guard + tests + journey + memo + cert), recorded on landing.

## 11. Final S95 status — GREEN

**The end-to-end O2C control plane is CERTIFIED and VERIFIED as one governed workflow in the real Electron runtime (operator Mac, 2026-09-04), with ONE canonical production fix.** Every defined control passes; one real financial-integrity gap (F-S95-1, draft-invoice settlement) was reproduced and FIXED by mirroring the buy-side guard (strengthening a fail-closed control, inventing nothing) and is proven live; the SO "approval boundary" is documented (status machine + RBAC, no separate action). Proven by 13/13 focused tests + platform/command + sales + crm 344/344 + finance 314/314 (sandbox) + the fresh-profile real-Electron journey with a real process restart (47 assertions + RESULT, exit 0). No frozen change; no FG-S95 token; AI advisory-only. `certification/baseline.json` untouched. Release-track files left untouched (paused). Full main suite + build recorded on the operator's run when available.
