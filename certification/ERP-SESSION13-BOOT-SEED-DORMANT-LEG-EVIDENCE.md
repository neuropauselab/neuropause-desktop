# ERP — SESSION 13: CONTROL-ACCOUNT BOOT-SEED HARDENING + DORMANT POSTING-LEG CLOSURE

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base:** Session 12 GREEN (`abd3a3a`)
**Label:** TEST-VERIFIED. No frozen surface touched; no accounting policy changed; canonical account numbers
unchanged. Two independent hardening items, each reproduce → fix → negative-control → regress.

---

## A · ROOT CAUSE

**Boot-seed fragility.** Finance CONTROL accounts (Cash 1000, AR 1100, AP 2000, Tax Payable 2100, Operating Expenses
5000, Revenue 4000, GST 1200, fixed-asset control) were seeded by `seedControlAccountsIfEmpty` **only when the chart
was completely empty**, called lazily from `applyGlDerivedEntries` on the first GL posting. Stock accounts are
ensured by a *different*, create-missing routine (`ensureStockAccounts`). So if the first GL activity on a fresh
install was a stock movement (goods receipt → inventory bridge → `ensureStockAccounts`), the chart became non-empty
*before* the control accounts were seeded; the empty-only seed then skipped forever, and a later cash/expense posting
silently refused (its control account could not resolve). Reproduced: after a stock receipt, a service bill's
`Dr Operating Expense 5000` posted **0** (account absent) — a genuine production ordering defect, not a
test-harness artefact.

**Dormant duplicate posting leg.** The ERP document adapter carried a `finance-vendor-bills` `postOn.posted` leg
(`deriveSupplierBillPosting`) that never fired in production — the adapter keys `postOn` on the record-level status,
which is always `active`, never the domain `posted` — a latent second posting owner for the vendor bill.

---

## B · PRODUCTION INITIALIZATION ARCHITECTURE

```
Application boot (per active tenant, contained/best-effort)
  → ensureCanonicalChart(ctx)          ← the ONE authoritative initializer
      → seedControlAccountsIfEmpty(ctx)  (finance control — empty-only, respects a customized chart)
      → ensureStockAccounts(ctx)         (inventory/production — create-missing, established policy)
  → full canonical chart ready BEFORE any transaction
Transactions begin (control accounts seeded before any stock activity can make the chart non-empty)
```

