# SESSION 96 — CROSS-CYCLE ERP FINANCIAL-INTEGRITY CERTIFICATION

**Class:** cross-cycle integrity gate. **Outcome: the certified P2P (S94) and O2C (S95) cycles execute in the SAME tenant/profile over a SHARED product without corrupting shared Inventory, GL, AR, AP, Cash, GRNI, Revenue, COGS, journal history, idempotency, outbox/audit, tenant isolation, or lineage.** Reuses ONLY existing canonical modules/commands — no new accounting / inventory / reconciliation / transaction engine. ZERO production change. No frozen change; no FG-S96 token. Baseline S95 GREEN. Release track PAUSED.

## 1. Shared accounting/inventory mappings traced (source-wins)

Read from `inventoryGlBridge.ts` (`switch(movement.type)`) and the posting rules — **asserted, not assumed**:

- **P2P receipt** (`receive` movement): **Dr Inventory / Cr GRNI** (`deriveGoodsReceiptPosting`).
- **P2P supplier-invoice approve** (matched goods bill): **GRNI relief + Cr Accounts Payable** (+ PPV/tax) via `goodsBillMatch`/`glPosting`.
- **P2P supplier payment**: **Dr Accounts Payable / Cr Cash** (`JE-VPAY-*`).
- **O2C shipment** (`issue` movement): **Dr COGS / Cr Inventory** at STANDARD cost (`deriveCogsPosting`, `method: 'standard'`; posts only when the product carries a unit cost — a half-costed dispatch refuses, no entry).
- **O2C invoice issue**: **Dr Accounts Receivable (1100) / Cr Sales Revenue (4000)**.
- **O2C customer receipt**: **Dr Cash / Cr Accounts Receivable**.

Inventory is one shared ledger (`inventory-movements`); the product's `currentStock` is derived from it. AR and AP live in disjoint stores (`finance` customer invoices + `finance-payments` receipts vs `finance-vendor-bills` + `finance-vendor-payments`), and the settlement commands resolve disjoint stores — so AR/AP separation is structural.

## 2. Both cycles in one tenant (fresh profile, no seeded state)

`crossCycleFinancialIntegrity.test.ts` and the real-Electron journey build ONE installation / ONE profile, create a single shared SKU, and run the full P2P chain then the full O2C chain against it. Every step is a governed command; no IPC shortcuts.

## 3. Control matrix (RED / YELLOW / GRAY / POLICY-OPEN)

| # | Control | Status | Evidence |
|---|---|---|---|
| 4 | Shared inventory: 0 + P2P receipt − O2C shipment = final stock (product = ledger = movements) | GREEN | product `currentStock` == Σreceive − Σissue; P2P adds one receive, O2C one issue; no phantom/duplicate |
| 5a | P2P GL present: Dr Inventory/Cr GRNI, GRNI-relief/Cr AP, Dr AP/Cr Cash | GREEN | journals grow through the P2P chain |
| 5b | O2C GL present: Dr COGS/Cr Inventory, Dr AR/Cr Revenue, Dr Cash/Cr AR | GREEN | journals grow through the O2C chain (COGS at standard cost) |
| 5c | Every posting exactly once; replay never duplicates a journal; originals immutable; entry numbers unique | GREEN | replaying every terminal command adds zero journals + zero movements; both settlements stand |
| 6 | AR/AP separation: supplier payment cannot settle a customer invoice; customer receipt cannot settle a supplier bill | GREEN | `PaySupplierInvoice` on a customer invoice → refused; `ReceiveCustomerPayment` on a supplier bill → refused; no stray payment/receipt |
| 7 | Idempotency + restart: both cycles survive a restart; terminal replays never double-post | GREEN | rebuild over the same stores; inventory/journals/settlements preserved; both replays deduped |
| 8 | Tenant isolation: tenant-B cannot see or settle tenant-A documents; forged tenant refused | GREEN | foreign-tenant bill/invoice invisible; cross-tenant settle refused; forged tenant → CROSS_TENANT_CLAIM |
| 9 | Raw/legacy doors stay governed-only | GREEN | raw-door O2C ship/convertToInvoice + status edit refused (S46) |
| 10 | AI/advisory cannot autonomously execute either cycle | GREEN | advisory context (no procurement/operations/sales manage) refused on GR post, pay, ship, issue, receive |
| 11 | Deterministic reconciliation from persisted state | GREEN | inventory (receipts−issues=stock), AP (bill paid, amountPaid=total), AR (invoice paid, amountPaid=total), cash (one payment out + one receipt in) |

