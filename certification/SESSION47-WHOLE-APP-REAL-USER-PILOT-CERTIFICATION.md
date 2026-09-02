# SESSION 47 — WHOLE-APP REAL-USER PILOT CERTIFICATION

**Baseline:** `a89ae24` (S46) · branch `cert/data-import-cst-integration` · frozen surfaces UNTOUCHED
(gate-detector PROCEED on every changed file) · external effects 0 · armed `out/` not rebuilt by this
session (observation: its hash differs from the S45 record — changed between sessions, not here).

## 1 · The headline evidence — the "hands off the laptop" dry run

`e2e/o2cUiJourney.e2e.cjs` — a click-only Playwright journey against the real Electron runtime
(alternate build, fresh throwaway profile, **no `window.neuropause.invoke`, no seeding, no source
access**), simulating a brand-new operator:

```
launch → Try Free Locally → keep on device → workspace type: Explore Business → skip discovery
→ Business → CRM → New Customer ("Pilot Coffee Co.") → Sales → New Sales Order (SO-PILOT-1, 750)
→ open row → Ship → Generate Invoice → Finance → open INV-SO-PILOT-1 → Issue
→ New Payment (PAY-PILOT-1, cleared, 750) → invoice shows PAID
```

**9/9 PASS · zero developer intervention · every write behind those buttons is the governed command
spine** (separately proven at the IPC layer by `o2cRuntime.e2e.cjs`, 30/30, re-run green this session
on S46+S47 code).

## 2 · What S47 changed (minimal, pilot-usability only)

1. **Modal footer `flex-wrap`** (`components/ui/Modal.tsx`) — found by the journey harness: at a real
   window size the Sales Order detail's action row overflowed and **Ship — the primary next action —
   was invisible**. One class; every action now wraps into view.
2. **Issued-invoice edit fence** (`EnterpriseModuleScreen.tsx` + 2 ui pins) — the §18 fence gains its
   first in-app representation: editing an issued-family invoice shows *"This invoice is issued.
   Changing its amounts books general-ledger adjustment entries."* Visibility of DEFINED behavior;
   blocks nothing; invents no policy.
3. `e2e/o2cUiJourney.e2e.cjs` — the new permanent dry-run harness.

## 3 · Whole-app certification matrix

(Audited by a six-lens fleet + synthesis at HEAD, each claim file:line-cited in the audit record;
statuses re-verified where lenses disputed.)

| Area | UI | Backend | Governance | Security | Runtime | UX | Status |
|---|---|---|---|---|---|---|---|
| Auth / Onboarding (local-first) | ✓ | ✓ | ✓ | ✓ | journey-proven | ✓ | **GREEN** |
| Navigation / IA (58 sections, no dead route) | ✓ | ✓ | — | ✓ | journey-proven | ✓ | **GREEN** |
| Dashboard / Mission Control | ✓ | ✓ | — | ✓ | census-carried | ✓ | **GREEN** |
| CRM / Customers | ✓ | ✓ | CRUD-OK master data | ✓ | journey-proven | ✓ | **GREEN** |
| Quotes (incl. governed conversion) | ✓ | ✓ | ✓ | ✓ | runtime-proven | ✓ | **GREEN** |
| Sales Orders (full lifecycle) | ✓ | ✓ | ✓ | ✓ | journey+runtime | ✓ | **GREEN** |
| Shipments (order-level Ship; canonical order routing S46) | ✓ | ✓ | ✓ | ✓ | runtime-proven | ✓ | **GREEN**; shipment DOCUMENTS = YELLOW (memo) |
| Invoices (generate/issue; edit fenced) | ✓ | ✓ | ✓ | ✓ | journey+runtime | ✓ | **GREEN**; economic edits/DELETE = **PILOT-GREEN** (fence now in-app) |
| Payments / AR (cleared governed; clearing-edit refused S46) | ✓ | ✓ | ✓ | ✓ | journey+runtime | ✓ | **GREEN**; pending/void = YELLOW (no GL) |
| Procurement (P2P commands exist; UI on legacy doors) | ✓ | ✓ | partial | ✓ | S22 harness | ✓ | **YELLOW** — same S43-era gap on the other chain; POST-PILOT |
| Inventory | ✓ | ✓ | module-guarded | ✓ | — | ✓ | **YELLOW** (legacy doors, defined) |
| Warehouse | ✓ | ✓ | S46 canonical routing | ✓ | — | ✓ | **PILOT-GREEN** (documents memo) |
| Finance / GL | ✓ | ✓ | derived-only O2C | ✓ | runtime-proven | ✓ | **GREEN** |
| Approvals / Holds (Hold Center) | ✓ | ✓ | ✓ | ✓ | S44-carried | ✓ | **GREEN** |
| AI (assistant, summaries, proposals) | ✓ | ✓ | proposal-only | ✓ | — | ✓ | **ADVISORY-ONLY / PILOT-FENCED** (no mutation path found) |
| Integrations / Connectors | ✓ | ✓ | ✓ | ✓ | — | ✓ | **PILOT-GREEN** (cloud features gated honestly in local mode) |
| Import / Export (Data Command Center) | ✓ | ✓ | staged + approved | ✓ | — | ✓ | **PILOT-GREEN** — economic-row import = runbook fence (CST lane program) |
| Settings / Administration | ✓ | ✓ | ✓ | ✓ | — | ✓ | **GREEN** |
| Users / Roles / Permissions | ✓ | ✓ | RBAC real | ✓ | — | ✓ | **GREEN** (local-first single-operator pilot) |
| Audit / Governance surfaces | ✓ | ✓ | one sink | ✓ | — | ✓ | **GREEN** |
| Operations / Health / Outbox drill-down | ✓ | ✓ | ✓ | ✓ | — | ✓ | **GREEN** |
| Backup / Recovery | ✓ | ✓ | — | ✓ | S37/S41-carried | ✓ | **GREEN** (full DR drill = external item, carried) |
| Help / error states | ✓ | — | — | — | — | ✓ | **GREEN** (refusals = fixed English sentences, never bare codes) |

