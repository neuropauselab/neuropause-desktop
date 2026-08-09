# NeuroPause — Phase 6 Completion Matrix

**Date:** 2026-08-09 · **Build:** `1.0.0-rc.15` · **Gate:** **6,225 / 6,225 green, 651 files** (desktop; up from 6,148 / 646 at the Medical Device Stage-1 close — zero regressions, none deleted or weakened). Backend 418, cloud-core 44, companion-protocol 23. `typecheck:release` PASS · `lint:release` PASS · `docs:validate` 50/50.

## One Intelligent Workspace — intelligence experience (this pass)

Landed 2026-08-09. Full detail: `claude/NEUROPAUSE-INTELLIGENCE-EXPERIENCE.md`.

**Status reconciliation note:** the Universal Data Plane UI rows earlier in this
file that read **NOT IMPLEMENTED** are **HISTORICAL — SUPERSEDED**: the Data
Command Center UI (Import, Export, Relationships, History, Quality, Provenance,
Mappings, Coverage) shipped in the Phase 6 UI pass and remains VERIFIED against
its renderer model tests. Where any row below disagrees with an earlier row,
the LATER row is authoritative.

| Capability | Status | Tests |
|---|---|---|
| Deterministic-first intelligence seam (arithmetic, clock, invoice totals, lot quantities, stock, approvals) | **VERIFIED COMPLETE** — a hit NEVER invokes the AI engine (the test engine throws on call); RBAC refusals are answers, not fall-throughs | 15 + 6 |
| Honest no-AI state (badge case 5: NO AI MODEL USED, never "local AI") | **VERIFIED COMPLETE** | in 6 |
| Intelligence measurement incl. engineless turns + economics line ("% without an external provider") | **VERIFIED COMPLETE** — measured counters only; explicit empty state | in 6 + 24 |
| Three-layer answer model (Answer / Reason / Evidence) in AI Home | **COMPLETE BUT DEVICE UNVERIFIED** — rendered from the real envelope; "no evidence" stated when absent | renderer model |
| Business attention strip (decisions / tickets / quarantined batches) | **COMPLETE BUT DEVICE UNVERIFIED** — real RBAC-gated queries; failed queries omit tiles; all-zero states it | in 24 |
| Business information architecture (Today/Business/Work/Data/Operations/Intelligence/System) | **COMPLETE BUT DEVICE UNVERIFIED** — render-only regrouping; SECTIONS + nav locks untouched | in 24 |
| Performance HUD removed from normal dev runs (opt-in `VITE_NP_PERF_HUD=1`) | **VERIFIED COMPLETE** (lint/build); measurement pipeline untouched |  |
| Governed actions (recommend → plan → approval → execute → verify → audit) | **PRE-EXISTING (Stage 4/5)** — reused, not rebuilt; regression green |  |
| Cross-domain deterministic variance decomposition ("why did margin change" computed across domains) | **PARTIAL** — catalogued resolver questions answer deterministically; a general variance engine is NOT implemented and not claimed |  |

## Private-First Onboarding + AI Workspace (Product Experience stage)

Landed 2026-08-09. Full detail: `claude/PRIVATE-FIRST-AI-EXPERIENCE.md`.

| Capability | Status | Tests |
|---|---|---|
| First-run experience (welcome → privacy → workspace type) | **COMPLETE BUT DEVICE UNVERIFIED** — full-screen flow, each decision persisted immediately; completion one-way | 10 |
| Private First routing (planner + composite client) | **VERIFIED COMPLETE** — the four charter-critical cases incl. "external disabled → never leaves the device, external client never invoked" | 19 |
| Execution-stamped routing metadata → UI badge + "Why?" | **COMPLETE BUT DEVICE UNVERIFIED** — badge renders ONLY from execution metadata; absence renders nothing | in 19 + 17 |
| AI mode + external consent (Settings → AI, audited writes) | **COMPLETE BUT DEVICE UNVERIFIED** — same candidate assembly serves Settings and requests | in 19 |
| Measured AI usage | **VERIFIED COMPLETE** — counts from execution only; explicit empty state until the first measurement; tamper-corrected totals | in 10 |
| Workspace types (Personal / Professional / Business) | **COMPLETE BUT DEVICE UNVERIFIED** — one product, render-time nav curation; SECTIONS order + every nav lock untouched | in 17 |
| Personal → Professional upgrade | **VERIFIED COMPLETE** — a one-field profile change; nothing to migrate, and no migration promised | in 10 |
| AI Home ("Ask NeuroPause") over the real assistant pipeline | **COMPLETE BUT DEVICE UNVERIFIED** — capability-gated suggestions; no parallel ask path | in 17 |
| Privacy Center | **COMPLETE BUT DEVICE UNVERIFIED** — describes the three routes without exceeding the architecture |  |
| Legacy-install behaviour preservation | **VERIFIED COMPLETE** — null mode resolves to pre-mode behaviour; claude-no-key still reports needs-setup | in updated suites |
| No-unprovable-claims copy | **VERIFIED COMPLETE** — asserted by test: no "no credit card", no "100% local", no "never leaves your device" | in 17 |
| Telemetry | **VERIFIED COMPLETE** — local platform events, names only; no prompts/content/responses recorded anywhere |  |
| macOS visual verification of the flow | **DEVICE VISUAL VERIFICATION PENDING** — bundle builds (AiHomeView 9.4 kB chunk); not launched |  |

