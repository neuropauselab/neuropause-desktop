# ERP — SEAM #1: INVENTORY LEDGER → GENERAL LEDGER BRIDGE

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `b34ba16`
**Nature:** first end-to-end ERP foundation slice, chosen by architecture mapping. Additive; reuses existing
patterns; no frozen surface touched; no existing GREEN gate affected.

---

## WHY THIS SLICE FIRST (architecture mapping result)

NeuroPause already ships a genuinely deep, real ERP — **106 enterprise modules** on one framework (declarative
descriptor + `EnterpriseRecordStore` + hooks), inheriting RBAC, tenant scope, audit, timeline, renderer
broadcast and generic CRUD/action IPC. Two independent maps confirmed the **physical spine** (an append-only
stock-movement ledger where balance = Σ movements, reservations, reorder→PR, ledgered production orders, BOM
explosion) and the **financial spine** (a real double-entry GL with AR/AP auto-posting, FX, periods) are each
real domain engines — not UI mockups.

The gaps are the **seams between physical events and their financial/planning consequences**, and the mapping
ranked the operational-movement → GL bridge (inventory value / COGS / WIP) as the single highest-leverage missing
foundation: *"the seam the entire Profitability tail hangs on."* Both halves existed — the movement ledger, and
the Phase-6 posting rules (`erp/postingRules.ts`) that derive balanced Dr/Cr lines — but they were joined only
through hand-entered document lines that nothing populated, so **stock could move with no GL effect, or a GL value
could be posted that did not match the ledger.** This slice closes that seam at the point stock actually moves.

## WHAT WAS BUILT (reuse, not reinvent)

`enterprise/modules/inventory/inventoryGlBridge.ts` (new):
- **`deriveMovementGlPostings(movement, movementId)`** — a pure function that maps a valued stock movement to one
  balanced `GlDerivedEntry`, keyed `MOV-<movementId>`, using the movement's OWN quantity × unit cost:
  - `receive` → Dr Inventory / Cr GRNI (reuses `deriveGoodsReceiptPosting`)
  - `issue` → Dr COGS / Cr Inventory (reuses `deriveCogsPosting`; refuses with no unit cost — never a partial
    cost of sale)
  - `production_consumption` → Dr WIP / Cr Inventory (reuses `deriveMaterialIssuePosting`)
  - `production_output` → Dr Finished Goods / Cr WIP (reuses `deriveProductionCompletionPosting`)
  - `adjustment` → Dr/Cr Inventory ↔ Inventory-Adjustment, sign following the movement quantity (reuses
    `deriveInventoryAdjustmentPosting`)
  - `return` → Dr Inventory / Cr COGS (reverses cost of sale)
  - `transfer` / `reservation` / `reservation_release` → **no GL effect** (internal move / commitment)
- **`postMovementToGl(movement, id, status, ctx)`** — ensures the stock/production control accounts exist
  (`ensureStockAccounts`, idempotent) then posts via **`applyGlDerivedEntries`** — the exact proven, non-frozen
  GL seam invoice/payment already use (idempotent on `entryNumber`; posts through the real journal module's
  governed `post`, which owns the balance guard, period-close guard, posted-entry immutability and reversal, so
  there is still exactly one accounting engine). Void movements are skipped (reversal is a separate governed seam).

`enterprise/modules/inventory/stockMovementModule.ts` (wiring): the movement `onChange` reconciler — which
already re-derives product stock and runs auto-reorder — now also calls `postMovementToGl`, **contained in a
try/catch** so a GL failure (or the GL module simply not being wired) can never unwind the physical ledger write
or product reconcile. This matches the module's existing advisory-seam discipline (auto-reorder is contained the
same way) and the evidence-must-not-block-the-action rule.

## DISCIPLINES KEPT (nothing weakened)

- **Idempotent** — one journal entry per movement (`MOV-<id>`); `applyGlDerivedEntries` skips an existing entry
  number, so re-firing `onChange` (an update) never double-posts. *Tested.*
- **Balanced or nothing** — every derived entry has debits === credits > 0, or no entry is produced; a movement
  with no resolvable value posts nothing (an honest gap beats a plausible-wrong number). *Tested.*
- **Non-blocking / fail-closed** — the physical movement and reconcile stand first; the GL post is advisory and
  contained. With the GL module not wired the bridge no-ops and the movement still records. *Tested.*
- **Tenant-scoped** — posts through `ctx`; the journal store denies an unscoped write and filters by resolved
  scope, so a movement in tenant A posts only into tenant A's ledger. *Tested.*
- **Audit / evidence** — the journal `create` + governed `post` emit the framework's lifecycle audit + platform
  event + broadcast, unchanged.

## TRANSACTION-GRAPH TAIL NOW CLOSED (with real numbers)

