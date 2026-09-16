# SESSION 50 — PROCUREMENT SURFACE HARDENING & REFERENCE INTEGRITY

**Baseline:** `5179909` (S49) · frozen surfaces untouched (gate-detector PROCEED ×7 before editing) ·
external effects 0 · armed/dist artifacts untouched · zero new IPC channels · zero new main-side
stores · zero duplicate architecture (measured, §6).

## 1 · PO status-machine census (Phase 1)

Measured by a 3-lens fleet + first-hand reads (search spaces stated in the census output; every
`file:line` verified at HEAD). The PO lifecycle at `5179909`:

| Status | Entered by | Real significance |
|---|---|---|
| draft | create / RFQ award / conversion | none (default) |
| approved | `approve` action (budget FW-5 + contract FW-7 gates) **or** edit door (spend-policy `canEnterStatus` gate) | **authority** — and counts toward budget commitment (`COMMITTED_PO_STATUSES`) |
| sent | `send` action (from approved) or edit door (spend-policy gated) | descriptive stamp + budget commitment |
| received | **`receiveGoods` conversion ONLY** (raw store write, stamps `convertedReceipt`) | lifecycle truth for a physically received order; budget commitment |
| cancelled | `cancel` action (refused from received) or edit door | releases commitment; no side effects |

**The measured split-door architecture (recorded, not "fixed"):** entry into `approved`/`sent` via
the edit door is gated by the LIVE document-adapter approval engine (`moduleRegistry.ts:559-579` →
`canEnterStatus` → `DEFAULT_SPEND_POLICY`, decision history from the real approval store) — while
the `approve` ACTION enforces budget + contract but never consults the spend policy. Fencing the
edit door INTO approved would have **killed the only live enforcement of the spend policy for POs**
— so it was left exactly as it is, and the split is finding F-S50-2 below.

**What was OPEN and is now FENCED** (`purchaseOrderModule.ts` validate — the S46/S49 pattern:
update-door only, crossing-only, status-less importer rows exempt, actions/conversions write via
the raw store and never re-enter):

1. **`received` in EITHER direction.** Not in `gatedStatuses`, so a hand-set `draft→received`
   passed no gate and then SATISFIED the `receiveGoods` status guard — composing the edit door
   with the conversion into a path that raises a real goods receipt (→ post → real stock movement
   + Dr Inventory / Cr GRNI) from a never-approved, never-budget-checked PO. Un-setting `received`
   releases committed budget while goods are physically in stock and re-arms `cancel`, which the
   action machine itself refuses from received.
2. **`approved`/`sent` → `draft`** — a silent approval reversal that releases budget commitment
   (S49 PR precedent: "an approval cannot be silently reversed"). The census lens recommended the
   narrower received-only fence; this half is added on two measured grounds — the commitment
   release (`COMMITTED_PO_STATUSES = ['approved','sent','received']`) and the certified S49 PR
   precedent — and strands nothing: the loud path (Cancel action → cancelled→draft edit) reaches
   draft in two defined steps.
3. **`convertedReceipt` is edit-immutable.** It is the Receive-Goods IDEMPOTENCY TOKEN and
   `readOnly` only in the renderer (`validateEnterpriseRecordInput` enforces no readOnly). A
   crafted payload clearing it on a received PO re-armed Receive Goods → second GR → post →
   duplicated movements (the single-product post has no cumulative over-receipt check). Both
   directions refused at the update door; create door untouched (a create-door refusal would lock
   out historical imports carrying receipt links — recorded bound).

**Deliberately FREE (refusing them would invent policy):** `cancelled→draft` (the ONLY recovery
path — no un-cancel action exists; the PR resubmit reasoning), `draft→cancelled` (identical
semantics to the ungated `cancel` action), all approved↔sent movement (spend-policy governed).

