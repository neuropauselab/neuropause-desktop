# SESSION 49 — PROCUREMENT GOVERNED UI CLOSURE

**Baseline:** `5846cb7` (S48) · frozen surfaces untouched (gate-detector PROCEED ×4 before editing) ·
external effects 0 · armed/dist artifacts untouched · the certified S48 pilot path NOT destabilized
(re-proven below).

## 1–2 · Architecture map & the gap

All EIGHT buy-side commands existed on the bus since S17/S23/S25/S26 — `CreatePurchaseRequest`,
`Submit/Approve/RejectPurchaseRequest`, `ConvertPurchaseRequestToPO`, `PostGoodsReceipt`
(`'post'` on `procurement-receipts`), `ApproveSupplierInvoice`, `PaySupplierInvoice` — with RBAC
(`procurement:manage` / `operations:manage`), journal, events, outbox, audit. The production UI
drove NONE of them (the S43-era gap on the buy chain). Also found: **PRs have no documentSpecs
approval binding**, so the update-door approval gate is vacuous for them — the PR edit door could
hand-set `draft→approved` (the S45 order-class bypass, buy side), and the GR edit door could
hand-set `received` (fake receipt, no stock) or un-set it (re-post ⇒ doubled movements). And the
**S46 into-`cleared` payment fence existed only on the customer module** — the vendor twin was open.

## 3 · What S49 changed (5 production files + 2 test files + 1 harness)

- **Renderer wiring (S43/S45 pattern, no new commands):** the (module, action) routing table now
  covers PR submit/approve/reject/convert, GR post, bill approve; governed creates for PR (draft
  forced) and CLEARED vendor payments (pending/void stay CRUD — no GL at creation). One
  `GovernedRecordOp` type derived from the single ipc helper — nothing duplicated.
- **PR authority guard** (`purchaseRequestModule.ts` validate): edits may not CROSS the
  approved/ordered boundary in either direction; **draft↔pending↔rejected edits stay free — the
  defined resubmit path** (no `resubmit` action exists; blocking it would invent a restriction).
- **GR economic guard** (`goodsReceiptModule.ts` validate): edits may not enter or leave
  `received`; pending↔rejected free (edit is the defined path to `rejected` — no reject action).
- **Vendor-payment clearing fence** (`vendorPaymentModule.ts` validate): edit-door transition INTO
  `cleared` refused — the exact S46 customer-side fence applied to its buy-side twin (S46's own
  pattern; no invention).
- Status-less importer rows exempt from every guard (the S45 lockout lesson, pinned).

## 4–5 · Lifecycle & guards — proven

Real-Electron click-only journey (`e2e/procurementUiJourney.e2e.cjs`, fresh profile, zero IPC
shortcuts): **7/7 PASS** — onboarding → Procurement → New Purchase Request (governed create) →
Submit → Approve → Create Purchase Order → PO visible in Purchase Orders. Main pins
(`session49ProcurementGuards.test.ts`, 9): both refusal directions per guard · resubmit and
pending→rejected paths preserved · full submit→approve→convert action chain untouched ·
vendor-payment fence · importer-shape no-lockout. UI pins
(`session49GovernedProcurementActions.test.tsx`, 9): each action dispatches the right operation
with the record as `target` and the legacy door NEVER fires; both governed creates + the
pending-stays-CRUD control. Deeper chain semantics (three-way match, GRNI, movements) carry
unchanged from their S17/S23/S25/S26 certifications — S49 changed no domain logic.

## 6–7 · Financial & inventory integrity

No posting logic touched. The guards only REFUSE hand-set states that would fake or double the
existing postings: hand-set `received` (no Dr Inventory / Cr GRNI behind it) and received→pending
(re-post doubling) are now impossible via the edit door; vendor clearing books only through the
governed command. Over-payment/duplicate-ref refusals in the vendor engine unchanged (their
existing tests run unmodified).

## 8 · Security

Same boundary as O2C — nothing new: per-command RBAC inside the idempotency boundary, tenant
server-resolved, S46 origin token unforgeable from the renderer. 965-file suite green includes all
13 permission/security suites.

## 9–12 · Evidence

```
Full main   965 files · 10,112 passed · 7 skipped   (S48: 964/10,103 — delta = the 9 new pins)
UI          78 files · 440 passed                    (S48: 77/431 — delta = the 9 new pins)
Typecheck   node + web PASS · Lint PASS · Build exit 0 (alternate outDir; armed/dist untouched)
Runtime     procurement journey 7/7 (first run, no iteration needed) ·
            O2C chain re-verified · O2C click journey 9/9 re-verified — ZERO pilot regression
```

## 13 · Remaining policy decisions (unchanged set + one new)

Existing memos stand. NEW, recorded not invented: whether a governed `ClearVendorPayment` /
un-reject PR flow should exist (the fences leave clearing to the governed create and resubmit to
the edit door — both defined today).

## 14 · Pilot fences

Unchanged from S48 — plus: the **packaged rc.21 artifact predates S49**, so packaged procurement
governance ships with the NEXT packaging run; the S48 Mac pilot certification (O2C) is unaffected.

## 15 · Post-pilot roadmap

PO status machine formalization (PO approve/send/receive remain descriptive/legacy — classified
YELLOW, no economic bypass found through them this session) · reference pickers · Lines (JSON)
retirement (still not a pilot blocker — the DocumentPanel line editor exists) · repackage with S49.

## 16 · Final status

PROCUREMENT UI **GREEN** (source + runtime; packaged pending next build) · GOVERNANCE **GREEN** ·
FINANCIAL INTEGRITY **GREEN** · INVENTORY INTEGRATION **GREEN** · SECURITY **GREEN** ·
O2C REGRESSION **PASS** · WHOLE-APP **PILOT-GREEN**.