Goods Receipt (`receive`) → Dr Inventory / Cr GRNI · Sales issue/delivery (`issue`) → Dr COGS / Cr Inventory ·
Material issue (`production_consumption`) → Dr WIP / Cr Inventory · Finished goods (`production_output`) → Dr FG /
Cr WIP. So the "→ Raw Material Inventory / … / Finished Goods / … / Accounting / Profitability" tail of the ERP
graph now produces real, balanced ledger entries from the real physical events — inventory value and gross margin
become obtainable from the books. These fire from the domain actions that already move stock (goodsReceipt post,
shipping/order ship, production consume/complete), which are already wired to IPC and the UI, and the posted
entries read back through the existing **finance journal / ledger-account** module UI.

## TESTS

`enterprise/modules/inventory/inventoryGlBridge.test.ts` — **16/16 pass**:
- Pure derivation (10): each movement type → correct Dr/Cr accounts + amounts, keyed on the movement; every entry
  balances; internal moves produce `[]`; an issue with no unit cost produces `[]`; zero quantity produces `[]`.
- Integration (6), through the REAL create/update handlers + real modules (products + stock-movements + journal +
  ledger-accounts): a `receive` posts a balanced Dr Inventory 50 / Cr GRNI 50 entry **posted** through the real
  governed journal + account-balance readback; a sales `issue` posts Dr COGS / Cr Inventory; idempotency (an
  update never double-posts); a `transfer` posts nothing; GL-not-wired → the movement still records, no throw; and
  tenant isolation (tenant A's entry is invisible under tenant B's scope).

| Check | Result |
|---|---|
| New bridge tests | **16/16** |
| All enterprise-module tests (the `onChange` blast radius — every module that posts movements + finance GL) | **88 files / 660 passed** |
| `tsc` node | **exit 0** |
| ESLint (bridge + test + wiring) | **clean** |
| `electron-vite build` | **exit 0** |

Regression scope note: the full ~9,500-test main suite exceeds this sandbox's per-command cap, so the blast-radius
subset was run instead — the registry-wide `onChange` change affects only modules that post stock movements plus
the finance GL, all under `enterprise/modules/` (660 green). A pre-implementation search confirmed **no existing
test coupled movements to the GL**, so nothing depended on the prior "no GL effect" behaviour; non-enterprise code
(renderer, AI, tenancy core, CST, IPC) was not touched.

## FILES CHANGED

```
NEW  src/main/enterprise/modules/inventory/inventoryGlBridge.ts        derive + post a movement's GL entry
NEW  src/main/enterprise/modules/inventory/inventoryGlBridge.test.ts   16 pins (pure + integration)
MOD  src/main/enterprise/modules/inventory/stockMovementModule.ts      onChange posts the movement to the GL (contained)
```

No frozen surface touched; no readiness gate status changed (this is additive ERP capability, not a gate).

## KNOWN LIMITATIONS / NEXT SEAMS (ranked, per the architecture map)

This closes seam #1's core (movement → GL). Deliberately NOT in this slice, recorded as the ERP roadmap:
- **#2 Domain-action posting parity** — some lifecycle actions emit `updated` rather than `status_changed`; the
  movement-triggered path above covers the goods flows, but the Phase-6 document adapter still keys on status.
- **#3 MRP execution path** — the net-requirement engine is real but terminates in counts; persist planned orders
  as draft PRs / production orders (reuse the auto-reorder drafting seam).
- **#4 QA disposition → inventory** — pass/fail/quarantine/rework posting movements (quarantine warehouse) + a
  receipt/output gate.
- **#5 Production costing** — derive actual cost from the order's own consumption/output movements; post variance.
- **Void/reversal of a posted movement entry** — a governed reversal seam (skipped here; voids don't post).
- Multi-line receipts/dispatches (this slice posts per movement, which is the ledger's unit of truth).

## MAP TO THE LEVEL-2 AI-NATIVE-ERP TARGET (operator's architecture)

NeuroPause is already the "system of intelligence + orchestration" shape the Level-2 diagram describes, and this
slice strengthens its **system-of-record** core: canonical entities = the 106-module canonical model above the
store; canonical API = the enterprise-module IPC (auth → authorize → validate → business rules → approval →
transaction → event); event bus = the platform EventBus every mutation fans out to; RBAC+ABAC = the per-module
permission + tenant/amount-scoped authz; workflow/approval = the CST governance kernel + approval gates; AI-agent
"propose-only, human-approves, controlled tools" = the Live Brain governance model (Brain proposes → governance →
execution → verification, never direct DB writes); immutable audit = ActionRecord + the append-only stores. The
`correlation_id` transaction-graph traversal is the natural next foundation (the typed-relationship layer already
links documents; a correlation id across the SO→…→INV chain would make "why is SO-1245 delayed?" answerable).