Pins: `session50PoStatusFence.test.ts` — **12**, first-run green: three received-crossing
refusals (incl. the action-parity control: the cancel ACTION refuses received too), both reversal
refusals, both token refusals (+ the token surviving = conversion still refuses a second receipt),
`cancelled→draft` and `draft→cancelled` still save, non-status edits on approved POs still save,
the full approve→send→receiveGoods action chain untouched, status-less importer shape editable.

## 2 · Reference integrity (Phase 2)

Census: **8 genuinely relational operator-typed fields ranked by measured risk; 11 stamped/readOnly
refs need no picker; NO reference-picker mechanism existed anywhere in the renderer** (negative
sweep, search space stated: picker/combobox/autocomplete/datalist over all renderer sources — sole
hit is the API-scopes chip toggle). Descriptive fields (vendorPayment.vendor/bankAccount/
transactionRef, bill.vendorGstin/paymentReference, pr.department/requester/approver, gr.condition)
were measured to have NO key consumer and deliberately keep their plain inputs.

**New `ReferenceField.tsx`** (renderer-only registry + component; no shared/descriptor change):

| Field | Target store | Match | Main-side consumer (why it's a reference) |
|---|---|---|---|
| PO.supplierRef | suppliers | id (Select) | `assignSupplier` → tenant-scoped `store.get`; foreign invisible, suspended refused |
| PO.budgetRef | finance-budgets | id (Select) | `evaluateBudgetControl` `r.id === ref`; dangling never approves; wrong-but-real id commits spend against the wrong budget SILENTLY |
| PO.contractRef | vendor-contracts | id (Select) | `evaluateContractGate` `r.id === ref` + supplier cross-check |
| PO.supplier | suppliers | **name (datalist)** | 3 name-keyed consumers with INCONSISTENT case rules: contract gate (ci), three-way match (byte-exact), scorecards (silent mis-attribution) |
| bill.sourcePurchaseOrder | purchase-orders | id (Select) | bill validate + goods-bill class flip + three-way match resolve (id-or-number; id canonical) |
| bill.vendor | suppliers | **name (datalist)** | the vendor limb of the three-way match, byte-exact vs po.supplier |
| payment.billRef | vendor-bills | id (Select) | `findBill` id-or-number; **duplicate bill numbers resolve silently to newest — the id doesn't** (census rank-1 risk) |

Properties, each pinned or measured: choices come from the EXISTING tenant-scoped RBAC'd list door
(`enterprise:module.list` — deny-by-default scope, target module's own read permission) — zero new
IPC, zero new privileged surface; the canonical RECORD ID is stored while the label is shown;
a stored value resolving to no live choice is preserved as an explicit "(unresolved)" option —
an edit never destroys an untouched reference; a refused/failed list DEGRADES to the plain text
input (fail-safe; main-side consumers still validate whatever arrives); **name-keyed fields stay
free text with suggestions** — a closed Select would have invented master-membership policy the
domain does not have. Cross-tenant ids remain refused where they always were: at the main-side
consumer (no renderer check pretends to be the boundary). `GR.purchaseOrder` is deliberately
absent — conversion-stamped readOnly; the form never renders it. `rfq.sourceRequest` not converted
(census rank 8, audit-only, no economic consumer).

## 3 · Lines (JSON) retirement (Phase 3)

Census verdict, measured: **`fields.lines` JSON is the ONE canonical buy-side line model** — the
PR's only domain consumer is the PR→PO conversion carrying it VERBATIM (`conversion.ts:54`); PO
subtotal/total derive from it; GR post and the three-way match parse it through
`procurementLines.ts`. The adopted document-line store is a SECOND, UNSYNCED representation whose
accounting legs (`postOn`) are **structurally unreachable** (keyed on record-level status
`active|archived|deleted` against domain-status keys — corroborating the committed Session-13
comment), and `EnterpriseModuleActionContext` cannot reach it — so DocumentPanel adoption would
have instantiated a silent lines-lost desync. **The smallest honest path is renderer-only**, and
that is what landed:

**New `LinesEditor.tsx`**: a structured line grid replacing the raw textarea for exactly the
procurement chain — PR / PO / vendor bill (`{sku, quantity, unitPrice}` + per-line amount +
derived-subtotal preview, labelled derived; main stays authoritative) and GR
(`{sku, quantity, poLine?, warehouse?}`). It serializes into the SAME form-state key on every
change, so the submitted payload, persisted shape, command contracts, conversion and every parser
are byte-compatible and untouched. Honesty rules pinned: parser ALIAS keys (productId/product,
qty, price/unitCost) are read so legacy rows display; edits write the canonical key while UNKNOWN
row keys are preserved verbatim; malformed JSON falls back to the raw textarea with the original
text intact — operator data is never destroyed. Other `lines` carriers (GL journals, bank
statements, payroll, sales, dispatch…) keep their textarea — their shapes differ and sales is out
of this session's scope (follow-up recorded).

**Label kept as "Lines (JSON)" — measured, not overlooked:** the import classifier auto-maps CSV
columns BY FIELD LABEL (`classifier.ts:112`, score 0.95); renaming would silently weaken re-import
mapping. Rename waits for an importer alias mechanism (follow-up).

UI pins: `session50LinesAndReferences.test.tsx` — **8**, first-run green (canonical serialization
into the governed CreatePurchaseRequest payload · alias display + unknown-key preservation through
an edit · malformed fallback · row removal · picker choices from the list door + id submitted ·
unresolved preservation · failed-list degradation · name-field free text with suggestions).

## 4 · Governance / security (Phase 4)

Nothing about the boundary moved: same command spine, RBAC inside the idempotency boundary,
server-resolved tenant, S46 origin token. The new components ADD no authority: they read through
the existing permission-gated list door and write through the existing form submit path. The S49
UI suites re-ran unmodified (the governed-path and legacy-door-never-fires pins). The fence
TIGHTENS the update door only. AI remains advisory-only; no AI path gained any shortcut (no AI
code touched). No new privileged IPC channel (no channel registry change at all).

## 5 · Runtime proof (Phase 5)

`procurementUiJourney.e2e.cjs` extended and re-run against a fresh alternate build, fresh profile,
clicks/typing only: onboarding → Procurement → New Purchase Request → **structured line entered
through the editor (SKU-PILOT × 10 @ 5) — no JSON typed** → governed create → Submit → Approve →
Create Purchase Order → PO visible → **PO detail shows total 50.00 derived main-side from the
lines carried PR→PO, and the Source Request linkage** → 10/10 PASS. O2C regression: `o2cRuntime`
chain + `o2cUiJourney` 9/9 re-run PASS (results in §6).

## 6 · Suite evidence (Phase 6)

```
S50 fence pins        12/12   (session50PoStatusFence.test.ts, first run green)
S50 UI pins            8/8    (session50LinesAndReferences.test.tsx, first run green)
Adjacent focused     133/133  (S45+S49 guards, procurement dir, P2P 11/12, documentWiring, outcomes)
Full main            966 files · 10,124 passed · 7 skipped   (S49: 965/10,112/7 — delta = the 12 new pins)
Full UI               79 files · 448 passed                   (S49: 78/440 — delta = the 8 new pins)
Typecheck            node + web PASS · Lint PASS (0 errors on all touched files)
Build                alternate outDir exit 0 (armed out/ and dist untouched)
Runtime              procurement journey 10/10 · o2cRuntime RESULT green (exit 0) · o2cUiJourney
                     9/9 + RESULT green
```

Failure classifications (nothing suppressed): one full-UI run flagged 2 tests
(`dataImportShellJourneyGate26`, `previewNavReachability`) — **parallel-load flake**, both green
×3 in isolation AND on the full-suite re-run (79/448/0), different tests on different runs, no
S50 surface involved. Two e2e harness incidents, both **environment/operator class**: the first
procurement-journey attempt stalled behind an ORPHANED S47-era Electron instance (the S48-measured
signature; killed, re-run passed first try), and the o2cUiJourney harness hung on app-close AFTER
printing all 9 PASS lines + RESULT (exit-grace hang; the product behaved correctly — the run's own
output is the evidence).

## 7 · Whole-app write-path rescan (Phase 7)

Re-answered post-implementation: (1) procurement ECONOMIC writes reachable through generic CRUD —
**none new; the PO received/token holes are now closed**; the remaining known CRUD-reachable
procurement writes are the ones certified free in S49 (PR draft-lane, GR pending↔rejected) plus
the residuals in §8. (2) Authority transitions editable through UPDATE — PO approved/sent entry
remains spend-policy-gated BY DESIGN (the live gate); reversals now refused. (3) References cannot
bypass tenant authorization — the picker reads the deny-by-default scoped list door; consumers
unchanged. (4) Structured lines cannot bypass domain validation — the editor writes the same field
the same validators parse. (5) A renderer cannot fabricate a governed operation — untouched
surfaces, S46 origin token intact. (6) No duplicate architecture — no new bus/store/engine/channel;
two view components + one registry each. (7) No certified O2C path changed — zero sales/finance
O2C files touched (the vendor-bill/payment fields are buy-side); O2C suites + journey re-ran green.

## 8 · Findings recorded, deliberately NOT fixed (Phase 8 discipline)

- **F-S50-1** GR-side receipt gaps: multi-line `post` never checks PO `fields.status` (a
  draft/cancelled PO with lines can be received against via a hand-created GR); single-product GR
  post checks no PO at all; GR create-as-'received' is unfenced (S49's GR fence is edit-only).
  Economically bounded — the bill match anchors on POSTED MOVEMENTS, not status — but a real
  posting-eligibility seam. Changing it alters posting semantics → next session, not S50.
- **F-S50-2** The two-door authority split on PO approval (edit door = spend policy; action door =
  budget FW-5 + contract FW-7; neither runs the other's gates). Unification is a policy decision.
- **F-S50-3** `budgetCheck`/`contractCheck` stamps are edit-writable (readOnly is renderer-only) —
  cosmetic authority forgery on the record face; no decision consumes them (NP-020 class).
- **F-S50-4** `'issued'` in the PO `gatedStatuses` is dead vocabulary (not a PO status option).
- **F-S50-5** `gr.supplier` is conversion-copied but editable; scorecards group by it (silent
  mis-attribution). Right fix if taken: stamping/readOnly, not a picker.
- **F-S50-6** The adopted document-line store is a live dual representation (sales-orders drift
  class) whose postOn legs are dead code — an ERP-layer reconciliation decision.
- **F-S50-7** SKU refs resolve cost 0 silently on unknown SKUs (honest 'uncosted' movement) — an
  inventory-family picker decision, not procurement-local.
- Policy memos untouched: SO approval, reversals/credit notes, shipment docs, ClearCustomerPayment,
  ClearVendorPayment / PR un-reject, importer economic rows.

## 9 · Packaging implications

The packaged `rc.21` artifact predates S49 AND S50 — packaged procurement governance + the S50
surface ship with the NEXT packaging run (S48's envelope is ready and unchanged). The S48 Mac
pilot certification (O2C scope) is unaffected: zero certified-path changes, re-proven in §6.

## 10 · Final status

PO GOVERNANCE **GREEN** (census + fence, source+runtime) · REFERENCE INTEGRITY **GREEN** for the
seven census-backed fields (runtime-proven through the journey's Source-Request/PO linkage;
remaining name-limb friction recorded) · LINES UX **GREEN** for the procurement chain (structured
editing runtime-proven; sales-side + label rename recorded follow-ups) · O2C **GREEN** (zero
regression) · SECURITY **GREEN** · WHOLE-APP **PILOT-GREEN** (packaged artifact one session behind
by design).
