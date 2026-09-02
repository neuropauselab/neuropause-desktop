# DECISION MEMO — O2C REVERSALS + SHIPMENT-DOCUMENT GOVERNANCE + PAYMENT STATUS EDITS

**Session:** ERP S45 · **Status:** OPEN — human decisions required · **Class:** business policy, NOT invented

Three related policies the S45 closure deliberately did NOT decide. Each is currently reachable through
the legacy `enterprise:module.*` doors (RBAC + module guards, but no command journal/idempotency/outbox).

## 1 · Reversal commands (invoice cancel, credit notes, refunds, write-offs)

- The invoice `cancel` action reverses real GL (`glPosting.ts` — cancel revokes the issued journal) and
  is renderer-reachable via the legacy action door.
- Every bus-route comment defers reversal to "a governed operation" that is **unmodeled**: no
  cancel/credit-note/refund/write-off member exists in `DomainCommandType`.
- **Decision required:** which reversal operations become governed commands, and what the reversal
  semantics are (full cancel only? partial credit notes? re-open a paid invoice?). Until decided,
  invoice `cancel` stays on the legacy door — recorded **YELLOW**, pilot operators instructed
  accordingly.

## 2 · Shipment-document lifecycle (warehouse-shipping ship/deliver; multiline dispatch)

- `ShipSalesOrder` is the governed **order-level** ship. Separate shipment DOCUMENTS exist
  (warehouse-shipping with COGS `postOn` bindings in `documentSpecs.ts`; `multiLineDispatchModule`)
  whose transitions are legacy-door only.
- **Decision required:** do shipment documents become governed commands, or is the order-level
  `ShipSalesOrder` the single governed shipment operation for the pilot (shipment documents recorded
  YELLOW / out of pilot scope)?
- **SHARPENED (S45 verify fleet):** the warehouse-shipping `ship` action not only posts COGS — it
  **hand-writes the linked sales order's status pending→fulfilled via direct `store.update`**,
  bypassing the order status machine (fulfill is only legal from `shipped`) and the S45 validate
  guard. This is the strongest reason the decision cannot stay open indefinitely: whichever way it
  goes, the cross-module direct write should route through the machine.

## 3 · Payment status edits (pending → cleared) and pending/void creation

- The governed `ReceiveCustomerPayment` force-sets `cleared` (Dr Cash / Cr AR). S45 routes the UI's
  **cleared creates** through it; **pending/void creates stay on the CRUD door** — measured: GL books
  only on cleared/void transitions (`glPosting.ts:3`), so a pending create has no GL effect.
- A later **pending → cleared EDIT** books GL through the legacy update door (the payments module has
  no `clear` action — edit is the only clearing path today).
- **Decision required:** should clearing become a governed command (`ClearCustomerPayment`)? Until
  decided: recorded **YELLOW**, defined behavior preserved.
- **CORRECTION (S45 verify fleet):** clearing-by-edit is NOT "the last GL-booking edit path" — editing
  an ISSUED invoice's economic fields (amount/taxRate/exchangeRate) also books GL adjustment entries
  through the legacy update door, and the DELETE door posts GL reversals. Both are deliberate
  `glPosting` behaviors; both are recorded in the matrix's adversarial-doors table and fold into this
  memo's decision scope (which economic mutations become governed commands vs stay defined-legacy).

## Safest temporary state (in force now)

All three remain exactly as the repository defines them — reachable, RBAC-guarded, module-guarded,
audited by the bridge — and are excluded from the pilot-critical GREEN set with operators informed.
Nothing was silently narrowed or invented.

## S46 UPDATE (still OPEN)

- **Payment clearing (§3): MECHANICALLY FENCED, policy still OPEN.** S46 closes the "create pending →
  edit to `cleared`" shortcut: the payment `validate` hook now REFUSES an edit-door transition INTO
  `cleared` (the GL-booking state), forcing clearing through the governed `ReceiveCustomerPayment`
  command. The policy question — should there be a distinct governed `ClearCustomerPayment` for an
  existing pending row — stays OPEN. Reversal/void of a cleared payment is untouched (this memo).
- **Warehouse shipment→order status (§2): CLOSED (technical).** S46 routes the warehouse `ship`
  action's linked-order status change through the canonical `orderActionPatch` table
  (pending→shipped→fulfilled), never a hand-set jump; an illegal/closed/cancelled order is refused.
  The remaining shipment-DOCUMENT governance question (do shipment docs become governed commands)
  stays OPEN.
- **Issued-invoice economic-field edits + issued-invoice DELETE: STILL OPEN, PILOT-FENCED.** These are
  DEFINED `glPosting` behaviors (drift-correction adjustments / reversal). S46 did NOT mechanically
  block them — blocking defined accounting behavior requires the reversal-policy decision. They stay a
  pilot fence (no economic-field edits / no deletes on issued invoices) until this memo is decided.
