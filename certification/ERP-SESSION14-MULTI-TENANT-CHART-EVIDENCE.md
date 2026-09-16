# ERP — SESSION 14: DYNAMIC-TENANT CHART INITIALIZATION + MULTI-TENANT ACCOUNT INTEGRITY

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base:** Session 13 GREEN (`8aa2bb9`)
**Label:** TEST-VERIFIED. No frozen surface touched; no accounting policy changed; canonical account numbers
unchanged; the Session 13 customized-chart empty-only policy preserved. Reproduce → implement → negative-control →
concurrency → multi-tenant E2E → regress.

Closes the Session 13 residual: a tenant NOT covered by the boot seed (created/activated after boot) whose first
activity is stock.

---

## A · ROOT CAUSE

Session 13 seeded the canonical chart at boot **only for the tenant active at boot** (and the on-posting seed is
empty-only). A tenant activated dynamically after boot whose FIRST activity was a stock movement therefore hit the
original ordering bug in its own scope: the inventory→GL bridge ensured **stock** accounts first
(`ensureStockAccounts`), making that tenant's chart non-empty, so the empty-only control-account seed then skipped —
permanently suppressing the finance control accounts for that tenant and refusing a later cash/expense posting.
Reproduced (no harness seeding): a fresh `tenant-DYNAMIC` whose first activity is a goods receipt had control
accounts (`5000`, `1000`) absent, and the fresh-tenant payment (needing Cash `1000`) could not complete.

---

## B · TENANT ACTIVATION ARCHITECTURE

The fix makes tenant initialization **deterministic and self-healing at the point of first use**, with proactive
coverage at boot and on activation:

```
Stock-posting seam (inventoryGlBridge)  ← the DETERMINISTIC guarantee
  → ensureCanonicalChart(ctx)   CONTROL-FIRST, in the acting tenant's own scope
      → seedControlAccountsIfEmpty(ctx)   (empty-only; customized-chart policy preserved)
      → ensureStockAccounts(ctx)
  → any tenant self-heals on its first stock activity, before stock seeding can make the chart non-empty

Boot                        → forEachTenantBackground('ensure-canonical-chart', ensureCanonicalChart)
                              seeds EVERY operable tenant, each under its own principal-pinned scope
Tenant activation (switch)  → onWorkspaceSwitch → ensureCanonicalChart (proactive, in the newly-active scope)
```

The **stock-posting seam** is the deterministic guarantee (it runs in the posting's own tenant scope, before stock
seeding, with no race). The **boot per-tenant pass** (`forEachTenantBackground`, which runs `fn` under
`runAsPrincipal(run.principal)` per tenant) covers every tenant existing at boot in the correct scope. The
**activation hook** (`onWorkspaceSwitch`) proactively seeds a tenant when it is switched to; it is best-effort by the
hub's contract, so it is an optimization, not the guarantee. Control seeding stays **empty-only** throughout — the
Session 13 customized-chart policy is unchanged.

---

## C · FILES CHANGED

```
MOD  .../inventory/inventoryGlBridge.ts   postMovementToGl now ensures the CANONICAL chart control-first (ensureCanonicalChart) rather than stock-only (ensureStockAccounts)
MOD  enterprise/index.ts                   boot seed is now per-tenant (forEachTenantBackground); + onWorkspaceSwitch activation hook; + onWorkspaceSwitch import
NEW  .../finance/session14MultiTenantChart.test.ts   8 pins: dynamic-tenant reproduction, idempotency, concurrency (incl. init-races-posting), multi-tenant isolation, cross-tenant PO refusal, fresh-tenant E2E, customized-chart preserved
NEW  certification/ERP-SESSION14-MULTI-TENANT-CHART-EVIDENCE.md
```

`controlChart.ts`, `glPosting.ts`, `postingRules.ts` are unchanged in Session 14 (reused as-is). Frozen surfaces
untouched. `certification/baseline.json` not staged.

---

## D · IDEMPOTENCY / CONCURRENCY PROOF

- **Idempotent:** `ensureCanonicalChart` run 3× sequentially converges to exactly one canonical set (no growth after
  the first, no duplicate codes).
- **Concurrent:** three simultaneous `ensureCanonicalChart` calls produce exactly one of each canonical account (no
  duplicates). This holds from the EXISTING persistence model — the seed helpers' check-then-create critical sections
  are synchronous (the only `await` is `store.load()` at the top), so on the single Node event loop the first
  resumer's create loop runs atomically and the second observes a non-empty chart and creates nothing. Account-code
  uniqueness is NOT relied on (the store does not enforce it); the empty-only / skip-existing guards + synchronous
  critical section ARE the concurrency protection. Proven load-bearing by NC-B (removing the empty-only guard
  produces duplicates under the concurrent test).
- **Init-races-posting:** an `ensureCanonicalChart` call fired concurrently with a tenant's first stock posting still
  yields exactly one of each account.
- **Per-tenant distinctness:** tenant A's initialization ≠ tenant B's — each seeds its own scoped chart; no
  cross-tenant reuse or renumbering.

---

## E · MULTI-TENANT ISOLATION PROOF

