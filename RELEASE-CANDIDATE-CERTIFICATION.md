# NeuroPause Desktop — Release Candidate Certification Report

**Phase 9 · 2026-08-07 · certified against origin HEAD `90e3517` + the Phase 9 certification fixes · v1.0.0-rc.14 lineage**
Audience: founders, enterprise customers, investors. Method: two independent evidence audits over the full repository (every claim carries file-level evidence in the underlying reports), four workflow chains traced leg by leg against mechanisms and tests, security controls re-confirmed at their enforcement points, and six defects found by certification **fixed under the standard gates** rather than papered over. Nothing below is aspirational; where something is partial or absent, it says so.

---

## 1. Certificate

NeuroPause Desktop is certified as an **Enterprise Release Candidate** for pilot deployment, on these grounds: a 104-module ERP core whose count, families, and descriptors are locked by an executable certification test; four business chains (lead-to-cash, procure-to-pay, hire-to-pay, inventory-to-manufacturing) whose every wired leg is proven by co-located tests — with the unwired legs disclosed by name in §6; a fail-closed security posture confirmed at its enforcement points; data safety machinery (registry-driven backup, quarantine-not-reset stores, migration rollback) that now covers the AI Memory and Knowledge Graph stores as well; a release pipeline that cannot ship an unverified artifact; and a documentation set a pilot company can actually use, bundled into the product. **The remaining blockers are exclusively external**: Apple signing credentials, the update-feed host, counsel review of legal drafts, and per-connector OAuth verification — enumerated in §10.

## 2. Repository health

47 workspaces; the shipping product is `apps/desktop` (~223k LOC, 620+ test files, ~5,640 tests after Phase 9), `packages/shared` (55.8k LOC of contracts and pure engines), `apps/backend` (optional peer; 38 test files). Zero TODO/FIXME debt markers, zero `@ts-ignore`, lint at `--max-warnings 0`, strict TS. The 39 dormant packages (~58.5k LOC) are quarantined out of the release gate and disclosed in the README as the lead orientation fact. Version discipline: atomic two-manifest bump script, tag↔version CI guard, backfilled CHANGELOG, release notes baked into each build. **Certification fixes landed in Phase 9**: `package:dir` no longer breaks on missing notices; AI Memory and Knowledge Graph now quarantine corrupt files instead of silently starting empty (the two stores the Phase 8 envelope missed — closing a silent-data-loss path); production costing refuses dangling production-order references; the vendor bill's source-PO field — previously declared readOnly with no writer, permanently empty — is now writable and guarded against unreal POs; the Developer Center SDK panel carries an honest not-yet-published notice. One audit finding was **refuted by evidence**: the backend store seed is not orphaned — `seedStoreIfEmpty()` runs at boot and `tsx src/db/seed.ts` is the documented reset path (a `db:seed` alias was added).

## 3. Security report

Confirmed at enforcement points, not from documentation: boot-time fail-closed IPC classification (`assertAllChannelsClassified` throws and refuses app start on any unclassified runtime channel — it caught a real gap during Phase 8 landing, which is the system working); OS-keychain vault that refuses plaintext fallback and clears rather than half-trusts corrupt ciphertext; per-action audit logging on privileged channels over a bounded rotating log, with a tamper-evident hash chain on governance logs; marketplace package installs fail-closed on signature state in packaged builds; CSP with `default-src 'self'`/`object-src 'none'`/`frame-ancestors 'none'`; IPC sender-origin allowlist; `contextIsolation`+`sandbox`+`nodeIntegration:false` on every window; OAuth per RFC 8252 (PKCE, random loopback path, state check, encrypted refresh-token persistence, pre-expiry rotation, server-side revoke); crash reporting opt-in, redacted at rest, never uploaded. **Score: 9/10** — deductions: the IPC audit log uses bounded rotation but not the hash chain, and there is no SIEM/WORM export (both in ROADMAP).

## 4. Quality report

~5,640 desktop tests + backend suite, green on Electron 42.8.1; every workflow leg in §6 marked WIRED carries named test evidence; the module registry is test-locked at 104/13; Phase 9 added guard tests for each certification fix, including additive-omission proofs (the FW discipline). Known quality debts, disclosed: no single end-to-end chain test spans a whole workflow (legs are proven in isolation); the store envelope now covers the nine highest-value stores while ~60 smaller writers remain on the legacy pattern (priority list in ROADMAP); `knowledgeBench` carries a documented wall-clock flake under load. **Score: 8.5/10.**

## 5. Architecture report

One framework carries the enterprise surface: descriptor + record store + generic IPC with automatic RBAC/audit/timeline/broadcast, and a single generic UI for all 104 modules — new modules inherit everything. Pure engines live in `packages/shared` with co-located tests; cross-module integration goes through injected optional stores (additive, byte-identical when omitted — proven each time); the composition root wires every subsystem and refuses to boot on classification gaps. Honest architectural boundaries: the Enterprise API is **in-process** (IPC), not a network service; the Digital Twin is a read-only projection, self-described; platform centers are Preview-labeled; the desktop is local-first with the backend as an optional peer behind a three-tier URL config. **Score: 9/10** — deduction: whole-file JSON persistence has a known scalability ceiling (documented; adequate for pilot volumes).

## 6. Enterprise workflow validation (the honest map)

