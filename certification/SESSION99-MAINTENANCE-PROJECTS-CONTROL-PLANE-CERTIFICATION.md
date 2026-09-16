# SESSION 99 — MAINTENANCE + PROJECTS ECONOMIC CONTROL-PLANE CERTIFICATION

**Class:** control-plane certification — ZERO production change. **Outcome: Maintenance and Projects are certified as SAFE, governed participants in the existing canonical Inventory + Finance control plane. Maintenance spare-part consumption is a real, idempotent, governed inventory-ledger participant; Projects billing routes into the canonical customer-invoice module and its governed AR/revenue posting. The undefined accounting treatments (maintenance cost→GL, project cost/revenue→GL) remain POLICY-OPEN — documented, never invented.** Both domains have NO domain commands; they are driven through governed module ACTIONS. No new engine, no frozen change, no FG-S99 token, no accounting policy invented. Baseline S98 GREEN. Release track PAUSED.

## 1. Discovery (source-wins)

**Maintenance** (modules under `enterprise/modules/maintenance/`, perm `maintenance:manage`): the ONLY economic seam is spare-part `consume` → `postSparePartConsumption` (`maintenanceMovements.ts:80`) → `postStockMovement`, posting a `production_consumption` movement into the canonical `inventory-movements` ledger (idempotent, status-guarded, `inventory:manage` at the seam). Labor cost (`laborCost`/`partsCost`/History `totalCost`) has NO GL seam. The spare material posts incidentally to `Dr WIP (1350) / Cr Inventory (1300)` via the shared `inventoryGlBridge.ts` because the seam reuses Manufacturing's movement type.

**Projects** (modules under `enterprise/modules/projects/`, perm `operations:manage`): the billing run `issueInvoice` creates a DRAFT invoice in the canonical `finance` module (same store/kind as O2C), freezing gathered time entries + the run. Issuing is governed-command-only (raw `issue` fenced, S46) via `IssueCustomerInvoice` → `Dr Accounts Receivable (1100) / Cr Sales Revenue (4000)`. No project-cost entity; no project-specific GL seam (confirmed by DECISION-MEMO-S75, still open).

## 2. Findings — NO new economic defect

- **No RED, no YELLOW.** No production change this session. Reproduce-first surfaced no economic-forge defect in either domain.
- One thing looked like a defect and is NOT: the raw invoice `issue` action returns `ok:false` for a project-billing draft invoice. That is the **S46 governed-command-only fence working as designed** — issuing must go through `IssueCustomerInvoice`. The certification now proves the project invoice inherits that fence (a positive control) and posts AR/revenue only through the governed command.
- Two accounting boundaries are POLICY-OPEN and deliberately NOT changed (DECISION-MEMO-S99): maintenance cost→GL (labor non-posting; spare material incidentally to WIP — Cr Inventory correct, WIP debit a mis-attribution), and project cost/revenue→GL beyond the canonical invoice (DECISION-MEMO-S75). Maintenance work-order status is editable but gates no economic effect → a non-economic operational observation, out of scope, not changed.

## 3. Control matrix (RED / YELLOW / GRAY / POLICY-OPEN)

| # | Control | Status | Evidence |
|---|---------|--------|----------|
| M1 | Spare-part consume → one production_consumption; on-hand −q once; idempotent | GREEN | one movement; replay refused; on-hand 100→95 |
| M2 | Posted spare movement immutable (cannot be deleted) | GREEN | S97 delete guard; on-hand unchanged after refused delete |
| M3 | Maintenance labor cost → GL | POLICY-OPEN (non-posting) | work order with laborCost/partsCost posts 0 journal |
| M4 | Maintenance spare material → GL | POLICY-OPEN (incidental WIP) | Cr Inventory 40 correct; Dr WIP 40 documented mis-attribution, not fixed |
| M5 | Work-order lifecycle assign→start→complete→verify + history | GREEN | status 'verified'; history record created |
| M6 | Maintenance security: advisory (no inventory:manage) cannot consume; tenant isolation; unauthorized create refused | GREEN | advisory consume refused (0 movement); tenant-B sees nothing |
| P1 | Project/task/time creation is non-posting | GREEN | 0 journal until invoice issued |
| P2 | Billing run → DRAFT invoice in canonical finance module; entries + run frozen; one invoice per run | GREEN | draft amount 800; entries immutable; re-issue refused |
| P3 | Governed issue → Dr AR / Cr Revenue exactly once; legacy door fenced | GREEN | raw issue refused (S46); command posts AR 800 / Rev 800 once; replay no dup |
| P4 | Project cost→GL / revenue recognition | POLICY-OPEN | DECISION-MEMO-S75, still open; no separate posting beyond AR/revenue |
| P5 | Project security: advisory (no operations:manage) cannot bill; tenant isolation | GREEN | advisory issueInvoice refused (0 invoice); tenant-B sees nothing |
| R | Restart durability (both domains) | GREEN | spare movement + WO state + invoice lineage + AR/revenue/WIP GL survive; no duplicate |

