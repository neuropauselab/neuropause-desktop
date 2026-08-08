# NeuroPause — Phase 5 Closeout: Enterprise Pilot + Release Readiness

**Program:** Global Product RC → Pilot Readiness · **Phase:** 5 · **Date:** 2026-08-08
**Build:** `1.0.0-rc.15` · **Baseline commit referenced by docs:** `0a040e2` · **Branch:** `phase6-stage13-enterprise-digital-twin-platform`

## Executive summary

**Status: PHASE 5 — TECHNICALLY PILOT READY · EXTERNAL RELEASE BLOCKERS — OPERATOR ACTION REQUIRED.**

Everything achievable without operator-held credentials or on-device GUI hardware is complete and verified: documentation coherence, the full pilot-enablement doc set, the product maturity matrix and release-blocker register, release/security/version audits, and the automated gate. What remains before a *distributable, signed, externally-installable* pilot is **operator/human** work — Apple/Windows signing credentials, update-feed hosting, secret rotation, and on-device macOS GUI sign-off — none of which can be honestly performed or faked from this Linux cloud environment. The exact operator checklist is at the end.

No capability is claimed GA. RC ≠ GA. No signing, notarization, or GUI verification is claimed without evidence.

## Build / commit / repository

- Version `1.0.0-rc.15`, canonical and CI-guarded in `package.json` + `apps/desktop/package.json` (tag↔version guard). `apps/backend` (`0.1.0`) and `apps/cloud` (`0.0.0-preview.1`) are independently-versioned service apps, not the product version.
- CHANGELOG now carries a `[1.0.0-rc.15]` section (was missing; rc.15 work had been left under `[Unreleased]`).
- The cloud build environment is **not** the git repo; changes are delivered to the operator as a tarball and committed on the Mac. Git safety/audit (Steps 2 & 50) are operator-run — commands provided in the delivery.

## Test counts (cloud run, this phase)

- `typecheck:release` — **PASS** (backend + desktop node/web).
- `lint:release` — **PASS** (exit 0).
- `test:release` — **5702 / 5703 passed**, 630/631 files. The single miss is `apps/desktop/src/main/knowledgeAssets/knowledgeBench.test.ts` (Stage-7 perf bench): measured `compose=131ms` vs an absolute `≤120ms` budget on the shared cloud VM; matrix/lineage/dashboard sub-budgets pass with wide margins. **Not a functional regression** and not caused by Phase-5 changes (no `knowledgeAssets` source was touched); it passes on the calibrated hardware where the 5,703-green baseline was set. Tracked as **RB-13** (make the budget hardware-relative / CI-gated; do not silently weaken).
- `docs:validate` — **47/47 clean** (42 governed + 5 operator/legacy).

## Documentation status

- **Coherence (Step 3): DONE.** Pre-rename surface names updated to current Phase-2 labels in the 5 living operator/validation docs (`opscenter`→Operations, `product-ops`→Release Ops, `workforce-center`→Workforce Admin, knowledge "fabric"→Enterprise Knowledge), code identifiers/paths preserved. The dated `ERP-COMPLETION-REPORT-2026-08-05.md` is preserved as a historical snapshot with a clarifying note.
- `scripts/docs-validate.cjs` extended with an `operatorDocuments` set (terminology coverage) so these legacy docs stay clean going forward.
- New governed docs (all validate clean, honesty-labelled): Pilot Support Runbook, Pilot Acceptance Criteria, Pilot Test Pack, Pilot Feedback Form, Telemetry & Diagnostics Policy, Performance Pilot Baseline, Product Maturity Matrix, Release Blocker Register, Pilot Release Notes. `DOWNLOAD-CATALOG`, `DOCUMENT-MANIFEST.json`, `DOCUMENTATION-INDEX.json`, and `WEBSITE-PRODUCT-DATA.json` updated to pilot state.

## Architecture (unchanged, documented)

Local-first desktop enterprise plane (renderer → secure IPC → Electron main → local JSON stores) + thin cloud control plane (Express → PostgreSQL 16 → Redis 7). No ERP/enterprise data was migrated to Postgres. The enterprise API/SDK remains in-process/typed IPC — **no public HTTP Enterprise API** is claimed.

## Capability status (see docs/product/PRODUCT-MATURITY-MATRIX.md)

