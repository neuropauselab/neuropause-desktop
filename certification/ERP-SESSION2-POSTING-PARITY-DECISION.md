# ERP — SESSION 2: POSTING-PARITY FINDING + ARCHITECTURE DECISION (ESCALATED)

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `d26aee7`
**Status:** ⛔ **REPRODUCED (source-verified) · ESCALATED — a materially-consequential accounting decision.**
**No code changed.** Every available "fix" alters financial posting semantics or risks double-posting; per the
program's safety boundary (stop for a materially-consequential architecture decision) and CLAUDE.md §2 #4 (never
fake green) / the "never silently change business semantics" rule, this is surfaced for the operator's decision
rather than resolved unilaterally.

---

## THE FINDING (verified in source, not inferred)

There are **two independent GL-posting mechanisms**, and they overlap on one economic event while leaving another
unposted:

1. **Seam #1 — the movement→GL bridge** (`inventoryGlBridge.ts`, live since `f0ac6c1`). A goods-receipt `post`
   action posts a `receive` stock movement (`goodsReceiptModule.ts:108`), whose `onChange` posts
   **Dr Inventory / Cr GRNI** — and it **reuses `deriveGoodsReceiptPosting`**, the same derivation the document
   adapter uses.

2. **The Phase-6 document adapter** (`documentAdapter.ts`), attached to **every** module at boot
   (`enterprise/index.ts:1212`). Its `postOn` map (`documentSpecs.ts`) declares:
   - `procurement-receipts`: on status `received`/`completed` → `deriveGoodsReceiptPosting` → **Dr Inventory / Cr GRNI**.
   - `finance-vendor-bills`: on status `posted` → `deriveSupplierBillPosting` → **clears GRNI** for the matched value.

**The adapter's posting is DORMANT today**, because its gate only fires on `status_changed`/`created`:

```
documentAdapter.ts:356   if (event.action !== 'status_changed' && event.action !== 'created') return;
```

…but the status-changing domain actions emit **`updated`**, not `status_changed`:

```
goodsReceiptModule.ts:126   ctx.emit(self, 'updated', updated);   // GR reaches 'received'
vendorBillModule.ts:205     actionCtx.emit(self, 'updated', updated); // bill reaches 'posted'/'approved'
framework/moduleRegistry.ts:767   if (result.ok) await fan(module, 'updated', record); // ALL runAction results
```

`moduleRegistry.ts:767` is the root: **every custom action fans `updated`**, even when it changed the record's
status. So every status-driven `postOn` entry is unreachable through an action.

## THE TWO CONSEQUENCES

- **A latent double-post (do NOT "just fire on `updated`").** Because the bridge already posts Dr Inventory/Cr GRNI
  for the receipt (reusing the *same* derivation), making the adapter gate accept `updated` would post GRNI **twice**
  for one receipt (two entries, different references: `MOV-<movementId>` vs the adapter's receipt reference). The
  naive parity fix is a correctness regression.
- **A missing GRNI clear (a real gap).** `handleVendorBillChangeForGl` books Dr Operating Expense / Cr Accounts
  Payable and Dr AP / Cr Cash — it contains **no GRNI leg** (verified: no `GRNI` reference in its posting).
  The only thing that clears GRNI is the adapter's dormant `postOn.posted`. So **GRNI accrued at receipt is never
  relieved** in production, and expense may be recognized at bill time while inventory was already capitalized at
  receipt — an inconsistent perpetual-inventory model.

## WHY THIS IS AN OPERATOR DECISION (not a mechanical fix)

Resolving it means deciding **who owns each posting** — an accounting-model choice that changes the GL:

- **Option A — the movement ledger owns inventory/GRNI accrual (recommended).** Keep seam #1 as the sole
  Dr Inventory/Cr GRNI path; **remove** `procurement-receipts.postOn` (dormant today, so removing it is behavior-
  neutral now and forecloses the double-post footgun). Then give the vendor-bill GRNI *clear* a real, single home:
  either add a GRNI leg to `handleVendorBillChangeForGl`, or make the bill's posting flow through the adapter on the
  bill's actual emit. Net GL model: receipt Dr Inventory/Cr GRNI (bridge) → bill Dr GRNI/Cr AP → issue Dr COGS/Cr
  Inventory. This keeps "one accounting engine" and a coherent perpetual-inventory model.
- **Option B — the document adapter owns document posting.** Fix the event-key parity (fan `status_changed` when a
  runAction changes status, or have the adapter also consider `updated` guarded by a per-spec status check) AND
  remove the bridge's `receive` posting so GRNI accrues once. Larger blast radius (touches seam #1 + the framework
  emit contract) and re-opens seam #1's tested behavior.
- **Option C — defer.** Leave the adapter posting dormant; accept that GRNI is not cleared until a later slice. Not
  recommended — it leaves an untrue liability balance.

**Recommendation: Option A.** It is the smallest coherent change, preserves the tested seam #1 path, removes the
double-post footgun with a behavior-neutral deletion, and localizes the one real new posting (the GRNI clear) to a
single owner. But choosing A vs B changes which subsystem is the source of truth for document GL — a decision that
belongs to the operator.

## ROOT-CAUSE NOTE FOR WHICHEVER OPTION IS CHOSEN

`moduleRegistry.ts:767` fanning `updated` for status-changing actions is the underlying inconsistency: a `postOn`
map keyed by status can never be reached by an action. If Option B is chosen, the correct root fix is to fan
`status_changed` when a runAction's result changed `record.status` (comparing pre/post status), so the lifecycle
label matches reality — not to broaden the adapter's gate. This is itself a framework-contract change (many
`onChange` reconcilers branch on the action) and needs its own slice + blast-radius proof.

## WHAT WAS DONE THIS SESSION

Reproduced entirely from source (line citations above); confirmed the adapter is production-attached, the actions
emit `updated`, the bridge and adapter share `deriveGoodsReceiptPosting`, and the vendor-bill GL path has no GRNI
leg. **No production code changed** (correctly — the fix is a semantic decision). The program continues with the
next independent seam (MRP → persisted planned orders) while this awaits the operator's Option A/B/C ruling.
