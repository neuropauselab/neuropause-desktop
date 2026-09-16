# SESSION 55 — ENTERPRISE GOVERNANCE CLOSURE

## 1 · Executive result

A repository-wide five-lens census (write paths · status machines · GR eligibility ·
AI/security · YELLOW diagnostics; every claim cited to file:line with search spaces stated)
found and **mechanically closed FOURTEEN real governance gaps in four classes** — all closable
without inventing business policy — while filing everything that needs a business decision into
memos (one new memo, two register corrections). **Decision-neutrality is measured: full main
967/10,137/7 = S54 + exactly the 13 new pins, ZERO existing tests changed across 12 production
files touched.** All three S54 YELLOWs closed. AI/security boundaries re-verified with zero
gaps. Baseline `dec36f6` → this session's commit.

## 2 · What was CLOSED (mechanical, policy-free — each with its measured justification)

**CLASS 1 — store-anchored token guards** (the census-generalized F-S50-3 pattern: input-
anchored "immutable once stamped" guards read the MERGED payload, so a crafted update supplying
`''` cleared the token and the guard passed):
1. `journalEntryModule.postedAt` — un-posting: a cleared token forced status draft and the
   entry SILENTLY DROPPED OUT OF THE BOOKS (balances re-derive from the posted ledger). The
   kernel governs POST; the update door provided un-post. Now store-anchored.
2. `accountingPeriodModule.closedAt` — edit-door reopen of a CLOSED period around the reopen
   action, with an audit row saying only 'updated'. Now store-anchored (the reopen ACTION is
   untouched — its authority question is memo'd).
3. `paymentModule.bankReconciledAt` (FW-8) — one edit erased the bank-evidence stamp. Now
   store-anchored.

**CLASS 2 — marker/token immutability** (readOnly is renderer-only; the update door accepts
any descriptor key — the cross-cutting mechanism the census pinned):
4. Vendor-bill markers `approvedAt`/`cancelledAt`/`paidDate` + `amountPaid`: clearing
   approvedAt was a SILENT APPROVAL REVERSAL with the Dr Expense/Cr AP booking ORPHANED
   (glPosting computes live=false → no reversal; reconcileBill AGREES with forged markers);
   setting paidDate faked settlement with zero payments. Markers now move only through
   actions/reconciler (raw-store writers).
5. `order.convertedInvoice` — clearing re-armed Generate Invoice → DUPLICATE INVOICE (the
   conversion guard reads only the token). Now immutable (S50 convertedReceipt shape).
6. `order.pickList` — same shape, duplicate pick document. Now immutable.
7. Quote conversion state + `convertedOrder` token — editing a CONVERTED quote back to
   'accepted' while blanking the token re-armed the GOVERNED ConvertQuoteToSalesOrder into a
   duplicate sales order. Crossings involving 'converted' + the token now fenced;
   draft/sent/accepted/rejected/expired edits stay free (no invented policy).
8. GR received-row `purchaseOrder`/`lines`/`supplier` — the first two are INPUTS to the
   cumulative no-over-receipt invariant; `supplier` is the scorecard attribution key
   (closes F-S50-5). Frozen on received rows only; pending/rejected rows fully editable.

**CLASS 3 — posting re-arm fences** (the S49 GR pattern extended to its unfenced twins):
9. `shippingModule` — NO fence existed: hand-set shipped/delivered faked shipments; UN-setting
   re-armed Ship into DUPLICATE stock issues + order advances. Crossings involving
   shipped/delivered refused; pending↔cancelled free.
10. `multiLineDispatchModule` — dispatched→draft re-armed dispatchLines → duplicate
    Dr COGS / Cr Inventory per line. Fenced; draft↔failed free.
11. `multiLineReceiptModule` — received→draft re-armed receiveLines → duplicate
    Dr Inventory / Cr GRNI (this module lived OUTSIDE the S49 fence). Fenced.
12. `stockMovementModule` — the module DECLARES "the IMMUTABLE stock ledger — corrections by
    compensating movement, history never rewritten" and enforced nothing: editing a posted
    movement's quantity re-derived stock while GL stayed at the original (idempotent bridge, no
    adjustment machinery) — silent stock-vs-books divergence. **Enforcing a declared contract
    is not invented policy.** Posted rows: only →void (the GL-reversing correction path) with
    economic fields unchanged; void terminal.