Tenant A and Tenant B receive independent canonical charts; B cannot see A's accounts before B is initialized, and A
is unchanged by B's initialization (store-scope enforcement — `scopeOrDeny`). Cross-tenant reference is refused: a
bill in tenant B naming tenant A's purchase order fails validation ("no purchase order found"), because A's PO is
invisible in B's scope. No tenant can read, resolve, mutate, or post against another tenant's control accounts — the
initializer resolves accounts through the tenant-scoped module store, never a cross-tenant handle.

---

## F · FRESH-TENANT E2E PROOF (no harness seeding)

A newly activated `tenant-FRESH` (never seeded) completes the full P2P flow driven only by the real posting paths:
`PO → goods receipt (Inventory/GRNI) → partial vendor bill → GRNI relief/PPV/AP → second bill → payment`. The first
stock activity (the receipt) self-heals the chart control-first, so: GRNI accrues 400 and reconciles to **0** after
cumulative billing; both bills paid → AP reconciles to **0**; Cash (a control account) is credited 400 — proving the
control accounts were available to a tenant that had no boot seed and no harness seeding.

---

## G · NEGATIVE-CONTROL RESULTS

Each mutation fails the appropriate suite; each restore is byte-identical (sha256 verified, post-restore == baseline).

| # | Mutation | Failing suite | Directive §9 item |
|---|---|---|---|
| A | Stock-first ordering in `ensureCanonicalChart` (control no longer seeded first) | session14 (dynamic-tenant reproduction + fresh E2E) | #1 remove activation init, #6 stock-first before init |
| B | Remove the empty-only guard (force-add onto a customized chart) | session14 (concurrency + customized-chart) + session13 + glAutoPosting | #4 duplicate accounts, #5 bypass customized-chart, #7 remove concurrency protection |
| C | Change AP code (2000→9990) | session10 literal pin | (canonical mapping) |
| D | Change GRNI code (2150→9991) | session10 literal pin | (canonical mapping) |

§9 items #2 (wrong tenant context) and #3 (reuse another tenant's chart) are enforced by the tenant-scoped record
store (`scopeOrDeny`), proven by the multi-tenant isolation + cross-tenant-PO tests and the existing storeScope
tenancy suites; they were not source-mutated because that would require breaking the platform scope machinery
(out of scope), consistent with prior sessions' handling of tenancy negative controls.

---

## H · REGRESSION COUNTS

| Suite | Result |
|---|---|
| `session14MultiTenantChart.test.ts` | **8/8** |
| `session13BootSeed` + `glAutoPosting` (policy pins) | 7 + 10 (unchanged) |
| `session11VendorBillP2P` + `session12PartialP2P` | 16 + 11 |
| Blast radius — all `src/main/enterprise` | **1363** (Session 13 1355 + 8) |
| `src/main/erp` + `src/main/medicalDevice` | **220** (unchanged) |

---

## I · TYPECHECK / LINT / BUILD

`typecheck:node` + `typecheck:web` clean · `electron-vite build` clean · ESLint clean on all changed/new files.
Repo-wide `npm run lint` carries the same pre-existing test-file backlog noted since Session 10 (sandbox-vs-Mac
config); no regression from this change — confirm on the Mac.

---

## J · COMMIT SHA

`<filled at commit>` — one commit, `erp(s14): …`. The user pushes from the Mac.

---

## K · REMAINING RISKS / BOUNDS

- **Activation hook is best-effort** (the switch hub is fire-and-forget by contract); it is a proactive optimization,
  not the guarantee. The DETERMINISTIC guarantee for "stock-first cannot bypass init" is the posting-seam control-first
  ensure, which runs in the acting tenant's scope with no race. Documented, not relied on for correctness.
- **Concurrency safety is emergent from synchronous critical sections**, not a lock. It is proven by test and pinned
  by NC-B (remove the empty-only guard → duplicates). If a future change introduces an `await` between the
  existence check and the account create in `seedControlAccountsIfEmpty` / `ensureStockAccounts`, that guarantee
  would need an explicit single-flight latch (the established `actionRecord`/`orchestrator` pattern) — flagged.
- **Customized-chart policy deliberately preserved** (empty-only): a genuinely customized chart missing a canonical
  control account still pauses; forcing canonical codes onto it remains an operator decision, not taken here
  (Session 13 bound, unchanged).
- Session 11/12 bounds carry forward (foreign-currency goods-bill PPV combines FX; mid-PO standard-cost-change uses
  pool-average).

---

## L · STATUS: 🟢 GREEN

1. Dynamically activated tenants receive deterministic chart initialization (posting-seam control-first; boot
   per-tenant; activation hook). ✓
2. Initialization runs in the correct tenant scope (posting scope; boot pass principal-pinned per tenant). ✓
3. Tenant A and Tenant B have independent charts. ✓
4. Initialization is idempotent. ✓
5. Concurrent initialization cannot duplicate accounts. ✓
6. Customized-chart protection unchanged (empty-only). ✓
7. Stock-first activity cannot bypass initialization (control-first at the posting seam). ✓
8. A newly activated tenant completes a real PO → receipt → bill → payment flow. ✓
9. GRNI and AP reconcile correctly. ✓
10. No cross-tenant account access/posting is possible. ✓
11. Negative controls prove the tenant-boundary + ordering + policy gates. ✓
12. No frozen surface modified. ✓
13. All existing ERP/P2P/security regressions remain GREEN. ✓

GREEN with the explicitly-stated bounds in §K. Session 15 not started.