**Hire-to-pay: COMPLETE** — every leg wired and tested: recruitment → hire-creates-employee → shifts/leave/holidays → attendance import+confirm → statutory payroll with LOP proration → one idempotent GL accrual → disbursement (Dr 2200/Cr 1000) → payslips → register → PF/ESI/PT/24Q filings. **Lead-to-cash: STRONG with two typed links** — lead→customer conversion, quote→order, order→invoice, invoice↔payment reconciliation, invoice→GL and payment→GL (idempotent, FX-aware) all wired+tested; lead→opportunity and opportunity→quote are validated typed references, not one-click conversions. **Procure-to-pay: STRONG with one re-keyed leg** — PR→approval→PO with budget (off/warn/block) and vendor-contract gates, PO→goods receipt→real stock movement, bill→AP+expense+ITC posting, bill→vendor payment→GL all wired+tested; the goods-receipt→bill leg is re-keyed by hand (the source-PO link is now at least writable and guarded — Phase 9). **Inventory/manufacturing: OPERATIONALLY COMPLETE, FINANCIALLY UNLINKED** — immutable movement ledger with reconciler, warehouse ops, BOM→work order→consumption/output, MES execution, FIFO/WAVG valuation all wired+tested; **costing is hand-entered (now guarded against dangling orders) and neither valuation nor costing posts to the GL — there is no inventory asset, COGS, GR/IR, or WIP account**. Consequence stated plainly: GL margin excludes cost of goods; inventory value lives in the operational ledger; period-end inventory journals are manual (the periodic-inventory pattern, supported today). Perpetual-inventory accounting is the largest named gap on the Finance roadmap.

## 7. Performance report

Startup instrumented (boot-phase marks in Release Diagnostics), tested metrics core, 10+ bench suites, virtualized lists, runtime CPU/memory sampling with Prometheus export on the ops surface. Not yet done: budgets calibrated on target hardware, long-session soak, packaging-time perf of the universal build. **Score: 7.5/10.**

## 8. Pilot readiness

**82%** (from 74% at Phase 8.1 — certification fixes + completed documentation set + refuted seed finding). Ready: data safety incl. memory/graph quarantine, diagnosability, truthful install + per-family user guides + in-app help + first-run legal step, pilot tooling, the Pilot Handbook (new, `docs/pilots/`), and two IdP registrations configured locally (GitHub, Entra — each needs one verified round-trip). Open, all external: signed artifact (largest), live feed host, counsel sign-off, connector round-trips.

## 9. GA readiness

**60%.** Beyond the pilot gate: a pilot actually run and its fixes landed; perpetual-inventory GL integration (or a deliberate periodic-inventory product stance); the deferred UX items (tables, forms, sidebar 2.0); toolchain generation (ESLint 9/vite/vitest); functional currency (C3); SDK publication or removal of the preview surface; live connector traffic at scale. Enumerated with reasons in `ROADMAP.md`.

## 10. Risk register + remaining human-gated items

| # | Risk / item | Severity | Mitigation / owner |
|---|---|---|---|
| R1 | Unsigned builds until Apple credentials land | High (pilot-blocking) | Pipeline complete + fail-closed; **owner: founder — cert + 3 secrets into Actions, then one tagged run proves signing AND feed together** |
| R2 | Update feed host unproven (DNS unresolved from audit environment; nothing ever published for this lineage) | High | `curl -sI https://neuropause033.com/updates/latest-mac.yml`; first tagged run publishes; CI probes reachability |
| R3 | Perpetual-inventory GL absent (no COGS/inventory asset/GR/IR/WIP) | Medium (scope, not defect) | Disclosed to pilots (Handbook §honest boundaries); periodic-inventory journals supported; roadmap item |
| R4 | Legal drafts unreviewed | Medium | Counsel review; presentation flow already live |
| R5 | Store envelope partial beyond the nine core stores | Medium | Highest-value stores covered (incl. all business records); adoption list in ROADMAP |
| R6 | No in-place update rollback | Low | Deliberate (`allowDowngrade:false`); rollback = reinstall previous DMG; version-stamped stores make downgrade data-safe; documented |
| R7 | Connector registrations: 2 configured locally, 0 runtime-verified; local env values don't travel to CI/backend | Medium | One interactive round-trip each; mirror values into deployment environments |
| R8 | No end-to-end chain test | Low | Legs individually tested; E2E harness is a roadmap QA item |
| R9 | SDK surface is preview-labeled but unpublished | Low (now labeled) | Publish or retire per product decision (ROADMAP) |
| R10 | Whole-file JSON persistence ceiling | Low (pilot volumes) | Documented; revisit at scale |

**Remaining human-gated (nothing below is unblockable by code):** Apple Developer ID certificate + notarization credentials → Actions secrets · Windows Authenticode certificate (optional for mac pilot) · update-feed DNS/serving + deploy key · counsel review of `docs/legal/` · one OAuth round-trip each for GitHub + Entra, registrations for remaining providers · the first tagged release run (`npm run version:bump -- 1.0.0-rc.15` → CHANGELOG → tag) — the single act that converts "implemented" into "verified" for R1 and R2 simultaneously.

---

*Underlying evidence: PHASE8-COMPLETION-REPORT.md · the Phase 8.1 verification audit · the Phase 9 stage audits (platform surfaces, installer behaviors, security spot-confirmation, CI/CD, and the four-chain workflow map with file:line citations) · moduleCertification.test.ts (the executable lock). This report states nothing those artifacts cannot back.*
