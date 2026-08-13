# NeuroPause — Cross-Domain Relationship Engine

**Date:** 2026-08-09 · **Build:** `1.0.0-rc.15` · **Gate:** `typecheck` PASS · `lint` PASS · `test:release` **6,495 / 6,495 across 691 files, 0 failures** (desktop 6,010 / 640).

**Status: IMPLEMENTED — DEVICE VISUAL VERIFICATION PENDING.**

## The problem this solves

The enterprise modules already referenced each other. Nothing declared that they did.

Every cross-entity link in the codebase is an untyped `type: 'text'` field, and three incompatible conventions are in use simultaneously:

| Convention | Example | Fields |
|---|---|---|
| Display name | `finance-invoices.customer` = `"ABC Hospital"` | `customer`, `supplier`, `vendor`, `contact` |
| Business code | `sales-orders.product` = `"SKU-1001"` | `product` (SKU), `warehouse`, `productionOrder` |
| Record id, or id-or-number | `finance-payments.invoiceRef` = a record id **or** `"INV-1001"` | `*Ref`, `sourcePurchaseOrder`, `purchaseOrder` |

So an imported invoice carried the text `"ABC Hospital"` and the system had no idea which customer record that was. Nothing linked. There was no ambiguity to review because nothing was attempted.

## The trap that shaped the design

`EnterpriseRecordStore.search()` is a case-insensitive **substring** match across `title`, `tags` and the string form of *every* field. Resolving `"INV-1"` through it returns `INV-1`, `INV-10`, `INV-100`, and any record whose notes mention the invoice.

Using it would have produced a relationship engine that looks like it works and attaches payments to the wrong invoices. `relationshipResolver.ts` therefore builds its own exact index over the declared key fields and never calls `search()`. A test asserts the `INV-1` / `INV-100` case directly.

## Architecture

```
relationshipModel.ts      the missing DECLARATION — 24 relationships, real module ids + real field keys
relationshipResolver.ts   pure matching: index + ordered strategies (no I/O, fully testable)
relationshipStore.ts      persistence: resolved LINKS + a PENDING review queue
relationshipEngine.ts     orchestration: resolve after import, retry parked, apply decisions, build the graph
```

Six IPC channels (`dp:rel.*`), a Relationships tab in the existing Data Command Center, and a boot-time declaration check.

### Matching, strongest first

1. **`internal_id`** — the value *is* a record id. Confidence 1.
2. **`business_key`** — exact match on a declared key field (`customerCode`, `sku`, `poNumber`). Confidence 1.
3. **`normalized_key`** — same value ignoring case, spacing and punctuation. Confidence 0.97.
4. **`canonical_name`** — legal-suffix equivalence (`"ABC Hospital Ltd." ≡ "ABC Hospital Limited"`). **Never auto-applied.** Produces a proposal a person confirms.

**More than one candidate at any level means AMBIGUOUS.** Two customers whose names normalize identically are never disambiguated by list order.

### Similarity never touches money silently

Each relationship declares a `sensitivity`. On a `financial` link — invoice→customer, payment→invoice, bill→purchase order, PO→supplier — a similarity match is *never* offered as a resolution. It is surfaced as a decision with the explicit reason *"this link affects money, so it is never matched automatically."* A wrong one misstates who owes what.

### The record keeps its own truth

A resolved link is stored **beside** the record, not written into it. The reference field keeps what the source system said (`"ABC Hospital"`, `"PO-1042"`). Overwriting it with an internal id would destroy the evidence, break the export round trip, and make a wrong resolution unrecoverable. Undoing a bad link is deleting a row, not repairing data.

### Import order is irrelevant

An unresolved reference **parks** in the pending queue. Every import runs `resolveRecords` on what arrived and then `retryPending` over everything parked. Import invoices before customers and the invoices park; import the customers and the next pass links them.

**No duplicate target is ever created to satisfy a dangling reference** — a dedicated test asserts the customer module stays empty when an invoice references a customer that does not exist.

A **skipped** item is a recorded decision, and a later pass does not overrule it — asserted by test.

## Review UI

The Relationships tab distinguishes two states that a naive queue would conflate:

- **Needs a decision** (ambiguous) — candidates exist, each shown with *why* it was offered ("the company names are equivalent apart from their legal suffix"), not just a confidence rank. Actions: link to a candidate, or leave unlinked.
- **Waiting on data** (unresolved, no candidates) — nobody can act on this yet. It says so, states how many times it has been re-checked, and links itself when the target arrives.

Every decision is audited (`relationship.decided`, `relationship.skipped`) with the actor, both records and the source value.

## Authorization

| Channel | Permission |
|---|---|
| `dp:rel.overview`, `dp:rel.queue`, `dp:rel.graph` | `data:read` |
| `dp:rel.decide`, `dp:rel.skip`, `dp:rel.retry` | `data:import` |

Deciding which customer an invoice belongs to writes a business fact, so it carries the write right, not the read right.

## The boot check

A declaration naming a field that does not exist resolves nothing, forever, without erroring — the worst possible failure for this feature. `assertRelationshipsAreDeclarable` runs at boot against the **live** descriptors and logs every mismatch. A test proves the checker catches a bad declaration.

## Declared coverage (24)

Order-to-cash: quote→customer, order→customer/contact/product/quote, shipment→order/product, invoice→customer/order, payment→invoice/customer.
Procure-to-pay: PO→supplier/product, receipt→PO/supplier/product, bill→vendor/PO.
Manufacturing: execution→product. CRM: customer→lead/contact, contact→lead. People: employee→manager. Projects: project→customer.

**Deliberately absent:** warehouse codes, work centres, machines, BOMs, budgets, vendor contracts, bank statements and pick lists have no target module in this build. Declaring them would create links that can never resolve, so they are not declared.

## Test coverage — 31 engine + 11 renderer

Prefix collision (`INV-1` vs `INV-100`), refusal to choose between equal candidates, similarity-never-silent-on-money, import order irrelevance, no-duplicate-creation, idempotency under repeated passes, decision auditing, refusal of a decision pointing at a deleted record, skip persistence, both traversal directions, broken-edge display, and an unwired target module.

## What is NOT done

| Item | Status |
|---|---|
| Device visual verification | **PENDING** — not launched since this work |
| Line-item-level relationships | Not started. ERP document lines are child records; linking them is a separate pass. |
| Medical Device Manufacturing Pack | **NOT STARTED** |
| Relife Ortho tenant + synthetic dataset | **NOT STARTED** |
| Batch/lot traceability, Quality Center, Document Control | **NOT STARTED** |

Nothing here justifies calling the Relife pilot ready.
