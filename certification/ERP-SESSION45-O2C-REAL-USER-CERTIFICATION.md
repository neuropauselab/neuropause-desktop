# ERP SESSION 45 — GOVERNED O2C REAL-USER CERTIFICATION

**Mode:** INTEGRATE + CERTIFY + ADVERSARIALLY VERIFY · **Classification:** **GREEN (conditioned GO)**
**External effects:** 0 · **Armed `out/` :** byte-identical throughout (`d38d7529…` before/after every build)

## 1 · Executive result

The complete pilot-critical O2C lifecycle — **Customer → Sales Order → Ship → Invoice → Issue (AR/GL)
→ Receipt → Settlement → GL** — is now executable by a real user from the production UI through ONE
governed path, **proven end-to-end in the real Electron runtime** on a fresh local-first profile
(30/30 harness assertions). Session 43 had wired one governed write; S45 wired the remaining four,
added one new governed command with exact precedent, closed the status-edit corruption door at two
layers, and fixed a product defect that made **every** governed command unusable in local-first mode.
An adversarial verify fleet then attacked the changes; its two regression findings were fixed and
re-proven, and its pre-existing-door findings are recorded in the matrix — none is on the pilot
happy path.

## 2 · Git baseline

Entry HEAD `d4bba1b` (`docs(erp-s44)`), branch `cert/data-import-cst-integration`. Pre-existing
worktree: `certification/baseline.json` (custody-protected, never staged) + untracked artifacts.
`verify-freeze.sh`: ANCESTRY OK · SOURCE FAIL classified as **baseline lag over non-frozen work**
(gate-detector PROCEED on every flagged file; zero frozen surfaces moved — the F-P25 conflation
class; re-record remains the operator's call).

## 3 · Architecture reused (nothing duplicated)

`platform:command.dispatch` (FG-ERP-LIVE-IPC, frozen contract untouched — `operation` is an open
string validated deny-by-default in the non-frozen bus) · command bus + `PERMISSION_FOR_COMMAND` ·
DurableCommandJournal (S18/S40 intent-first) · outbox relay (S31) + DeliveredEventLog · governance
audit sink · module status machines · `glPosting` seam · Hold Center (S44) · `resolveGovernedActor`
(FG-6/D-12). **Zero frozen-surface changes. Zero new engines.**

## 4 · What S45 changed (7 production files, +~230/−14)

| Change | File(s) |
|---|---|
| `ConvertQuoteToSalesOrder` — new governed command (union+event+permission+route; wraps the existing quote `convertToOrder` action; compensation mirrors `ConvertPurchaseRequestToPO`) | `domainCommand.ts` · `commandBus.ts` |
| Renderer wiring: Orders **Ship**/**Generate Invoice**, Finance **Issue**, Quotes **Convert** → governed dispatch with `target`; Payments **cleared** create → `ReceiveCustomerPayment` (pending/void stay CRUD — no GL at create, measured) | `EnterpriseModuleScreen.tsx` · `lib/ipc.ts` |
| Machine-owned status: `readOnly` on order/invoice status + validate-hook refusal of hand-set status on the update door (orders: any change; invoices: supplied pre-derivation change — pinned payment-state derivation preserved) | `orderModule.ts` · `invoiceModule.ts` |
| **Local-first fix:** `resolvePrincipal` now uses `resolveGovernedActor` — the device-local principal is handled EXPLICITLY (CLAUDE §4 law). Before: every governed command returned UNAUTHENTICATED in local mode while legacy doors worked — pushing local users onto the bypass | `platformCommandIpc.ts` |
| Verify-fleet regression fixes: status-less (importer-shape) records no longer locked out of edit; unrendered-field errors fold into the form-level slot; readOnly fields omitted from form payloads (stale-status race closed) | both modules + screen |

## 5–6 · Governance matrix & UI-to-command trace

See **ERP-O2C-GOVERNANCE-MATRIX.md** (23 rows + the adversarial-doors table). Every governed UI
action and its command:

```
Orders create form            → CreateSalesOrder        (S43)
Quotes  "Convert to Sales Order" → ConvertQuoteToSalesOrder (S45, NEW)
Orders  "Ship"                → ShipSalesOrder           (S45 wiring)
Orders  "Generate Invoice"    → InvoiceSalesOrder        (S45 wiring)
Finance "Issue"               → IssueCustomerInvoice     (S45 wiring)
Payments create (cleared)     → ReceiveCustomerPayment   (S45 wiring)
```

## 7–9 · Authorization, tenant isolation, approval

- Per-command RBAC inside the idempotency boundary (`sales:manage` / `operations:manage`), unchanged.
- Tenant server-resolved; `claimedTenantId` mismatch → `TENANT_SCOPE_VIOLATION` — **proven live**.
- Approval: procurement approval unchanged. **Sales-order approval policy is UNDEFINED** — nothing
  invented; DECISION-MEMO-SALES-ORDER-APPROVAL.md filed. (The verify fleet re-confirmed the platform
  workflow runtime has zero production callers — a standing certification gap predating S45.)

## 10–13 · Persistence, idempotency, events/outbox, audit — runtime-proven

`e2e/o2cRuntime.e2e.cjs` (alternate build `out-seam-s45`, fresh throwaway profile, **30/30 PASS**):
full chain executed; invoice settled to `paid`, outstanding 0; same-key replay → `replayed:true`,
one order ever; all six domain events (`SalesOrderCreated/Shipped/Invoiced`,
`CustomerInvoiceIssued`, `CustomerPaymentReceived`, `QuoteConvertedToSalesOrder`) present in the
durable `platform-command-journal.json` read back from disk. Crash/restart semantics carry forward
from S37–S41 (unchanged journal machinery).

## 14 · Hold/reconciliation

Unchanged (S44). The journal HOLD → Hold Center → Decision Record path is untouched by S45.

## 15 · AI governance

Unchanged: advisory-only by design; no AI execution path into ERP state exists (S42 GRAY carried).

## 16 · Zero-bypass audit

- **Pilot-critical workflow: zero known RED.** The four previously-RED renderer doors (ship, issue,
  cleared-receipt create, quote conversion) are closed and proven closed at the UI layer (legacy door
  never invoked — ui pins) and live (journal events present).
- **Adversarially-found doors outside the workflow** (verify fleet; all pre-existing): import-minted
  receipt GL · issued-invoice economic-field edit GL adjustments · delete-door GL reversals ·
  warehouse-shipping's direct order-status write · importer reviewer-update validate bypass · the
  legacy action channel still accepting governed keys from any authorized dispatcher (renderer-side
  routing is courtesy, not boundary — a naive main-side guard would break the bus's own re-entry;
  follow-up: origin discriminator). All recorded in the matrix table with classes.
- Non-renderer doors (REST gateway, companion, sandbox validation pipelines that "mutate real
  platform data") are recorded surfaces, out of the renderer sweep's scope, carried as S42 classes.

## 17 · Real-user onboarding test

Local-first (the product's own first-run mode): **the S45 auth fix is what makes this possible at
all** — measured before the fix, `CreateSalesOrder` returned UNAUTHENTICATED on a fresh local
profile; after it, the entire chain runs. The runtime harness executes the exact real-user sequence
against the real renderer build via the real bridge with zero developer seeding beyond master data
entered through the product's own module forms.

## 18 · Failure testing (live)

Pending order cannot invoice (`CONFLICT`) · cross-tenant claim rejected · same-key replay returns the
original result · hand-set status via the edit door refused with the status unchanged · governed
refusals surfaced in the UI (modal stays open; unrendered-key errors now fold into the visible slot).

## 19 · Packaged application testing

- **Real Electron runtime: PROVEN** (this session, alternate build, 30/30).
- **Packaged .app:** carried from S41/S43 for the unchanged shell (packaged SIGKILL recovery GREEN).
  The existing `dist/` .apps predate S45 and do not contain the new wiring; repackaging is governed
  by the B.12/B.13 armed-build + dist-overwrite envelope and is listed as **operator validation**
  (one `electron-builder` run with a dist-protecting output override, then `e2e/platformCommandLive.e2e.cjs`
  + `o2cRuntime` against the packaged binary).
- **Windows: UNTESTED — external validation.** No Windows evidence is claimed.

## 20 · Performance sanity

No new polling, no new synchronous filesystem work on the hot path; the wiring replaces one IPC call
with one IPC call. Suite/build times unchanged (build 2.8s; full suite ~22s wall).

## 21 · Full test results (measured, final state)

```
Full main suite   963 files · 10,091 passed · 7 skipped · exit 0   (entry baseline: 10,090/7)
UI suite          76 files · 429 passed                            (entry: 421 + 8 new S45)
New S45 pins      11 main (session45QuoteConversionAndStatusGuards) + 8 ui (session45GovernedO2CActions)
Adjacent suites   S27/28/29/43 handler + platform/command + modules: all green, zero tests changed
Typecheck         node + web clean · ESLint clean on all changed files
Build             electron-vite alternate outDir, exit 0 ×3 · armed out/ byte-identical (d38d7529…)
Runtime harness   e2e/o2cRuntime.e2e.cjs — 30/30 PASS
```

## 22 · Known limitations

The matrix's adversarial-doors table, plus: the composed production `resolvePrincipal` is executed by
the runtime harness but by no vitest (Electron-coupled construction — the F-P45 §19-item-6 posture,
stated not hidden) · local-mode actor attribution differs between doors (`local:<id>` vs
`local-<id>@device.invalid`, both honest D-12 namespaces) · governance-audit label for local actors is
`'owner'` (byte-parity with the legacy convention) · order `fulfill/close/cancel` remain legacy
(measured: no stock/GL effect; cancel releases reservations only) · the import→GL chain finding is
SOURCE-PROVEN; the decisive runtime pin (scratch-profile import of a payments CSV, journal read-back)
is the named next measurement.

## 23 · External validation required

Windows acceptance · repackaged .app run under the armed-build envelope · full DR drill (S42 Gate 4,
carried) · any live AI provider claims (none made).

## 24 · Policy decision memos

`DECISION-MEMO-SALES-ORDER-APPROVAL.md` · `DECISION-MEMO-O2C-REVERSAL-AND-SHIPMENT-DOCS.md`
(reversals + shipment documents + payment clearing + the economic-edit/delete GL doors folded in).

## 25 · GO / NO-GO

**GO — for a CONTROLLED first real user, under three named fence conditions** (per §2 #31 these are
recorded conditions, not mechanical controls — closing them mechanically is the top follow-up):

1. Pilot operators do not use **Data Command Center import** for payments/invoices (import mints GL
   around the spine).
2. Pilot operators drive shipment via the **order-level Ship action**, not the warehouse-shipping
   module's ship/deliver (direct order-status write bypassing the machine).
3. Pilot operators treat **invoice cancel / record delete / economic-field edits on issued
   invoices** as out of pilot scope until the reversal memo is decided.

**Exact first-user happy path:** launch (local-first, no sign-in needed) → Customers → New Customer →
Sales → Orders → New Sales Order (governed create) → open order → **Ship** → **Generate Invoice** →
Finance → open invoice → **Issue** → Payments → New Payment (cleared, invoiceRef) → invoice shows
**paid**, outstanding 0 → GL/journal reflects Dr AR/Cr Revenue + Dr Cash/Cr AR → every step visible
in the UI from authoritative persisted state.

**What would make it unconditional:** govern or gate the import door for economic rows; route the
shipping module's order-status write through the machine; decide the reversal memo.