**Status vocabulary — exactly one per item, no ambiguity:**
`VERIFIED COMPLETE` · `COMPLETE BUT DEVICE UNVERIFIED` · `PARTIAL` · `EXTERNAL DEPENDENCY` · `NOT IMPLEMENTED`

## Universal Data Plane

| Capability | Status | Tests |
|---|---|---|
| Parsing (XLSX/CSV/TSV/JSON/XML/DOCX/TXT) | **VERIFIED COMPLETE** | 28 |
| Classification, confidence, evidence | **VERIFIED COMPLETE** | in 35 |
| Validation, quality report, dedup | **VERIFIED COMPLETE** | in 35 |
| Approval gating, compensating rollback | **VERIFIED COMPLETE** | in 35 |
| Provenance (store + per-field lineage) | **VERIFIED COMPLETE** | in 35 |
| IPC contracts, authz, runtimeCore, renderer namespace | **VERIFIED COMPLETE** — booted on macOS 2026-08-08; `dp:ontology` round-trip returned 8 entities | 24 |
| Boot-invariant replication in tests | **VERIFIED COMPLETE** | in 24 |
| Segregation of duties on high-risk approval | **VERIFIED COMPLETE** | in 24 |
| Mapping memory (tenant-isolated, versioned) | **VERIFIED COMPLETE** | in 24 |
| Import lifecycle notification | **PARTIAL** — subscribers notified; does not re-enter module `hooks.onChange` | in 24 |
| Data Command Center UI | **NOT IMPLEMENTED** | — |
| Import Center UI | **NOT IMPLEMENTED** (backend API complete) | — |
| Provenance UI | **NOT IMPLEMENTED** (backend API complete) | — |
| Cross-domain relationship reconstruction | **NOT IMPLEMENTED** | — |
| Export (CSV/XLSX/JSON) | **NOT IMPLEMENTED** | — |
| PDF extraction | **NOT IMPLEMENTED** — packaging constraint, reason declared in-product | — |
| Image OCR | **EXTERNAL DEPENDENCY** — no engine bundled | — |
| Connectors (Odoo/Zoho/Tally/SAP/Salesforce) | **EXTERNAL DEPENDENCY** — adapter seam only; **NOT CONFIGURED**, never CONNECTED | — |

## ERP foundation (this pass)

| Capability | Status | Tests |
|---|---|---|
| Line-item document model (8 trade document types) | **VERIFIED COMPLETE** | 48 suite |
| Domain-specific line validation | **VERIFIED COMPLETE** | in 48 |
| Deterministic totals (integer minor units, half-up) | **VERIFIED COMPLETE** | in 48 |
| Line store: all-or-nothing writes, cascade, orphan detection | **VERIFIED COMPLETE** | in 48 |
| Three-way match (PO ↔ GR ↔ Bill) with 5 states | **VERIFIED COMPLETE** | in 48 |
| GRNI accrual + clearing | **VERIFIED COMPLETE** | in 48 |
| Inventory → GL (receipt, adjustment, write-off) | **VERIFIED COMPLETE** | in 48 |
| COGS on dispatch | **VERIFIED COMPLETE** | in 48 |
| WIP + production variance | **VERIFIED COMPLETE** | in 48 |
| Approval engine (single/multi-step/threshold/role/department) | **VERIFIED COMPLETE** | in 48 |
| Segregation of duties (4 configurable rules) | **VERIFIED COMPLETE** | in 48 |
| ERP document adapter (reusable adoption seam) | **VERIFIED COMPLETE** — composes onto existing `onChange`; no-op for unspecced modules; idempotent posting | 25 |
| Document specs for 8 live modules (PO, GR, Bill, Delivery, Production, Quote, SO, Invoice) | **VERIFIED COMPLETE** — written + tested | in 25 |
| **Registering the adapter into the running app** | **COMPLETE BUT DEVICE UNVERIFIED** — all 104 registrations route through `documentIntegration.attach()` in the enterprise composition root; `postJournal` bound to the real `applyGlDerivedEntries`. Verified by integration tests that drive the REAL journal module and assert persisted ledger state. | 9 |
| Stock/production chart accounts ensured before posting | **VERIFIED COMPLETE** — `ensureStockAccounts` (mirrors the existing `ensureFxAccount` pattern); found by integration testing, which caught that the journal was silently rejecting every stock entry | in 9 |
| Inventory / GRNI / COGS / WIP reaching the REAL general ledger | **COMPLETE BUT DEVICE UNVERIFIED** — asserted against persisted journal state; GRNI nets to zero across receipt→matched bill | 9 |
| Sales → Finance posting chain | **PARTIAL** — invoice→GL already existed; COGS derivation now exists; not yet joined at module level | — |
| Manufacturing costing methods | **PARTIAL** — `weighted_average` and `standard` implemented and named; FIFO **NOT IMPLEMENTED** and not claimed | in 48 |

