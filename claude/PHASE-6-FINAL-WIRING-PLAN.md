# NeuroPause — Phase 6 Final Wiring Plan & Gap Register

**Date:** 2026-08-08 · **Build:** `1.0.0-rc.15` · **Baseline:** `1cd95e7`
**Purpose:** classify every remaining Phase 6 item honestly, so what is done, what is left, and what it costs are all visible.

Status vocabulary: **ALREADY COMPLETE** · **DONE THIS PASS** · **NEEDS IMPLEMENTATION** · **EXTERNAL DEPENDENCY** · **OUT OF SCOPE (this pass)**.

## A. Data Plane engine — already complete, preserved

The engine shipped in the previous pass and was **not rewritten**. Parsing (XLSX/CSV/TSV/JSON/XML/DOCX/TXT), header detection, classification with evidence, confidence bands, normalization, validation, dedup, planning, approval gating, compensating rollback and provenance are all **ALREADY COMPLETE** (63 tests). This pass added wiring around it, changing one behaviour only: an explicit decline is now reported as declined rather than pending.

## B. P0 — IPC + runtime wiring

| Item | Status | Evidence |
|---|---|---|
| `data:read` / `data:import` / `data:approve` permissions | **DONE THIS PASS** | `packages/shared/src/types/enterprise.ts` union + `ALL_ENTERPRISE_PERMISSIONS` |
| 11 `dp:*` channels in the canonical registry | **DONE THIS PASS** | `channels.ts` + `RUNTIME_INVOKABLE_CHANNELS` |
| Typed Zod request contracts (bounded, `.strict()`) | **DONE THIS PASS** | `contracts.ts`, 64 MiB base64 ceiling |
| `IpcResponseMap` entries + wire types | **DONE THIS PASS** | `responses.ts` + `packages/shared/src/types/dataPlane.ts` |
| `runtimeAuthz` classification | **DONE THIS PASS** | `RUNTIME_CHANNEL_PERMISSIONS` — read/write scopes separated |
| Subsystem + handlers | **DONE THIS PASS** | `dataPlane/index.ts`, `initDataPlane()` |
| `runtimeCore` wiring (import, init, `defs.push`) | **DONE THIS PASS** | reuses the enterprise registry, authz gate, governance audit sink |
| Renderer namespace (`ipc.data.*`, explicit methods) | **DONE THIS PASS** | `renderer/src/lib/ipc.ts` |
| Boot-invariant test replicating the startup check | **DONE THIS PASS** | `wiring.test.ts` — the gate now catches unclassified channels |
| **Actual macOS Electron boot verification** | **NEEDS IMPLEMENTATION (operator)** | Cannot be done from a Linux container — see §G |

## C. P3 items completed this pass

| Item | Status | Notes |
|---|---|---|
| Smart mapping memory | **DONE THIS PASS** | Tenant-isolated, versioned, auditable, `useCount`; cross-tenant leakage asserted impossible by test |
| Import lifecycle notification | **DONE THIS PASS** | `onImported` fires one event per destination module with a correlation id. **Partial:** it notifies subscribers; it does not yet re-enter each module's `hooks.onChange` (see §E) |
| Import history / provenance API | **DONE THIS PASS** | `dp:history`, `dp:run`, `dp:provenance` over the durable `ProvenanceStore` |

## D. P1 — Line-item document model — NOT IMPLEMENTED

**This is the highest-value remaining ERP change and it is genuinely large.**

The blocker is structural: `EnterpriseFieldValue = string | number | boolean | null`. Every one of the 104 modules, the descriptor validator, the generic renderer, the sync/LWW `rev` model and the certification test assume flat scalar records. Line items cannot be added by extending a field list.

Two viable designs, neither small:

1. **Child-record store per document type** — lines as their own module records with a `parentId`, totals derived by a pure engine. Preserves the framework; costs a parent/child integrity layer that JSON storage cannot enforce (no FK, no cascade), plus a renderer that can edit a grid.
2. **Structured field type** — widen `EnterpriseFieldValue` to admit an array of line objects. Smaller surface conceptually, but it changes the core type every module, test and store envelope depends on, and invalidates the current on-disk shape.

**Recommendation:** design (1), scoped as its own phase with a migration plan, starting with SalesOrder and PurchaseOrder only. Estimated blast radius: the framework, 2 modules, the renderer grid, the sync model, and the certification lock.

## E. P2 — Accounting integration — NOT IMPLEMENTED