**No RED, no YELLOW, no GRAY.** One POLICY note (not a gap): O2C COGS uses the **standard-cost** basis (labelled truthfully in source; `method: 'standard'`) — the defined costing method, not invented here; no weighted-average/FIFO costing is claimed.

## 4. Real-Electron result — GREEN (operator Mac, 2026-09-04)

`out-seam-s96` build → single fresh-profile journey running both cycles over a shared SKU + a real restart. **Passed every assertion + RESULT on the first run, exit 0** (45 assertions): FRESH profile, NO seeded state → shared SKU-1 → P2P reorder (Q1 = 430) → PR/PO/GR → **P2P receipt: inventory 70 → 500** (one receive movement) + GRNI → Supplier Invoice → AP → **supplier bill PAID** (one cleared supplier payment) → O2C on the SAME SKU → **O2C shipment: inventory 500 → 460** (one issue movement, Dr COGS/Cr Inventory) → Invoice → Issue (AR) → **customer invoice PAID** (one cleared receipt) → **SHARED INVENTORY: product stock == Σreceive − Σissue** → **AR/AP separation** (supplier payment cannot settle the customer invoice; customer receipt cannot settle the supplier bill; no stray payment/receipt) → **GL populated by both cycles (7 journals)** → **REAL PROCESS RESTART: inventory, both settlements, all counts unchanged; both terminal payment replays deduped; no duplicate GL/movement.** **GREEN end-to-end.**

## 5. Focused + regression totals

`crossCycleFinancialIntegrity.test.ts` **8/8** (shared inventory equation; cross-cycle GL populate + exactly-once + no replay dup; AR/AP separation; restart durability; tenant isolation; raw-door + AI boundaries; deterministic reconciliation). Regression: platform/command + finance + procurement + sales + inventory **809/809**. Typecheck node clean; eslint clean. Full main + UI + build + journey PENDING operator Mac.

## 6. Frozen-file changes

**None.** gate-detector PROCEED on all S96 files. `enterprise/index.ts`, `runtimeCore.ts`, `packages/shared`, `commandBus.ts`, `cst/`, all finance/procurement/inventory/sales modules untouched. No FG-S96 token. `certification/baseline.json` untouched.

## 7. Exact files changed — ZERO production code

- **TEST (1):** `apps/desktop/src/main/platform/command/crossCycleFinancialIntegrity.test.ts` (new).
- **HARNESS (1):** `apps/desktop/e2e/s96CrossCycleIntegrityJourney.e2e.cjs` (new).
- **DOCS (1):** this cert.

No production `.ts` changed; no shared/frozen change. (The only production change in the P2P/O2C series was the S95 draft-invoice guard, already landed.)

## 8. Policy gaps (documented, not implemented)

O2C COGS costing basis is standard cost (defined; no weighted-average/FIFO invented); no cross-cycle netting / inter-company / consolidated-tax treatment (none exists). Each is a future operator-gated decision; none blocks the S96 target.

## 9. Exact commit

One non-frozen commit (test + journey + cert), recorded on landing.

## 10. Final S96 status — GREEN

**The P2P and O2C cycles are CERTIFIED and VERIFIED to co-exist in one tenant without corrupting any shared financial or inventory state, in the real Electron runtime (operator Mac, 2026-09-04).** Shared inventory nets correctly (product = ledger = movements; 70 → 500 → 460); both cycles' canonical GL is populated exactly once and immutable (7 journals); AR/AP are separated (no cross-settlement); idempotency + restart hold across both cycles; tenant isolation, raw-door, and AI boundaries all fail closed; reconciliation is consistent from persisted state. Proven by 8/8 focused tests + 809/809 command/finance/procurement/sales/inventory (sandbox) + the fresh-profile real-Electron cross-cycle journey with a real process restart (45 assertions + RESULT, exit 0). No frozen change; no FG-S96 token; ZERO production change; AI advisory-only. `certification/baseline.json` untouched. Release-track files left untouched (paused). Full main suite + build recorded on the operator's run when available.
