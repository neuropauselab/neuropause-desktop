# SESSION 57 — BUSINESS-POLICY CLOSURE CERTIFICATION

## 1 · Executive decision

The three memos were closed **exactly as far as legitimate decision material reaches, and not
one sentence further.** Everything with DEFINED semantics or a DECLARED principle was promoted/
enforced through the canonical spine (eight governed commands wrapping existing action semantics
verbatim; SoD from the repo's own `creator_cannot_approve` vocabulary). Everything requiring a
threshold, role, chain, or accounting semantic that exists NOWHERE in the repository was
re-examined, left POLICY-BLOCKED, and given a precise addendum naming the single operator
sentence that unblocks it. No policy was invented; no history-deleting "reversal" exists —
every reversal books compensating GL.

## 2 · Baseline / implementation map

Baseline `973e4c8`. Policy map executed:

| Memo item | Classification | Enforcement |
|---|---|---|
| SO approval | **C — POLICY-BLOCKED** (no threshold/role/binding exists anywhere; the quote discount `approvalStatus` is computed but consumed by nothing — binding it needs an approver definition that does not exist) | addendum names the choice: interpretation A, or supply B/C's parameters |
| Invoice cancel | **A — promoted** | `CancelCustomerInvoice` → invoice `cancel` action verbatim (compensating GL revoke) |
| Credit/debit notes | **A — promoted** | `Issue/CancelCreditNote`, `Issue/CancelDebitNote` → the notes' own actions verbatim |
| Payment clearing | **A — promoted** | NEW `clear` module action (both payment modules) carrying the DEFINED pending→cleared transition the S46/S49 fences had orphaned; commands `ClearCustomerPayment`/`ClearVendorPayment`; onChange GL/reconcile unchanged |
| Shipment documents | **A — promoted** (settling the memo §2 scope question in practice) | `ShipShipmentDocument` → shipping `ship` verbatim (stock issue + order advance) |
| Cleared-payment reversal, partial credit notes, reopen-paid | **C — POLICY-BLOCKED** (semantics do not exist to promote) | memo addendum |
| Expense-claim self-approval | **A — declared principle enforced** | approve refuses `creator === decider` (`creator_cannot_approve`); reject stays open (withdrawal); creator-less rows uncompared |
| Payroll/disbursement, fixed assets, adjustments/cycle counts, period reopen, draft-PO receiving | **C — POLICY-BLOCKED** (no thresholds/roles/chains anywhere) | addendum per item |
| Credit/debit-note re-measurement (memo §4) | **B — mechanism existed; now also governed** | closed by the promotion set |

## 3 · Enforcement paths (all canonical, nothing duplicated)

Renderer action button → S43/S45 routing table → `platform:command.dispatch` →
application boundary → command bus (`PERMISSION_FOR_COMMAND` inside the idempotency boundary:
`operations:manage` / `warehouse:manage`, each module's own declared write permission — nobody
gains or loses access) → `moduleAction` → the module's OWN guards/GL → durable journal →
domain event (8 new members, compiler-proved map totality via `Record<DomainCommandType,…>`) →
outbox → audit. The 8 legacy action-door keys remain un-origin-fenced — the recorded S49-class
YELLOW posture, unchanged deliberately.

## 4 · Test evidence

```
S57 main pins        4/4  (session57PolicyPromotions: clear clears + books/reconciles (polled
                     eventual onChange) · second clear refuses · void refuses · S46/S49 edit
                     fences hold BESIDE the new actions · SoD refuse/allow/withdraw/orphan)
S57 UI pins          7/7  (session57GovernedReversalActions: each new route dispatches the right
                     op with the record target; legacy door NEVER fires)
Certified-pin delta  ONE pin updated WITH documented justification (payments module actions:
                     [] → exactly [clear]) — the Phase-5 clause satisfied; zero other changes
Full main            968 files · 10,141 passed · 7 skipped  (S55/S56 + exactly the new pins)
Full UI              80 files · 455 passed (+7)
Discipline 4/4 · Typecheck PASS · npm run lint = the 1 logged frozen-path error
Journeys             procurement 10/10 + RESULT · O2C 9/9 + RESULT (rebuilt alternate,
                     fresh profiles, clicks only — S55/S56 GREEN preserved)
```

## 5 · Remaining register

- **POLICY-BLOCKED (operator sentences needed, one each):** SO approval interpretation ·
  cleared-payment reversal/void semantics · partial credit notes / reopen-paid ·
  payroll+disbursement approval · fixed-asset actions · stock-adjustment/cycle-count authority ·
  period-reopen authority · draft-PO receiving (PO approve/send commitment decision).
- **YELLOW:** origin-fence extension for the promoted keys (S49-class carry) · issued-invoice
  ADJ edits + DELETE reversals (defined-legacy, memo'd) · importer reviewer-update bypass ·
  packed workspace `.ts` sources.
- **GRAY:** updater E2E · SmartScreen · native-x64.
- **Distribution trust:** mac notarization + windows Authenticode PENDING CREDENTIALS.
- rc.23 predates S57 — the promotion set ships with the next packaging run (the established
  cadence; nothing certified about rc.23 changes).

## 6 · Release decision

**GOVERNANCE: GREEN** (every decidable item decided-and-tested; every undecidable item fenced
where it was already fenced, with its unblock sentence named). **GLOBAL RELEASE: CONDITIONAL
GO unchanged** — pilot scope; distribution trust + the named operator sentences are all that
remain.
