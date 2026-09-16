# DECISION REGISTER — S88 Reorder Governance Policy Closure

**Purpose.** Close the five operator-policy decisions S87 identified, so a future governed reorder-execution command can be built without inventing business semantics. **Method (HARD RULE): invent nothing.** Every closure below is grounded in an EXISTING project decision or mechanism (ERP Session 3 MRP planned-orders seam, the auto-reorder seam, the durable command journal, the existing PR lifecycle) or in the standing constitution (CLAUDE.md §2 deny-by-default; no new capability). Where a closure would have required an invented business value (a threshold, a dedup window, an override bound, a supplier rule), it was NOT selected — instead the deny-by-default / no-new-capability position is recorded, which invents nothing.

S88 implements only the **pure decision layer** (`reorderExecutionPolicy.ts`), which decides what a future command WOULD draft and creates nothing. **Execution is deliberately NOT wired** (no command, no PR creation, no PO, no supplier award, no automatic/background reorder) — that is a separate later gate.

---

## D1 — Recommendation identity / lineage

**Decision (CLOSED by reuse).** Identity is a deterministic purchase-request number per `(S86 report number, sku)`: `PR-REORDER-<reportNumber>-<sku>` (`reorderExecutionRequestNumber`). Lineage to the causing report/build reuses the existing Session-1 correlation spine (`childCorrelationMeta`).

- **Existing decision reused:** ERP Session 3 MRP seam — `mrpPurchaseRequestNumber(reportNumber, sku) = 'PR-MRP-<reportNumber>-<sku>'`, documented in source as *"the idempotency key: the same requirement always maps to the same PR number."* S88 applies the identical pattern to S86 report rows.
- **Rationale.** An S86 decision report has a stable, immutable `reportNumber`; each row is SKU-keyed. `(reportNumber, sku)` is therefore a stable per-row identity that does not treat a NEWLY generated report as the same opportunity (a new report has a new number → a new deterministic PR number). No new identity engine.
- **Affected command(s):** the future `CreatePurchaseRequestFromReorderRecommendation` would set the PR `requestNumber` to this value (exactly as MRP sets it).
- **Affected UI:** none in S88 (execution not wired).
- **Approval / audit / idempotency:** the number is also the D2 idempotency guard and the audit lineage key.
- **Migration:** none.
- **Unresolved dependencies:** none.

## D2 — Recommendation-scoped idempotency

**Decision (CLOSED by reuse).** One recommendation (report row) drafts **at most one** PR, enforced by THREE existing guards in depth: (a) the Session-3 deterministic-number guard — if `PR-REORDER-<reportNumber>-<sku>` already exists in any non-deleted state, do not draft again; (b) the durable command journal's `(tenantId, idempotencyKey)` replay dedup (Session 18) — an exact command replay returns the committed result, never a second effect; (c) the auto-reorder open-supply position guard — a drafted PR counts as open supply, so a re-assessment finds the position restored and refuses (D3).

- **Existing decisions reused:** Session 3 (`deriveMrpDraftRequests` skips a requirement whose deterministic number already exists), Session 18 (`durableCommandJournal` keyed `${tenantId}::${idempotencyKey}`), the auto-reorder seam (open-supply idempotency).
- **Interactions (source-grounded):**
  - *Replay / same idempotency key* → journal returns the committed result (no second PR).
  - *Application restart* → the journal is durable; a committed command replays across restart.
  - *Recommendation regeneration* → a new report has a new number → a new deterministic PR number, so the number guard does not block it; but guard (c) does — the first PR's open supply restores the position, so the new report's row re-assesses to not-triggered and fails closed (D3). No duplicate procurement for the same genuine need.
  - *New recommendation after inventory state legitimately changes again* (e.g., the first PR was rejected/cancelled → no longer open supply, position still low) → guards (a) new number and (c) position both allow it, which is CORRECT: the need is genuinely open again. This is exactly the existing auto-reorder behavior.
- **Why not a generic request idempotency key:** a generic per-command key would let two distinct operator confirmations of the same row create two PRs. The Session-3 deterministic `(report, sku)` number prevents that at the document level. Reused, not invented.
- **Migration / unresolved:** none.

## D3 — Stale-recommendation / re-open semantics

**Decision (CLOSED by deny-by-default + existing engine).** At execution time, re-run the existing pure `assessReorder` against the LIVE product + open supply. The row is executable ONLY if it is still triggered AND the recommended quantity is unchanged; otherwise **fail closed** (`stale-not-triggered` / `stale-quantity-changed`) and the operator must regenerate the recommendation before executing. No auto-regeneration (no autonomous procurement).

