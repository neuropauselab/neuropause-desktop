# SESSION 61 — GOVERNED PAYMENT REVERSAL + FINANCIAL HISTORY INTEGRITY CERTIFICATION

**Class:** governed reversal implementation (D4) + financial delete boundary (D6). The accounting is REUSED from the existing canonical `-REV` revocation path — nothing invented. The two boundaries the operator's STOP conditions reserved (bank-reconciled reversal, a finer reverse-only permission) are memo'd. No packaging, no release. **The one FROZEN step — registering the module in `enterprise/index.ts` — is PRESENTED as an FG gate, NOT applied.**

## 1 · Baseline

- **Baseline / HEAD at start:** `31d342a` (S60). Branch `cert/data-import-cst-integration`.

## 2 · Final commit

- **Final commit:** `<this commit>` — all NON-frozen. Frozen surfaces (`runtimeCore.ts`, `packages/shared`, `cst/`, `contracts.ts`, `channels.ts`, `enterprise/index.ts`) UNTOUCHED; `enterprise/index.ts` registration is deferred to `FG-ERP-S61-REVERSAL-REGISTER` (token-gated). gate-detector → PROCEED on every edited file; `enterprise/index.ts` verified byte-unchanged.

## 3 · Accounting discovery (measured, first-hand)

1. A cleared customer payment books Dr Cash (1000) / Cr AR (1100) + realized FX, keyed `glPaymentEntryNumber(number)` via `decideLifecycle` (`glPosting.ts`). 2. A cleared vendor payment books Dr AP (2000) / Cr Cash + FX, keyed `glVendorPaymentEntryNumber`. 3. The reconciler already reverses on `deleted || status==='void'` — a cumulative `${base}-REV` mirror. 4. Debit/credit direction is DETERMINISTIC (the `-REV` exactly negates the booked base lines). 5–6. Multi-currency + realized FX (7810) are represented; the `-REV` mirrors the FX line too. 7. `bankReconciledAt` (S55) makes a payment immutable. 8. Clearing creates a distinct journal transaction (the base entry). 9. Reversal must affect cash/bank + AR/AP + FX (via `-REV`) and the invoice/bill reconciliation state (re-open). 10. Customer + vendor SHARE one abstraction (identical `decideLifecycle`; only the entry-number fn + document differ). **Conclusion: the reversal accounting is fully DERIVABLE from the existing revocation path — IMPLEMENT, not STOP; the bank-reconciled subset is the operator's flagged STOP.**

## 4 · Reversal data model

A dedicated non-frozen module `finance-payment-reversals` (record kind `finance-payment-reversal`). Each reversal is a SEPARATE, immutable record referencing the original: `reversalNumber` (stamped `REV-<paymentNumber>`), `originalKind` (customer|vendor), `originalPaymentId`, and — stamped read-only from the original as evidence — `originalPaymentNumber`, `documentRef`, `amount`, `currency`; plus `reason` (required) and the store's own `createdBy`/`createdAt` (the actor + timestamp) + tenant scope. The original payment is NEVER a field target. Chosen over "a negative payment in the payments ledger" because `calculatePaidAmount` clamps negatives to 0 (a negative row could not re-open the invoice); a dedicated referencing record is the only model the existing frozen derivation supports.

## 5 · Command model

Two governed commands (non-frozen `domainCommand.ts`): `ReverseCustomerPayment` / `ReverseVendorPayment` → events `CustomerPaymentReversed` / `VendorPaymentReversed`. The bus (`commandBus.ts`) routes each by CREATING a reversal record through `EnterpriseModuleCreate` (`originalKind` set from the command TYPE, never the payload; `originalPaymentId` = `cmd.target`; `reason` from payload). Full spine: UI → preload → IPC → application boundary → command bus → authorization → create → durable transaction → persistence → GL (onChange) → domain event → outbox → audit → response. No alternate path; customer + vendor share the module + GL + reconciler.

## 6 · Authorization

