# NeuroPause Roadmap

**Established by Phase 8 (2026-08-07)** — the forward work register, harvested from the retired `COMMIT_QUEUE.md` hand-off runbook and the Phase 8 audit's deferred ledger, ordered against repository truth (104 certified modules, Phase 7 UX complete, Phase 8 RC hardening executed). Items land only through the standard increment discipline: gates green → commit → push.

## Finance depth (the pre-Phase-8 Stage C tail)

**C2d** Realized FX — period P&L from account 7810 + historical exposure trend from the immutable revaluation snapshots. **C3** Company functional-currency configuration (INR/USD/EUR/GBP/AED/SGD) replacing the hardcoded USD display constant without touching the accounting engine. **C4** Budget forecast engine (rolling, scenario, department, cash, revenue, expense, variance). **C5** Intercompany accounting (due-to/due-from, intercompany journals, settlement, eliminations). **C6** Consolidation engine (parent/subsidiary, consolidated statements, minority interest, currency translation).

## Phase 8 deferred items (audit-recorded, non-gating for the pilot)

**Demo/seed data** — a feature-flag-gated sample-data loader through the modules' own validate hooks (clearly labeled demo records, one-click removal); deferred because it needs interactive verification against live module guards. **Sidebar 2.0 interactive layer** — favorites/pins/recents in the sidebar (personalization store + palette MRU already exist). **Table experience** (sticky headers, sorting, export on the generic module screen) and **form auto-save/drafts**. **Card-kit migration** (339 byte-compatible hand-rolled containers → `<Card variant="hairline">`). **Workflow UI walk-throughs** (lead→cash, procure→pay, hire→pay, asset→depreciation — backend seams are suite-tested; the UI walk needs a human at the running app). **ESLint 9 / vitest 2 / vite 6+ / electron-vite 5 toolchain generation** (deliberately excluded from the Phase 8 Electron upgrade — one toolchain risk at a time). **Windows Authenticode runtime probe** in signingStatus. **Dormant-package tier disposition** — quarantined from the release gate in Phase 8; staged deletion (safest-first order in the Phase 8 recon) or explicit retention remains a product decision; mine `packages/business` (hr/payroll/healthcare logic) before any deletion; `sdk`/`cli` are advertised in the Developer Center UI — reconcile product truth before removing.

## Human-gated procurement (start in parallel — no code depends on the order)

Apple **Developer ID Application** certificate (+ `APPLE_CSC_LINK`/`APPLE_CSC_KEY_PASSWORD`) and notarization credentials (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) — the pipeline signs and notarizes automatically once present. Windows **Authenticode** certificate (`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`). Live update-feed host (`https://neuropause033.com/updates` + `DEPLOY_SSH_KEY`). IdP tenants for SSO pilots (Azure AD / Google / Okta). Counsel review of `docs/legal/EULA.md` + `PRIVACY.md` (presented at first run as drafts).

## Later stages (post-pilot)

Deployment/SSO hardening at customer scale, observability export (WORM/SIEM for the audit chain — named by the security threat model), Linux target, localization, and the platform-center Preview surfaces graduating to production one at a time (each exits Preview only with real external effect and its own verification).
