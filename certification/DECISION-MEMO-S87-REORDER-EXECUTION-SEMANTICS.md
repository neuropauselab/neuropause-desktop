# DECISION MEMO — S87 Governed Reorder EXECUTION: policy matrix, source-wins findings, and the STOP determination

**Outcome: STOP at decision-readiness.** A reorder-recommendation-*driven* governed execution command is **NOT policy-complete**. The generic governed PR-draft primitive already exists and is safe, but promoting it into a *reorder execution* action requires recommendation-identity, recommendation-scoped idempotency, and a stale-recommendation policy that the repository does not define. Per the S87 HARD RULE and CLAUDE.md §2 (deny-by-default; no policy fabrication; a recommendation is evidence, never permission), those undefined semantics are **not invented**; the branch stays blocked and S86 decision-readiness remains the terminal.

This is a discovery/governance gate whose correct result may be "do not build." It is.

## 1. Canonical `runReorderCheck()` execution trace (source: `autoReorderSeam.ts`)

```
Product record (+ ctx: EnterpriseModuleActionContext)
  → runReorderCheck(productRecord, ctx, trigger)
      trigger 'movement' AND product.autoReorder !== 'on'  → no-op (returns ok)
      resolve Purchase Requests module via ctx.moduleFor    → absent → honest failure
      openSupplyForProduct(sku, open PRs + open POs)         → incoming supply
      assessReorder({product, openSupply})                  → { triggered, suggestedQuantity, note, ... }
      NOT triggered                                          → returns ok (no draft)
      triggered:
        autoReorderRequestNumber(...)                        → PR number
        requestsModule.hooks.validate({ requestNumber, department:'Inventory',
            requester: manual? ctx.actor() : 'auto-reorder', product: sku,
            quantity: assessment.suggestedQuantity, priority, status:'draft', reason })
        requestsModule.store.create(...)                     → PR DRAFT
        ctx.emit(requestsModule, 'created', request)         → lifecycle event
```

Downstream side effects of the DRAFT: none economic. A PR draft creates no PO, moves no stock, posts no GL. It counts as **open supply**, which is the ONLY idempotency: the next assessment sees the position restored and stays quiet. Approval → PO conversion → budget control (FW-5) all happen later, through their own governed actions.

**Two entry points, both already governed:** the product `reorderCheck` action (`productModule.runAction`, RBAC `inventory:manage`, tenant-scoped, audited) and the movement reconciler (`stockMovementModule`, auto path, `autoReorder:'on'` only). Neither is a renderer-to-store bypass. `reorderCheck` is **not** in `GOVERNED_ONLY_ACTIONS`, so it is reachable from the renderer through `enterprise:module.action` today, gated by `inventory:manage` + tenant + audit.

## 2. Source-wins findings

- The governed **PR-draft primitive already exists** in the command spine: `commandBus.ts` case `CreatePurchaseRequest` → forces `status:'draft'` → full flow (envelope validation → principal-derived tenancy → `authorize('procurement:manage')` → durable journal idempotency → `EnterpriseModuleCreate` → `PurchaseRequestCreated` event → outbox → audit → compensation soft-delete on commit failure). `PERMISSION_FOR_COMMAND.CreatePurchaseRequest = 'procurement:manage'`; `EVENT_FOR_COMMAND.CreatePurchaseRequest = 'PurchaseRequestCreated'`.
- A **PR draft requires no supplier and no cost.** `PURCHASE_REQUEST_DESCRIPTOR` marks only `requestNumber` and `status` `required: true`; `product`/`quantity` optional; there is no supplier field. Supplier and cost enter downstream at PO conversion.
- **S85 (`inventory-reorder-recommendation`) and S86 (`inventory-reorder-decision`) expose no `actions` and no `runAction`.** They are pure immutable-snapshot read modules. The framework action handler refuses any action on a module without a matching `runAction`/`actions` entry (`"Unknown action"`), so a decision report is structurally non-executing.
- **No renderer surface** wires a recommendation or decision row to PR creation. The S86 module renders through the generic read-only module screen.
- **Quantity source is `assessReorder.suggestedQuantity`** (S85/S86). Demand trend, lead time, MOQ, order multiples, and EOQ do **not** modify it (S85/S86 confirmed: demand is context; the other fields do not exist on the product master).

## 3. Execution-policy matrix (source only; nothing invented)