- **Desktop:** implemented; logic/view-models covered by the gate; **GUI verification PENDING** (human macOS task).
- **Backend / PostgreSQL / Redis:** certified Phase 3 (auth, tenancy, authz, store, health, failure/recovery); backend suite re-verified (418 tests).
- **Authentication / tenant isolation:** VERIFIED (server-side; argon2; keychain-encrypted refresh; cross-tenant returns not-found).
- **ERP (104 modules/13 families):** local-first, best-tested (Finance ~192, HR ~83, Memory ~235, Workforce ~219); persistence VERIFIED by gate, GUI PENDING.
- **AI Workforce / Automation:** governed lifecycle VERIFIED; live AI = EXTERNAL (provider).
- **Knowledge:** lexical VERIFIED; semantic = EXTERNAL (Qdrant+embeddings).
- **Digital Twin / Industry / Enterprise Marketplace / Cloud / Federation:** PREVIEW (seeded/in-memory).
- **Operations:** honest status VERIFIED.
- **Connectors / Marketplace / Sync / Mobile:** implemented; connectors/sync provider-gated; marketplace install worker-only.

## Security status

- Shipping code: **no hardcoded private keys or live secrets** (all high-signal matches are test fixtures). No secrets logged (errors carry `requestId`). `.env*` are git-ignored.
- **Real secrets exist in local gitignored dotfiles** (`.env.github`, `.env.entra`, `apps/backend/.env`, `.env`) — GitHub OAuth secret, Microsoft Entra secret, backend `JWT_ACCESS_SECRET` + DB password, `MEILI_MASTER_KEY`. **Operator must rotate/revoke + move to secret management (RB-4).** Values were never printed.
- No SOC 2 / ISO 27001 / GDPR / HIPAA certification claimed.

## Signing / notarization / update status

- macOS signing + hardened runtime + notarization: **wired, credential-gated** (`electron-builder.yml`, `scripts/notarize.cjs`, `macos-release.yml`) → fails open to unsigned. **BLOCKED — Apple credentials required (RB-1).**
- Windows Authenticode: env-driven, **certificate required (RB-2)**; no RFC3161 timestamp configured.
- Auto-update: `electron-updater` → `https://neuropause033.com/updates` (channel `beta`); **needs hosted feed + a signed build to serve (RB-3).**
- No signed/notarized artifact was produced (cannot be, honestly, in this environment). No fake checksums/links published.

## Performance status

Pilot baseline method documented (`docs/enterprise/PERFORMANCE-PILOT-BASELINE.md`); real cloud test-timings captured as build-health signals; user-facing latencies marked PENDING GUI CAPTURE with exact procedure. Full load/stress testing is a future phase.

## Accessibility status

Not verified this phase — requires the running GUI on macOS (PENDING GUI, folds into RB-9). Documented as outstanding.

## Pilot documentation / acceptance / artifacts

- Pilot Support Runbook, Acceptance Criteria (per-item honest status), Test Pack ("suggested evaluation sequence", no fixed duration), Feedback Form: **created.**
- Release artifacts: **none produced** (signing/GUI blocked); Download Catalog states "Pilot artifact — distribution controlled by NeuroPause", no fake links.

## Blockers (see docs/product/RELEASE-BLOCKERS.md)

- **P0:** none outstanding that engineering can resolve.
- **P1:** RB-1 (macOS signing/notarization — operator), RB-3 (update-feed hosting + signed build — operator), RB-4 (secret rotation — operator/security), RB-9 (macOS GUI sign-off — human).
- **P2:** RB-2 (Windows signing), RB-5 (OAuth registration), RB-6 (AI provider), RB-7 (Qdrant), RB-10 (standalone checksums).
- **P3:** RB-8 (billing), RB-11 (.env.example dev password), RB-12 (stale feed URL in 2 packaging docs), RB-13 (perf-bench absolute budget).
- **Resolved this phase:** legacy-doc terminology, CHANGELOG rc.15, documentation coherence.

## External dependencies

AI provider · Qdrant + embeddings · OAuth (GitHub/Entra) registration · Razorpay billing · update-feed hosting · Apple + Windows signing credentials. Each is off/blocked until the operator configures it; the product shows honest states, never fabricated ones.

## Operator action checklist

See the delivery message and RELEASE-BLOCKERS RB-1…RB-4 for the exact actions, credentials, and verification commands (macOS signing/notarization, Windows signing, update-feed hosting, secret rotation, and GUI sign-off).

## Recommended next phase

After operator credentials are supplied and GUI sign-off is done: cut a **signed, notarized RC build**, serve it from the update feed, run the on-device install→update→recovery certification (RB-9/RB-3), then re-evaluate for a controlled external pilot. **Do not** start GA / global launch / new feature development until then.

## Final status

**PHASE 5 — TECHNICALLY PILOT READY. EXTERNAL RELEASE BLOCKER — OPERATOR ACTION REQUIRED.** All independent engineering and documentation work is complete and verified; the remaining path to a distributable signed pilot is operator/human action, itemized above.
