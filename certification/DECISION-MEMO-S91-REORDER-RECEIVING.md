# DECISION MEMO — S91 Reorder → Goods Receipt → Inventory (canonical receiving reused; nothing invented)

**Outcome.** The S90 reorder-originated Purchase Order enters the **existing** governed P2P receiving path with **zero production changes** — the path exists (S16/S23/S24), is UI-wired, and the reorder PO is a normal single-product PO. S91 is a certification/verification gate. No new receiving engine, no second inventory ledger, no new approval engine, no bypass. No frozen change; no FG-S91 token.

## 1. Canonical PO receiving path (source-wins)

```
reorder PO (status 'draft', PO-PR-REORDER-<report>-<sku>, sourceRequest = PR)
  → (approve)  draft → approved        [PO module action; poTransition]
  → (send)     approved → sent         [PO module action; optional — receiving allows approved OR sent]
  → operator assigns receiving warehouse on the PO (operational field edit)   ← see §5
  → (receiveGoods) convertPurchaseOrderToReceipt:
        guards: PO not draft/cancelled (approval-before-receive) AND no existing convertedReceipt (one GR per PO)
        creates ONE pending Goods Receipt (GR-PO-PR-REORDER-…, purchaseOrder = PO id, qtyOrdered/qtyReceived = PO qty)
        stamps PO: convertedReceipt = GR id, status 'received'
  → (PostGoodsReceipt COMMAND) goods-receipt 'post' action:
        guards: not already 'received' (one post per GR) AND PO not cancelled
        posts ONE valued `receive` Stock Movement (referenceRecord = GR) → inventory += qty, Dr Inventory / Cr GRNI
        stamps GR: status 'received', receiptMovement
  → inventory (derived from the immutable ledger — never edited)
```

Sources: `purchaseOrderModule.ts` (status machine + edit-door fences), `conversion.ts` (`convertPurchaseOrderToReceipt`), `goodsReceiptModule.ts` (`post` action + over-receipt + serialization), `inventoryGlBridge.ts` (`receive` → Dr Inventory / Cr GRNI), `postMovement.ts` / `multiLineMovements.ts` (the shared movement seam), `commandBus.ts` (`PostGoodsReceipt`).

## 2. Existing commands reused

- **`PostGoodsReceipt`** (command bus, durable journal — idempotency + `GoodsReceiptPosted` event + outbox + audit) is the governed **economic** step (inventory + GRNI). Reused verbatim.
- **PO approve / send** and **PO receiveGoods** are governed **module actions** (RBAC `procurement:manage` + tenant scope + audit) — no command-bus command exists for them (recorded, not changed). They create no economic effect (approve/send are status transitions; receiveGoods creates a pending document). The UI already renders these buttons on the PO detail (`module.actions`), and Post Receipt on the GR (GOVERNED table → `PostGoodsReceipt`).

## 3. PO approval / send status — DEFINED

The PO status machine is `draft → (approve) approved → (send) sent`, and `cancel` from any state except `received`/`cancelled`. **Receiving requires the PO to be approved or sent** — `convertPurchaseOrderToReceipt` refuses a draft/cancelled PO ("Approve or send the purchase order before receiving goods"), and the `post` ingress independently refuses a cancelled PO (S55). So **approval-before-receive is the defined, enforced gate**; S91 does not auto-approve or auto-send (each is an explicit operator action). No approval threshold/role/authority invented.

## 4. Over-receipt / duplicate policy — DEFINED (with a recorded single-product characteristic)

- **Duplicate protection (enforced):** one GR per PO (`convertedReceipt` idempotency token; the PO edit door refuses to clear/set it); one post per GR (the `received` guard refuses a re-post; the edit door refuses to hand-set/un-set `received`); the durable command journal dedups same-key replays. So an inventory movement cannot be double-posted by replay, restart, or a second receive — proven.
- **Over-receipt (multi-line):** cumulative received ≤ ordered per SKU across the PO's received receipts (S16/S24, serialized per (tenant, PO)). Fail-closed; no tolerance invented.
- **Recorded characteristic (NOT a new policy, NOT changed by S91):** the **single-product** receipt path (a header-only GR with no `lines` — which is what a reorder PO produces) posts `quantityReceived` directly and does **not** run the cumulative-vs-ordered check (that check operates on `lines`). In the reorder flow the quantity is set by the conversion to the ordered quantity and is received once (one-GR-per-PO + one-post-per-GR bound the effect), so the reorder path receives exactly what was ordered. Editing a *pending* single-product GR's `quantityReceived` upward before posting is therefore not cumulative-bounded on this path. This is a pre-existing property of the header-only receipt path, documented here; **imposing a single-product over-receipt bound is a receiving-policy decision + its own gate, not invented in S91.**

## 5. Warehouse at receiving — an operator input (recorded, consistent with S88 supplier)

A reorder recommendation is **SKU-level and carries no warehouse**, so the reorder PR/PO have no `warehouse`. The Goods Receipt requires a warehouse (it is the physical receiving location). Therefore the operator **assigns the receiving warehouse on the PO** (an operational field edit on the draft/approved PO — the edit door fences only `status`/`convertedReceipt`, so a warehouse edit is allowed) before receiving. This mirrors S88's finding that supplier selection is a PO-stage input the recommendation does not provide: the reorder chain supplies **SKU + quantity + lineage**; **warehouse (and supplier) are operator inputs at the PO/receiving stage.** No default warehouse is invented; the operator must choose one.

## 6. GR → GL is canonical (tested, not invented)

Posting the receipt books the **existing** Dr Inventory / Cr GRNI via the inventory GL bridge (valued at the product's standard cost). This is the defined goods-receipt accounting (S11/S16) — S91 tests it (it is expected, not "unrelated GL"). No vendor invoice, no payment, no unrelated GL, no COGS is produced by receiving.

## 7. Legacy-door status (recorded, not changed)

`PostGoodsReceipt`'s underlying `post` action and the PO `approve`/`send`/`receiveGoods` actions are governed at the module-action layer (RBAC + tenant + audit) via both the command bus (journaled, UI path) and the legacy `enterprise:module.action` door (they are not in the S46 `GOVERNED_ONLY_ACTIONS` fence). The economic invariants hold on both doors (document-level idempotency + the edit-door `received` fences prevent double-post and edit-based inventory mutation). Fencing these to governed-only (reusing the S46 mechanism) is a future hardening option, recorded here, not implemented.

## 8. HARD RULE compliance

No receiving policy invented; no duplicate infrastructure; generic status edits cannot mutate inventory (edit door refuses `received`); no auto-receive, no auto-pay. Each transition (approve, send, warehouse assignment, receiveGoods, PostGoodsReceipt) is an explicit operator action. AI stays advisory (§13) — it holds no `procurement:manage` path and cannot approve, receive, or post.

## 9. Remaining policy gaps (documented, not implemented)

1. **PO approve/send governance promotion** to command-bus commands + the S46 fence for PO/GR consequential actions (currently module-action governed).
2. **Single-product over-receipt bound** (the header-only receipt path does not cumulative-check; multi-line does).
3. **Warehouse/supplier defaulting for reorder POs** (currently operator inputs — deliberately, no default invented).
4. **PR/GR legacy-door fencing** (carried from S90).

None blocks the S91 target (reorder PO → GR → posted inventory + GRNI); each is a future operator-gated decision.
