# FG-S82 — Register the governed Spend Analytics + Supplier Risk modules

**Gate class:** additive module registration in the frozen composition root `enterprise/index.ts`.
**Exactly mirrors** how every ERP module in this repo was registered (apAgingModule, supplierPerformanceModule, inventoryAgingModule/atpModule under FG-S81…). **Frozen footprint = 3 additive lines in ONE frozen file. No other frozen surface.**

## The literal token required (nothing frozen changes without this, verbatim)

The operator must supply, on its own line and verbatim, the token
`AUTHORIZED: FG-S82 — register procurement-spend-analytics + procurement-supplier-risk modules in enterprise/index.ts (1 import line + 2 registerModule lines), per gate doc`
— this document deliberately does not start a line with that token, and the token is **ABSENT** as of this writing.

Silence / enthusiasm / a descriptive "looks good" is **not** consent — only the exact token above.

## The verbatim diff (additive only)

**File:** `apps/desktop/src/main/enterprise/index.ts` (FROZEN)

**(a) Import** — the two instances are exported from the NEW leaf file `procurementIntelligenceInstances` (deliberately separate from `procurementInstances`: the finance instance files import `procurementInstances` for the PO store, so importing finance back from there creates an ESM evaluation cycle that dereferences half-initialized singletons — measured as 24 collection-failed test files before the leaf split; the leaf sits outside the cycle). Add ONE import statement after the existing `procurementInstances` import block:

```ts
import { spendAnalyticsModule, supplierRiskModule } from './modules/procurement/procurementIntelligenceInstances';
```

**(b) Registration** — in `initEnterpriseModules`, immediately after the existing procurement block's `registerModule(supplierPerformanceModule); // Procurement → Supplier Performance (scorecard registers)` (line 1308):

```ts
  registerModule(spendAnalyticsModule); // Procurement → Spend Analytics (immutable per-supplier spend registers; reads POs + receipts + bills + payments, mutates nothing)
  registerModule(supplierRiskModule); // Procurement → Supplier Risk (existing calculateVendorRisk over real delivery evidence, >=60 cutoff; reads sources, mutates nothing)
```

No other line changes. No type, channel, contract, or runtimeCore change.

## Threat analysis (both directions)

- **What it grants:** two READ-ONLY register modules become reachable through the *existing* governed `enterprise:module.*` channels + the existing UI. Both are RBAC-gated `procurement:read` / `procurement:manage` and tenant-scoped by `EnterpriseRecordStore` (no new authority path, no new channel, no new tenant resolver).
- **Mutation surface:** none in procurement or finance — both modules only WRITE their own immutable register records (regeneration refused via the `generatedAt` fence). They READ the injected `purchaseOrderModule` / `goodsReceiptModule` / `supplierModule` / `vendorContractModule` / `vendorBillModule` / `vendorPaymentModule` stores; the read-only guarantee is pinned (every source store byte-identical after generation — unit + journey).
- **Cross-family imports:** `procurementInstances.ts` is UNTOUCHED. The finance vendor-bill/payment singletons are referenced only from the new LEAF file `procurementIntelligenceInstances.ts` (nothing inside the procurement↔finance evaluation cycle imports it), and even there only through LAZY store getters resolved at generation time. The existing `vendorBillModuleInstance → procurementInstances` import direction is preserved; the full main suite proves collection order is safe (the pre-split wiring failed 24 files by TDZ — caught and fixed before any commit).
- **AI reach:** none — no AI path writes these stores; AI may only read the resulting governed registers through existing read channels. The `summarize` hooks are deterministic (`model: 'none'`).
- **KPI seam:** the S82 observations/conditions splice (kpiIntelligenceInstance, NON-frozen) reads the same tenant-scoped stores and adds only existing-formula numbers; the open-PO-exposure condition ships UNCONFIGURED (null) and is fail-closed — it can never fire until an operator configures a limit.
- **Removing it:** reverting the 4 lines removes the two modules from the registry; nothing else depends on the registration (the instances are otherwise imported only by the non-frozen kpiIntelligenceInstance splice, which reads source stores, not the register modules).
- **Injection:** the modules resolve tenant only through the store's `scopeOrDeny` (server-side); the renderer supplies no tenant (pinned: identical create payload under two bound scopes yields isolated registers).

## Verification plan (after the token)

1. Change-control choreography: clean checkpoint → `freeze-baseline.sh` re-record → `verify-freeze.sh` INTACT #1 (committed) → apply the 3 lines → suites green → isolated frozen commit → re-record → INTACT #2.
2. gate-detector: `enterprise/index.ts` is the ONLY frozen file in the changeset.
3. Full main suite + full UI suite + typecheck node/web + eslint + build.
4. Real-Electron acceptance journey (`e2e/s82SpendRiskJourney.e2e.cjs`): supplier → PO approve/send → spend register (ORDERED/OPEN separate) → receiveGoods + post → lifecycle shift → vendor bill approve → INVOICED ≠ PAID → risk register (existing >=60 cutoff, open-bill exposure, printed reasons) → deterministic regeneration → sources read-only.
5. `certification/baseline.json` never staged; no push/tag/notarize; release track PAUSED.

## Non-frozen work already landed (this changeset, build-ready, gate-detector PROCEED)

- `procurement/procurementIntelligenceModel.ts` — pure spend analytics + supplier-risk register (existing formulas only; see DECISION-MEMO-S82-SPEND-RISK-POLICY.md).
- `procurement/spendAnalyticsModule.ts` + `procurement/supplierRiskModule.ts` (local module ids; lazy source-store getters).
- `procurement/procurementIntelligenceInstances.ts` — the two singletons in a cycle-safe LEAF file (`procurementInstances.ts` itself untouched).
- `analyticsPlatform/procurementIntelligenceSeam.ts` + the `kpiIntelligenceInstance.ts` capture splice (additive lines).
- `procurement/procurementIntelligence.test.ts` — 23 focused tests (green; full procurement suite 68/68 green).
- `certification/DECISION-MEMO-S82-SPEND-RISK-POLICY.md`.
- `e2e/s82SpendRiskJourney.e2e.cjs` (fails closed until this gate lands — by design).

**⛔ STOP: no frozen edit occurs until the exact FG-S82 token arrives. The token is ABSENT.**