| Gap | Status | Why it is not a quick win |
|---|---|---|
| Inventory → GL (asset/COGS) | **NEEDS IMPLEMENTATION** | Requires a valuation-at-issue decision (FIFO layer vs moving average) and an inventory/COGS account pair in the existing chart. Posting COGS without line-level cost is not defensible |
| GRNI accrual | **NEEDS IMPLEMENTATION** | Needs receipt→invoice matching state, which needs **line items** (D) to be correct at quantity level |
| Three-way match | **NEEDS IMPLEMENTATION** | PO ↔ GR ↔ Bill matching on quantity and price is meaningless against single-line documents. **Blocked on D** |
| WIP / production variance | **NEEDS IMPLEMENTATION** | Needs a WIP account, standard-cost baseline and variance accounts; manufacturing currently computes variance but posts nothing |
| Module `onChange` re-entry for imports | **NEEDS IMPLEMENTATION** | The notification hook exists; routing it through `emitLifecycle` per module needs loop-guarding via the correlation id |

**The honest dependency:** three of these five are blocked on line items. Implementing them against flat documents would produce numbers that look right and are not — the worst possible outcome for an accounting system.

## F. P4–P7 — NOT IMPLEMENTED this pass

| Item | Status | Note |
|---|---|---|
| Multi-level approval engine + SoD in ERP modules | **NEEDS IMPLEMENTATION** | The data plane now has real SoD (`data:import` ≠ `data:approve`) — a working pattern to generalize. ERP modules still use single-actor flips |
| Data Command Center UI | **NEEDS IMPLEMENTATION** | Backend is fully reachable; this is a renderer surface |
| Medical Device Manufacturing Industry Pack | **OUT OF SCOPE (this pass)** | Depends on batch/lot and document control; the existing `inventory-lots` and `documents-registry` modules are the seam |
| Relife Ortho pilot tenant/config/dataset/docs | **OUT OF SCOPE (this pass)** | Deliberately not started — see §H |
| Connectors (Odoo/Zoho/Tally/SAP/Salesforce) | **EXTERNAL DEPENDENCY** | Adapter seam exists; **no connector is claimed**. Status must remain NOT CONFIGURED without a real tested endpoint |
| PDF extraction | **NEEDS IMPLEMENTATION** | See §I |
| Image OCR | **EXTERNAL DEPENDENCY** | See §I |
| Cross-domain relationship reconstruction | **NEEDS IMPLEMENTATION** | Design settled: match on the entity's `identityKeys`; unresolvable references go to NEEDS REVIEW rather than being guessed |

## G. The Electron boot verification gap — read this

The charter makes macOS Electron boot **mandatory** before claiming the wiring complete. **It has not been done, and could not be done here:** this session runs in a Linux container, and the bridge to the developer's Mac executes in an isolated Linux VM with no ability to launch the packaged app.

What was done instead, to remove the specific risk that made the previous pass decline to wire at all: `wiring.test.ts` **replicates the boot-time classification invariant** against the real `RUNTIME_CHANNEL_PERMISSIONS` / `PUBLIC_CHANNELS` registries and the real handler defs. The failure mode "app will not boot because a channel is unclassified" is now caught by `test:release`.

That is strictly weaker than launching the app. Still unverified: preload exposure, window lifecycle, renderer round-trip, and the behaviour of the session/workspace accessors the subsystem is wired to. **The operator must run the app.**

## H. Relife Ortho — deliberately not started

The pilot foundation (industry pack, tenant config, synthetic dataset, four pilot documents) is **not started**, not partially faked. Building a medical-device industry pack on top of an ERP whose inventory does not post to the ledger and whose documents have no line items would produce a demo, not a pilot foundation — and a quality/traceability story resting on that base would be misleading in a regulated industry. The correct order is D → E → then the pack.

## I. PDF / OCR — the packaging constraint

Per the charter's own instruction to inspect packaging first: the desktop app has **never shipped a native module**, targets a macOS **universal** build, and uses `asar` with a single unpack entry. `pdfjs-dist` needs a worker file; `tesseract.js` needs WASM plus language data — both require `asarUnpack` entries and, for universal builds, arch-aware handling. Adding either is a packaging change that must be validated by actually building and launching the app.

**Decision: retain UNSUPPORTED with an explicit reason** until that validation can happen. The plane already reports both honestly and never produces an empty fake extraction.

## Recommended order for the next pass

1. Operator: launch the app, verify boot + the `dp:*` round-trip (§G).
2. Data Command Center UI (backend already reachable).
3. **Line items** (§D) — the unlock for most of §E.
4. Inventory→GL, GRNI, three-way match, WIP (§E), in that order.
5. Generalize the SoD pattern into an ERP approval engine (§F).
6. Only then: medical-device pack → Relife pilot foundation.