## 4. Real-Electron result — PENDING operator Mac

`out-seam-s99` build → fresh-profile combined journey with a real restart (`apps/desktop/e2e/s99MaintenanceProjectsJourney.e2e.cjs`):

```
cd apps/desktop
env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s99"
NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s99MaintenanceProjectsJourney.e2e.cjs ; echo "exit=$?"
```

Walks, on a FRESH profile with NO seeded state: product + stock → work order (labor non-posting) → spare consume (on-hand −5 once, one production_consumption, replay refused, posted movement undeletable, Cr Inventory 40 / incidental Dr WIP 40) → WO lifecycle → project + billable time → billing run DRAFT invoice (entries/run frozen, one-per-run) → legacy issue door refused (S46) → governed IssueCustomerInvoice → Dr AR 800 / Cr Revenue 800 once → REAL RESTART (all state + GL survive, no duplicates). **Only mark S99 GREEN once this passes on a fresh profile with RESULT + exit 0 on the operator's Mac.**

## 5. Focused + regression totals (sandbox)

`maintenanceControlPlane.test.ts` **9/9**; `projectsControlPlane.test.ts` **5/5**. Regression: maintenance + projects + finance + platform/command (recorded on the run). Typecheck node clean; eslint clean on the new files.

## 6. Frozen-file changes

**None.** gate-detector PROCEED on all S99 files. `enterprise/index.ts`, `runtimeCore.ts`, `packages/shared`, `cst/` untouched. No FG-S99 token. `certification/baseline.json` untouched.

## 7. Exact files changed — PRODUCTION vs TEST/DOCS

- **PRODUCTION: NONE.** (Zero-production-change certification gate.)
- **TEST (2):** `apps/desktop/src/main/platform/command/maintenanceControlPlane.test.ts`, `apps/desktop/src/main/platform/command/projectsControlPlane.test.ts` (both new).
- **HARNESS (1):** `apps/desktop/e2e/s99MaintenanceProjectsJourney.e2e.cjs` (new).
- **DOCS (2):** this cert + `DECISION-MEMO-S99-MAINTENANCE-PROJECTS-ACCOUNTING.md`.

## 8. Policy-open decisions (documented, not implemented — operator-gated)

Maintenance: spare-part consumption expense account (repairs expense vs WIP vs asset capitalization), repair-vs-capex rule, materiality threshold, whether labor posts, maintenance approval workflow. Projects: project cost→GL, revenue recognition (fixed-price % complete / milestone / deferred), cost capitalization/WIP, labor-cost methodology, budget-variance/write-off (DECISION-MEMO-S75). None invented.

## 9. Exact commit

One non-frozen commit (two focused tests + combined journey + memo + cert), recorded on landing.

## 10. Final S99 status — GREEN pending the operator's Mac journey

Both domains are certified SAFE governed participants at the sandbox level: maintenance spare-part consumption is a real, idempotent, immutable, governed inventory-ledger participant with correct on-hand and a documented (not invented) incidental WIP posting; projects billing routes cleanly into the canonical customer-invoice module and its governed, fenced, once-only AR/revenue posting. Every undefined accounting treatment remains POLICY-OPEN and fail-safe (non-posting or incidental-and-documented). Proven by 9/9 + 5/5 focused tests + regression (sandbox). No RED, no production change, no frozen change, no FG token, AI/advisory-only, tenant/RBAC enforced, restart-durable. `certification/baseline.json` untouched; release-track files untouched (paused). **The fresh-profile real-Electron journey with a real restart runs on the operator's Mac — S99 is marked GREEN only on RESULT + exit 0 there.**