| # | Question | Source answer | State |
|---|---|---|---|
| 1 | Who may execute a reorder recommendation? | `CreatePurchaseRequest` requires `procurement:manage`; `reorderCheck` product action requires `inventory:manage` | **DEFINED** (differ by path) |
| 2 | Does creating the PR require approval? | No — a PR is created as `draft`; approval is a separate downstream action | **DEFINED (no)** |
| 3 | Which approval chain applies? | The PR→PO conversion uses the approval engine + `DEFAULT_SPEND_POLICY` + budget control (FW-5), downstream — not a gate on draft creation | **DEFINED (downstream)** |
| 4 | How is estimated order value calculated? | S86: `suggestedQuantity × product.purchaseCost`; not consumed by PR creation | **DEFINED (informational)** |
| 5 | Missing purchase cost? | S86 marks `SUPPLIER_DATA_MISSING`; a PR draft does not require cost | **DEFINED** |
| 6 | Missing supplier info? | PR draft has no supplier; supplier chosen at PO stage | **DEFINED (not required for draft)** |
| 7 | Supplier selection required before PR creation? | No source path links a product to a preferred supplier (no master field) | **DEFINED (no) / UNAVAILABLE data** |
| 8 | Is MOQ enforced? | No MOQ field or logic anywhere | **UNDEFINED / absent** |
| 9 | Order multiples enforced? | None | **UNDEFINED / absent** |
| 10 | EOQ used? | None | **UNDEFINED / absent** |
| 11 | Demand trend modifies reorder quantity? | No — context only (S85/S86) | **DEFINED (no)** |
| 12 | Lead time used? | No lead-time field or logic | **UNDEFINED / absent** |
| 13 | Operator override the suggested quantity? | The generic `CreatePurchaseRequest` takes quantity from payload (any value); no reorder-specific bound exists | **UNDEFINED (policy)** |
| 14 | Operator select a supplier? | Not at PR-draft stage; no product→supplier link | **UNDEFINED / UNAVAILABLE** |
| 15 | Execute the same recommendation twice? | The generic command dedups only identical replays (same idempotencyKey); two distinct confirmations create two PRs | **UNDEFINED for a recommendation** |
| 16 | Idempotency identity? | Durable journal keys on `(tenantId, idempotencyKey)`; there is no recommendation-scoped key | **DEFINED at command level; UNDEFINED at recommendation level** |
| 17 | Can one recommendation create multiple PRs? | Nothing prevents it — there is no recommendation identity to dedup on | **UNDEFINED → unsafe without policy** |

## 4. Defined vs undefined — the decisive split

**DEFINED and safe today:** a *generic, operator-initiated* governed PR-draft creation (`CreatePurchaseRequest`), with tenant/actor/RBAC/idempotency-key/journal/event/outbox/audit/compensation. Drafting paper is harmless; the economic gate is the downstream PO conversion, which already has its policy.

**UNDEFINED (inventing them is forbidden):**
- **Recommendation identity / lineage.** S85/S86 are regenerated immutable reports; a row is `(reportId, sku)` with no stable, addressable recommendation entity a PR can bind to. A lineage link needs a new data model.
- **Recommendation-scoped idempotency.** "One recommendation → at most one PR" requires an identity (above) and a dedup rule (per-SKU? per-day? per-report? what if the position legitimately drops again after the first PR is fulfilled or cancelled?). All undefined.
- **Stale-recommendation policy.** Between report generation and operator confirmation the canonical position can change. Re-running `assessReorder` at confirmation is *mechanically* possible, but the *decision* (refuse / recompute quantity / warn-and-proceed) is undefined.
- **Quantity-override policy.** Whether and how far an operator may deviate from `suggestedQuantity` is undefined.
- **Supplier at reorder time.** No product→supplier link exists.

## 5. Why the existing command is not, by itself, a safe *reorder execution*

Reusing `CreatePurchaseRequest` as a reorder-execution surface (auto-populating quantity from an S86 row and letting the operator click "Create Purchase Request") would, without the undefined policies above, mean: **two clicks = two PRs** for the same need, with **no stale re-check** of the position. That is exactly the duplicate-PR and stale-data hazard the S87 spec (§3, §6, §7) requires to be closed. Closing it requires the recommendation identity + recommendation-scoped idempotency + stale policy — all undefined. So the generic primitive is a safe *generic* PR creator but **not** a safe *reorder execution* without inventing policy.

## 6. Determination

Governed reorder EXECUTION as a recommendation-driven action is **NOT SAFE TO BUILD** at this time, because the material execution policies (recommendation identity, recommendation-scoped idempotency, stale-recommendation handling, quantity override) are **undefined** and CLAUDE.md §2 + the S87 HARD RULE forbid inventing them for GREEN. **S87 stops at decision-readiness.** No new command, no new action, no UI execution surface, no frozen change, no FG-S87 token. The execution path remains blocked (proven by test + real-Electron journey): S86/S85 modules are non-executing and generating a decision report creates no PR.

## 7. Remaining operator decisions (to unblock a future execution gate)

An operator ruling on each of the following would make a governed `CreatePurchaseRequestFromReorderRecommendation` command buildable (it would then reuse the existing spine verbatim — `procurement:manage`, durable journal, `PurchaseRequestCreated`, outbox, audit — exactly like `CreatePurchaseRequest`, adding only the ruled identity/idempotency/stale checks):

1. **Recommendation identity** — what uniquely identifies "a reorder recommendation" for lineage + dedup (e.g. `(tenant, sku, asOfDate)`, or a persisted recommendation entity).
2. **Recommendation-scoped idempotency** — one recommendation → at most one open PR; the exact key and the re-open condition (fulfilled/cancelled).
3. **Stale-recommendation policy** — on confirmation, re-assess the live position; refuse / recompute / warn.
4. **Quantity-override policy** — may the operator deviate from `suggestedQuantity`, and within what bounds.
5. **Supplier at reorder time** — remains out of scope for a draft (supplier is a PO-stage decision); confirm this stays true.

Until then: S86 decision-readiness is the terminal; the S86 surface stays read-only for execution.
