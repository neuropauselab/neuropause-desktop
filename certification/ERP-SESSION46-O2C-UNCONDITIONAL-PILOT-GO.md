# ERP SESSION 46 — GOVERNED O2C PILOT CLOSURE + ONBOARDING CERTIFICATION

**Gate:** S46 · **Mode:** DISCOVER → BUILD → ATTACK → OPERATE (closure, not expansion)
**Baseline:** `7d6175d` (S45, GREEN — conditioned GO) · branch `cert/data-import-cst-integration`
**Frozen surfaces:** UNTOUCHED (gate-detector PROCEED ×4; no `packages/shared`, `cst/`, `runtimeCore`, `contracts.ts`). **External effects:** 0. **Armed build:** not rebuilt.

---

## 1 · S45 BASELINE

HEAD `7d6175d`, verified first-hand (`git log`, `git show 7d6175d`). S45 left the pilot-critical O2C lifecycle governed end-to-end with the six writes routed through the command spine, and flagged eleven residual findings — the three MATERIAL ones (warehouse-ship status bypass, legacy action-door, payment clearing shortcut) being the target of S46.

## 2 · S46 CHANGES (4 production files, non-frozen)

- `enterprise/modules/warehouse/shippingModule.ts` — canonical order-status routing.
- `enterprise/framework/moduleRegistry.ts` — the origin boundary (token + governed-action guard).
- `platform/command/commandBus.ts` — the command bus stamps the internal origin token.
- `enterprise/modules/finance/paymentModule.ts` — the payment clearing fence.
Plus 1 new test file + 5 existing test files re-harnessed to carry the authorized internal origin.

## 3 · WAREHOUSE SHIP CLOSURE (Finding 1 — MATERIAL → CLOSED)

The warehouse `ship` action hand-set the linked Sales Order to `fulfilled` via a direct cross-module `store.update`, jumping `pending → fulfilled` — a transition the order status machine FORBIDS (legal chain: pending → shipped → fulfilled), bypassing the S45 edit guard. **Fix:** `advanceLinkedOrderToFulfilled` now drives the change through `orderActionPatch` — the ONE canonical guarded transition table the order module's own lifecycle actions use — walking the legal chain and applying only guarded patches. A `deleted`/`closed`/`cancelled`/already-`fulfilled` order yields NO legal advance and is left untouched. No hand-set order status remains anywhere outside the order module (rescan clean; the shipment module still sets its OWN `shipped` status only). Stock is issued once by the shipment; the order transition is status-only (no double issue). **Class A → CLOSED (technical, no policy).**

## 4 · PAYMENT CLEARING RESULT (Finding 4 — MATERIAL → FENCED)

A "create pending → edit to `cleared`" shortcut booked real Dr Cash / Cr AR through the legacy update door, around the governed `ReceiveCustomerPayment` command. **Fix:** the payment `validate` hook refuses an EDIT-door transition INTO `cleared` from a non-cleared prior (a status-less importer row is not compared; create is untouched; a governed cleared receipt has no prior record on that path). The GL-booking transition now goes only through the governed command. **Class D (policy: should a distinct `ClearCustomerPayment` exist) stays OPEN in the memo; the accidental economic shortcut is mechanically CLOSED.** Classification: **GREEN** for the fence; **POLICY REQUIRED** for the clearing-command question.

## 5 · INVOICE ECONOMIC MUTATION RESULT (Finding 2/3 — DEFINED-LEGACY, PILOT-FENCED)

Editing an ISSUED invoice's economic fields (amount/taxRate/exchangeRate) books GL ADJUSTMENT entries, and DELETE posts GL reversals — both DELIBERATE `glPosting` behaviors (drift-correction / voiding). These are NOT accidental shortcuts; they are defined accounting behavior whose governance is the reversal-policy decision. S46 did NOT mechanically block them (blocking defined accounting behavior requires the policy). **Class C/D → YELLOW + pilot fence + memo (OPEN).** The invoice STATUS boundary (draft↔issued family) was already fenced in S45.

## 6 · LEGACY ACTION ORIGIN RESULT (Finding 6 — MATERIAL → CLOSED)

