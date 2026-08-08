# NeuroPause — Phase 6 Maturity Matrix

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: program, product, engineering
>
> Per-domain maturity after Phase 6, from code evidence. Honesty rule: **UI is generic everywhere** (all 104 modules share one screen), **GUI verification is pending everywhere** (renderer tests are Node-only), and a strong test count does not by itself mean a deep data model.

**Status values:** `COMPLETE` · `VERIFIED` (evidence-backed) · `PARTIAL` · `PREVIEW` · `EXTERNAL DEPENDENCY` · `NOT IMPLEMENTED`.

## Universal Enterprise Data Plane (new in Phase 6)

| Capability | Status | Evidence |
|---|---|---|
| Ingestion architecture (adapter → parse → classify → validate → route → import) | **COMPLETE** | `dataPlane/` pipeline, 63 tests |
| XLSX (multi-sheet, shared strings, date styles, deflate) | **VERIFIED** | Parsed a genuine openpyxl workbook + hermetic fixtures |
| CSV / TSV (RFC-4180: quotes, embedded delimiters/newlines, BOM) | **VERIFIED** | `parsers.test.ts` |
| JSON / XML / DOCX / TXT | **VERIFIED** | `parsers.test.ts` |
| PDF text extraction | **NOT IMPLEMENTED** | Reported `unsupported` with a named reason |
| Image OCR | **EXTERNAL DEPENDENCY** | Reported `unsupported`; no OCR engine bundled |
| Legacy `.xls` | **NOT IMPLEMENTED** | Detected and refused, not mis-parsed |
| Schema/header detection | **VERIFIED** | Title rows skipped, duplicate headers disambiguated, prose sheets correctly unclassified |
| Entity classification + column mapping | **VERIFIED** | Multi-signal; 8 canonical entities |
| Confidence + evidence | **VERIFIED** | Bands + `reasons[]` on every mapping |
| Contradiction / conflict guards | **VERIFIED** | "Invoice Date" over names refused; "Annual Salary" ≠ monthly |
| Normalization with recorded transformations | **VERIFIED** | Money, dates, phone, whitespace |
| Validation + data-quality report | **VERIFIED** | valid / invalid / incomplete / duplicate + top issues |
| Duplicate detection (exact + fuzzy) | **VERIFIED** | Legal-suffix canonicalization; reported, never auto-merged |
| Import plan (read-only) | **VERIFIED** | `analyzeSource` writes nothing |
| Risk-aware approval gate | **VERIFIED** | High-risk cannot import without explicit approval |
| Transactional import | **PARTIAL** | Compensating rollback for high-risk; **not ACID** (JSON stores) |
| Provenance | **VERIFIED** | Record metadata + durable `ProvenanceStore`, per-field lineage |
| Audit | **VERIFIED** | `dataplane.import` / `dataplane.import.rollback` |
| Import history / Import Center | **PARTIAL** | `ProvenanceStore.history()` exists; no UI |
| **IPC + UI surface** | **NOT IMPLEMENTED** | Engine not reachable from the renderer — the main Phase 6 gap |
| Smart mapping memory | **NOT IMPLEMENTED** | Designed for (`identityKeys`, synonyms) but not persisted |
| Connectors (Odoo/Zoho/Tally/SAP/Salesforce) | **NOT IMPLEMENTED** | Adapter seam exists; no provider implemented — not claimed |

## Business domains (unchanged by Phase 6 — verification, not rebuild)

| Domain | Data model | Business rules | Persistence | Permissions | Audit | Workflow | UI | E2E | Posts to GL |
|---|---|---|---|---|---|---|---|---|---|
| Finance | PARTIAL (no line items) | **VERIFIED** (double-entry, period close, FX, depreciation) | PARTIAL (JSON) | PARTIAL (shared `operations:*`) | VERIFIED | PARTIAL | Generic · GUI pending | PARTIAL | **Yes** |
| HR | PARTIAL | **VERIFIED** (statutory payroll, proration, accrual) | PARTIAL | PARTIAL | VERIFIED | PARTIAL | Generic · GUI pending | PARTIAL | **Yes** |
| Manufacturing | PARTIAL | PARTIAL–VERIFIED (MES execution, backflush) | PARTIAL | VERIFIED (`manufacturing:*`) | VERIFIED | VERIFIED (shop floor) | Generic + 1 panel | PARTIAL | **No** |
| Inventory | PARTIAL | PARTIAL–VERIFIED (single-writer ledger) | PARTIAL | VERIFIED | VERIFIED | PARTIAL | Generic | PARTIAL | **No** |
| Warehouse | PARTIAL | PARTIAL | PARTIAL | VERIFIED | VERIFIED | PARTIAL | Generic | **PARTIAL (thin: ~13 cases / 8 modules)** | **No** |
| Sales | **PARTIAL (single-line order)** | PARTIAL (discount policy, guarded conversion) | PARTIAL | VERIFIED (`sales:*`) | VERIFIED | PARTIAL | Generic | PARTIAL | Invoice only; **no COGS** |
| CRM | PARTIAL | **PARTIAL (largely CRUD + derived fields)** | PARTIAL | VERIFIED (`crm:*`) | VERIFIED | PARTIAL | Generic | PARTIAL | No |
| Procurement | PARTIAL | PARTIAL (2 gates; **no three-way match**) | PARTIAL | VERIFIED | VERIFIED | PARTIAL | Generic | PARTIAL | **No** (no GRNI) |
| Projects | PARTIAL | PARTIAL (one strong billing seam) | PARTIAL | PARTIAL | VERIFIED | PARTIAL | Generic | **PARTIAL (~7 cases)** | Via invoice |
| Service/Helpdesk | **NOT IMPLEMENTED beyond tickets** | **PARTIAL (SLA lookup only)** | PARTIAL | PARTIAL | VERIFIED | **NOT IMPLEMENTED** | Generic | **PARTIAL (~4 cases)** | No |

## The four structural ceilings

These bound the whole suite regardless of module count, and Phase 6 does **not** close them:

1. **No line-item documents.** Field values are flat scalars; a sales order is one product and one quantity.
2. **JSON-file persistence** — no transactions, referential integrity or joins.
3. **No multi-level approval or segregation of duties** in the ERP modules (the data plane adds a real approval gate for *imports* only).
4. **Accounting integration stops at Finance and HR** — inventory, production and procurement never post to the ledger, so the GL cannot yield a correct balance sheet or gross margin for a stock-holding company.

## Aggregate

Release gate after Phase 6: **5,766 tests / 633 files green** (up from 5,703 / 631 — 63 added, zero regressions). Documentation: governed set validates clean. Nothing here is claimed GA.

## Related
[Enterprise Data Plane](../developer/ENTERPRISE-DATA-PLANE.md) · [Product Maturity Matrix](PRODUCT-MATURITY-MATRIX.md) · [Release Blockers](RELEASE-BLOCKERS.md) · `claude/PHASE-6-CLOSEOUT.md`
