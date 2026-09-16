# DECISION MEMO — S97 F-S97-1: a POSTED stock movement could be deleted, silently corrupting on-hand stock (YELLOW, fixed)

**Classification: YELLOW — inventory-integrity gap (the ledger's declared immutability was enforced on EDIT but not on DELETE), reproduced and FIXED by extending the existing S61 economic-delete guard. Not RED (requires `inventory:manage` + same tenant), not GRAY (cause fully understood), not POLICY-OPEN (the immutability rule is declared by the module itself).**

## 1. Finding (reproduced first)

The stock-movement ledger is the AUTHORITATIVE inventory source: a product's on-hand / reserved / available are re-derived from the movement history by the reconciler, and `EnterpriseRecordStore.list()` excludes `deleted` records. So **soft-deleting a POSTED movement removes it from the ledger and silently changes on-hand stock.** Reproduced: create a product, post a `receive` of 100 (on-hand = 100), delete the movement via the generic delete door → **delete succeeded and on-hand dropped 100 → 0** (and the movement's already-posted GL is left orphaned).

## 2. Why it is a defect (not an undefined rule)

The stock-movement module DECLARES its own contract — *"the IMMUTABLE stock ledger — corrections by compensating movement, history never rewritten"* — and its `validate` hook ENFORCES it against EDITS (a posted movement's economic fields cannot be changed; the only status transition is → void). But the DELETE door was NOT guarded: `ECONOMIC_DELETE_GUARD` (S61 D6/S64) covered only cleared payments and payment reversals, not stock movements. So the module enforced its immutability on one door and left another open — a backdoor around a declared invariant.

## 3. Canonical fix (reuses existing architecture; strengthens an existing invariant)

One entry added to the existing `ECONOMIC_DELETE_GUARD` in `enterprise/framework/moduleRegistry.ts`, keyed on the stock-movement module id (`inventory-movements`), mirroring the payment guard: a `posted` stock movement cannot be deleted ("void it, which reverses the ledger and GL, or post a compensating movement"). `void`/`draft`/importer rows carry no live on-hand effect and are unaffected; the internal command-bus compensation uses `store.softDelete` directly (documented on the guard) and is unaffected. This **strengthens the module's own declared immutability invariant** and invents no policy — exactly the fix class the S97 directive permits ("fix only when the fix reuses the canonical architecture and strengthens an existing invariant").

## 4. Verification

- Reproduce → now refused: `inventoryWarehouseControlPlane.test.ts` "F-S97-1" asserts the posted-movement delete is refused and on-hand is UNCHANGED.
- Existing immutability (edit) unaffected; the void correction path stays open.
- Regression: inventory + warehouse 174/174; the whole `enterprise` + `platform/command` + `ipc/handlers` surface **1955/1955** (no test relied on deleting a posted movement).
- Not faking green: no assertion weakened; the fix closes a real corruption path.

## 5. Scope / bounds

Applies to posted stock movements only. It does not change costing, adjustment, cycle-count, shrinkage, reservation-expiry, or lot/serial policy (none invented — those remain POLICY-OPEN per the directive). It is the exact structural analogue of the S61 cleared-payment delete guard.

## 6. Files changed

Production: `apps/desktop/src/main/enterprise/framework/moduleRegistry.ts` (one guard entry). Test: `apps/desktop/src/main/platform/command/inventoryWarehouseControlPlane.test.ts`. Both non-frozen (gate-detector PROCEED).
