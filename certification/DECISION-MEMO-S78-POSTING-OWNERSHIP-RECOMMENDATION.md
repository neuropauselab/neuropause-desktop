# DECISION MEMO — S78 · Posting-ownership (Session-2 A/B/C) — recommendation, NOT implemented

**Status:** RECOMMENDATION ONLY. No authoritative operator decision exists; per the S78 rule this memo recommends the safest option and **does not implement it**. Supersedes nothing; extends `ERP-SESSION2-POSTING-PARITY-DECISION.md` + the S77 §7 analysis with an explicit safest-option recommendation.

## The question

Which layer owns GL posting for documents where both a domain-action path and the document-adapter (`postOn`) path could post: **A** domain-action owns (adapter only gates approval), **B** adapter owns (`postOn` hooks), or **C** formalize the current split (adapter approval + domain posting).

## Measured current reality (source, not preference)

- Vendor-bill posting already has **ONE authoritative live owner** — the finance vendor-bill path (`handleVendorBillChangeForGl`); Session 13 **retired** the adapter `postOn.posted` leg (`documentSpecs.ts:87-97`) because the adapter keys `postOn` on the record-level status (always `active`), never the domain `posted`, so it never fired in production.
- The adapter's live role today is **approval gating** (`gatedStatuses` → `evaluateApproval`), which is real and enforced (PO, bill).
- So the de-facto current architecture is **already Option C**: adapter gates approval, domain path owns posting.

## Recommendation: **Option C (formalize the split)** — safest

Reasoning:
- **Least risk / no migration.** A and B both require moving live posting between layers; C ratifies what already runs and what every GL test already exercises. Moving posting is exactly the kind of change that risks a double-post or a dropped post.
- **B is structurally penalized.** The adapter's `postOn` keys on record-level status (`active`), not domain status — the documented reason the supplier-bill adapter leg never fired. Choosing B means reworking the adapter status model first.
- **A is close to reality but overreaches.** A says "adapter only gates approval" — true — but framed as a migration it invites touching documents that already post correctly. C captures the same end-state without a migration.
- **The real work C requires is a guarantee, not a move:** an invariant/pin that **no document may have two live posting owners** (a `postOn.posted` leg AND a domain GL owner for the same document), so a future document cannot silently reintroduce a second owner. That is additive and safe.

## What C would entail if the operator approves (still NOT done here)

- A single certification statement: "adapter = approval gate; the domain GL seam (`handle*ChangeForGl` / `applyGlDerivedEntries`) = sole posting owner," pinned by an invariant test asserting no module id in `DOCUMENT_SPECS` carries a `postOn.<domainStatus>` posting leg that duplicates a live domain GL owner.
- No behavior change (it ratifies current behavior) → the no-behavior-change proof is the existing GL suite passing unchanged.

## Dependent code paths (all options)

`erp/documentSpecs.ts`, `erp/documentAdapter.ts` (`postOn`, `guardStatus`), `enterprise/modules/finance/glPosting.ts`, the per-document `handle*ChangeForGl` owners (`handleVendorBillChangeForGl`, payment/invoice/receipt seams), `erp/postingRules.ts` accounts.

## Decision required from the operator

Confirm **Option C (formalize split)** — or select A/B with the understanding that both require a posting-owner migration first. **Nothing is implemented until the operator rules.**
