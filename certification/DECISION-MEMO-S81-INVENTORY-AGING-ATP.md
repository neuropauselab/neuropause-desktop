# DECISION MEMO — S81 Inventory Aging + ATP: method & policy assumptions

**Class:** design/policy record for the S81 governed inventory-aging + ATP intelligence.
**Discipline:** no business-specific threshold, valuation rule, reservation-priority or allocation policy is invented. Where a choice was unavoidable it is a *reuse of an existing repo convention* or a *universal, stated assumption*, recorded here for the operator.

## Canonical sources reused (no duplicates created)

| Need | Authoritative source reused |
|---|---|
| On-hand / reserved / available per SKU | `productComputedStock` / `calculateCurrentStock` / `calculateReservedStock` (`packages/shared/types/inventory.ts`) — the SAME deltas the product master already materializes. `available = on-hand − reserved`. |
| Immutable stock ledger | `inventory-movements` (`stockMovementModule`) — the single source of truth; never mutated by aging/ATP. |
| Reservations | `reservationModule` (posts `reservation` / `reservation_release` ledger movements). |
| Incoming | open `procurement-orders` (`purchaseOrderModule`) + `parsePurchaseOrderLines` for multi-line POs. |
| Aging snapshot pattern | `apAgingModule` (Finance → Payables Aging) — the exact "immutable point-in-time snapshot via a pure derive fn" pattern, mirrored. |
| Tenant isolation / RBAC | `EnterpriseRecordStore` (`scopeOrDeny`) + module `permissions` — free for any module. |

## Decision 1 — Aging METHOD = FIFO physical-flow layers

To age on-hand from an immutable movement ledger, remaining stock is attributed to receipt layers **oldest-consumed-first** (standard FIFO physical flow); each surviving layer carries the age of its receiving movement. This is the only way to age on-hand from the ledger and is a **universal convention, not a business threshold**. It is orthogonal to the cost method — the repo values at **standard cost** (S10/S11), and physical-flow aging assumes FIFO *physical* movement regardless of the cost assumption, which is the near-universal default. **No valuation rule is invented** (the aging report carries quantities, not values).

## Decision 2 — Buckets = the repo's existing AP-aging 30-day cadence, adapted

`apAgingModule` already buckets by **current / 1–30 / 31–60 / 61–90 / 90+**. Inventory age has no "due date", so the AP "current vs past-due" split has no inventory meaning. The inventory buckets are the **same 30-day cadence with the same 90+ tail**: **0–30 / 31–60 / 61–90 / 90+**. Boundaries are inclusive at 30/60/90; strictly-older-than-90 is the tail. **No new threshold is invented — the cadence is reused** from an already-shipped repo module. If the operator later defines business-specific inventory buckets, they become an explicit policy input; nothing here hard-codes a business rule.

## Decision 3 — ATP = available + incoming

- `available = on-hand − reserved` (the product master's own definition; reserved is committed demand already netted).
- `incoming` = outstanding quantity on **open** purchase orders. **Open = status ∈ {approved, sent}** — the complement of the three unambiguous exclusions: `draft` (merely created — not available), `received` (already in on-hand via its receive movement — never double-counted), `cancelled` (dead). This does **not** invent a reservation-priority or allocation policy; it is the plain "committed-but-not-yet-received" set.
- `ATP = available + incoming`. Future sales-order demand beyond existing reservations is **not** subtracted — that would require an allocation/promising policy the repo does not define; reservations already capture committed demand. Recorded as an honest boundary, not silently assumed away.
- **No double counting:** received POs are in on-hand (excluded from incoming); reserved is netted from available; incoming is open-PO-only.

## Decision 4 — Granularity boundary: lot/serial

The authoritative stock ledger (`StockMovement`) carries **no lot/serial field** — lots and serials are separate modules (`lotModule`, `serialModule`) not linked on movements. Therefore ledger-derived aging/ATP is at **SKU + warehouse** granularity, which is the granularity the authoritative on-hand itself is defined at. **Lot/serial-level aging is NOT derivable from the current ledger and is honestly out of scope** (the directive's "where available" — it is not available at ledger level). Adding lot-level aging would require a lot dimension on the movement ledger (a separate frozen-adjacent change) and is recorded as a future Tier-2 item, not faked.

## Reconciliation invariant (tested)

Sum of per-warehouse on-hand (transfer-aware FIFO) **==** the authoritative product total (`calculateCurrentStock`). This proves the S81 warehouse-aware derivation never diverges from the product master. Pinned in `inventoryIntelligence.test.ts`.

## Nothing invented — explicit list

Not invented: inventory valuation policy · financial aging thresholds · reservation priority rules · allocation policy · safety-stock policy. Buckets and the incoming-status set are **reuses of existing repo conventions**; the aging method and ATP identity are **stated universal assumptions**. No operator value was fabricated; no STOP was required for correctness.
