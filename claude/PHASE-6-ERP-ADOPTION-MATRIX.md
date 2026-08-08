# NeuroPause — ERP Engine Adoption Matrix

**Date:** 2026-08-08 · **Build:** `1.0.0-rc.15` · **Gate:** 5,862 / 5,863 (sole failure = known env-sensitive perf bench RB-13)

**Objective (from the Completion Matrix):** *"engines are complete and tested; module-level adoption is the next step."* This records how adoption is done, which modules adopt what, and exactly what remains.

## The adoption mechanism

`apps/desktop/src/main/erp/documentAdapter.ts` — a module declares a `DocumentSpec`; `attach()` **composes** the behaviour onto the module's existing `hooks.onChange`. Three properties make this safe to apply across 104 modules:

1. **A module with no spec is returned by identity** — `attach()` is a literal no-op. Asserted by test.
2. **The module's own reconciliation runs first, unchanged** — Finance's GL posting, Procurement's budget/contract gates and Sales' inventory reservation are untouched. Order asserted by test.
3. **Totals are derived at read, never written back** — matching the codebase's own idiom (project progress from tasks, SLA breach at read). Nothing mutates a record inside its own change hook, so there is no lifecycle loop.

Posting is **derived** here and applied by the **existing** journal module through an injected `postJournal` — one accounting engine, one balance guard. Every derivation carries a deterministic reference and the adapter refuses to re-post one (idempotency asserted by test).

## Adopted modules (`documentSpecs.ts`)

| Module (live id) | Document | Lines | Posts on | Approval + SoD | Status |
|---|---|---|---|---|---|
| `procurement-orders` | purchaseOrder | ✓ | — | Spend policy (mgr → finance ≥10k → exec ≥100k); gated: approved/issued/sent | **SPEC COMPLETE, NOT REGISTERED** |
| `procurement-receipts` | goodsReceipt | ✓ | `received`/`completed` → **Dr Inventory / Cr GRNI** | — | **SPEC COMPLETE, NOT REGISTERED** |
| `finance-vendor-bills` | bill | ✓ | `posted` → **Dr GRNI / Cr AP** (refuses unless three-way match = MATCHED) | Bill policy; SoD: requester ≠ payment approver | **SPEC COMPLETE, NOT REGISTERED** |
| `warehouse-shipping` | delivery | ✓ | `shipped`/`dispatched` → **Dr COGS / Cr Inventory** | — | **SPEC COMPLETE, NOT REGISTERED** |
| `manufacturing-executions` | (material) | ✓ | `in_progress` → **Dr WIP / Cr Inventory**; `completed` → **Dr FG + variance / Cr WIP** | — | **SPEC COMPLETE, NOT REGISTERED** |
| `sales-quotes` | salesQuote | ✓ | — | — | **SPEC COMPLETE, NOT REGISTERED** |
| `sales-orders` | salesOrder | ✓ | — | — | **SPEC COMPLETE, NOT REGISTERED** |
| `finance-invoices` | invoice | ✓ | — (revenue/AR already post via the existing `invoiceModule` → `handleInvoiceChangeForGl`) | — | **SPEC COMPLETE, NOT REGISTERED** |

## Deliberately NOT adopted

| Group | Count (approx.) | Why |
|---|---|---|
| `finance-journal-entries` | 1 | The GL already has a real, balance-guarded line model (`GlJournalLine`). A second line model over the same document would create a divergent accounting truth. |
| Register / snapshot modules (AR & AP aging, ratios, cash flow, valuation, forecasts, payroll register…) | ~40 | Immutable derived reports, not documents. They compute on create and are read-only after. |
| Master data (customers, suppliers, products, employees, contacts, leads, warehouses…) | ~30 | No lines. Already adopted by the Data Plane for import. |
| Operational records (tickets, tasks, time entries, attendance, leave, movements, lots, serials…) | ~25 | Single-fact records; forcing lines on them would break domain semantics, which the charter forbids. |

## THE REMAINING STEP — honest status

Every spec above is **written and tested but NOT registered into the running application.** Registration is one contained edit in the enterprise composition root:

```ts
// apps/desktop/src/main/enterprise/index.ts
const documents = new DocumentIntegration({
  lines: new DocumentLineStore(join(userDataDir, 'erp-document-lines.json')),
  postJournal: (d, ctx) => applyGlDerivedEntries(/* existing journal path */),
  audit, now, actor,
});
documents.registerAll(DOCUMENT_SPECS);
// then, at module registration: registry.register(documents.attach(module))
```

**Why it was not applied in this pass.** It requires binding `postJournal` to the live double-entry posting path — the most sensitive code in the system — and this session cannot launch the app to verify the result. This exact session produced the evidence for that caution: two defects (the externalization bug and the startup race) were invisible to a green 5,838-test suite and only appeared on launch. Registering a posting path blind, overnight, against a working build is the one change where being wrong is expensive and silent.

The adapter is built so this step is small, reversible and verifiable in one run: apply the edit, launch, create a goods receipt, confirm one GRNI entry appears in the journal.

## Test coverage

25 adapter tests (`documentAdapter.test.ts`) + 48 engine tests (`erp.test.ts`) = **73**, covering: no-op for unspecced modules, composition order, line validation, derived totals, GRNI on receipt, COGS on dispatch, bill refusal when the match failed, GRNI netting to zero across receipt→bill, idempotency under re-fired events, refusal recording, a throwing derivation not breaking the mutation, creator-cannot-approve, two-step approval, threshold escalation, and requester-cannot-approve-own-payment.
