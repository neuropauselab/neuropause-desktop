# NeuroPause — Batch / Lot Traceability

**Date:** 2026-08-09 · **Build:** `1.0.0-rc.15`
**Gate:** `typecheck:release` PASS · `lint:release` PASS · `test:release` **6,148 / 6,148 across 646 files** (desktop) — **0 failures**
**Status: IMPLEMENTED — DEVICE VISUAL VERIFICATION PENDING.**

---

## The problem this solves, and the one it must not create

A lot is the unit a recall is executed in. Two questions have to be answerable
from records, at speed, on the worst day a manufacturer has:

- **Forward** — this batch is bad. *Where did it go?*
- **Backward** — this patient's device failed. *What went into it?*

A traceability system that **guesses** is worse than none, because it is
believed. So the governing rule of this implementation is: **every edge in the
graph is a record of something that happened, written by the operation that
performed it.** Nothing is inferred from a name that looks similar, nothing is
derived from a substring match, and an empty answer is stated as *"nothing has
been recorded"* rather than *"it went nowhere"*.

---

## Quantity: the invariant everything else rests on

A lot's quantity is **not a mutable number**. It is derived from one immutable
original and two monotonically increasing counters:

```
remaining = quantity − consumedQuantity − splitQuantity
```

There is no code path that sets `remaining`. Consumption and splitting each add
to their own counter and are refused when the result would exceed what is left.
That makes **over-consumption, double consumption and lossy splits arithmetic
impossibilities** rather than a list of bugs to be tested for individually.

Both operations pass through **one** gate, `canDraw`, because they compete for
the same material — checking them separately is exactly how a lot ends up
over-drawn by one of each.

Quantities are rounded to six decimals at every boundary. Lot quantities are
frequently fractional (kilograms of alloy, metres of wire), and in binary floats
`100 − 60 − 40` lands at `5.7e-15`, which would leave a lot eternally "partially
consumed" with a residue nobody can see or issue.

---

## The lifecycle state machine

Declared explicitly in `LOT_STATUS_TRANSITIONS`. Anything absent is refused with
a sentence naming what to do instead.

| From | May become |
|---|---|
| `created` | quarantined · released · blocked · expired · recalled |
| `quarantined` | released · blocked · expired · recalled |
| `released` | quarantined · blocked · partially_consumed · consumed · exhausted · expired · recalled |
| `blocked` | quarantined · released · expired · recalled |
| `partially_consumed` | quarantined · blocked · consumed · exhausted · expired · recalled |
| `consumed` | **recalled** |
| `exhausted` | **recalled** |
| `expired` | blocked · recalled |
| `recalled` | *(terminal)* |

Only `released` and `partially_consumed` are **consumable**. Material cannot be
drawn from a quarantined, blocked, expired or recalled lot — by consumption
*or* by shipment. That is the single most important refusal in the service.

### Three decisions worth defending

1. **`consumed` and `exhausted` are both "nothing left", and both exist.** The
   reason differs, and the reason is what an investigator asks first:
   `consumed` = the remainder was issued downstream; `exhausted` = the remainder
   was divided into child lots, so the material still exists under other lot
   numbers. Collapsing them loses the distinction between *used* and *renamed*.
2. **`consumed` and `exhausted` can still become `recalled`.** A recall
   routinely lands on material that has already been used — that is precisely
   the case traceability exists for. Refusing it would make the system unable to
   represent the most important event it will ever record.
3. **`expired` never returns to `released`.** Re-releasing expired material is a
   decision this software will not make representable by a status change.

**Marking a lot `consumed` by hand while material remains is refused**, naming
the remaining quantity. Otherwise the status silently disagrees with the
arithmetic — and the quantity is evidence, not a display value.

---

## Expiry

Computed at read, never stored. A lot with **no expiry date is never expired**;
`isLotExpired` returns false rather than treating missing data as a hazard. A
great many devices — instruments, most metal implants — have no expiry at all,
so empty is the common case, and the UI says *"no expiry recorded"* rather than
leaving a blank a reader will fill in with their own assumption.

The **Expired** view shows lots whose date has passed *whether or not anyone has
run the transition*. A view of only already-marked lots would be a list of work
already done, not work outstanding.

