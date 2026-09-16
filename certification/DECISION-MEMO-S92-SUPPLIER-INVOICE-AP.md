# DECISION MEMO — S92 Reorder → Supplier Invoice → Three-Way Match → Accounts Payable (canonical AP reused; nothing invented)

**Outcome.** The S91 reorder-originated, POSTED Goods Receipt continues into the **existing** governed supplier-invoice → three-way-match → Accounts-Payable path with **zero production changes**. The path exists (S11/S12/S16/S25), is UI-wired, and the reorder Goods Receipt is a normal PO-sourced (goods) receipt. S92 is a certification/verification gate. No new AP engine, no second matcher, no invented accounting / matching tolerance / tax / currency / payment authority. **This is NOT a STOP** — every consequential financial rule the path needs is already DEFINED. No frozen change; no FG-S92 token.

## 1. STOP-check — is any consequential financial rule undefined? NO.

The S92 directive requires a STOP + memo only if the existing system does not define a consequential financial rule (matching tolerance, tax, currency, payment authority, AP posting). Source-wins discovery found **all of them defined**:

- **Three-way match** — `erp/threeWayMatch.ts`, the single pure engine (PO ↔ GR ↔ Bill), reused (never a second matcher). `DEFAULT_TOLERANCE` = { quantityAbsolute 0, pricePercent 0.01, priceAbsolute 0.05, overReceiptPercent 0.05 } — explicit, not invented.
- **Goods-bill resolution** — `finance/goodsBillMatch.ts` `evaluateGoodsBill`: the ONE place that resolves the match for both the `approve` gate and the GL relief. Received value is read back from the ACTUAL posted receipt movements (the GRNI really accrued).
- **AP posting / GRNI relief / PPV / tax** — `finance/glPosting.ts` `handleVendorBillChangeForGl` + `erp/postingRules.ts` (`deriveGoodsBillPosting`): approving a matched goods bill relieves GRNI and books the payable (Cr Accounts Payable), all idempotent, through the shared GL seam.
- **Payment authority** — SEPARATE (`PaySupplierInvoice`, S26). **S92 does not touch it** — the outcome is a payment-ready LIABILITY, never a payment.

Because every rule is defined, S92 implements/certifies what the source actually does; it invents nothing.

## 2. Canonical path (source-wins)

```
reorder Goods Receipt (posted; Dr Inventory / Cr GRNI accrued — S91)
  → operator drafts a Vendor Bill (supplier invoice) referencing the PO
        fields: billNumber, vendor, amount (subtotal), currency, sourcePurchaseOrder = PO, lines[{sku,quantity,unitPrice}]
        create is CRUD (operations:manage + validate); a named source PO must RESOLVE; NO payable booked
  → (ApproveSupplierInvoice COMMAND) vendor-bill `approve` action:
        guards: bill must be draft (at-most-once); if a goods bill (has sourcePurchaseOrder) run evaluateGoodsBill:
          NO_LINES / LINES_INCONSISTENT / NO_RECEIPT / BLOCKED / MISMATCH → HELD (stays draft, NO payable)
          MATCHED / PARTIAL → postable
        on postable: stamp approvedAt → onChange → GRNI relieved / Cr Accounts Payable booked ONCE
  → a payment-ready liability (settlement is the separate governed PaySupplierInvoice — NOT S92)
```

Sources: `vendorBillModule.ts` (validate + `approve`/`cancel` + edit-door marker fence + `onChange`→GL), `goodsBillMatch.ts`, `threeWayMatch.ts`, `postingRules.ts`, `glPosting.ts`, `commandBus.ts` (`ApproveSupplierInvoice`, S25).

## 3. The reorder-specific finding — an OPERATOR-INPUT boundary, not a gap (S88/S91 pattern extended)