## Governance

| Capability | Status |
|---|---|
| Audit on Data Plane operations | **VERIFIED COMPLETE** |
| Tenant isolation (mapping memory) | **VERIFIED COMPLETE** |
| ERP multi-level approval engine | **VERIFIED COMPLETE** (engine); **NOT IMPLEMENTED** (module adoption) |
| Audit immutability (hash-chained) | **VERIFIED COMPLETE** (pre-existing `AuditChain`) |

## Medical device / Relife

Stage 1 (Product Model + Batch/Lot Traceability) landed 2026-08-09. Full detail:
`claude/MEDICAL-DEVICE-PRODUCT-MODEL.md` and
`claude/MEDICAL-DEVICE-BATCH-LOT-TRACEABILITY.md`.

| Capability | Status | Tests |
|---|---|---|
| Industry-pack architecture (Core → Pack → Tenant) | **COMPLETE BUT DEVICE UNVERIFIED** — manifest + taxonomy contract, registry with boot-time validation, open vs closed taxonomies. Contains no tenant-specific logic, asserted by test. | in 43 |
| Medical-device product model | **COMPLETE BUT DEVICE UNVERIFIED** — 18 fields, 5 taxonomies, per-tenant unique product codes on a normalized key, free-form regulatory metadata, serial-requires-batch rule | 43 + 39 |
| Product persistence / CRUD / audit | **COMPLETE BUT DEVICE UNVERIFIED** — inherited from the Enterprise Module Framework; no new CRUD system | in 39 |
| Product search (code / name / family / category / material) | **VERIFIED COMPLETE** — deliberately NOT the store's substring-over-everything search | in 43 |
| Product UI (list / detail / create / edit / history) | **COMPLETE BUT DEVICE UNVERIFIED** — real renderer views on the existing design system; bundle emits `MedicalDevicesView` (81 kB) | 29 renderer |
| Batch/Lot model + explicit state machine | **COMPLETE BUT DEVICE UNVERIFIED** — 9 states, every transition declared; `recalled` terminal; a recall may land on already-consumed material | in 43 |
| Lot quantity integrity | **VERIFIED COMPLETE** — `remaining` is derived, never stored; one `canDraw` gate for consumption and splitting; six-decimal rounding | in 43 + 39 |
| Lot split (lineage + quantity conservation) | **VERIFIED COMPLETE** — 100 = 60 + 40; rename-as-split refused; a refused split leaves the lot byte-identical | in 43 + 39 |
| Lot merge | **UNSUPPORTED BY DESIGN** — channel exists and always refuses with its reason; refusal audited. Rationale documented. | in 39 |
| Lot UI (6 views + detail + operations + traceability) | **COMPLETE BUT DEVICE UNVERIFIED** | 29 renderer |
| Forward traceability | **COMPLETE BUT DEVICE UNVERIFIED** — lot → MO → FG lot → warehouse → shipment → customer/order, from real records only | in 43 + 39 |
| Backward traceability | **COMPLETE BUT DEVICE UNVERIFIED** — customer/shipment/lot → MO → source lots, recursively | in 43 + 39 |
| Traceability UI | **COMPLETE BUT DEVICE UNVERIFIED** — both directions, grouped results, scope note always shown | 29 renderer |
| Inventory integration | **COMPLETE BUT DEVICE UNVERIFIED** — posts through the EXISTING `postStockMovement` seam; non-fatal; never invents an inventory product | in 39 |
| Manufacturing integration | **COMPLETE BUT DEVICE UNVERIFIED** — input lots → order → output lot recorded as graph edges | in 39 + 6 E2E |
| Relationship engine integration | **VERIFIED COMPLETE** — 4 declarations (product/MO/warehouse/supplier); none allows a similarity proposal | in 14 |
| Data Command Center integration | **VERIFIED COMPLETE** — 2 canonical entities; lots are HIGH risk and never import without explicit approval; no second import system | in 14 |
| Imported-lot normalization | **VERIFIED COMPLETE** — import replay stamps tenant, initialises counters, coerces an uninterpretable status, resolves the product from its code, records context edges; idempotent | in 14 |
| Provenance on traceability edges | **COMPLETE BUT DEVICE UNVERIFIED** — `{planId, provenanceId}` carried through; written once, never overwritten | in 39 |
| Permissions (5 new scopes, existing RBAC) | **VERIFIED COMPLETE** — traceability is a separate read scope so support/quality can ask without any write right | 7 |
| Audit (7 lot actions + product lifecycle) | **VERIFIED COMPLETE** | in 39 + 6 |
| Tenant isolation | **VERIFIED COMPLETE** (mechanism) / **PARTIAL** (only one tenant can exist) | in 39 |
| Failure + security testing | **VERIFIED COMPLETE** — 18 named failure modes, all fail safely with an actionable message | in 39 + 6 |
| Performance (1,000 lots / >11,000 relationships) | **VERIFIED COMPLETE** as a non-quadratic assertion. **No benchmark figure is claimed** — the bounds are deliberately loose and the run is not controlled. | in 39 |
| Synthetic dataset | **VERIFIED COMPLETE** — `examples/medical-device/`, 94 products + 302 lots + 161 shipments, every row prefixed `SYN-`/`SYNTHETIC` | in 14 |
| End-to-end scenario (product → RM lot → MO → consume → FG lot → warehouse → shipment → customer → both traces) | **COMPLETE BUT DEVICE UNVERIFIED** — driven through the REAL channel contracts with unmocked services | 6 |
| Real UI E2E at the DOM level | **NOT IMPLEMENTED** — no DOM testing library exists in this repo. Panel logic is covered by the view-model suite; layout is not covered by anything. |  |
| Quality foundation (NCR/CAPA/inspection) | **NOT IMPLEMENTED** — depends on this foundation; the lot detail says so in words rather than showing an empty panel |  |
| Document control lifecycle | **NOT IMPLEMENTED** — same |  |
| Relife tenant configuration | **NOT IMPLEMENTED** |  |
| Relife synthetic dataset + import templates | **NOT IMPLEMENTED** |  |
| Relife dashboard + executive AI | **NOT IMPLEMENTED** |  |
| Relife pilot documentation | **NOT IMPLEMENTED** |  |