---

## Split

`planLotSplit` plans; `LotService.split` applies. Quantity conservation is
checked as an equality, so after the plan is applied
`original = remaining + consumed + Σ children` holds by construction.

- Splitting 100 into 60 + 40 leaves the parent `exhausted`.
- A partial split (100 → 60 + 10) leaves 30 in the parent, `partially_consumed`.
- **Moving 100% into ONE new lot is refused.** Renumbering a lot is not a split;
  it severs the link between a lot number and the material it identifies while
  looking like an ordinary operation.
- Duplicate child numbers, reuse of the parent number, zero/negative/unnamed
  parts, and any total exceeding what remains are refused — and a refused split
  leaves the lot **byte-identical**, asserted by test.

Children inherit product, dates, warehouse, supplier, `parentLotId`,
`sourceLotId` (the whole chain's origin) and **the parent's disposition**.
Splitting quarantined material is refused outright at the `canDraw` gate, so it
can never produce material that looks free to use.

**Write order is children first, parent last.** A crash between the two leaves
orphan child lots — visible, investigable, and conservative — rather than a
parent debited for children that do not exist, which would silently lose
material from the system.

---

## Merge: deliberately unsupported

**Lot merge is not implemented, and will not be.** The reason is exported as a
constant so the UI, the service and the test all quote the same sentence, and
`md:lot.merge` exists as a channel that *always refuses* — so a caller reads the
reason instead of inferring that the feature is merely unbuilt. The refusal is
audited.

> Merging lots A and B into C asks the system to answer *"which inputs produced
> this unit?"* with *"one of two sets, we no longer know which"*. For a device
> that goes into a person, that is the one answer traceability must never give:
> a defect traced to A's raw material would force the recall of everything in C
> including material that was never at risk, and a defect confined to B would be
> indistinguishable from one in A.

Everything merge is usually reached for is already representable:

| Intent | Representation |
|---|---|
| Combine several lots into one output | A manufacturing order with multiple input lots and one output lot. The output's backward trace lists every input. |
| Store several lots together | They share a warehouse. Storage location is not identity. |
| Ship several lots on one shipment | One shipment, many lot links. |

---

## The traceability graph

```
Raw Material Lot ──┐
                   ├→ Manufacturing Order → Finished Goods Lot ─→ Warehouse
Raw Material Lot ──┘                                            ─→ Shipment → Customer
                                                                            → Sales Order
```

### Edges, and the operation that writes each

| Kind | Orientation | Written by |
|---|---|---|
| `lot_of_product` | lot → product | `createLot`, import replay |
| `lot_supplied_by` | lot → supplier | `createLot`, import replay |
| `lot_derived_from` | **child → parent** | `split` |
| `mo_consumed_lot` | **order → lot** | `consume` |
| `mo_produced_lot` | order → lot | `createLot` with an order, import replay |
| `lot_stored_in` | lot → warehouse | `createLot`, `moveToWarehouse`, import replay |
| `lot_shipped_in` | lot → shipment | `recordShipment` |
| `shipment_to_customer` | shipment → customer | `recordShipment` |
| `shipment_for_order` | shipment → sales order | `recordShipment` |

If you cannot name the operation that writes an edge, the edge does not belong
in the graph.

### Traversal

Two edge kinds point **against** the flow of material, because they are written
from the side that owns the fact: a child lot knows its parent, and a
manufacturing order knows what it consumed. Direction is expressed as a single
xor over that set, so forward and backward are provably mirror images and cannot
drift. Following those two the same way as the rest is the classic traceability
bug — it reports a child's parent as the child's destination, and answers *"where
did this raw material go?"* with the order that ate it and then nothing else.

`lot_of_product` and `lot_supplied_by` are **context, not flow**. They appear on
a lot's detail but are never traversed: following `lot_of_product` would walk
from one lot to its product and then to every other lot of that product — a
catalogue listing wearing a trace's clothes.

Traversal is breadth-first with an explicit visited set, a depth cap (12) and a
node budget (5,000). A rework loop (lot → MO → lot → MO) or a mis-imported cycle
**terminates**, asserted by test. A walk stopped by either limit reports
`truncated: true` rather than presenting a partial answer as complete.

### Scope notes

Every trace carries a plain-language statement of what was searched, because an
empty answer is ambiguous in the worst possible way:

- *"nothing has been recorded yet … this is not a statement that the material went nowhere"*
- *"N traceability records exist in this workspace, and none of them touch this item"*
- *"N recorded steps across M items … nothing here is inferred from a name that looks similar"*

### Edge store

Append-only, idempotent, tenant-scoped on read.

- **No update, no delete.** A trace whose history can be edited answers a recall
  with whatever someone last typed. The single permitted mutation is attaching
  provenance to an edge that already exists — evidence added, never a fact
  changed, and never overwriting provenance already there.
- **Idempotent on `(tenant, kind, from, to)`.** A re-run import or a retried IPC
  call yields one edge. Without it, re-importing a shipment file would double
  every lot's apparent destinations.
- **Tenant filtering happens in the store**, not in its callers. A cross-tenant
  leak in a traceability graph is one customer being told about another's
  shipments.

---

## Integration with what already exists

### Inventory — the existing ledger, not a second one

Lot receipt, consumption, transfer and shipment post through
`postStockMovement`, the same seam Sales and Procurement use. No second
inventory engine exists.

Posting is **last and non-fatal**. A manufacturer may keep its device catalogue
here and not in `inventory-products`, and an actor may hold `medicalDevice:lot.write`
without `inventory:manage`. Neither may unwind a batch record. The lot operation
has already succeeded; the integration reports its own outcome rather than
pretending. **No phantom inventory product is ever created** to make a posting
succeed — asserted by test.

### Manufacturing

`consume(lotId, qty, manufacturingOrderId)` records `mo_consumed_lot`;
creating a lot with a `manufacturingOrderId` records `mo_produced_lot`. Input
lots → production → output lot is therefore a real path in the graph, walked in
both directions by the E2E test.

### Relationship engine

Four declarations added to `RELATIONSHIPS`:

| Key | From field | To |
|---|---|---|
| `mdLot.product` | `md-lots.productCode` | `md-products.productCode` |
| `mdLot.manufacturingOrder` | `md-lots.manufacturingOrderId` | `manufacturing-orders.orderNumber` |
| `mdLot.warehouse` | `md-lots.warehouseId` | `inventory-warehouses.code`/`name` |
| `mdLot.supplier` | `md-lots.supplierId` | `procurement-suppliers.name` |

All four are `operational` — none states who owes what — and **none sets
`allowNameProposal`**: a lot's product is identified by an exact catalogue code,
and "close enough" is the wrong answer to *"which device is this batch?"*.
Import order is irrelevant; an unresolved reference parks and links itself when
its target arrives. No duplicate target is ever created to satisfy a dangling
reference.

### Data Command Center — the existing importer, not a second one

Two canonical entities added to the ontology:

| Entity | Module | Risk | Why |
|---|---|---|---|
| `medical_device_product` | `md-products` | **medium** | Master data, expensive to unwind — but not money or payroll. Forcing explicit approval on every catalogue load trains people to approve without reading. |
| `medical_device_lot` | `md-lots` | **high** | A lot is the unit a recall is executed in. It is never written without a person explicitly approving. |

Synonyms cover the header names manufacturers' spreadsheets actually use
(`batch no`, `cat no`, `use by`, `exp date`, `part number`, …).

**The import normalization problem, and how it is solved.** The Data Plane
writes imported rows straight to a record store — deliberately, so a bulk load
cannot be blocked by a per-record hook. For every other module that is fine. For
a lot it is not: a row arrives with a lot number and a quantity and none of the
invariants this pack depends on. So the row becomes a lot in the module's
`onChange`, which the framework replays over every imported record: tenant
stamped, counters initialised, a status the state machine cannot interpret
replaced with `created`, the product resolved from its code, and the context
edges recorded so the lot is traceable the moment it lands. Re-running the
replay is a no-op — asserted by test.

### Provenance

Every trace edge can carry `{ planId, provenanceId }`, the identifiers the Data
Plane's provenance store is keyed by, so a user walks
**lot → edge → source file → sheet → row → original value**. Imported steps are
marked in the traceability UI. Provenance is written once and never overwritten.

---

## Permissions and audit

| Scope | Held by | Gates |
|---|---|---|
| `medicalDevice:lot.read` | Viewer and above | `md:lot.list`, `md:lot.get` |
| `medicalDevice:lot.write` | Manager and above | create, transition, split, merge, consume, move, ship |
| `medicalDevice:traceability.read` | Viewer and above | `md:trace.forward`, `md:trace.backward` |

Traceability is a **separate read scope** on purpose: support, quality and
regulatory staff must be able to ask *"where did this go?"* without holding any
right to release, block or consume a batch.

Every scope is checked twice — once by the secure bridge from the channel
declaration, once inside the service, because the service is also reachable from
the import path, which is not an IPC call.

**Audited:** `medicalDevice.lot.created`, `.status_changed`, `.consumed`,
`.split`, `.moved`, `.shipped`, `.merge_refused`. Each entry carries the actor,
the lot, and a summary a person can read (`"Split lot LOT-001: 100 kg into
LOT-001-A (60), LOT-001-B (40); 0 kg remain in LOT-001"`). The lot detail's
**Audit** section renders exactly these.

---

## Why lot writes bypass the generic CRUD path

The lot module's `validate` hook **refuses every renderer-originated write**,
with a message naming the Batch/Lot Center. The service writes through
`store.create` / `store.update`, which the framework — by its own long-standing
design, used by the stock-movement poster and every other reconciler — does not
route through `validate`.

The result: exactly one code path can change a lot, and it is the one that
enforces the state machine and the arithmetic. A generic record write takes a
bag of fields and stores it; for a batch that is not acceptable, because a batch
whose quantity can be typed over is a batch whose recall is a guess.

What remains reachable generically is **reads**, and record-level archival /
soft-delete. Soft-delete **retains** the record (status becomes `deleted`), so a
traceability answer is never destroyed by it, and it is audited like any other
module change. That is a real residual capability of a lot writer and it is
stated here rather than hidden.

---

## UI

**Medical Devices → Batch / Lot Center** and **→ Traceability**.

- **Views:** All · Quarantined · Released · Blocked · Expired · Recalled, with
  live counts. Released includes partially consumed.
- **Lot detail:** Identity · Quantity (original / consumed / split / remaining,
  with a bar) · Dates · Warehouse & manufacturing · Lineage (parents, children,
  source) · Distribution (shipments, manufacturing orders) · Lifecycle (only the
  transitions the state machine allows) · **Not yet configured** · Audit.
- **Operations:** split (with a live arithmetic preview that shows the overdraw
  amount *before* the button is pressed), consume, move, ship, and every legal
  transition.
- **Traceability:** direction tabs phrased as the questions themselves — *"Where
  did this go?"* / *"What went into this?"* — a subject picker, grouped results
  by node type, and an indented step list. The scope note is always shown.

**Honest absence.** Quality status and Documents render as
*"Not yet configured — the Quality Center is not part of this build, so no
quality record exists for any lot."* An empty Quality card would read as *"this
lot has no quality history"*, which is a different and far more dangerous claim.
Merge shows its refusal reason in the same section.

---

## Tests — 138 added, 0 existing tests weakened or deleted

| Suite | Count | Covers |
|---|---|---|
| `medicalDeviceModel.test.ts` | 43 | State machine (every declared target is a declared status; recall is terminal; recall can land on consumed material; expired never re-releases), quantity algebra, split planning incl. the rename refusal, fractional residue, expiry, Lot Center views, both traversal directions, cycle termination, truncation, lot context. |
| `medicalDeviceService.test.ts` | 39 | Real stores. Creation guards, duplicate lot numbers, tenant isolation (reads, writes, traces), lifecycle + audit, over/double consumption, refusal to draw from quarantined/blocked/recalled, quantity survival across reload, split lineage + conservation + no-mutation-on-refusal, merge refusal, RBAC, inventory integration, edge idempotency, provenance non-overwrite, the full E2E scenario, and performance. |
| `medicalDeviceImport.test.ts` | 14 | The shipped synthetic dataset parses and is marked; ontology routing and risk; relationship declarations resolve against real descriptors; imported-lot normalization; a lots-before-products import that links on the second pass; re-import idempotency. |
| `medicalDeviceE2E.test.ts` | 6 | The whole journey through the **real channel contracts** with the real services, plus schema rejection of malformed payloads and the generic-write refusal. |
| `medicalDeviceAuthz.test.ts` | 7 | Every `md:` channel's exact scope, audit flags, and the read/write split. |
| `medicalDevicesModel.test.ts` (renderer) | 29 | Every judgement the panels make. |

### Failure testing

Duplicate lot number, unknown product, invalid transition, negative quantity,
over-consumption, double consumption, cross-tenant lot, cross-tenant product,
invalid split (over-total, duplicate numbers, parent-number reuse, zero parts,
rename), missing manufacturing order (parks, does not fail), missing source lot,
unauthorized modification, malformed IPC payload, unparseable regulatory
metadata, and a status the state machine cannot interpret. **All fail safely**,
with a message naming what to do instead.

### Performance

Measured against a synthetic dataset built in-test: **1,000 lots and >11,000
traceability relationships**.

| Operation | Bound asserted |
|---|---|
| Lot lookup | < 500 ms |
| Forward trace | < 5,000 ms |
| Backward trace | < 5,000 ms |

These bounds are **deliberately loose**. They assert that traversal is not
accidentally quadratic or unbounded. **They are not a published benchmark, and
no benchmark figure is claimed** — producing one would require a controlled
machine and repeated runs, neither of which this test has.

---

## Synthetic dataset

`examples/medical-device/` — 94 products, 302 lots, 161 shipment rows, plus a
README. **Every row is invented.** Every product code is prefixed `SYN-`, every
product name begins with `SYNTHETIC`, and every lot, customer, supplier and
order reference is prefixed `SYN-`, so if a file is ever imported into a
workspace holding real records the invented rows are identifiable at a glance.
No confidential or company information is used anywhere.

The data is shaped to exercise the states that matter: released/quarantined/
blocked lots, lots **with and without** expiry, mixed units (kg and pieces),
fractional raw-material quantities, manufacturing-order references, and
supplier/warehouse codes that do not resolve until a matching record exists — so
the relationship review queue has something real in it.

---

## What is NOT done

| Item | Status |
|---|---|
| **Device visual verification** | **PENDING.** The app has not been launched since this work. The production bundle builds cleanly — `electron-vite build` transforms 1,197 main-process modules and emits every renderer chunk including `MedicalDevicesView` (81 kB) — but nobody has looked at the screen. |
| DOM-level renderer tests | **NOT POSSIBLE IN THIS REPO** — no DOM testing library is installed. The panels' logic is fully covered by the view-model suite; their layout is not covered by anything. |
| Lot merge | **UNSUPPORTED BY DESIGN.** Documented above; the channel refuses with its reason and the refusal is audited. |
| Multi-tenant | **PARTIAL.** Isolation is implemented and tested; creating a second tenant is not yet possible. `TENANT_ID` in `instances.ts` is the single seam. |
| Quality Center (NCR / CAPA / inspection) | **NOT STARTED** — depends on this foundation. |
| Document Control | **NOT STARTED** — depends on this foundation. |
| Relife tenant, dashboard, pilot | **NOT STARTED** — depend on both of the above. |
| Serial-level traceability | **NOT IMPLEMENTED.** The product model carries `serialTracked`; no serial entity exists in this pack. |
| Shipment as a first-class module | **NOT IMPLEMENTED.** Shipments exist in the graph as referenced codes, recorded by `md:lot.ship`. There is no shipment record to open. |
| Trace export / recall report | **NOT IMPLEMENTED.** A trace can be read on screen; it cannot yet be exported as a document. |
| Automatic expiry transition | **NOT IMPLEMENTED.** Expiry is computed at read and surfaced in the Expired view; nothing runs a scheduled job to move lots to `expired`. |

Nothing here justifies calling the Relife pilot ready.
