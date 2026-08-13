# NeuroPause — Phase 6 Recon: existing system, honestly assessed

**Program:** Universal Enterprise Data Intelligence · **Date:** 2026-08-08 · **Build:** `1.0.0-rc.15`
**Method:** four parallel read-only recon passes over `apps/`, `packages/`, `docs/`, `claude/`, evidence-cited.

This is the input to Phase 6. It exists to stop us rebuilding what works and to stop us claiming depth we do not have. Nothing here is inferred from documentation — every claim is from code.

## 1. The framework is genuinely good; reuse it

`defineEnterpriseModule` + `EnterpriseRecordStore` (`apps/desktop/src/main/enterprise/framework/`) give every module, for free: descriptor-driven validation, atomic JSON persistence with quarantine-not-reset on corruption, lifecycle fan-out (audit + platform event + IPC broadcast), RBAC hooks, and a generic renderer. 104 modules across 13 families are registered in one place (`enterprise/index.ts:302-405`) and locked by `moduleCertification.test.ts` (`CERTIFIED_COUNTS`, 104 total).

**Consequence for Phase 6:** the data plane writes THROUGH this framework. It adds a routing vocabulary, not a second ERP.

## 2. Module count is a poor proxy for depth

Depth is very unevenly distributed. Roughly 40% of the 104 modules are immutable derived *register* modules (aging, ratios, cash-flow, valuation, forecasts) that compute a report on create and are read-only after.

| Domain | Modules | Test cases | Business rules | Posts to GL? |
|---|---:|---:|---|---|
| **Finance** | 21 | ~192 | **Strong** — double-entry with balance guard, period close, posted-entry immutability + reversal, realized/unrealized FX, straight-line & declining-balance depreciation | **Yes, native** |
| **HR** | 15 | ~83 | **Strong (payroll)** — effective-dated statutory rules, attendance proration, balanced 9-account accrual, one-run-per-period | **Yes**, 3 seams |
| **Manufacturing** | 12 | ~35 | Medium-strong MES — schedule-gated execution, BOM backflush, immutable event ledger, OEE | **No** (no WIP/variance) |
| **Inventory** | 7 | ~40 | Medium-strong — single-writer stock ledger, availability-guarded reservations, FIFO/WAC valuation | **No** |
| **Warehouse** | 8 | ~13 | Medium — paired transfer legs, variance-posting cycle count | **No** |
| **Sales** | 7 | ~78 | Medium — discount policy forcing approval, guarded conversions, real inventory reservation | Invoice only; **no COGS** |
| **CRM** | 8 | ~84 | **Thin-medium** — stage/probability clamping, lead conversion; largely CRUD + derived fields | No |
| **Procurement** | 7 | ~31 | Thin-medium — budget gate, contract gate; **no three-way match** | **No** (no GRNI) |
| **Projects** | 4 | ~7 | Thin, one strong seam (time → invoice) | Via invoice |
| **Service/Helpdesk** | **1** | ~4 | **Very thin** — an SLA lookup table and two flags, 324 LOC total | No |

## 3. Four structural ceilings (these bound everything, regardless of module count)

1. **No line-item documents anywhere.** `EnterpriseFieldValue` is `string | number | boolean | null`. A Sales Order carries one product, one quantity, one total. Multi-line data is JSON stuffed into a textarea.
2. **JSON-file persistence.** No transactions, no referential integrity, no joins. Cross-module references are free-text codes resolved by linear scan.
3. **No multi-level approval or segregation of duties.** Grepping `approvalChain|escalat` across modules returns nothing real — every "approve" is a single-actor state flip. The creator can approve their own record.
4. **Accounting integration stops at Finance and HR.** Inventory, production and procurement never reach the books, so the GL cannot produce a correct balance sheet or gross margin for a company that holds stock.

**These are the honest gaps.** Phase 6 does not close them; closing (1) and (2) is a data-model and storage-engine programme in its own right.

## 4. Ingestion: there was nothing to reuse

A repo-wide grep for `documentImport|parseFile|extractText|fileIngest` returned **zero hits**. No parsing library is declared anywhere (`xlsx`, `papaparse`, `pdf-parse`, `mammoth`, `jszip` — all absent). Every `readFile` in main is JSON store persistence.

The renderer already captures file drops (`WorkspaceView.tsx:75-88`) but keeps only `{name, size, type}` — commented in-source as awaiting a routing layer.

**Downstream of extraction, everything already exists:** `unifiedStore.upsertMany()` → `LocalSearchBackend` (TF-IDF inverted index) → federated `EnterpriseSearch`; plus `memoryStore.remember()` and `graphStore.apply()`. The missing tier was extraction.

## 5. Constraints that shaped the Phase 6 design

- **No native modules, ever, in desktop.** The app has never shipped one; macOS builds are `--universal`; `asar: true` with a single unpack entry. A parser with native bindings, WASM or worker files would be the first and would introduce ABI/rebuild concerns this repo has never had.
- `externalizeDepsPlugin` reads `dependencies` only — a parser in `devDependencies` gets inlined into the 4.9 MB single-file main bundle.
- **Startup fails closed on IPC:** `runtimeCore.ts:2784` throws if any runtime channel is neither RBAC/auth-gated nor in `PUBLIC_CHANNELS`. This check runs at BOOT, not in tests — a wiring mistake is not caught by `test:release`.
- Release gate covers 6 workspaces; `apps/desktop` and `packages/shared` are both in it.

**Design consequence:** the Universal Data Plane was built with **zero runtime dependencies**, using `node:zlib` for the ZIP container that XLSX and DOCX are made of. This buys real spreadsheet parsing without touching the packaging risk surface at all.