**Why Stage 1 could start (2026-08-09):** the charter's dependency rule — "COMPLETE THE ERP FOUNDATION FIRST" — is satisfied. The ERP engines are adopted by the live modules, the relationship engine is wired, and the Data Command Center exists, so the pack extends real infrastructure rather than standing beside it. Product and Batch/Lot are built; **Quality Center, Document Control and the Relife tenant remain NOT STARTED by design** — they depend on the lot foundation, and starting them before it was verified would be exactly the feature theater the charter forbids.

**No regulatory claim.** The pack records the data a manufacturer keeps. NeuroPause is not validated software and implements no standard; the product model, the sterility field and the UDI field are storage, not compliance. This is stated in the pack manifest, in the product form's help text, and on screen.

## Runtime

| Item | Status |
|---|---|
| macOS Electron boot + round-trip | **VERIFIED COMPLETE** — 2026-08-08 on Apple Silicon. `Data Plane ready { channels: 11, entities: 8 }`, 652 secure handlers, no channel refusal, renderer round-trip returned 8. Results recorded in `claude/MACOS-PHASE-6-OPERATOR-CERTIFICATION.md`. |
| macOS launch since the Medical Device pack | **DEVICE VISUAL VERIFICATION PENDING** — `npm run dev` has not been run since this work. The production bundle builds (`electron-vite build`: 1,197 main-process modules transformed; every renderer chunk emitted, including `MedicalDevicesView` at 81 kB), and the `md:*` channels are covered by contract-level E2E tests, but nobody has looked at the screen. |

## Quality

| Item | Status |
|---|---|
| Unit + integration tests | **VERIFIED COMPLETE** — 6,148 green (desktop), zero regressions, none deleted or weakened |
| Data Plane E2E (multi-domain import journey) | **VERIFIED COMPLETE** |
| Procure-to-pay E2E (receipt → match → bill, GRNI nets to zero) | **VERIFIED COMPLETE** |
| Security (ZIP/XXE/limits/tenant/SoD) | **VERIFIED COMPLETE** |
| Full synthetic enterprise E2E through the UI | **PARTIAL** — the medical-device journey runs end to end through the real channel contracts with unmocked services (`medicalDeviceE2E.test.ts`); no DOM-level UI test exists in this repo. |
| Performance benchmarks at 50k/100k rows | **PARTIAL** — 20k-row parse asserted; larger benchmarks not run |
| Documentation validation | **VERIFIED COMPLETE** — 50/50 |
