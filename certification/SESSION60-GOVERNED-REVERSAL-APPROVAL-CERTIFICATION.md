# SESSION 60 — GOVERNED ECONOMIC REVERSAL + APPROVAL CONTROL-PLANE CERTIFICATION

**Class:** policy implementation under authoritative operator decisions (D4–D12). Implement what is fully DEFINED by existing governed accounting; STOP+memo what requires an undefined record model, a new authority hierarchy, or an uncontrolled P2P redesign. **No accounting invented; no partial control shipped; no certified invariant weakened; no packaging/release.**

## 1 · Baseline and final commit

- **Baseline / HEAD:** `714346d` (S59). **Final commit:** `<this commit>`.
- Branch `cert/data-import-cst-integration`. Frozen surfaces (`runtimeCore.ts`, `packages/shared`, `cst/`, `contracts.ts`, `channels.ts`) UNTOUCHED — the S60 change is one non-frozen module (`invoiceModule.ts`) + one test + four docs. `gate-detector.sh` → PROCEED on `invoiceModule.ts`.

## 2 · Scope discipline (P0 / P1 / P2)

The operator ordered scope P0 = D4, D5, D6; P1 = approval control-plane + D8–D11; P2 = D12. **Exactly ONE decision was fully defined by existing governed accounting and was implemented: D5.** Every other decision hit a named S60 STOP condition and is filed as a decision memo. This is the honest boundary between "defined and shipped" and "designed and blocked" — no decision was faked GREEN.

## 3 · What was IMPLEMENTED — D5 (govern issued-invoice economic adjustment)

The operator: govern economic adjustment; do NOT silently mutate posted invoice economics; use a governed adjustment transaction referencing the original; **REUSE the existing credit/debit-note mechanism if it provides the correct semantics** rather than creating another accounting subsystem; do NOT create duplicate adjustment stores.

- **The hole S60 closed:** S46 fenced the STATUS edit on an issued invoice, but the ECONOMIC-FIELD edit (`amount` / `taxRate` / `exchangeRate`) on the update door still passed — silently booking a GL adjustment via `glPosting` and rewriting posted history.
- **The fix (one non-frozen module):** the invoice `validate` hook now refuses a change to `amount` / `taxRate` / `exchangeRate` on any **non-draft** invoice (issued / partially_paid / paid / cancelled), directing the caller to raise a **credit note (to reduce)** or **debit note (to increase)** — the existing governed, compensating, cumulative-capped, auditable adjustment mechanism (S57, certified D2 in S59). **No new store, no new command, no new accounting** — the sanctioned path already exists and was reused verbatim.

## 4 · What was BLOCKED — D4, D6, D8–D11, D12 (STOP + memo)

- **D4 (clear-payment reversal) + D6 (financial delete boundary)** → `DECISION-MEMO-S60-PAYMENT-REVERSAL-AND-DELETE-BOUNDARY.md`. The existing payment GL reverses ONLY by mutating the original payment (`glPosting.ts:552-555`: `revoked = deleted || status === 'void'`) — the exact opposite of the operator's "immutable original + separate governed transaction." Satisfying D4 needs a **new reversal record model** + its compensating GL (incl. the multi-currency realized-FX rule) + SoD authority — undefined accounting (STOP). D6's payment redirect target IS D4, so D6 is coupled and blocked with it (implementing it alone would redirect into a nonexistent command — a partial control the STOP rule forbids).
- **D8–D11 (approval control-plane)** → `DECISION-MEMO-S60-APPROVAL-CONTROL-PLANE.md`. The canonical engine has "NO threshold, hierarchy" by design (`workflowRuntime.ts:17-19`). The reusable policy capability (tenant-configurable thresholds, roles, multi-step chains, executor≠approver, immutable decision records, fail-closed) is a substantial framework extension that (a) risks the certified single-approval-engine invariant and (b) is empty and untestable until bound to a domain whose thresholds, roles, and accounting are defined — none are. Building it now would ship a shell or invent authority + accounting (STOP). The bounded design and the exact missing inputs are in the memo.
- **D12 (PO commitment lifecycle)** → `DECISION-MEMO-S60-PO-LIFECYCLE.md`. `ApprovePurchaseOrder` / `SendPurchaseOrder` do not exist; binding receiving to a commitment state re-pins **~18 goods-receipt test files** while preserving GRNI / three-way-match / idempotency — an uncontrolled P2P redesign (explicit S60 STOP).

