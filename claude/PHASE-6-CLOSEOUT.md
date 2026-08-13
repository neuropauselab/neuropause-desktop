# NeuroPause — Phase 6 Closeout: Universal Enterprise Data Intelligence

**Program:** Phase 6 · **Date:** 2026-08-08 · **Build:** `1.0.0-rc.15` · **Branch:** `phase6-stage13-enterprise-digital-twin-platform` · **Baseline:** `1cd95e7`

## Executive summary

Phase 6 asked for two things: a **Universal Enterprise Data Plane**, and the **maturing of nine ERP domains**. The first is built, tested and real. The second was, on inspection, largely a *verification* problem rather than a build problem — and where it is genuinely thin, this report says so rather than papering over it.

**What was built:** a zero-dependency ingestion and routing engine that reads real spreadsheets, understands what is in them, scores its own confidence with evidence, validates and de-duplicates, refuses to write high-risk data without explicit human approval, rolls back partial failures, and records complete provenance for every imported value. **63 new tests**, all green.

**What was not built:** the IPC and UI surface that would let a user actually drive it, plus PDF/OCR extraction and external ERP connectors. These are stated as NOT IMPLEMENTED, not disguised.

**Gate:** `typecheck:release` PASS · `lint:release` PASS · `test:release` **5,766 tests / 633 files green** (from 5,703 / 631 — **zero regressions**).

## Architecture (preserved, not changed)

The local-first desktop plane and thin cloud plane are unchanged. No ERP data moved to PostgreSQL. The data plane writes **through** the existing `EnterpriseRecordStore` / `defineEnterpriseModule` framework into existing module ids and existing descriptor field keys — it adds a routing vocabulary, not a second ERP.

## Universal Data Plane — what it does

`apps/desktop/src/main/dataPlane/` (10 source files + 2 test files):

**Supported formats:** XLSX (multi-sheet, shared strings, deflate, date-styled serials), CSV/TSV (RFC-4180), JSON, XML, DOCX, TXT. **PDF and image OCR are NOT implemented** and are reported as `unsupported` with a named reason — never guessed, never a silent empty success. Legacy `.xls` is detected and refused.

**Zero runtime dependencies.** XLSX and DOCX are ZIP containers of XML, so the plane reads them with `node:zlib` alone. This was a deliberate call: the desktop app has never shipped a native module, builds a macOS universal binary, and uses `asar` with a single unpack entry — a parser stack with WASM/worker/native parts would have introduced packaging and ABI risk this repo has never carried.

**Classification** combines a name signal with an independent value signal; a value signal that contradicts the header vetoes the match. Three guards were added *because the smoke test caught the failures*:
- "Invoice Date" over a column of person names does not map at high confidence;
- **"Annual Salary" refuses to map to a monthly salary field** (a 12× payroll error);
- "Payment Terms" (`NET30`) is left unmapped rather than forced into a tax-number field on a weak "looks like a code" signal.

**Governance.** Risk is a property of the canonical entity; `finance` and `hr` are always high-risk, as are customer/supplier/employee masters. Approval is required when the entity is high-risk **or** classification was below high confidence **or** any mapped column was low-confidence. Without an explicit `{approved: true}`, the table is reported `awaiting_approval` and **nothing is written**.

**Transactionality — stated precisely.** JSON stores have no transactions. For high-risk tables a partial failure triggers a **compensating rollback** (every created record soft-deleted, table reported `failed` with `rolledBack: true`, plus a rollback audit entry). This is compensating, **not ACID**, and is documented as such everywhere it appears.

**No false success.** `imported` requires zero failures; otherwise the run is `partial`, `failed` or `nothing_imported`.

**Provenance.** Flat metadata on each record (`importSourceFile`, `importSourceTable`, `importSourceRow`, `importConfidence`, `importedBy`) plus a durable `ProvenanceStore` with per-field `{field, column, original, transformation}` lineage.

## Verification evidence

