# NeuroPause — Phase 6 UI Execution Closeout

**Date:** 2026-08-08 · **Build:** `1.0.0-rc.15` · **Branch:** `phase6-stage13-enterprise-digital-twin-platform`

**Gate at closeout:** `typecheck:release` PASS · `lint:release` PASS (0 warnings) · `test:release` **6,456 / 6,456 across 690 files, 0 failures** (shared 23, companion-protocol 44, backend 418, desktop 5,971). Renderer bundle builds; the Data Command Center emits its own lazy chunk.

**Status: PHASE 6 UI ENGINEERING COMPLETE — DEVICE VISUAL VERIFICATION PENDING.**
Every surface below is implemented, wired to a real backend capability, and covered by tests. Nobody has yet *looked* at it running on macOS. That is the only outstanding class of verification, and it is stated as such rather than folded into "done".

## What was built

### Data Command Center (`apps/desktop/src/renderer/src/dataCommandCenter/`)

A section in the sidebar (Business group, id `data-center`) with eight tabs, all over the existing `dp:*` channels.

| Tab | Backed by | What it does |
|---|---|---|
| Overview | `dp:history` | Real aggregate totals across every import run; a fresh install shows an invitation, not a dashboard of zeroes |
| Import | `dp:inspect` → `dp:analyze` → `dp:import` | The full lifecycle: choose/drop → identify → classify → review the column mapping → approve per group → import → results |
| Export | `dp:exportable`, `dp:export` | CSV / XLSX / JSON, written through the native save dialog |
| History | `dp:history` | Every run, including the failed ones, with per-group results and per-row errors |
| Data Quality | `dp:history` | Issues aggregated from what actually happened; silent when nothing went wrong |
| Provenance | `dp:provenance` | Record → source file, sheet, row, and the original value of every field |
| Mappings | `dp:mappings`, `dp:mapping.forget` | The tenant's remembered column mappings |
| Coverage | `dp:ontology` | The entities the engine can recognise, the formats it reads, and the formats it deliberately does not |

**No UI theater.** There is no chart without data behind it, no percentage progress bar (the engine reports a named *stage*; a percentage would have to be invented), no fabricated activity, and no "connected" indicator for anything that is not connected. Formats the build cannot read (PDF, OCR, legacy `.xls`) are stated with their reason on the Coverage tab and again at the moment a user picks such a file.

**One design system.** Every element composes the existing `components/ui` primitives (`Page`, `Card`, `Button`, `Icon`, `EmptyState`, `Loading`, `pillTabs`). `primitives.tsx` maps the view-model's tone vocabulary onto the app's existing Badge tones — it introduces no new visual language.

**Logic lives in the view-model.** The renderer test environment is Node-only, so `dataCommandCenterModel.ts` holds every decision that could mislead a user and `dataCommandCenterModel.test.ts` asserts them (58 tests): empty-vs-zero, "Matched" vs "Needs review", hold reasons in plain language, the rule that a run with failures can never render as success, and the approval gate.

### The approval gate

A group that requires approval starts **unchecked**; a blocked group cannot be checked at all; an omitted group is sent as an explicit `approved: false` rather than being left out. Approving anything high-risk (money, payroll, master data) requires a written reason, which is recorded on the audit entry next to the approver's name. `importReadiness` states *why* the button is disabled rather than leaving the user to guess.

### Export

`exporters.ts` + `zipWriter.ts` — zero new dependencies, using `node:zlib` for deflate.

The `.xlsx` writer emits a **fully conformant OOXML package**: `_rels/.rels`, `Override` content types for every non-default part, and a styles part that declares fonts, fills and borders. The earlier test-fixture workbook omitted all of that; our own parser read it, but Excel would have shown a repair prompt, which a user reads as data corruption.

The load-bearing test is a **round trip**: every format is read back by the product's own `parseFile` and must yield the same values and types. An export this product could not re-import fails the gate rather than reaching a customer.

Export is gated **twice** — `data:read` for the surface, plus the destination module's *own* read permission inside the handler — so bulk extraction cannot be a way around the per-module gate the on-screen view enforces. A test narrows the granted set to prove the second gate is load-bearing. A dismissed save dialog is reported as `cancelled`, never as a zero-record success, and is not audited as an extraction.

### Import lifecycle replay (closes a real defect)

Previously the Data Plane importer wrote straight to the record store. The records existed and **nothing else in the system knew**: no per-record audit entry, no renderer broadcast (so open views stayed stale), and no module `onChange` reconciler ever ran.

`notifyImportedRecords` in `moduleRegistry.ts` replays imported records through the same fan-out a hand-created record takes — audit, platform timeline, renderer broadcast, and the module's own hook — wired through `enterprise.notifyImported` and `runtimeCore`'s `onImported`. It is deliberately **sequential** (a reconciler may write to another module; hundreds running concurrently would race those writes) and deliberately **non-throwing** (the records are already persisted, so a failing hook is reported, not allowed to unwind a committed import). `EnterpriseModuleActionContext` gained an optional `correlationId` so a reconciler can tell import-driven change from a person clicking Save.

Extracting `createLifecycleEmitter` also removed the duplicate definition of the fan-out: there is now exactly one.

### Plan signature

`PlannedTable` / `DataPlanePlannedTable` now carry `signature`, the mapping-memory key for a table's shape. The renderer sends it back verbatim when a reviewer chooses "Remember this mapping", so the renderer never re-derives the hash and the two can never disagree.

## What is NOT done

Stated plainly rather than left to be discovered.

| Item | Status |
|---|---|
| **Device visual verification** | **PENDING.** The app has not been launched since this work. No screenshot, no click-through. |
| Cross-domain relationship reconstruction | **NOT STARTED.** Resolving an imported "Customer Name" column to an existing customer record (and reporting ambiguous/unresolved matches for review) is designed but unbuilt. |
| Medical Device Manufacturing Pack | **NOT STARTED.** |
| Relife Ortho tenant configuration + pilot dataset | **NOT STARTED.** Nothing here justifies calling the Relife pilot ready. |
| PDF / OCR ingestion | **REFUSED BY DESIGN** in this build, with the reason shown to the user. |
| Connectors | **NOT CONFIGURED** — unchanged by this phase. |
| RB-13 (`knowledgeBench` absolute-ms perf budget) | Still environment-sensitive; passed in all three gate runs of this session. |

## Operator verification steps (macOS)

1. `npm run dev` → the sidebar shows **Data** under Business.
2. Overview on a fresh profile shows the invitation state, not a grid of zeroes.
3. Import a small `.csv` or `.xlsx`: the stage bar advances through named stages, the mapping table shows confidence and the engine's reason per column, and nothing is written until Import is pressed.
4. Import a file containing a payroll or invoice sheet: that group starts unchecked and the button stays disabled until a reason is written.
5. Export → pick Excel → the native save dialog appears; **open the result in Excel and confirm no repair prompt**.
6. Provenance → click one of the record ids listed from your import → the source file, sheet and row appear.
7. After an import, confirm an open Business module view refreshes (the lifecycle replay).