- **Existing decisions reused:** the auto-reorder and MRP seams both RE-ASSESS against current state at draft time (never against a cached figure); CLAUDE.md §2 #8 deny-by-default; the S87 spec's own requirement that a safe implementation must fail closed if the recommendation is no longer valid.
- **Rationale.** An immutable report is a point-in-time reading; the live position can change before confirmation. Re-assessment against the current substrate is the existing mechanism; failing closed on any change is deny-by-default (no tolerance invented — the match is exact).
- **Must a new recommendation be generated before execution?** Yes, when stale — regeneration is required; S88 does not auto-generate.
- **Affected command / UI / audit:** the future command calls `deriveReorderExecutionDecision` first and refuses a non-`executable` result; the refusal reason is surfaced verbatim. No PO/GL effect.
- **Migration / unresolved:** none.

## D4 — Quantity override policy

**Decision (CLOSED as: no override; quantity immutable).** The reorder quantity is the canonical `assessReorder.suggestedQuantity` carried by the S86 report row, immutable. The operator may not change it at execution; a live change makes the recommendation stale (D3), not overridable.

- **Existing decisions reused:** the MRP and auto-reorder seams draft the canonical computed quantity with NO override mechanism; the S87 spec's fallback (*"If overrides are not defined, keep the quantity immutable"*); deny-by-default / no-new-capability.
- **Consequences (none, because no override):** no min/max, no override authorization, no override audit reason, no approval recalculation, no lineage break, no idempotency change — because there is no override. Introducing an override later (with min/max/authorization/audit) is an explicit future operator decision, not part of S88.
- **NOT invented:** no MOQ, EOQ, or order-multiple rule (those fields do not exist on the product master; S86/S87 confirmed).
- **Migration / unresolved:** an override capability, if ever wanted, is a separate ruling.

## D5 — Supplier-at-reorder policy

**Decision (CLOSED by existing PR lifecycle).** A reorder PR draft carries **no supplier**. Supplier selection remains the existing PO-conversion decision. Reorder execution therefore allows a PR without a supplier and never silently selects one.

- **Existing decisions reused:** S87 source-proof — `PURCHASE_REQUEST_DESCRIPTOR` requires only `requestNumber`+`status` (no supplier field); the auto-reorder and MRP seams draft PRs with no supplier; supplier/vendor/RFQ/contract selection is a PO-stage concern.
- **Rationale.** The product master has no per-SKU preferred-supplier / lead-time / MOQ link (S86/S87). Inventing supplier selection is forbidden; deriving a supplier silently is forbidden. The existing lifecycle already defers supplier to PO conversion, so no decision is missing for the DRAFT.
- **Affected command / UI / audit:** the future command drafts a supplier-less PR; the operator (or a later gate) selects the supplier at PO conversion, where the existing supplier/vendor/RFQ/contract mechanisms apply.
- **Migration / unresolved:** a per-SKU preferred-supplier master field (to pre-fill a supplier) is a separate future data-model + operator decision — NOT part of S88.

---

## Summary

| Decision | Outcome | Grounded in (existing) | Invented value? |
|---|---|---|---|
| D1 Identity/lineage | `PR-REORDER-<reportNumber>-<sku>` + correlation spine | Session-3 `mrpPurchaseRequestNumber`; Session-1 correlation | No |
| D2 Idempotency | deterministic-number guard + journal replay + open-supply | Session 3, Session 18, auto-reorder seam | No |
| D3 Stale | re-assess live; fail closed; regenerate if stale | auto-reorder/MRP re-assessment; deny-by-default | No |
| D4 Quantity override | none — immutable canonical quantity | MRP/auto-reorder; spec fallback; deny-by-default | No |
| D5 Supplier | PR draft without supplier; supplier at PO | existing PR lifecycle; S87 source-proof | No |

**All five closed by reuse — zero business values invented.** S88 implements the pure decision layer only; execution stays unwired. The future execution gate would compose: `deriveReorderExecutionDecision` (refuse unless `executable`) → the existing `CreatePurchaseRequest` command through the governed spine (S87) with the deterministic `requestNumber` + correlation lineage, `procurement:manage`, durable journal, `PurchaseRequestCreated`, outbox, audit. AI remains advisory and can never execute this directly (CLAUDE.md §13).
