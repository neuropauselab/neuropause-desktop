# RC1 Audit — 04: Desktop Application (Part 6)

Evidence: `packages/shared/src/ipc/channels.ts` (source of truth for the IPC
surface), the dev-machine boot log (2026-07-03), directory inventories of
`src/main` and `src/renderer/src/views`, a repo-wide grep of
`app.getPath('userData')`, the in-session read of `shell/sections.ts`, and the
live suite (66 files / 525 tests, all main-process).

## 1. Process & IPC security model

Electron with context isolation; the renderer reaches the main process only
through the preload bridge. Every invokable channel is declared in a single
allowlist and registered through `secureBridge` with a **Zod request schema**;
sensitive mutations carry an `audit: true` flag feeding `audit.log`. Numbers,
stated exactly: **360 channels defined** in the map; the boot log registers
**327 secure handlers + 9 plain handlers (336)**. The ~24-channel delta is
Finding A4-1 below.

## 2. IPC surface by domain (grep of channels.ts)

Largest groups: ecosystem 53, federation 44, cloud 43, enterprise 23,
workforce 14, org 13, catalog 13, plugins 12, memory 12, connectors 12, nps 11,
runtime 9, graph 9, registry 7, update 6, auth 6, unified 5, onboarding 5,
crash 5, backup 5, livesync 4, feedback 4, app 4, timeline 3, perms 3,
founder 3, flags 3 — plus ~15 smaller groups (license, pilot, diagnostics,
recovery, platform, relationship, …) summing to 360.

## 3. Sections & views

18 sidebar sections (`sections.ts`, session-verified): home, organization,
enterprise, developer, ecosystem, cloud, federation, store, workspace,
operations, workforce, connectors, memory, automations, notifications,
analytics, settings, and **welcome** (added Sprint 5). 21 view files render
them (some sections host multiple panels). The onboarding wizard mounts as an
overlay in `AppShell`, gated on persisted `firstRun`. Known posture: the
renderer has no unit harness — all 525 tests are main-process; renderer changes
are verified by typecheck + lint + eyeball.

## 4. Main-process subsystems (directory inventory)

**Local AI OS:** ai, intelligence, memory, graph, timeline, search,
recommendations, founder. **Connect & apps:** connectors, unified, plugins,
registry, catalog, nps. **Org/enterprise tiers:** organization, enterprise,
ecosystem, federation, workforce, cloud. **Safety & operations:** security,
permissions, recovery, backup, migration, diagnostics, releaseOps, updater,
support, trace, platform, runtime, services. **Commercial & early access
(Sprints 4–5):** featureFlags, license, onboarding, feedback, pilot.
**Infrastructure:** auth, ipc, config, logger, window/windowState, menu,
buildInfo, runtimeCore, `__bench__`. All of these initialize in the boot log;
their behavior is covered by the 525-test suite at the service layer.

## 5. userData persistence ledger (46 files, grep-verified)

Pattern throughout: atomic `.tmp`-then-rename JSON writes at mode 0600.
**Encrypted binaries:** `vault.bin`, `connector-vault.bin` — secrets are not
plaintext on disk (mechanism verified in A7). **Logs:** `audit.log`,
`crashes.log`, `telemetry.log` (+ their JSON stores). **Domain stores:**
memory/graph/timeline-adjacent (`memory.json`, `memory-audit.json`,
`graph.json`), connectors (`connectors.json`, `unified-store.json`,
`registry.json`, `plugins.json`), the five ecosystem-, three enterprise-, five
federation-, three workforce-, four cloud-prefixed stores, updater
(`update-history.json`, `update-prefs.json`), `window-state.json`, and the
Sprint 4–5 set: `feature-flags.json`, `license-status.json`,
`livesync-queue.json`, `livesync-mirror.json`, `onboarding.json`,
`feedback.json`, `pilot.json`. **Legacy:** `sync-state.json` belongs to the
superseded local cloud/sync simulator (see A4-2).

## 6. Findings

- **A4-1 — channel reconciliation.** 360 defined vs 336 registered at boot.
  Action for A9: enumerate the ~24 defined-but-unregistered channels; prime
  suspects are the superseded cloud/sync simulator's channels. Dead
  definitions are allowlist surface that should be pruned or explicitly marked
  deprecated.
- **A4-2 — legacy sync simulator artifacts are evidence-backed.** Both its
  `userData` file and (per A4-1) likely its channels persist. Retirement was a
  carried Sprint-4 item; this audit upgrades it from "tracked" to "verified
  present, with a concrete artifact list".
- **A1-2 — fully closed.** Developer-verified: `git log --all -- .env` and
  `git ls-files | grep .env` both empty — no secrets ever committed; private
  remote live, `main` tracking `origin/main`.

Next increment: **A5 — connector audit** (adapter-by-adapter, four-tier
honesty marking: real API / OAuth-ready / framework-only / absent).
