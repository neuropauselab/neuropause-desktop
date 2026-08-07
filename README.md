# NeuroPause Desktop

**Status: `1.0.0-rc.14` lineage · Phase 8 (Release Candidate hardening) · 2026-08-07**

A local-first enterprise desktop workspace: **104 certified business modules across 13 families** (Finance 21, HR 15, Manufacturing 12, Maintenance 10, CRM 8, Warehouse 8, Sales 7, Procurement 7, Inventory 7, Projects 4, Executive 3, Helpdesk 1, Documents 1) on one descriptor-driven framework, plus AI workspace surfaces (assistant, workforce, knowledge, automation) — running on the user's machine with an optional backend peer. The module count is not a marketing number: it is locked by `apps/desktop/src/main/enterprise/modules/moduleCertification.test.ts`, which fails the suite if registration and certification ever disagree.

## Repository map — read this before anything else

```
apps/
  desktop/    ← THE PRODUCT. Electron main + preload + React renderer (~223k LOC, 620+ test files)
  backend/    ← optional Express peer: auth (OAuth PKCE), store, orgs, devices, billing, license, sync,
                semantic search (Postgres 16 + Redis 7 + Qdrant). Desktop degrades gracefully without it.
  cloud/      ← 91-line preview scaffold, superseded by packages/cloud-core. Not a running service.
packages/
  shared/     ← the ONE package the desktop imports: IPC channels + Zod contracts + types + pure engines
  cloud-core/ ← used by the backend (events, audit chain, gateway primitives)
  shared-cloud/ ← thin DTOs used by the backend
  …39 others  ← ⚠ DORMANT: real code, ZERO imports from any app. The desktop bundler cannot even
                resolve them (only @neuropause/shared is aliased). Kept as prior art; excluded from
                the release-verification path. Do not assume anything here ships.
```

That warning is the most important orientation fact in the repo: **of 44 packages, the shipping product uses one** (plus two in the backend). The certified enterprise functionality lives entirely inside `apps/desktop/src/main/enterprise/` and `packages/shared`.

## The enterprise module framework (the dominant surface)

A module is a **descriptor** (fields, actions, permissions) plus an **EnterpriseRecordStore** (atomic JSON, soft delete, revisions, schema-stamped envelope with quarantine-not-reset). `defineEnterpriseModule` gives every module RBAC, audit, timeline events, broadcasts, offline persistence and one generic CRUD IPC surface; the renderer's generic screen (list → detail → form → per-record AI summary) renders all 104 modules with zero per-module UI. Cross-module engines are pure functions in `packages/shared/src/types/` with co-located tests: GL posting, payroll with attendance proration, statutory filings, budget- and contract-gated PO approval, auto-reordering, bank-reconciliation write-back, depreciation, treasury.

## Getting started (development)

Prereqs: Node ≥ 20.11 (`.nvmrc`), Docker (for the optional backend infra).

```bash
npm install
npm run infra:up            # Postgres + Redis + Qdrant (backend optional — desktop runs without it)
cp .env.example .env
npm run db:migrate
npm run dev                 # backend + desktop, concurrently
```

Per-workspace gates (what CI runs): `npm run typecheck -w @neuropause/desktop` · `npx eslint apps/desktop packages/shared --max-warnings 0` · `npm test -w @neuropause/desktop` · `npm run build -w @neuropause/desktop`. Note: main-process tests execute under vitest but `tsconfig.node.json` owns their typecheck — run both, not one.

Release engineering: `npm run version:bump -- <semver>` moves both manifests atomically; `npm run package:mac` builds, generates third-party notices, packages, and **verifies artifacts against the update feed** (sha512) in one command; signing/notarization activate automatically when Apple credentials are present in the environment (fail-closed — a failed notarization fails the build). See `docs/guides/RELEASE-CHECKLIST.md`.

## Security model (short form)

Fail-closed IPC: every runtime channel must be RBAC-gated or explicitly allowlisted, asserted at boot (the app refuses to start otherwise). Secrets live in an OS-keychain-backed vault that refuses plaintext fallback. Privileged IPC actions append to a rotating audit log. Marketplace installs verify signatures fail-closed in packaged builds. Crash reporting is opt-in, redacted at rest, never uploaded.

## Documentation

`docs/` is large; start with `docs/guides/QUICK-START.md`, `docs/guides/INSTALLATION.md`, the per-family user guides in `docs/user/`, and `docs/legal/` (EULA/privacy drafts). The same set is bundled into packaged builds and reachable in-app (Getting Started → Documentation). Program history lives in the dated root reports — each now carries a banner marking it a historical snapshot; the current-state documents are `PHASE7-COMPLETION-REPORT.md` and the Phase 8 reports.

## Honest caveats

Pilot builds may be **unsigned** until Apple Developer credentials are installed in CI (the installation guide gives the real Gatekeeper steps). The mac artifact is arm64 (universal available via `package:mac:universal`); there is no Linux target. No usage telemetry exists — pilot feedback is local-capture + manual export by design. `packages/shared` is verified through the desktop suite rather than its own; the 39 dormant packages carry their own tests but none of that code ships.

## License

Proprietary — see `LICENSE`. Bundled open-source attributions: `THIRD-PARTY-NOTICES.md` (generated at packaging).