13. GR `post` vs a **CANCELLED** PO (F-S50-1's closable half): the eligibility rule existed at
    the conversion door only; the post ingress received against cancelled POs. Measured: zero
    tests and no flow legitimately do so; PO-less receipts (defined, pinned) preserved. The
    DRAFT half is deliberately NOT fenced — load-bearing in the governed command lane itself —
    memo'd as a commitment-authority decision.

**CLASS 4 — one delete door:**
14. `SetStatus-'deleted'` was a SECOND delete path skipping the Delete door's dependency
    assessment, refusal-without-force and decision record. Refused with a pointer to the one
    governed door (measured: no production or test caller used it; the compiler proved the
    old 'deleted' fan branch unreachable after the guard).

**Pins:** `session55GovernanceFences.test.ts` — 13, green (2 fixture module-id corrections
during bring-up; zero assertion changes). Every fence: update-door only, status-less importer
rows exempt, actions/conversions write via raw store and never re-enter validate, no-lockout
controls included.

**One attempted fence REVERTED against a certified pin (recorded, not hidden):**
invoice `amountPaid` edits drive the payment-state derivation and are PINNED as defined
behavior (preserved deliberately by S45). The census's "hole" is the memo'd defined-legacy
settlement-edit class — folded into the O2C memo scope, not fenced. Never weaken a pin to
land a fence.

## 3 · S54 YELLOW closures (Phase 11)

- **A · UI flake CLOSED** — diagnosed mechanistically (two limbs: the palette-open broadcast
  can be LOST before AppShell's passive-effect listener attaches — no timeout can recover a
  lost event; plus time-sliced renders exceeding the 1s default find). Test-side re-emit loop
  gated on OBSERVED ABSENCE (the census caught a toggle hazard in the first version of the
  patch — `command-palette` TOGGLES, so a blind re-emit could close a just-opened palette —
  fixed before commit). Assertion unweakened; a human presses ⌘K only when the window is
  interactive, so the lost event is a harness artifact. 3/3 in isolation + green in the full
  runs.
- **B · F-S51-1 lint hygiene CLOSED** — the mechanism was `ignorePatterns` in the REPO-ROOT
  `.eslintrc.cjs` (S51's "no ignore file exists" was an apps/desktop-scoped search — the same
  narrow-search-space class as the qemu and `.env` misses, recorded). `'dist-*'`/`'out-*'`
  added; `npm run lint` now reports EXACTLY the one logged pre-existing frozen-path error
  (`cst/` is frozen — fixing it needs an FG gate; protection preserved, scope documented).
- **C · asar packing CLOSED (bounded)** — census measured exactly THREE runtime-live files in
  the packed node_modules (the vendored CST kernel path) vs 87 dead `*.test.ts` files;
  `!**/*.test.ts` added to the builder files config (raw TS cannot be require()d; the bundles
  contain zero requires of any .ts path — provably runtime-safe). A broader src-TS exclusion
  was REFUSED as unproven (workspace deps declare TS mains). Applies to the NEXT packaging
  run; rc.22 artifacts untouched.

## 4 · AI governance + security boundaries (Phases 9–10) — VERIFIED, zero gaps

Re-measured at HEAD, not inherited: no AI path touches ERP stores/commandBus (124-file sweep,
every enterprise import classified) · INTERNAL_ACTION_ORIGIN per-process random, module-
private, `.strict()`-unreachable from the renderer · claimedTenantId rejected at THREE layers
(application boundary, bus defense-in-depth, principal-derived scope) · actor derivation fully
main-side (deny-by-default forgery refusal) · **missing idempotencyKey REFUSED, never
auto-minted** (schema + bus double layer, pinned) · authorization runs INSIDE the durable
idempotency boundary. Three unpinned-semantics observations recorded (cross-operation key
reuse replays conservatively; committed replays skip re-authorization BY DOCUMENTED DESIGN;
the bus's defense-in-depth missing-key string has no direct pin) — none crosses a boundary.

## 5 · POLICY-BLOCKED register (Phase 1/15 — decisions owed, not defects)

Existing memos verified OPEN and honored: SO approval · O2C reversals/credit-notes/
ClearCustomerPayment/shipment-docs (one stale statement corrected in place: the S45
"sharpened" direct-write item was CLOSED by S46 — dated addendum added) · ClearVendorPayment/
PR-un-reject · importer economic rows. **NEW memo `DECISION-MEMO-DEEP-FINANCE-HR-AUTHORITY.md`:**
HR chain (payroll post, salary disbursement Dr Salaries Payable/Cr Cash, expense-claim
SELF-APPROVAL — the SoD vocabulary exists but only bills bind it) · fixed assets · stock
adjustments/cycle counts (the shrinkage channel) · period-reopen authority · draft-PO
receiving (F-S50-1's deferred half) · credit/debit-note modules NOW EXIST (register
re-measurement for the reversal memo, §2 #21).

## 6 · Test evidence (Phase 13)

```
S55 pins             13/13
Modules + framework  108 files · 858 tests — ALL GREEN with every fence in place
Full main            967 files · 10,137 passed · 7 skipped  (S54 +1 file/+13 tests = exactly
                     the pin file; ZERO existing tests changed — measured decision-neutrality)
Full UI              79 files · 448 passed (stabilized flake test in-run)
Release discipline   4/4 · Typecheck node+web PASS
npm run lint         EXACTLY 1 error — the logged pre-existing frozen-path defect (F-S51-1 closed)
Real-user journeys   procurement 10/10 + RESULT · O2C 9/9 + RESULT (fresh alternate build,
                     fresh profiles, clicks only; the known harness exit-grace hang recurred
                     after completion — environment class, all asserts green)
```

## 7 · Updated release matrix (Phase 15)

- **GREEN:** O2C workflow · procurement workflow · S45–S55 fence set (now covering all NINE
  status machines + the stock ledger + tokens/markers) · AI advisory-only isolation · tenant/
  actor/idempotency boundaries · Mac + Windows functional acceptance (S51/S53, untouched).
- **YELLOW:** procurement legacy-door origin fence (S49 carry) · issued-invoice economic edits
  + DELETE-door reversals (memo'd defined-legacy) · importer reviewer-update validate bypass
  (memo'd) · asar workspace-source packing residue (test files excluded; src exclusion
  unproven).
- **GRAY:** Windows updater E2E (no live host) · SmartScreen · native-x64 spot-check.
- **POLICY-BLOCKED:** the §5 register (three memos).
- **PENDING OPERATOR CREDENTIALS:** Windows Authenticode · macOS notarization.

## 8 · Decision

**GOVERNANCE: GREEN** (every found real gap closed or memo'd; nothing converted dishonestly).
**GLOBAL RELEASE: unchanged — CONDITIONAL GO for the pilot scope, HOLD on distribution trust
only.** The rc.22 artifacts predate S55; the fence set ships with the next packaging run
(recorded — same discipline as S49→S51).
