# DECISION MEMO — S74 · Maintenance cost → General Ledger (UNDEFINED, STOPPED)

**Status:** STOPPED — awaiting operator accounting policy. Nothing invented. This memo blocks ONLY the maintenance-cost→GL posting; the entire operational Maintenance workflow is GREEN and unaffected.

## What is defined and working (NOT blocked)

- **Parts consumption hits the Inventory Ledger.** A spare-part `consume` posts a real `production_consumption` stock movement through the shared `postStockMovement` seam (asserting `inventory:manage`), dropping on-hand stock. This is immutable, idempotent (already-consumed guard), and tenant-scoped. Measured live in `maintenance.test.ts` and the S74 journey pin.
- **Cost is captured on the work order and rolled into Maintenance History.** `laborCost` + `partsCost` are captured as work-order fields and summed into the immutable `maintenance-history` record's `totalCost` at `verify`. This is an operational cost record.

## What is UNDEFINED (the STOP)

There is **no GL journal** for maintenance cost. Measured from source (`glPosting.ts` has no maintenance / spare-part / `production_consumption` GL treatment; there is no repairs/maintenance-expense account anywhere in the shared chart). The following require operator policy and must NOT be invented:

1. **Repairs/maintenance expense vs capitalization.** Does a work order's cost expense to a maintenance/repairs account, or capitalize to the asset (betterment/overhaul)? The threshold and rule are undefined.
2. **Which GL accounts.** No repairs-expense, maintenance-expense, or WIP-maintenance account is defined in the canonical chart. Inventing account codes is forbidden (§2/§14 policy discipline).
3. **Spare-part consumption GL treatment.** The consumption debits the Inventory Ledger; whether it should also debit maintenance-expense (crediting inventory) at the GL — vs COGS, vs capex — is undefined.
4. **Labor cost source + posting.** WO `laborCost` is a captured field, not sourced from a costed labor rate, and has no journal.
5. **Downtime cost.** Downtime hours are recorded operationally; any financial charge for downtime is undefined.

## Recommendation

When the operator supplies the maintenance accounting policy (expense vs capex rule + threshold, the specific GL accounts, and the spare-part/labor posting treatment), wire a maintenance-cost posting through the **existing** GL seam (`applyGlDerivedEntries` / the finance journal path) at `verify` — the same durable, audited, idempotent path used by O2C/P2P — with a decision memo → implementation gate. Until then, maintenance is an operational + inventory-integral workflow with **no** GL effect, and that boundary is stated honestly (never silently treated as posted).

## Inputs needed from the operator

- Expense-vs-capitalize rule for maintenance work orders + the materiality threshold.
- The GL account(s): repairs/maintenance expense; and, if capitalizing, the asset/betterment account.
- Spare-part consumption GL treatment (which expense account is debited against the inventory credit).
- Whether WO labor cost posts to GL and, if so, the account + the labor-rate source.