- Parsed a **genuine openpyxl-produced workbook** (6 sheets): shared strings resolved, date serials converted to ISO via numFmt detection, numbers preserved, header row detected on data sheets and correctly *not* detected on a prose sheet.
- **63 tests**: real ZIP/XLSX/DOCX bytes built in-test (CRC32 + deflate, no binary fixtures), RFC-4180 edge cases, malformed/unsupported input, classification safety guards, validation, dedup, approval gate, rollback, provenance persistence, and a multi-domain E2E journey (approve Projects + Employees, leave Customers unapproved → exactly the approved data lands, the rest does not).
- Two real defects were found by tests and fixed **in the code, not the test**: duplicate column headers caused a genuine header row to be discarded and imported as data; an explicit decline on a high-risk table was misreported as `awaiting_approval` instead of `skipped`.

## ERP domains — verified, not rebuilt

Full recon in `claude/PHASE-6-RECON.md`. The honest finding: **module count is a poor proxy for depth.**

- **Finance (~192 tests) and HR payroll (~83)** contain real, well-tested accounting: double-entry with a balance guard, period-close guard, posted-entry immutability and reversal, realized/unrealized FX, depreciation; effective-dated statutory payroll with attendance proration and a balanced 9-account accrual.
- **Manufacturing and Inventory** have credible operational discipline (single-writer stock ledger, schedule-gated MES execution, BOM backflush).
- **Sales, Procurement, CRM, Projects and especially Service/Helpdesk are predominantly CRUD plus derived-field stamping.** Helpdesk is 324 lines total — one module, an SLA lookup table and two flags.

Rebuilding these was explicitly out of scope per the charter's "verify and improve only where necessary"; inventing depth would have been feature theater.

### Four structural ceilings (NOT closed by Phase 6)

1. **No line-item documents anywhere** — field values are flat scalars; a sales order is one product, one quantity.
2. **JSON-file persistence** — no transactions, referential integrity or joins.
3. **No multi-level approval or segregation of duties** in the ERP modules (the data plane adds a real approval gate for *imports* only).
4. **Accounting integration stops at Finance and HR** — inventory, production and procurement never post to the ledger, so the GL cannot produce a correct balance sheet or gross margin for a stock-holding company. There is no three-way match and no GRNI accrual.

These are the honest gaps. Closing (1) and (2) is a data-model and storage-engine programme in its own right and should be scoped as one.

## Known limitations

- **No IPC/UI surface for the data plane** — the engine is complete and tested but not reachable from the renderer. This was a deliberate risk call: `runtimeCore.ts:2784` throws at BOOT for any unclassified channel, and that check does **not** run in `test:release`, so a wiring mistake would ship a non-booting app past a green gate. It could not be verified without launching Electron, which this environment cannot do.
- PDF text extraction and image OCR: not implemented / external dependency.
- Smart mapping memory, Import Center UI, and external ERP connectors (Odoo/Zoho/Tally/SAP/Salesforce): not implemented. The adapter seam exists; **no connector is claimed**.
- Cross-domain relationship reconstruction on import (linking an imported invoice to an imported customer) is not implemented.
- Imports write to stores directly and do not fire module `onChange` lifecycle hooks, so downstream automation does not react to imports.

## Security

Uploaded bytes are treated as untrusted: every ZIP offset is bounds-checked; entry-count, per-entry and whole-archive inflated budgets are enforced (zip-bomb protection); ZIP64, encrypted archives and unknown compression methods are refused by name; the XML scanner resolves no DTDs or external entities (no XXE surface); row ceilings bound memory. Nothing uploaded is executed, and spreadsheet formulas are read as values, never evaluated. No secrets are logged; error messages carry truncated values, never whole records.

## Next phase — recommended scope

1. **Wire the data plane** (channels → contracts → responses → `runtimeAuthz` → `runtimeCore` → renderer namespace → Data Command Center UI), verified by launching the app on macOS.
2. **Close ceiling (1): line-item documents** — the single highest-leverage change for ERP credibility.
3. **Complete the accounting integration** — inventory/COGS, GRNI accrual, three-way match, WIP/variance.
4. Then: mapping memory, Import Center, connectors.

## Final status

**PHASE 6 — CORE CONTRACT COMPLETE. UI SURFACE AND SEVERAL CHARTER ITEMS EXPLICITLY NOT IMPLEMENTED.**

The Universal Enterprise Data Plane is real, tested and honest about its edges. The ERP maturity claim in the charter is answered with evidence rather than assertion — including where that evidence is unflattering. Per the charter's own rule, the core contract was completed and the remaining limitations documented rather than filled with fake functionality.

**Phase 7 has not been started.**
