# NeuroPause — Enterprise Data Plane (Developer Guide)

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: developers
>
> The Universal Enterprise Data Plane: how a file becomes governed enterprise records. **Status: engine implemented and tested (63 tests); no IPC/UI surface yet** — see Limitations.

## What it is

A main-process subsystem (`apps/desktop/src/main/dataPlane/`) that ingests a file, understands it, routes it to the correct business domain, and — only with the required human approval — writes it into the **existing** enterprise module stores with full provenance.

It adds a routing vocabulary over the ERP. It does **not** fork the data model: every destination is an existing module id and existing descriptor field keys.

## Pipeline

```
file bytes
  → detectFormat        magic bytes beat the extension
  → parseFile           XLSX · CSV/TSV · JSON · XML · DOCX · TXT
  → classifyTable       sheet → canonical entity, column → canonical field
  → prepareRows         normalize + validate + duplicate detect
  → analyzeSource       → ImportPlan (nothing written)
  → [human approval]
  → applyImportPlan     → EnterpriseRecordStore + provenance + audit
```

## Zero dependencies, deliberately

The desktop app has never shipped a native module and builds a macOS universal binary; `externalizeDepsPlugin` only externalizes `dependencies`. Adding a parser stack (pdfjs worker, tesseract wasm, sharp) would mean `asarUnpack` entries and ABI rebuilds.

So the plane uses **only `node:zlib`**. XLSX and DOCX are ZIP containers of XML, so `zipReader.ts` (central-directory scan + `inflateRawSync`) and `xmlScanner.ts` (forward scanner over non-nesting OOXML elements) are enough to read real workbooks — shared strings, deflate, and date-styled serials included.

## Modules

| File | Responsibility |
|---|---|
| `zipReader.ts` | ZIP central directory + deflate. Rejects ZIP64/encrypted/unknown methods by name. Entry, per-entry and whole-archive size caps (zip-bomb protection) |
| `xmlScanner.ts` | Entity decoding, attribute parsing, element iteration. No DTD/external entities — no XXE surface |
| `parsers.ts` | Format detection + XLSX/CSV/TSV/JSON/XML/DOCX/TXT → `ParsedTable[]`, header detection, Excel serial→ISO |
| `ontology.ts` | Canonical entities → real module ids + field keys, with synonyms, value-shape hints, conflicts, identity keys, risk |
| `normalize.ts` | Money/date/phone/text normalization, every transformation recorded; company-name canonicalization |
| `classifier.ts` | Multi-signal scoring → entity + column mappings with confidence and evidence |
| `quality.ts` | Row validation, quality report, exact + fuzzy duplicate detection |
| `planner.ts` | `analyzeSource()` → `ImportPlan`. Read-only |
| `importer.ts` | `applyImportPlan()` + `ProvenanceStore`. The only writer |
| `testFixtures.ts` | TEST-ONLY: builds genuine ZIP/XLSX/DOCX bytes (CRC32 + deflate) so tests need no binary fixtures |

## Classification: never on the header alone

Every column score combines a **name signal** with an independent **value signal**, and a value signal that contradicts the header actively vetoes the match. Three guards matter:

- **Contradiction veto** — header "Invoice Date" over columns of names scores negative and is capped; it will not map at high confidence.
- **Conflict words** — `CanonicalField.conflicts`. "Annual Salary" will not map to `monthlySalary`; that would be a 12× payroll error.
- **Weak shapes earn nothing alone** — only `email` and `url` are self-evident enough to map with no name signal. "Looks like a code" describes SKUs, country codes and `NET30` alike.

Bands: **high** ≥ 0.85, **medium** ≥ 0.60, **low** below. Every mapping carries `reasons[]` — the evidence a reviewer audits.

## Governance

- **Risk** is a property of the canonical entity. `finance` and `hr` are always high-risk, as are customer/supplier/employee masters.
- `requiresApproval` is true when the entity is high-risk **or** the table classified below high confidence **or** any mapped column is low-confidence.
- `applyImportPlan` refuses to write an approval-required table without an explicit `{approved: true}` decision — it reports `awaiting_approval` and touches nothing.
- **High-risk is all-or-nothing.** JSON stores have no transactions, so a partial failure on a high-risk table triggers a **compensating rollback**: every record created in that table is soft-deleted, the table reports `failed` with `rolledBack: true`, and a `dataplane.import.rollback` audit entry is written. This is compensating, not ACID — stated plainly because the difference matters.
- Status can never overstate: `imported` requires zero failures; anything else is `partial`, `failed` or `nothing_imported`.

## Provenance

Every created record gets flat provenance in `metadata` (`importPlanId`, `importSourceFile`, `importSourceTable`, `importSourceRow`, `importConfidence`, `importedBy`) plus a full `ProvenanceRecord` in the durable `ProvenanceStore`, including per-field `{field, column, original, transformation}` — so a value traces back as:

```
Finance.Invoice.total ← company.xlsx ← Invoices ← row 1847 ← "Invoice Amount"
                      ← "₹25,000" → 25000 INR ← approved by cfo@np.example
```

## Extending the ontology

Adding an entity is a data-only change to `ONTOLOGY` in `ontology.ts`: point `moduleId` at an existing module, list `fields` using that module's real descriptor keys, add `synonyms`, `identityKeys` and a `risk`. No engine change.

## Limitations (honest)

- **No IPC or UI surface yet.** The engine is complete and tested but not reachable from the renderer. Wiring it means adding channels to `packages/shared/src/ipc/{channels,contracts,responses}.ts`, classifying them in `runtimeAuthz.ts`, pushing handlers in `runtimeCore.ts`, and adding a renderer namespace — a boot-critical path (`runtimeCore.ts:2784` throws on any unclassified channel) that cannot be verified without launching Electron.
- **PDF and OCR are not implemented.** Both are reported as `unsupported` with a named reason; nothing is guessed.
- **Legacy `.xls`** (OLE compound) is detected and refused, not parsed.
- **Duplicates are reported, never auto-merged.** Merging master records is destructive in a JSON store.
- **Cross-domain relationship *reconstruction*** (linking an imported invoice to an imported customer record) is not implemented — invoices import with the customer as text, matching the existing module's own model.
- The plane writes to module stores directly; it does not fire module `onChange` lifecycle hooks, so downstream automation does not currently react to imports.

## Tests

63 tests across `parsers.test.ts` (28) and `dataPlane.test.ts` (35), covering real XLSX/DOCX/ZIP bytes, RFC-4180 edge cases, malformed and unsupported input, classification safety guards, validation and dedup, approval gating, rollback, provenance persistence, and a full multi-domain E2E journey.

## Related
[Universal Data Import (user)](../user/UNIVERSAL-DATA-IMPORT.md) · [Developer Guide](DEVELOPER-GUIDE.md) · [Phase 6 Maturity Matrix](../product/PHASE-6-MATURITY-MATRIX.md)
