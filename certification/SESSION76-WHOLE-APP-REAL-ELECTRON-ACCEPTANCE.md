# SESSION 76 — WHOLE-APP REAL-ELECTRON ACCEPTANCE

**Class:** whole-app real-Electron acceptance run for the six outstanding domain journeys. No new domain, no production source change. Baseline S75 HEAD `ee220b0`. Release/notarization track PAUSED.

**This certification has two parts:** the first S76 attempt (Linux sandbox — ENVIRONMENT-BLOCKED, recorded at commit `1d58410` and preserved below in §History) and the **Mac acceptance run of 2026-09-03**, which converted all six journeys to GREEN on the operator's macOS machine per this document's own runbook.

## Custody (verified before anything else, Mac run)

- HEAD = `1d58410` at execution (parent chain: `ee220b0` S75 Projects → `1d58410` S76 Linux-blocked cert commit — cert-only, "no source change"). `ee220b0` object verified present. **Production source at execution = byte-identical to S75 `ee220b0`.**
- No unexpected production changes: `git status` clean except `certification/baseline.json` — the pre-existing custody-protected working-tree modification (3±/3∓), **not touched by S76, never staged**.
- The six harnesses run **unmodified** — with one exception recorded under Failure Discipline: a teardown-only fix to `e2e/s74MaintenanceJourney.e2e.cjs` (class B), made **after** all 18 of its assertions had already passed. **No application source was modified to make any journey pass.**
- Alternate release builds produced per the runbook: `env -u NP_E2E_BUILD npx electron-vite build --outDir out-seam-s73|s74|s75` (each ✓ built; git-ignored; NOT e2e-seed builds — `NP_E2E_BUILD` unset, so the seed seam is structurally absent).

## Mac execution record (2026-09-03, macOS/darwin 25.5.0, node v20.20.2, playwright-core 1.62.1)

Each journey: real Electron launched via playwright-core `_electron.launch` on the alternate production build, fresh throwaway `--user-data-dir` profile (asserted equal to the running `app.getPath('userData')`), `NODE_ENV=production`, all E2E/dev env vars cleared, boot logs `Enterprise OS ready` + `Runtime core ready` observed on the app's own stdout, then the whole-user journey through `window.neuropause.invoke` — the same preload bridge the UI uses — with every mutation on governed channels (`enterprise:module.create/update/action`, `platform:command.dispatch`). Exit 0 = all assertions passed.

## Result table

| Domain | Harness | Result | Assertions | Evidence | Classification |
|---|---|---|---|---|---|
| CRM | `e2e/s73CrmJourney.e2e.cjs` | **GREEN** (Mac, exit 0, first attempt) | **15** | lead→convert (contact+customer)→dup-convert REFUSED→opportunity→advance→won→closed-immutable→accepted quote→**governed** `ConvertQuoteToSalesOrder`→order→cross-link read-back→same-idem-key REPLAYS (one order, ever). RESULT: "CRM whole-user journey VERIFIED in the real Electron runtime (lead→convert→opportunity→won→quote→governed order, idempotent)" | GREEN |
| HR | `e2e/s73HrJourney.e2e.cjs` | **GREEN** (Mac, exit 0, first attempt) | **10** | onboard→leave request→leave APPROVED→status read-back→expense claim→governed approve (SoD creator≠approver guarded)→EXIT offboard. Payroll post/disburse NOT driven (D8 POLICY-BLOCKED). RESULT: "HR whole-user journey VERIFIED in the real Electron runtime (onboard→leave-approve→expense→exit); payroll post/disburse = D8 POLICY-BLOCKED, not driven" | GREEN |
| Warehouse | `e2e/s73WarehouseJourney.e2e.cjs` | **GREEN** (Mac, exit 0, first attempt) | **15** | product→seed 100 on-hand→transfer APPROVE (reservation)→DISPATCH (transfer-out)→RECEIVE (transfer-in)→completed read-back→pick RESERVED→PICKED→packing→PACKED→shipment→SHIPPED (stock issued). Cycle-count/adjustment NOT driven (D10 POLICY-BLOCKED). RESULT: "Warehouse whole-user journey VERIFIED in the real Electron runtime (seed→transfer net-zero→pick→pack→ship); cycle-count/adjustment variance-approval = D10 POLICY-BLOCKED, not driven" | GREEN |
| Manufacturing | `e2e/s73ManufacturingJourney.e2e.cjs` | **GREEN** (Mac, exit 0, first attempt) | **12** | components seeded→BOM→production order→PLANNED→ALLOCATED (components reserved)→STARTED (consumed)→COMPLETED (finished goods output)→status read-back→quality inspection→costing. Variance/scrap approval NOT driven (POLICY-BLOCKED). RESULT: "Manufacturing whole-user journey VERIFIED in the real Electron runtime (BOM→order plan→allocate→start→complete→quality→costing); variance/scrap approval authority = POLICY-BLOCKED, not driven" | GREEN |
| Maintenance | `e2e/s74MaintenanceJourney.e2e.cjs` | **GREEN** (Mac, exit 0 on rerun after class-B teardown fix; all 18 assertions had already passed on the first run) | **18** | asset+machine→corrective fault→WO created→assigned (machine→maintenance, out of service)→started→ILLEGAL verify-before-complete REFUSED→completed→ILLEGAL duplicate completion REFUSED→verified→machine restored→immutable history (cost 300)→spare part consumed (real stock issue)→ILLEGAL duplicate consumption REFUSED. Maintenance-cost→GL NOT driven (POLICY-BLOCKED). RESULT: "Maintenance whole-user journey VERIFIED in the real Electron runtime (fault→WO→assign→start→complete→verify→history→spare-part issue); maintenance-cost→GL = POLICY-BLOCKED, not driven" | GREEN (B on teardown only — see Failure Discipline) |
| Projects | `e2e/s75ProjectsJourney.e2e.cjs` | **GREEN** (Mac, exit 0, first attempt) | **18** | customer→project (customerRef resolved; ghost-customer REFUSED)→task→done→billable time entries→billing run (totalAmount 320)→invoiced→real cross-module draft Finance invoice INV-BR-PRJ-1-1 (320, draft)→IDEMPOTENT re-issue REFUSED→close→ILLEGAL task-on-closed REFUSED→ILLEGAL cancel-after-complete REFUSED. Cost/revenue→GL NOT driven (POLICY-BLOCKED). RESULT: "Projects whole-user journey VERIFIED in the real Electron runtime (customer→project→tasks→time→billing→draft invoice→close, idempotent, immutable); project-cost/revenue→GL = POLICY-BLOCKED, not driven" | GREEN |