The legacy `enterprise:module.action` door accepted the now-governed verbs (ship / convertToInvoice / issue / convertToOrder) from any authorized caller. **Fix:** a SERVER-SIDE origin boundary. `INTERNAL_ACTION_ORIGIN` is a per-process, module-private, unguessable token (not in `@neuropause/shared`); the command bus passes it by calling the handler directly; the renderer/agent/REST path is `ModuleActionRequest.parse()` at the bridge and that schema is `.strict()`, so an `origin` field is REJECTED — the marker cannot be forged across the IPC boundary. The handler refuses a governed key without the token. Proven: an external `convertToOrder` mints no order; the internal origin and the governed command both work; a non-governed action is unaffected; the strict schema rejects a forged `origin`. **No renderer-trusted flag; RBAC unchanged; no second command system. Class A → CLOSED.**

## 7 · IMPORTER RESULT (Finding 5 — SEPARATE INGESTION SURFACE, FENCED)

The importer reviewer-update path bypasses `hooks.validate` by design (bulk ingestion). It is a SEPARATE controlled ingestion surface, not the pilot happy path. S46 did not rewrite it (the prompt forbids broad importer rewrites). **Class C → documented; pilot fence: no import of economic (payment/invoice) rows.**

## 8 · ZERO-BYPASS AUDIT (Phase 7)

Repo-wide rescan after the fixes: no hand-set O2C order/invoice/payment economic-status write remains outside its owning module + governed command. The six pilot-critical O2C writes (create SO, convert quote, ship, generate/issue invoice, cleared receipt) all flow UI → preload → `platform:command.dispatch` → Application Boundary → command bus → per-command RBAC → durable journal/idempotency → event → outbox → audit. **Remaining non-happy-path writes** (invoice economic edit/delete GL, importer, credit/debit-note issue, the legacy door now origin-guarded) are enumerated in the matrix; each is defined-legacy or policy-fenced, none on the pilot happy path. **No pilot-critical bypass remains.**

## 9 · SECURITY

Origin established server-side (unforgeable token; strict schema blocks renderer forgery); RBAC unchanged (per-command `ctx.authorize` inside the idempotency boundary); the origin guard is an ADDITIONAL gate, not a replacement. AI advisory-only, no execution path (unchanged). Renderer cannot supply tenant/actor (server-resolved) or the internal origin.

## 10 · TENANT ISOLATION

Unchanged and intact — every store is tenant-scoped, the command bus derives tenant from the principal and rejects a cross-tenant claim (`CROSS_TENANT_CLAIM`), and the S45/S46 changes add no cross-tenant path. Enterprise + platform suites (incl. tenant-isolation pins) green.

## 11 · FINANCIAL INTEGRITY

The GL invariants are unchanged (S46 touched no `glPosting` logic): invoice issue → Dr AR / Cr Revenue; cleared receipt → Dr Cash / Cr AR; outstanding = invoice − valid allocated receipts; paid ⇒ outstanding 0. The finance suite (44 files / 357 tests incl. the GL control-plane) is green after the payment fence. S46 does not invent accounting policy.

## 12 · O2C CHAIN

Customer → Sales Order (create + quote conversion) → Ship → Generate Invoice → Issue → AR → Customer Receipt (cleared) → Settlement → GL — every consequential write governed; the warehouse-ship and legacy-door bypasses closed; the payment shortcut fenced.

## 13 · RUNTIME PROOF

S45 proved the full governed O2C chain in a REAL Electron runtime on a fresh local profile (30/30). S46's closures are code-level (unit/integration), verified here; **the real-Electron re-run is PENDING on the Mac** (the Linux sandbox cannot execute the macOS Electron binary — same constraint as S41/S45). Recommended: re-run `e2e/o2cRuntime.e2e.cjs` on an alternate build; the armed build was NOT rebuilt.

## 14 · ADVERSARIAL PROOF

`session46O2CClosure.test.ts` (12 tests): external governed-key call refused (no bypass mint), internal origin admits, governed command works end-to-end, all four governed keys refused externally, non-governed action unaffected, renderer cannot forge origin (strict schema), the illegal pending→fulfilled jump refused, cancelled/closed order not force-advanced, payment pending→cleared edit refused, governed cleared receipt works.

## 15 · UI PROOF