## 5 · Exact files changed

- **Production source (1):** `apps/desktop/src/main/enterprise/modules/finance/invoiceModule.ts` — the D5 economic-field fence in the `validate` hook (additive; narrow; supplied-field-gated).
- **Tests (1 new):** `apps/desktop/src/main/enterprise/modules/finance/session60GovernedReversal.test.ts` (7 pins).
- **Docs (4 new):** this certification + three decision memos (payment-reversal-and-delete-boundary, approval-control-plane, PO-lifecycle).

## 6 · Existing engines reused (no duplicate infrastructure)

The module `validate`-fence pattern (D5), the credit/debit-note adjustment mechanism + its compensating `glPosting` entries (the redirect target), the command bus, Application Boundary, workflow/approval engine, durable journal/idempotency, journal-post kernel, governance audit/outbox, `creator_cannot_approve` SoD vocabulary. S60 created **no** new bus/engine/store/outbox/audit/command.

## 7 · New commands

**NONE.** D5 is enforced by a `validate` fence that REDIRECTS to the existing governed credit/debit-note commands. The blocked decisions would add commands (`ReverseCustomerPayment`, the approval-plane bindings, `ApprovePurchaseOrder`/`SendPurchaseOrder`) only in their own bounded sessions, named in the memos.

## 8 · Authorization / SoD behavior

Unchanged: per-command RBAC inside the idempotency boundary (`ctx.authorize`); the S46 origin boundary keeps governed keys off the legacy door; the S57 `creator_cannot_approve` expense-claim SoD stands. D5 adds no authority — it constrains the edit door to refuse an economic mutation and points at an already-authorized command. D8–D11 SoD/threshold is memo'd (mechanism absent). Server/application-side authoritative throughout; renderer supplies no tenant/actor/approval.

## 9 · Accounting / GL semantics (certified, unchanged)

No accounting rule was invented. D5 books **no** GL of its own — it refuses the ungoverned in-place adjustment and routes to the credit note (`creditNoteIssueLines` — Dr Revenue + Dr Tax Payable / Cr AR, balances to zero, cumulative-capped) / debit note. The redirect target's compensating, balanced GL is proven by an S60 pin (Dr Revenue 20 / Dr Tax 3.6 / Cr AR 23.6 on a 20@18% credit note). The payment-reversal GL (D4) and the domain-approval accounting (D8–D11) are undefined and memo'd — nothing guessed.

## 10 · Idempotency evidence

D5 is idempotent by construction: re-saving the SAME economic values on an issued invoice is a no-op (not a change) — pinned. The sanctioned adjustment inherits the credit-note idempotency (deterministic entry number + issued-note immutability, certified S59 D2). The broader command-lane idempotency (durable journal) is unchanged.

## 11 · Tenant-isolation evidence

Unchanged and intact — every finance store is tenant-scoped; the invoice/credit-note modules read/write under the bound scope; S60 adds no cross-tenant path. Proven by the existing enterprise/tenancy suites (green) + the finance module suite.

## 12 · Original-record immutability evidence

The point of D5: a posted invoice's economic identity is now immutable through the edit door — `amount`/`taxRate`/`exchangeRate` cannot be silently rewritten; the original invoice stays as booked and any adjustment lands as a SEPARATE, referenced credit/debit note. Pinned by the three refusal tests + the draft-stays-editable negative control. (The D4 memo carries the payment-side immutability requirement — currently violated by the void-driven reversal — as its central blocker.)

## 13 · UI-to-command-spine evidence

D5's enforcement is at the module `validate` hook — the same layer the EnterpriseModuleUpdate door invokes — so the fence holds for the renderer edit form and any governed caller alike. The sanctioned path (credit/debit note) routes from the UI via the existing S45/S57 governed routing table (`EnterpriseModuleScreen` → `platform:command.dispatch`). S60 added no renderer code.

## 14 · Negative tests