## 4 · Security / separation (Phase 5)

Authentication ≠ authorization ≠ policy ≠ approval ≠ execution — distinct code, fail-closed seams,
209 focused permission/security tests across 13 suites green at HEAD. Forged tenant → 
`TENANT_SCOPE_VIOLATION` (runtime-proven); forged origin on governed keys → refused (`.strict()`
schema, S46, source-verified); renderer supplies no identity; preload surface clean.

## 5 · AI (Phase 6)

Advisory-only everywhere reachable: summaries/drafts/proposals; the L6 execution gate remains the
sole (proposal → human confirm) route; **no AI path writes ERP state** (fleet sweep, search spaces
stated). Classification: **AI EXECUTION = ADVISORY ONLY / PILOT-FENCED.**

## 6 · Failure UX (Phase 7)

Refusals surface as sentences; duplicate submits busy-guarded + replay-safe; crash-orphaned commands
become durable HOLDs in a nav-primary Hold Center with plain-language resolution; no silent failure
or fake success found on the pilot path.

## 7 · The RED list

**In-app RED: NONE** (six lenses + synthesis, re-verified).
**RED-1 (delivery precondition, out-of-app):** no packaged artifact a real user could receive
contains S43–S47 — `dist/` newest is `1.0.0-rc.20` from `efe8196` (15 Aug). Packaging is
operator-gated (armed-build + dist-overwrite envelope, B.12/B.13). **A pilot cannot ship until one
controlled packaging run executes**; the runtime evidence here is from the alternate build.

## 8 · Pilot fences (conditions of GO)

1. No Data Command Center import of economic rows (payments/invoices) — CST-lane program.
2. Issued-invoice economic edits / deletes: **now visibly fenced in-app**; policy memo remains OPEN.
3. Shipment DOCUMENTS (warehouse ship/deliver docs) out of pilot scope — memo OPEN.
4. Reversals (invoice cancel / credit notes): treat as out of scope until the reversal memo decides.
5. Procurement runs on defined-legacy doors — pilot is O2C-first.

## 9 · Policy decisions required (unchanged set, nothing invented)

Sales-order approval · reversal/credit-note semantics · shipment-document governance ·
`ClearCustomerPayment` · importer economic-row governance.

## 10 · Post-pilot roadmap (found missing, NOT pilot-required)

Wire procurement UI to its existing governed commands (S43-pattern) · reference pickers replacing
free-text refs (order customer/product, payment invoiceRef) · retire the raw `Lines (JSON)` textarea
in favor of the DocumentPanel line editor · unify local-mode actor attribution across doors ·
`ClearCustomerPayment` + reversal commands once policy decides · Windows validation · full DR drill ·
packaged-app refresh cadence.

## 11 · Test / runtime evidence (exact, final state)

```
Full main suite   964 files · 10,103 passed · 7 skipped · exit 0   (S46 baseline preserved exactly)
UI suite          77 files · 431 passed  (+2 S47 fence pins)
Runtime (IPC)     o2cRuntime.e2e.cjs 30/30 — re-run green on S46+S47 code
Runtime (UI)      o2cUiJourney.e2e.cjs 9/9 — click-only, fresh profile, TIME TO FIRST
                  SUCCESSFUL TRANSACTION ≈ 13 s of automation (≈ 3–5 min human-paced)
Typecheck         node + web clean · ESLint clean · builds exit 0 (alternate outDir only)
```

## 12 · Final decision (Phase 14 — answered independently)

1. First controlled real user tonight? **YES from source/runtime — pending the packaging run (RED-1).**
2. Primary workflow without developer intervention? **YES — proven by clicks.**
3. Pilot-critical governance bypass? **NONE known.**
4. Tenant isolation proven? **YES (live).** 5. Authorization proven? **YES.**
6. Idempotency proven? **YES (live replay).** 7. Durability proven? **YES (journal on disk; S37–S41).**
8. Financial integrity proven? **YES for O2C (AR/GL derived-only; settlement live).**
9. Error/recovery UX usable? **YES.** 10. Policies fenced? **YES — visibly, where cheap; runbook otherwise.**
11. AI safely governed? **YES — advisory-only.** 12. Operationally usable? **YES (health/outbox/holds).**
13. Windows still a gap? **YES — external.** 14. Unrestricted release justified? **NO — HOLD.**

**FIRST CONTROLLED REAL USER: GO** (upon the operator's packaging run)
**WHOLE-APP PILOT: CONDITIONAL GO** (fences §8; packaging RED-1)
**UNRESTRICTED CUSTOMER RELEASE: HOLD** (policy set §9; Windows; DR drill; procurement governance)
