# FG GATE — FG-ERP-S61-REVERSAL-REGISTER · production registration of the Payment Reversals module

**Status:** PRESENTED — awaiting the literal token. **No frozen file has been edited.** Per CLAUDE §2 #1–#2 and the FG-2 precedent, the non-frozen capability (module + GL handler + reconciler + governed command + bus route + D6 delete guard + full tests) lands first as its own green commit (the choreography checkpoint — a one-commit *declared-but-unregistered* gap, covered by this gate doc), then the two additive frozen lines land in an isolated frozen-only commit ON THE TOKEN.

## Why a gate is needed

`apps/desktop/src/main/enterprise/index.ts` is a FROZEN surface (`certification/frozen-surfaces.json`; `gate-detector.sh` → FROZEN). Registering the new `finance-payment-reversals` module in the production composition root requires an FG gate, exactly as FG-2 registered the capability handler in frozen `runtimeCore.ts`.

## The verbatim diff (two additive lines, no existing line changed)

**1. Import (beside the existing vendor-payment instance import):**
```
 import { vendorPaymentModule } from './modules/finance/vendorPaymentModuleInstance';
+import { paymentReversalModule } from './modules/finance/paymentReversalModuleInstance';
```

**2. Registration (immediately after the vendor-payment registration, in the finance block):**
```
   registerModule(vendorPaymentModule); // Finance → Vendor Payments (partial-capable AP settlement)
+  registerModule(paymentReversalModule); // Finance → Payment Reversals (S61: governed reversal of a cleared payment)
```

Both the imported singleton (`paymentReversalModuleInstance.ts`) and the module factory it wires are already committed (non-frozen); this gate only makes them live in the running app.

## Threat analysis (both directions)

- **What it adds:** one more tenant-scoped `EnterpriseRecordStore`-backed module in the registry. `registerModule` = `documentIntegration.attach` + `registry.register`; the reversal module is deliberately excluded from `DOCUMENT_SPECS` (like journal), so `attach` is a no-op. The boot invariant `assertEveryModuleScoped` will bind its store via `registry.bindScope` — proven, since the module is a standard scoped store.
- **What it cannot do:** the module holds ZERO authority of its own — its `validate` guards fail closed (original must exist in the caller's tenant via `scopeOrDeny`, be cleared, not bank-reconciled, not already reversed), and its `onChange` only books the compensating `${base}-REV` mirror + re-opens the document. It never mutates the original payment. Registering it grants nothing that the (already-committed) governed command + bus route do not already gate.
- **Reverse direction (NOT registering):** the command `ReverseCustomerPayment`/`ReverseVendorPayment` routes to `moduleId: 'finance-payment-reversals'` via `EnterpriseModuleCreate`; without the registration a live dispatch returns "module not found" (fail-closed — no partial effect). This is the declared-but-unregistered gap this gate closes.

## Verification plan (on the token)

1. Clean checkpoint → `freeze-baseline.sh` re-record → `verify-freeze.sh` INTACT #1 (committed).
2. Apply the two lines → full main suite green → the boot-invariant `assertEveryModuleScoped` passes (module scoped) → one isolated frozen-only commit.
3. Re-record → INTACT #2 (committed) → evidence doc recording both INTACT baselines + the token quoted verbatim.
4. Real-Electron smoke (Mac): a governed `ReverseCustomerPayment` reaches the registered module (no "module not found").

## The token to apply

```
AUTHORIZED: FG-ERP-S61-REVERSAL-REGISTER — enterprise/index.ts payment-reversal module registration, two additive lines (import + registerModule), per gate doc
```

Until this literal token is given, `enterprise/index.ts` stays byte-unchanged and the Payment Reversals module is present, tested, and command-routed but NOT live in the running app.