Editing `amount` of an issued invoice → refused (directs to credit/debit note); editing `taxRate` of a partially_paid invoice → refused; editing `exchangeRate` of a paid invoice → refused. Negative controls proving the fence is NARROW: a draft invoice stays freely economically editable; a non-economic edit (notes) on an issued invoice is allowed; re-saving identical economic values is a no-op. (Fence false-positive guard: an omitted field is never treated as a change to 0 — only a field present in the payload is compared, mirroring the status guard.)

## 15 · Positive tests

The governed adjustment (a credit note referencing the issued invoice) issues and books balanced, compensating GL (Dr Revenue 20 / Dr Tax 3.6 / Cr AR 23.6) — the redirect target is real, not a dead end. 7 new S60 pins, all green first run.

## 16 · Full regression

Memory-safe focused (full 964-file main + UI + real-Electron runtime run on the Mac per the standing pattern): finance module suite **39 files / 290 passed** (was 38/283 in S59; delta = exactly the +7 S60 pins). The pinned `invoiceModule.test.ts` amountPaid-derivation behavior is intact (the fence is supplied-field-gated and runs before the payment derivation). Zero behavior change to any other module ⇒ the S55/S56/S57/S59 suites are behaviorally unchanged.

## 17 · Typecheck / build / lint

`typecheck:node` clean (production source). `typecheck:test` introduces zero new errors from the S60 test file (the pre-existing unrelated test-project drift is untouched). eslint on the two changed files → 0 errors. Build unaffected (additive validate branch). No packaging, no release promotion (per directive).

## 18 · Frozen-surface integrity

No frozen surface touched. `invoiceModule.ts` is non-frozen (gate-detector PROCEED). No FG gate required or taken. `baseline.json` and pre-existing untracked artifacts are not staged.

## 19 · Remaining YELLOW

DELETE-door soft-hide of an economically-active row (D6 — coupled to D4, memo'd); origin-fence extension for promoted keys (carried from S49); packed `.ts` sources. The issued-invoice economic-edit YELLOW carried since S46 is now **CLOSED** by the D5 fence.

## 20 · Remaining GRAY

Updater, SmartScreen, native-x64 (distribution — carried, untouched by S60).

## 21 · Remaining POLICY-BLOCKED

**7 items**, each with a filed memo naming the exact bounded slice and the minimum operator input: D4 (payment reversal record model), D6 (financial delete boundary — coupled to D4), D8, D9, D10, D11 (approval control-plane — threshold/role/SoD/dual-control mechanism + per-domain accounting), D12 (PO commitment lifecycle + ~18-file re-pin). D5 leaves the S59 POLICY-BLOCKED list; the count moves 8 → 7.

## 22 · Release impact

NONE this session (one additive validate fence, no packaging). D5 ships in the current governed behavior as a REFUSAL that redirects to an existing shipped command; the blocked items ship with their future bounded sessions.

## 23 · Per-decision disposition + FINAL

- **D4 · Clear-payment reversal:** POLICY-BLOCKED — reversal record model + compensating GL + SoD undefined; existing GL reverses via the original's void status (conflicts with immutable-original). Memo filed.
- **D5 · Issued-invoice economic adjustment:** GREEN — implemented + certified. Economic-field edit fenced on posted invoices; redirected to the governed credit/debit note; 7 pins.
- **D6 · Financial delete boundary:** POLICY-BLOCKED — coupled to D4 (payment redirect target absent). Memo filed.
- **D8–D11 · Approval control-plane:** POLICY-BLOCKED — no threshold/hierarchy/config/multi-step/immutable-decision-record; per-domain thresholds, roles, and accounting undefined. Bounded design + inputs in the memo.
- **D12 · PO commitment lifecycle:** POLICY-BLOCKED — approve/send commands absent; ~18-file goods-receipt re-pin; uncontrolled P2P redesign. Memo filed.

**No fake GREEN:** GREEN is claimed only for D5, backed by 7 passing pins over real stores + the real credit-note GL. Every undefined-record-model, new-authority-hierarchy, and P2P-redesign item is POLICY-BLOCKED with a filed memo naming its bounded slice and minimum required input, per the S60 STOP conditions. No accounting invented; no certified invariant weakened; no packaging. STOP.