The fix seeds the control accounts **at boot, on the empty chart, before stock activity** — reversing the fragile
ordering — while **preserving** the on-posting `seedControlAccountsIfEmpty` empty-only policy. That policy is a
deliberate, pinned rule (`glAutoPosting`: *"a non-empty customized chart WITHOUT the canonical accounts — the seed
must not run, the post must not force"*): a posting that cannot resolve a control account PAUSES and retries rather
than forcing canonical codes onto a customized chart. Session 13 did **not** change that policy — it removed the
*ordering* that let stock activity prevent the initial seed. (`seedControlAccountsIfEmpty` was given a ctx-only
signature and exported so the boot initializer can call it; its empty-only body is unchanged.)

---

## C · FILES CHANGED

```
MOD  .../finance/glPosting.ts                 seedControlAccountsIfEmpty: ctx-only signature + exported; empty-only body unchanged; applyGlDerivedEntries call updated
NEW  .../finance/controlChart.ts              ensureCanonicalChart(ctx) — the authoritative boot initializer (control empty-only, then stock create-missing)
MOD  enterprise/index.ts                       best-effort per-active-tenant boot call to ensureCanonicalChart (mirrors the Session 8 recovery hook; contained)
MOD  erp/documentSpecs.ts                       RETIRED the finance-vendor-bills postOn leg (kept approval gating); removed the now-unused deriveSupplierBillPosting import
MOD  erp/erpIntegration.test.ts                 repointed the 2 P2P adapter tests to the pure supplier-bill derivation (live path proven in session11/12)
MOD  erp/documentAdapter.test.ts               repointed the 3 supplier-bill adapter tests to the pure derivation (adapter mechanism still covered by receipt/shipping/mfg tests)
NEW  .../finance/session13BootSeed.test.ts     7 pins: boot-init fixes fragility, idempotent, empty-only pause preserved, fresh-db E2E, tenancy, single posting owner
NEW  certification/ERP-SESSION13-BOOT-SEED-DORMANT-LEG-EVIDENCE.md
```

Frozen surfaces (`packages/shared` chart constants, `cst/`, `contracts.ts`, `channels.ts`, `runtimeCore.ts`,
`connectors/index.ts`, `executionGate.ts`) untouched. `certification/baseline.json` not staged.

---

## D · ACCOUNT INTEGRITY PROOF

Canonical numbers unchanged and re-pinned (Session 10 literal pins still green): AP 2000 · Tax Payable 2100 ·
Operating Expenses 5000 · COGS 5050 · GRNI 2150 · Inventory 1300 · WIP 1350 · Revenue 4000 · PPV 5920 · Production
Variance 5910. `ensureCanonicalChart` is idempotent — three consecutive runs converge to exactly one canonical set,
no duplicate codes, no growth after the first. Partial/corrupted handling is safe and non-destructive: the empty-only
seed **never overwrites or renumbers** an operator-customized account and never force-adds canonical accounts onto a
customized chart (proven: a chart with a single custom `2000 "Custom Payables"` stays exactly `['2000']` after
`seedControlAccountsIfEmpty`, name preserved). `ensureStockAccounts` remains create-missing/skip-existing.

---

## E · FRESH-DATABASE E2E PROOF (no harness-only seeding)

`BOOT (ensureCanonicalChart) → PO → goods receipt (Inventory/GRNI) → partial vendor bill → GRNI relief/PPV/AP →
second bill → payment` on a chart seeded **only** by the boot initializer:
- GRNI accrues 400 on the receipt; two 200 partial bills relieve it cumulatively → **GRNI reconciles to 0**;
- both bills paid → **AP reconciles to 0**, Cash (a control account) credited 400.
No test-harness `seedControlChart` was called — the boot initializer is the only seeding, proving the production path
stands on its own. Tenant isolation proven: each tenant gets its own chart via `ensureCanonicalChart`; tenant B
cannot see tenant A's accounts; A is unchanged by B's initialization.

---

## F · DORMANT-LEG ANALYSIS / REMOVAL

- **Why it could not fire in production:** the document adapter's `handleChange` reads the record-level status
  (`active`/`archived`/`deleted`), never the domain `posted`, so `postOn.posted` on `finance-vendor-bills` was
  unreachable on a running device (established Sessions 9–11).
- **What depended on it:** two `erpIntegration.test.ts` tests and three `documentAdapter.test.ts` tests drove it by
  hand-forcing `status:'posted'`. The pure `deriveSupplierBillPosting` derivation is *also* unit-tested directly in
  `erp.test.ts` and `session10GlOwnership.test.ts` (unaffected).
- **Safe to remove now:** yes — the live vendor-bill GRNI relief (goods bills, cumulative partial) is proven
  end-to-end in `session11VendorBillP2P` / `session12PartialP2P`, so removing the dormant leg loses no live behavior.
- **Change to live posting ownership:** none — it never posted live. Vendor-bill GL posting now has **one
  authoritative owner**: `handleVendorBillChangeForGl`. The `finance-vendor-bills` adapter spec retains its approval
  policy but carries **no** `postOn` (pinned: `spec.postOn` is `undefined`), so no dormant mechanism can become a
  second posting owner. The 5 dependent tests were repointed to the pure derivation (their invariants preserved); the
  adapter mechanism itself stays covered by the receipt/shipping/manufacturing adapter tests.

---

## G · NEGATIVE-CONTROL RESULTS

Each mutation fails the appropriate suite; each restore is byte-identical (sha256 verified, post-restore == baseline).

| # | Mutation | Failing suite |
|---|---|---|
| 1 | Disable boot control-account seeding | session13 (boot-init reproduction) |
| 2 | Remove the empty-only guard (force-add onto a customized chart) | session13 (customized-chart pause) + glAutoPosting |
| 3 | Change AP code (2000→9990) | session10 literal pin |
| 4 | Change GRNI code (2150→9991) | session10 literal pin |
| 5 | Reintroduce a vendor-bill posting leg (`postOn:{}`) | session13 single-posting-owner pin |

---

## H · REGRESSION COUNTS

| Suite | Result |
|---|---|
| `session13BootSeed.test.ts` | **7/7** |
| `glAutoPosting.test.ts` (the customized-chart pause pin) | **10/10** (unchanged behavior) |
| `session11VendorBillP2P` + `session12PartialP2P` | 16 + 11 |
| all `src/main/erp` (incl. erpIntegration, documentAdapter, erp, session10) | green |
| Blast radius — all `src/main/enterprise` | **1355** (Session 12 1348 + 7) |
| `src/main/erp` + `src/main/medicalDevice` | **220** (unchanged) |

---

## I · TYPECHECK / LINT / BUILD

`typecheck:node` + `typecheck:web` clean · `electron-vite build` clean · ESLint clean on all changed/new files.
Repo-wide `npm run lint` carries the same pre-existing test-file backlog noted since Session 10 (sandbox-vs-Mac
config); no regression from this change — confirm on the Mac.

---

## J · COMMIT SHA

`<filled at commit>` — one commit, `erp(s13): …`. The user pushes from the Mac.

---

## K · REMAINING RISKS / BOUNDS (honest)

- **Customized-chart policy deliberately preserved, not changed.** The on-posting seed stays empty-only, so a
  genuinely customized chart missing a canonical control account still PAUSES (glAutoPosting). Fully guaranteeing
  "stock activity can NEVER leave a control account unseeded" for a *customized* chart would require switching to
  create-missing on every posting — which changes that intentional policy (it would force canonical codes onto a
  customized chart). That is an operator decision, not taken here; flagged rather than assumed.
- **Per-tenant boot seed.** `ensureCanonicalChart` runs at boot in the active tenant scope (like the Session 8
  recovery hook). A tenant activated dynamically after boot whose very first activity is stock, before its own boot
  seed, would hit the empty-only pause; multi-tenant hosts should invoke `ensureCanonicalChart` per tenant on
  activation (the function is exported and idempotent for exactly that).
- **Boot seed is best-effort/contained** (a failure logs and never blocks boot), consistent with the existing
  migration-inventory and recovery hooks.
- Carried-forward Session 11/12 bounds unchanged (foreign-currency goods-bill PPV combines FX; mid-PO
  standard-cost-change cost-flow uses pool-average).

---

## L · STATUS: 🟢 GREEN

1. Control accounts are deterministically available after production boot (the `ensureCanonicalChart` boot hook). ✓
2. Stock initialization can no longer suppress finance-account initialization on a fresh install (control seeded
   first, at boot, before stock activity). ✓
3. Seeding is idempotent (3× → one canonical set, no duplicates). ✓
4. Partial/corrupted initialization is handled safely — never overwrites or renumbers; empty-only respects a
   customized chart. ✓
5. Canonical account numbers unchanged. ✓
6. Fresh-database receipt → bill → payment works with only the boot initializer (no harness seeding). ✓
7. GRNI/AP reconciliation remains correct (partial + full). ✓
8. Vendor-bill posting has one authoritative live owner. ✓
9. The dormant duplicate posting leg is removed (pinned absent); no second posting owner remains. ✓
10. No frozen surface modified. ✓
11. Negative controls prove the initialization + posting-owner gates. ✓
12. ERP / P2P / security regressions remain green. ✓

GREEN, with the explicitly-stated bounds in §K (customized-chart policy preserved by design; per-tenant boot seed for
dynamic tenants). Session 14 not started.
