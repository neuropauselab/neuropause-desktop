# NeuroPause Pilot Handbook

**For pilot program operators running 10–20 pilot companies · v1.0.0-rc.14 lineage · Phase 9 certification (2026-08-07).**
This is the tie-together document: each section points at the authoritative guide rather than duplicating it.

## What a pilot company receives

A signed, notarized DMG (once Apple credentials land in CI — until then the unsigned build with the documented Gatekeeper path), the bundled documentation set (opens in-app from Getting Started → Documentation), and a named pilot contact. The product is local-first: each company's data lives on their machines, covered by scheduled backups of every business store, with no usage telemetry and opt-in redacted crash reporting.

## Before the first company (operator checklist)

Signing credentials installed as GitHub Actions secrets and one tagged release built, verified, and published (`docs/release/RC1-RUNBOOK.md`, `docs/guides/RELEASE-CHECKLIST.md`) · update feed serving and reachable (`curl -sI https://neuropause033.com/updates/latest-mac.yml`) · legal drafts through counsel (`docs/legal/`) · connector OAuth registrations for pilot scope verified with one interactive round-trip each · the pilot instruments in `docs/pilots/` (framework, success criteria, feedback forms) filled for your cohort.

## Installing a company

`docs/guides/INSTALLATION.md` (truthful about signing state) → first run presents the license/privacy step, organization setup, and the Getting Started checklist → the company's pilot lead joins the pilot from Getting Started (local marker; changes nothing else) → scope their families (Finance / HR / Inventory+Procurement guides in `docs/user/`).

## Operating the cohort

**Support**: each issue starts with an in-app support bundle (Operations → Release Diagnostics → Generate bundle — redacted, revealed in Finder) — `docs/guides/TROUBLESHOOTING.md`, `SUPPORT.md`. **Data safety**: scheduled backups cover every enterprise store; restore and validation are user-visible (Operations → Recovery Center) — `docs/guides/DISASTER-RECOVERY-GUIDE.md`. **Administration**: RBAC scopes, audit logs, feature flags — `docs/guides/ADMINISTRATOR-GUIDE.md`, `docs/guides/SECURITY-GUIDE.md`. **Updates**: manual-consent updater on Stable/Beta; rolling back = reinstalling the previous DMG from the downloads host (in-place downgrade is deliberately not supported; version-stamped stores quarantine newer data safely). **Feedback**: local capture, weekly export ritual per `docs/user/PILOT-ORIENTATION.md` — the pilot is operationally blind without it, by privacy design.

## Honest boundaries to set with pilot companies

The GL runs receivables/payables/payroll/assets fully; **perpetual-inventory accounting (COGS on sale, GR/IR, valuation-to-GL) is not wired** — inventory value lives in the operational ledger and period-end inventory journals are entered manually (the periodic-inventory pattern). Lead→opportunity and opportunity→quote links are typed references, not one-click conversions. The SDK/API surface shown in the Developer Center is a labeled preview; the working integration surface is the in-process Enterprise API. Platform centers marked *Preview* are honestly labeled prototypes. Scope pilots to what is certified: the 104 modules, the four working chains, connectors with verified registrations.