`operations:manage` (the finance write permission the entire finance command family requires). Reversal is separated from EDIT structurally: a distinct governed command minting a separate immutable record; the edit door cannot reverse (a cleared payment's economics are already immutable). A finer reverse-only permission is DEFERRED (frozen `EnterprisePermission` / D8–D11) — see `DECISION-MEMO-S61-PAYMENT-REVERSAL-ACCOUNTING.md §2`. Server/application-side authoritative; renderer supplies no tenant/actor/authority. UNAUTHORIZED proven (`operations:read` → refused, no reversal).

## 7 · Business policy (deny-by-default, fail-closed)

The reversal `validate` refuses: an original that is not found IN THE CALLER'S TENANT (`scopeOrDeny`), not `cleared`, bank-reconciled, or already reversed; and refuses editing an existing reversal (immutable). At-most-one EFFECTIVE reversal per payment (deterministic replay). Every guard is a REFUSAL that books nothing.

## 8 · Transaction semantics

The reversal is created through the durable command journal (idempotency + event + outbox in one atomic write). No auto-rollback: a reversal is a real compensating posting; undoing it is itself a governed decision. At-most-once WITHOUT compensation — the "already reversed" guard refuses any re-attempt, so a commit-failure retry is refused, not re-executed (the PostGoodsReceipt pattern). Idempotent replay of the same key returns the first result (proven).

## 9 · GL semantics

`handlePaymentReversalForGl` books ONE cumulative `${base}-REV` entry that mirrors EVERYTHING booked under the original payment's base entry — cash, AR/AP, and any realized-FX line — at the ORIGINAL amounts (an exact unwind), via the same `decideLifecycle` revocation the void/soft-delete path already uses. No new balancing account is fabricated; the original journal entry is never deleted or overwritten. Proven: customer reversal nets Cash (1000) and AR (1100) to zero; vendor reversal nets Cash and AP (2000) to zero; the original base entry is byte-identical after reversal and exactly one `-REV` entry is added.

## 10 · FX semantics

DEFINED — no STOP. The `-REV` mirror reverses the original entry's realized-FX line along with cash/AR/AP, i.e. it exactly unwinds the original settlement at its booked amounts; no new FX gain/loss is recognized at reversal date (a re-payment at a later rate would recognize new FX then). This is the repository's existing revocation treatment, reused verbatim — nothing invented.

## 11 · Bank reconciliation semantics

A bank-reconciled payment (stored `bankReconciledAt`, S55/FW-8) is REFUSED for reversal — reversing a payment a finalized statement vouches for needs a bank-correction state + authority the repository does not model (STOP + memo `§1`). The refusal never touches `bankReconciledAt`/`bankStatementRef`; S55 is not weakened. Proven (`session61PaymentReversal.test.ts`).

## 12 · Immutability evidence

Proven at both layers: after a reversal, the original payment record's `fields` are byte-identical (`JSON.stringify` equality, module + governed tests) — status stays `cleared`, amount/currency/rate/bank-evidence untouched; the original journal entry is preserved (every pre-reversal entry unchanged, only a new `-REV` added); and a reversal record itself cannot be edited (immutable evidence).

## 13 · Idempotency evidence

At-most-one reversal per payment (second attempt refused, no second `-REV`); re-firing the reversal onChange books no second `-REV` (deterministic `${base}-REV` guard); the command-level durable-journal replay returns the first result (one reversal record). All pinned.

## 14 · Tenant-isolation evidence

The reversal store is tenant-scoped; the original is resolved via `scopeOrDeny`, so a foreign-tenant payment is invisible → refused (module + governed tests). A renderer claiming a foreign tenant → `TENANT_SCOPE_VIOLATION`. No cross-tenant reversal path.

## 15 · Delete-door behavior (D6)

The shared `EnterpriseModuleDelete` handler now consults a non-frozen `ECONOMIC_DELETE_GUARD`: a CLEARED customer/vendor payment is REFUSED (independent of `force`) and the caller is directed to the governed reversal — DELETE can never substitute for reversal, and posted GL is never hidden by a soft delete. Financial history stays soft-only (physical delete never happens). The command-bus compensation uses `store.softDelete` DIRECTLY (not this door), so it is unaffected. Proven (governed test — plain + force both refused). Scoped to what D4 makes reversible (cleared payments), per the operator's "close D6 only to the extent justified by D4."

## 16 · UI evidence

The governed commands are reachable through the EXISTING `platform:command.dispatch` renderer dispatcher (S22/S43) — no new frozen renderer surface. A dedicated "Reverse" affordance on the payment detail is a thin post-gate addition that lands WITH the FG registration (until the module is registered in production, a live dispatch fail-closes with "module not found"). No renderer code shipped this session; the command path is proven end-to-end through `runSecureHandler`.

## 17 · AI governance evidence

Unchanged and intact: the AI never executes a reversal by store access. Any AI recommendation to reverse must flow through the SAME governed command → authorization → business policy → durable transaction → audit. The reversal module's `validate` treats all input as untrusted data (identity/tenant/authority/`confirmed` are never read from the payload; `originalKind` is set from the command type, not the payload). No AI bypass exists.

## 18 · Positive tests

Customer reversal (module + governed): nets Cash/AR to zero, re-opens the invoice (paid → issued, amountPaid 0), original + journal immutable, event + audit emitted. Vendor reversal (module): nets Cash/AP to zero, re-opens the bill (paid → approved), original immutable. Re-open consistency: a NEW payment on a re-opened invoice sums WITHOUT the reversed one.

## 19 · Negative tests (the operator's 15, mapped)

1 unauthorized ✓ · 2 cross-tenant ✓ · 3 renderer cannot mutate status to reverse (S46 edit-fence + reversal is create-only, no reverse-by-edit) ✓ · 4 legacy action bypass — reversal is create-only through the governed create door (RBAC + validate); no action door exists to bypass ✓ · 5 original not rewritten ✓ · 6 original journal not deleted ✓ · 7 duplicate reversal rejected ✓ · 8 duplicate GL impossible ✓ · 9 duplicate event impossible (idempotent replay) ✓ · 10 bank-reconciled evidence not erased ✓ · 11 DELETE cannot substitute ✓ · 12 nonexistent payment fails ✓ · 13 already-reversed deterministic (refused) ✓ · 14 forged tenant fails (TENANT_SCOPE_VIOLATION) ✓ · 15 forged internal-action origin — reversal uses the create door (no origin token); `.strict()` schemas reject any forged field; the S46 action-origin boundary is unaffected ✓.

> **S64 CORRECTION (§2 #21 — the list above was complete for what it tested and silent about
> what it did not; original preserved):** item 11 ("DELETE cannot substitute") covered deleting
> the ORIGINAL cleared payment. It did not cover deleting the REVERSAL RECORD — which was
> possible at this cert's HEAD and constituted an un-reversal (S63 census finding, STOP-class).
> S64 closed it in the same canonical delete guard with zero-mutation pins. The fifteen classes
> above all still hold; a sixteenth now exists and holds too.

## 20 · Full regression

Memory-safe focused (the full 964+ main + UI + real-Electron run is the Mac's, per the standing pattern): finance module suite **40 files / 300 passed** (S60 base 39/290; +1 file +10 S61 module pins); finance + framework + platform/command **53/449**; ipc/handlers + erp **27/326** (incl. the 8 S61 governed pins); enterprise + tenancy **265 files / 2713 passed** — zero regression from the reconciler refactor, the new module, the D6 guard, or the command/bus additions. The delegate refactor is proven byte-identical by the unchanged existing payment/vendor-payment suites. typecheck:node clean; eslint clean on all changed files; typecheck:test introduces no new S61 errors.

## 21 · Remaining POLICY-BLOCKED

Bank-reconciled payment reversal (memo §1 — bank-correction state/authority undefined). Plus the carry-forwards from S60: D8–D11 approval control-plane; D12 PO lifecycle. (D4/D6 leave the blocked list for the non-bank-reconciled, defined case.)

## 22 · Remaining YELLOW

The production registration of the reversal module in frozen `enterprise/index.ts` is PRESENTED as `FG-ERP-S61-REVERSAL-REGISTER`, awaiting the token — until then the capability is built + tested + command-routed but NOT live in the running app (declared-but-unregistered, the FG-2 pattern). A dedicated reverse-only permission is DEFERRED (memo §2). A reverse affordance on the payment detail UI lands with the FG registration.

## 23 · Remaining GRAY

Updater, SmartScreen, native-x64 (distribution — carried, untouched by S61).

## 24 · Release impact

NONE this session (all non-frozen; no packaging; the frozen registration is token-gated and NOT applied). Once `FG-ERP-S61-REVERSAL-REGISTER` lands the two additive lines, the governed reversal is live end-to-end.

---

**No fake GREEN:** every claim above is backed by a passing pin over real stores + the real command spine (18 new pins: 10 module + 8 governed). The bank-reconciled subset and the finer permission are POLICY-BLOCKED/DEFERRED with a filed memo; the frozen registration is an FG gate awaiting the operator's token. No accounting invented; no certified GL behavior changed (the `-REV` path is reused verbatim); the original payment and its journal are immutable. STOP after commit — and STOP at the FG gate.
