# NeuroPause Constitutional Settings Program v1.0 — Final Report

> **Historical snapshot — superseded facts.** This report was written in the
> `1.0.0-rc.1` era (bulk pass of 2026-07-24) and is retained as program history.
> Authoritative current facts: **104 certified modules across 13 families**
> (locked by `apps/desktop/src/main/enterprise/modules/moduleCertification.test.ts`),
> version lineage `1.0.0-rc.14`. See `PHASE7-COMPLETION-REPORT.md` and the
> Phase 8 reports for current state. Banner added by Phase 8 (8.11).

**Program:** Constitutional Settings v1.0 · Constitution Layer for the Enterprise AI Operating System
**Type:** A renderer-only configuration/navigation LAYER over existing production systems — no new runtime, engine, governance, identity, AI, cloud, or database.
**Status:** Complete. All six validation gates green; independent adversarial review returned **SHIP**. Settings is now a two-pane constitutional control surface with global search, a real Startup Experience Policy, and an honest capability inventory.
**Date:** 2026-07-17

---

## Executive summary

Settings is now the constitutional control layer it was meant to be: a single, searchable, two-pane surface (11 domains + a Capabilities ledger) through which the user governs the platform — while owning **no business logic of its own**. Every control reads or writes a *real existing* production system whose mutator already propagates and audits, or a real local preference; nothing is duplicated and nothing new was built underneath it. The program's hardest constraint — the authenticity mandate — was resolved with the user's **Configuration Visibility Principle**: each capability is Editable (real, changeable here), Managed (real, governed elsewhere, shown read-only with its source), or Unavailable (no real backing → hidden and listed only in the inventory). The recon proved that a large share of the requested IA — most of the AI provider/model/cost stack, in-app password change, passkeys, session management, consent/retention, i18n — has no production implementation; per the mandate, those are hidden and honestly enumerated rather than faked.

The entire layer is **renderer-only**: it adds two preference keys to the existing pref store and reuses existing IPC, RBAC, audit, and components. Zero new main-process runtime, engine, store, or channel — the strongest possible fulfillment of "Settings never owns business logic; it only configures existing systems."

---

## Repository Recon & Architecture Reuse Report

Three parallel read-only recon passes built a verified reuse map for every control across the eleven domains, cross-referenced against the 604-channel IPC enum, the `runtimeAuthz`/`withXAuthz` RBAC classification, the audit sinks, and the renderer's existing feature dirs. The finding that shaped the build: the platform already contains real, RBAC-gated, audited mutators for the controls that matter (organizations/roles, connectors, governance chains, feature flags, devices, recovery, memory, subscription, updates, backup, crash consent), each of which already propagates to its runtime — so Settings needs only to *reach* them, never to reimplement them. Equally important, the recon proved which requested controls are **not real** (below), which the Configuration Visibility Principle then routes to "hidden + inventoried."

Architecturally, Settings extends the existing `SettingsView` pattern (which already reused `SubscriptionCenter`, `TrustedDevices`, `EnterpriseOverview`, `FeatureFlagsCenter`, `ReleaseChannelCard`) into a full two-pane shell. It introduces no new architecture: light preferences are set inline through the real runtime seams (theme → `nativeTheme`, scale → the scale provider, startup → the pref store, crash consent → the release-ops runtime), and deep configuration routes to the real production center that owns it (Organization, Enterprise governance, Connectors, Developer, Workforce, Cloud, Federation, Commercial, Operations) — where the existing mutators already propagate and audit.

---

## Settings Architecture

A two-pane shell (`settings/SettingsShell.tsx`): a left domain rail (Identity, Security, Governance, Privacy, AI, Workspace, Organization, Integrations, Developer, Billing, System, and a Capabilities ledger) with a global natural-language search box, and a right content pane that renders each domain from a pure catalog (`settings/settingsCatalog.ts`). Search matches free text ("enable claude", "change startup page", "manage billing", "disable automatic execution") against a real index and routes every result to a real production page — a real section or a real Settings domain. The design follows the existing dark design system and reuses its primitives.

## Configuration Visibility Principle (the authenticity model)

Every capability is tagged and rendered by state. **Editable** controls (theme, interface scale, startup experience, crash-report consent, sign-out, plus the reused interactive centers) call a real mutator/hook and change real state. **Managed** rows (profile, MFA policy, AI provider & model, automatic-execution policy, data residency, digital-worker roster, compliance & audit, licenses, runtime health) show the real value read-only with its governing source and never expose a fake control. **Unavailable** capabilities are hidden from the interface entirely and listed only in the Capabilities inventory. This is enforced structurally by the catalog and locked by tests.

## Policy Inheritance / Runtime Integration Map

Each domain inherits from — and writes back to — an existing production system; Settings stores no duplicate state:

| Domain | Real backing (reused) | How policy propagates |
|---|---|---|
| Identity | auth session; enterprise org (`enterprise:org.*`); connectors | org/role/connector mutators (RBAC-gated, audited) |
| Security | MFA policy (`cloud:identity`); devices (`devices:*`); recovery (`recovery:run`) | existing mutators; MFA shown Managed (tenant policy) |
| Governance | governance chains/rules (`enterprise:governance.*`); feature flags (`flags:*`); federation policies (`fed:gov.*`) | `setChain`/`setRule`/`setOverride`/`addPolicy` — audited |
| Privacy | crash consent (`crash:setOptIn`); memory (`memory:*`); sharing (`fed:runtime.*`); residency (read-only) | crash toggle inline; deep data ops via their centers |
| AI | AI runtime (env/code) + autonomous-ops governance | Managed read-only; execution policy via governance |
| Workspace | ThemeProvider (`app:setThemeSource`); ScaleProvider; pref store | inline, propagate to native theme / scale / prefs |
| Organization | enterprise org + workforce registry + licenses | org CRUD (audited); worker roster read-only |
| Integrations | connectors (`connectors:*`); webhooks (`governance:*`) | connect/disconnect/sync — audited |
| Developer | ecosystem keys/oauth (`ecosystem:*`); plugins; sandbox | real CRUD in the developer console |
| Billing | commercial projection; `billing:checkout`; licenses | checkout redirect; usage/invoices read-only |
| System | updater; release-ops backup/recovery/migration; health; devices | existing mutators (audited); health read-only |

## Startup Experience Policy (the flagship, fully backed)

A real preference (`shell/startupPolicy.ts` + two keys in the existing pref store) with three modes — Resume where I left off, Open a specific section, and Smart (resume unfinished work, else Today's Intent). Every destination is validated against the real section registry, and a never-erroring fallback chain (Intent Home → Organization → Workspace → Settings) guarantees that if a configured startup section is ever hidden, removed, or the user loses access, NeuroPause redirects automatically instead of showing an error. The control previews the exact resolved destination (running the same resolver the shell uses at launch) so the fallback is transparent. It respects an optional permission predicate for the multi-user case.

## Features Reused / Duplicate Logic Eliminated

Reused wholesale: `SubscriptionCenter`, `TrustedDevices`, `EnterpriseOverview`, `FeatureFlagsCenter`, `ReleaseChannelCard`, and — by navigation — every real production center (Organization, Enterprise, Connectors, Developer, Sandbox, Workforce, Cloud, Federation, Commercial, Operations, Ops Center, Memory, Autonomous Operations). Reused hooks/IPC: `useTheme`, `useScale`, `useAuth`, the pref store, `ipc.releaseOps`. **No duplicate configuration state was created**: the flat legacy `SettingsView` was replaced by the constitutional shell and removed; every value shown is read live from its owning system. No new store, runtime, engine, governance/identity/AI logic, or IPC channel was added.

## Security & Governance

Settings introduces **no new attack surface**: it is renderer-only and every write flows through an existing channel that already enforces RBAC (via `secureBridge` → enterprise authz / `runtimeAuthz`) and, where applicable, writes the existing governance audit trail. Deep, privileged configuration is performed in the real centers under their existing permissions; Settings merely routes there. Managed values are read-only by construction (no mutator is attached to a Managed row), so nothing governed elsewhere can be silently overridden from Settings.

## Performance & Accessibility

The shell is a single lazy-loaded chunk; search is memoized and purely client-side over a static index (no IPC, no polling); reused centers keep their existing memoized fetches, so there is no duplicated fetching. Every control is a real, keyboard-focusable `<button>`/`<input>`/`<select>`; the search box and toggles carry labels; Managed/Unavailable states are conveyed by text (never color alone); the two-pane layout reflows.

## Authenticity Report

The layer surfaces only what is real. The **Capabilities inventory** is the honesty ledger: it lists every Managed capability with its governing source, and every Unavailable capability with why it is hidden — including the entire AI provider/model/routing/cost stack (environment/code-defined; no settings surface), in-app password change, passkeys, session list/revoke, NeuroID, encryption/certificates, per-user login history, consent store, account deletion, data-retention config, knowledge scopes, language/i18n, reduced-motion & high-contrast toggles, notification & density prefs, groups, the nine adapterless connectors, payment methods/credits, storage stats, and infrastructure discovery. The adversarial reviewer confirmed no fake or dead control exists anywhere in the shell, no Managed row is secretly editable, and no Unavailable capability is rendered as a control.

## Validation Results

Typecheck 0 (all workspaces, node + web). Lint 0 (`--max-warnings 0`). Tests: desktop **3,243 passed** (+15 new: the startup-policy resolver/fallback and the settings-catalog/inventory guardrails), sdk 15, cli 30, backend 259. Production build 0, with `SettingsShell` emitted as its own lazy chunk. Adversarial review: **SHIP** (four cosmetic/UX notes, zero constitutional violations).

## Remaining Genuine Gaps

Honestly deferred, and now visible in the Capabilities ledger rather than faked: an **organization-level mandatory/department/guest startup policy** (the user-level Startup Experience Policy is fully real; the org-mandated variant needs a shared org-policy store that does not exist and was intentionally not invented); a **read-only live value** for the Managed AI provider/model (a tiny read accessor could surface the resolved provider string in a future pass); and **per-section RBAC gating of startup** (would require a section-permission model; today section access is enforced at each section's data layer). Every other Unavailable item is a genuine, unbuilt capability listed in the inventory.

## Launch Readiness

Settings governs the entire operating system while the underlying architecture stays unified, non-duplicated, and production-authentic. An enterprise customer opening Settings finds one clean, searchable control surface where every switch is real, every read-only value names its source, and everything the platform cannot yet do is stated plainly rather than mocked. It adds no runtime, engine, governance system, identity platform, AI platform, or duplicated configuration — it is, precisely, a constitution over the systems that already exist.