A reorder recommendation is **SKU-level and supplies SKU + quantity + lineage only** (S85/S86/S88). The reorder PR carries no cost; the PR→PO conversion (`convertRequestToPurchaseOrder`) carries product + quantity + budget + lineage, and **no supplier and no unit price**. The canonical goods three-way match, however, needs:

- **Bill vendor = PO supplier** (else `threeWayMatch` BLOCKED — the wrong-supplier control);
- **PO ordered unit price** to compare against the bill price (the header-fallback order line reads `po.fields.unitCost`; absent ⇒ 0 ⇒ a real bill price MISMATCHes — the overcharge control);
- **Bill line items** (`sku, quantity, unitPrice`) — a goods bill with no lines is HELD `NO_LINES`.

These are the **same class of operator inputs S88 established for supplier and S91 for warehouse**: the reorder chain supplies SKU + quantity + lineage; **supplier, ordered unit price, and the supplier-invoice line items are operator inputs at the PO / invoicing stage.** The PO's `supplier` and `unitCost` are optional edit-door fields (the PO edit door fences only `status`/`convertedReceipt`), so the operator sets them on the draft PO; the invoice line items are entered on the bill. **No default supplier, price, or line is invented.**

The three-way match is therefore CORRECTLY FAIL-CLOSED for a reorder bill missing any input, and books NO payable:

| Missing operator input | State | Result |
|---|---|---|
| bill line items | `NO_LINES` | held, no AP |
| PO ordered price (no `unitCost`) | `MISMATCH` (price) | held, no AP |
| bill vendor ≠ PO supplier | `BLOCKED` | held, no AP |
| lines ≠ subtotal | `LINES_INCONSISTENT` | held, no AP |
| billed > received | `MISMATCH` (quantity) | held, no AP |

And it reaches Accounts Payable (booked exactly once) when the operator supplies vendor = PO supplier, PO `unitCost` = bill unit price, and bill lines matching the received SKU/quantity and summing to the subtotal.

## 4. Duplicate / idempotency / edit-door — DEFINED

- **At-most-once:** the `approve` action refuses a non-draft bill; the durable command journal dedups same-key replays. So AP is booked at most once — proven.
- **Edit-door fence:** `approvedAt`/`cancelledAt`/`paidDate`/`amountPaid` cannot be edited (validate refuses) — a generic edit cannot forge an approval or a payable. `sourcePurchaseOrder` must resolve to a real PO at create — the audit trail cannot be forged.
- **No payment:** S92 never dispatches `PaySupplierInvoice`; `amountPaid`/`paidDate` stay 0/empty; no vendor-payment record is created.

## 5. HARD RULE compliance

No accounting rule, matching tolerance, tax, currency, or payment authority invented; no duplicate infrastructure; no automatic invoice approval or payment. Every step (draft bill, set PO supplier/price, ApproveSupplierInvoice) is an explicit governed action. AI stays advisory (§13) — it holds no `operations:manage` path and cannot draft, approve, or pay. A consequential financial rule that WERE undefined would STOP here; none is.

## 6. Recorded characteristics + future operator-gated options (documented, NOT implemented)

1. **Reorder chain carries no supplier / price / line** — deliberately (S88/S91 pattern). A future operator-gated design option is to have the reorder recommendation/PR/PO carry a supplier, an ordered unit price, and a single line, so the goods bill matches with fewer manual inputs. This is a design change **rippling S88–S91** (PR/PO/GR shapes) and its own gate; not invented in S92.
2. **Vendor-bill create is CRUD** (the economic step is `approve`); the S46 origin fence is not applied to bill create/approve (they are governed at the module-action layer — RBAC + tenant + audit — and the economic invariants hold via the three-way match + edit-door fences). Fencing them to governed-only (reusing the S46 mechanism) is a future hardening option.
3. **Header-only over-receipt bound** and **PO approve/send governance promotion** — carried from S91, unchanged.

None blocks the S92 target (reorder GR → matched supplier invoice → AP booked once, fail-closed otherwise, never paid).