**Total: 6/6 journeys GREEN · 88 assertions passed · 0 product defects (A) · 1 harness teardown defect (B, fixed in harness only) · 0 environment (C) on Mac · policy items untouched (D).** Full logs preserved in the session run record (`s76-*.log`).

### Failure Discipline record — the single class-B event

`s74MaintenanceJourney.e2e.cjs`, first run: **all 18 assertions passed and the RESULT line was emitted**, then the process hung in teardown — `app.close()` never resolved, so node never exited (killed at the 8-minute bound, exit 143). Classified **B — TEST/HARNESS DEFECT** (shutdown-only; zero assertion failures; the other five harnesses use the identical assertion structure and exited cleanly). Fix confined to the harness `finally`/exit path: graceful close bounded by `Promise.race([app.close(), sleep(15_000)])`, `SIGKILL` fallback, explicit `process.exit` on completion. Rerun per discipline: exit 0, identical 18 PASS lines. **No production source touched.** No leaked Electron processes or temp profiles after the run.

### Real-Electron scope honesty

These harnesses drive the real app process and the real preload bridge with every business action on the governed channels (no mocked Electron, no direct store access, no seeded business state, no e2e-seed build). Per-harness scope: restart durability, audit/outbox tables, and tenant isolation are **not asserted inside these six journey harnesses** — they are covered by the standing dedicated harnesses (`s48Restart`, `sigkill*`, `tenantOwnership`, DR/S66) and the governed-layer suites; nothing here re-claims them.

## Regression (Mac, after all six journeys)

- **Full main suite** (`vitest run`): **978/979 files, 10190 passed, 7 skipped, 2 failed** — both failures in `src/main/release/releaseDiscipline.test.ts` (Gate 27): (1) tree declares `1.0.0-rc.24` while tag `v1.0.0-rc.24` is already bound to `11a82cd` with HEAD 9 commits past it; (2) CHANGELOG claims "No unreleased changes" while commits sit past the tag. **These are the release-track guards doing their job on a PAUSED release track** (they demand a version bump + changelog before any next build); they pre-exist S76, are unrelated to the six journeys, and S76 does not resolve them (release work is out of scope). **Zero product regressions.**
- **Full UI suite** (`vitest run --config vitest.ui.config.ts`): **80/80 files, 455/455 passed.**
- **`typecheck:release`**: clean across all 6 workspaces (node + web configs).
- **`lint:release`**: 0 errors, 0 warnings (`--max-warnings 0`).
- **Build**: the three out-seam production builds compiled clean (the only builds required; no packaging, no notarization).

## Consolidated policy blockers (unchanged from S75 — operator decisions, not resolved here)

1. **D8 — Payroll** post/generatePayslips/disburse approval authority (HR).
2. **D10 — Warehouse** cycle-count / stock-adjustment variance materiality approval.
3. **Manufacturing** variance / scrap write-off approval.
4. **Maintenance cost → GL** (`DECISION-MEMO-S74-MAINTENANCE-COST-ACCOUNTING.md`).
5. **Projects cost/revenue → GL** (`DECISION-MEMO-S75-PROJECT-COST-REVENUE-ACCOUNTING.md`).
6. **D12 — PO approve-send** authority.
7. **Bank-reconciled payment reversal** semantics (S61 flag).
8. **Session-2 posting-ownership** decision (Option A/B/C).

None resolved, none invented.

## FINAL DECISION

**REAL-ELECTRON WHOLE-APP ACCEPTANCE = GREEN** — 6 of 6 journeys executed and passed on the operator's Mac in the real Electron runtime (88 assertions; the one first-run anomaly was a harness teardown hang after full success, fixed in the harness only and rerun clean).

**WHOLE-APP ENGINEERING STATUS = GREEN** — all operational domains (CRM, HR+Expenses, Warehouse, Manufacturing, Maintenance, Projects) are now real-user-E2E GREEN on macOS on top of governed-layer GREEN; the full regression shows zero product regressions. The only failing checks are the two Gate-27 release-discipline guards, which are release-track hygiene (version/changelog vs the spent rc.24 tag) on a deliberately PAUSED track, not engineering defects.

**POLICY STATUS =** the eight unresolved operator decisions listed in "Consolidated policy blockers" above.

**RELEASE TRACK = PAUSED** (no notarization, no signing, no updater, no tag, no publish, no repackage; the Gate-27 guards will require the version bump + changelog when the track resumes).

No further implementation gate was begun.

## History — first S76 attempt (Linux sandbox, recorded at `1d58410`)

The initial S76 execution environment was a Linux aarch64 sandbox with a macOS-only Electron dist and no runnable Electron binary; all six journeys were recorded **NOT RUN — ENVIRONMENT-BLOCKED (Classification C)** with governed-layer pins reconfirmed 18/18 and the Mac runbook filed. That record was accurate for its environment and is superseded by the Mac execution above, which followed the filed runbook exactly.