No renderer file changed in S46 (main-side closures only), so the S43–S45 governed-UI wiring and the full UI suite are unaffected; the origin boundary + payment fence surface their refusals through the existing error slots. UI suite run pending on the Mac full pass (expected unchanged from S45's 429).

## 16 · FULL TEST NUMBERS (memory-safe; full main + UI + runtime → Mac)

| Suite (`--pool=forks --singleFork`) | Result |
|---|---|
| S46 focused (`session46O2CClosure`) | **12 / 12 passed** |
| `enterprise` + `platform` + `ipc` (incl. command bus, S43/S45 governed paths, transaction-graph, re-harnessed lifecycle tests) | **213 files / 1834 passed** |
| `finance` + `sales` (GL control-plane + payment fence) | **44 files / 357 passed** |
| `warehouse` + `sales` + `inventory` (canonical ship routing) | **17 files / 184 passed** |
| typecheck (node + web) · eslint (changed files) · `electron-vite build` | **clean · clean · exit 0** |

No test weakened or deleted. The 16 pre-existing lifecycle tests that drove governed keys directly through the door were updated to carry the authorized internal origin (they simulate the internal path, like the command bus) — every assertion preserved. **Full 962-file main suite + full UI + real-Electron runtime: PENDING on Mac (memory-bound / macOS-only here).**

## 17 · REMAINING POLICY DECISIONS (memos kept OPEN)

`DECISION-MEMO-SALES-ORDER-APPROVAL.md` (approval policy — does not affect the pilot happy path) and `DECISION-MEMO-O2C-REVERSAL-AND-SHIPMENT-DOCS.md` (reversals / credit notes / refunds / write-offs / shipment-document governance / payment-clearing command / issued-invoice economic edits). Both remain OPEN; S46 added closure notes without deciding any business rule.

## 18 · PILOT RESTRICTIONS (fence — honestly, an operator condition where not mechanical)

Mechanically closed (no fence needed): warehouse-ship status jump, legacy governed-action door, payment clearing-by-edit. **Remaining operator fence** (defined-legacy / policy-undecided, memo-tracked): do NOT edit issued-invoice economic fields (amount/taxRate/exchangeRate); do NOT delete issued invoices / cleared payments; do NOT import economic payment/invoice rows; sales-order approval + reversals remain undefined. These are policy fences on ADJACENT surfaces, not bypasses on the pilot happy path.

## 19 · WINDOWS STATUS

**UNTESTED** — no claim (macOS-only runtime here).

## 20 · AI STATUS

Advisory-only; no execution path; unchanged **GRAY**.

## 21 · DR STATUS

S42 Gate 4 full DR drill carried (not run this session); crash/HOLD recovery (S37–S44) unchanged and intact.

## 22 · FIRST-USER ONBOARDING RESULT

The pilot happy path — launch local-first (no sign-in, the S45 local-mode fix) → New Customer → New Sales Order → Ship → Generate Invoice → Issue → New cleared Payment → invoice paid, outstanding 0, GL correct — requires NO developer console, DB access, shell, hidden admin, manual JSON, or status mutation. Every write is governed. S46 removed the last MATERIAL bypasses on this path; the runtime re-confirmation is the Mac step.

## 23 · FINAL GO / NO-GO

The three MATERIAL governance hazards S45 flagged are mechanically closed and test-proven; the pilot-critical O2C workflow has no known broken workflow or bypass at the code level. The residual fence is defined-legacy/policy (adjacent surfaces), not a happy-path bypass. The one external gate is the Mac confirmation (full suite + real-Electron runtime), consistent with every prior session.

---

# FINAL CERTIFICATION

O2C GOVERNANCE: **GREEN** (pilot-critical path; material bypasses closed)
ZERO PILOT-CRITICAL BYPASS: **YES** (code-level; rescan clean)
REAL ELECTRON RUNTIME: **PASS (S45)** · S46 re-run **PENDING on Mac** (macOS-only)
REAL USER HAPPY PATH: **PASS** (governed, test-proven; runtime re-confirm on Mac)
DATA INTEGRITY: **PASS**
TENANT ISOLATION: **PASS**
AUTHORIZATION: **PASS**
IDEMPOTENCY: **PASS**
EVENT / OUTBOX / AUDIT: **PASS**
FINANCIAL CHAIN: **PASS**

FIRST REAL USER: **GO — FIRST CONTROLLED REAL USER CAN BE ONBOARDED**

— under a NARROWED, policy-only fence (defined-legacy economic edits/deletes/imports, memo-tracked — not a bypass) and pending the standing Mac confirmation of the full suite + real-Electron runtime. The material mechanical hazards that made S45 a *conditioned* GO are now closed; what remains is business-policy (reversals/approval), not a broken or bypassable pilot-critical workflow.

*Evidence label: TEST-VERIFIED (unit + integration, real handlers/command bus/journal). Full-main + UI + real-Electron runtime: PENDING on Mac. No external effects. No frozen surface touched.*
