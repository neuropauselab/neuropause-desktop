# NeuroPause — Enterprise GA Readiness Assessment

> **Historical snapshot — superseded facts.** This report was written in the
> `1.0.0-rc.1` era (bulk pass of 2026-07-24) and is retained as program history.
> Authoritative current facts: **104 certified modules across 13 families**
> (locked by `apps/desktop/src/main/enterprise/modules/moduleCertification.test.ts`),
> version lineage `1.0.0-rc.14`. See `PHASE7-COMPLETION-REPORT.md` and the
> Phase 8 reports for current state. Banner added by Phase 8 (8.11).

**Version assessed:** `1.0.0-rc.1`
**Assessment date:** 2026-07-18
**Environment:** CI-equivalent Linux workspace (Node 22), full monorepo checkout
**Classification:** **Release Candidate (RC)** — evidence below

> **⚠️ SUPERSEDED FOR THE CLOSED ITEMS (2026-07-24).** This is the RC-era
> assessment and is retained as the historical record. The **GA Execution Program**
> has since **closed the two HIGH blockers and the desktop/mac CI gap** identified
> below: TD-1 (Apple `id_token` now JWKS-verified), TD-2 (marketplace install now
> fail-closed), and TD-4 (per-PR desktop CI + macOS release automation added) — each
> with passing regression tests. The RC verdict and the "open item" language in the
> prose below refer to the state **as of 2026-07-18**. For the current, authoritative
> readiness decision see [`GENERAL-AVAILABILITY-REPORT.md`](GENERAL-AVAILABILITY-REPORT.md).
> The Technical Debt and Production Risk matrices in §4–§5 have been updated in place
> to mark the closed items.

---

## 1. Executive summary

NeuroPause is a large, coherent, production-grade TypeScript monorepo — a secure
Electron desktop shell plus a Node/Express/Postgres/Redis/Qdrant backend, with
shared contracts, an SDK, and a CLI. Across a full audit of every subsystem, the
**core platform is production-quality**: it typechecks and lints clean under a
zero-warning policy, passes **3,856 automated tests**, produces a clean
production build, and carries **zero production dependency vulnerabilities**. Its
security foundations (secure-by-default Electron, fail-closed IPC + RBAC,
backend-brokered PKCE OAuth, Argon2id, Keychain-encrypted refresh tokens, SSRF
guard, Ed25519 supply-chain signing) are real and tested.

It is **not yet Enterprise GA.** A small number of **honest, verified gaps** —
one HIGH-severity authentication item, one HIGH-severity supply-chain item, no
per-PR desktop CI, no macOS release automation, advisory-only update rollback,
and absent day-2 operational disciplines (alerting, tracing, capacity) — stand
between this build and a defensible general-availability claim. None of them is a
core-correctness failure; all of them are the finishing work that separates
"works and is well-built" from "safe to operate at enterprise scale without a
human filling the gaps."

The version string (`1.0.0-rc.1`), the code, and this assessment agree: **Release
Candidate**. The path to GA is short and concrete (§8).

### Classification rubric

| Class | Definition | NeuroPause? |
|---|---|---|
| Experimental | Core incomplete or unproven; gates red or absent | No — all gates green |
| Beta | Core works; significant known-unstable areas; limited validation | No — validation is broad and deep |
| **Release Candidate** | **Core production-grade and fully validated; a bounded, documented set of hardening/operational gaps remain before GA** | **Yes** |
| Enterprise GA | RC gaps closed; security hardening complete; release + day-2 operations automated and proven | Not yet |

---

## 2. Evidence: real measurements

Every number below was produced by executing the real toolchain in this
environment on the assessed commit. Nothing is estimated or carried over.

### 2.1 Quality gates

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **0 errors** across 5 workspace projects (sdk, shared, backend, desktop-node, desktop-web) |
| Lint | `npm run lint` (`eslint . --max-warnings 0`) | **0 warnings, 0 errors** |
| Tests | `npm run test` (workspaces) | **441 files / 3,856 tests passed**, 0 failed |
| Build | `npm run build` | **exit 0**, ~25 s |
| Format | `npm run format:check` | clean |

### 2.2 Test breakdown (real, per workspace)

| Workspace | Test files | Tests | Notes |
|---|---:|---:|---|
| `apps/desktop` | 409 | 3,548 | Vitest, ~212 s |
| `apps/backend` | 27 | 263 | Unit + HTTP, in-memory repo, ~15 s |
| `packages/sdk` | 2 | 15 | |
| `packages/cli` | 3 | 30 | |
| `packages/shared` | 0 | 0 | Types/contracts only |
| **Default gate total** | **441** | **3,856** | |
| `apps/backend` integration | +1 | — | `__integration__/organizations.test.ts`, **gated behind real Postgres** via `test:integration`; excluded from the infra-free gate by design |

The renderer model tests previously orphaned from the runner (`data`, `design`,
`developer`, `enterprise` dirs) were collected into the standard gate during this
RC; one stale assertion was corrected so all now pass.

### 2.3 Security & dependency posture

| Measure | Command | Result |
|---|---|---|
| Production vulnerabilities | `npm audit --omit=dev` | **0** (0 critical / 0 high / 0 moderate / 0 low) |
| All (incl. dev) vulnerabilities | `npm audit` | 11 total (1 critical, 7 high, 3 moderate) — **all in devDependencies** (build/test tooling), none reachable in shipped artifacts |
| TypeScript strictness | `tsconfig.base.json` | `strict: true` (repo-wide) |

### 2.4 Codebase scale

| Measure | Value |
|---|---|
| Source files (`.ts`/`.tsx`, excl. tests) | 1,290 |
| Source lines | 219,375 |
| Test files | 442 |
| Test lines | 62,270 |
| Documentation files (`docs/**/*.md`) | 120 |
| Backend build output | 1.4 MB |
| Desktop build output | 7.1 MB |
| Largest renderer chunk (`index-*.js`) | 930 KB (see Perf, §5) |

### 2.5 What is NOT measured here (and why)

Runtime latency, throughput, memory, and startup benchmarks are **not fabricated
in this report.** The instrumentation to produce them exists in the codebase
(`perfRecorder` / `PerfSampler`, runtime telemetry, backend Prometheus
`/metrics`, gateway p95, AI audit log), but real figures require the app running
on its **target hardware (macOS Apple Silicon)** against live infrastructure —
which a headless Linux CI environment cannot represent honestly. Producing those
numbers is a named GA task (§8), not a claim made here.

---

## 3. Enterprise Readiness Matrix

Per subsystem: **Ready** (production-grade, validated) · **RC** (works and is
tested, but has a bounded pre-GA gap) · **Modeled** (schema/surfaces exist and
are tested; not wired to a live external system).

| # | Subsystem | State | Evidence / basis | Gap to GA |
|---|---|---|---|---|
| 1 | Desktop shell (Electron main/preload) | **Ready** | Context isolation, sandbox, nodeIntegration off, strict CSP, allow-listed Zod IPC router; tested | — |
| 2 | Backend API (Express) | **Ready** | 263 unit/HTTP tests; request-id, validation, rate-limit, audit, error middleware | — |
| 3 | Authentication (OAuth/PKCE) | **Ready (GA)** | PKCE/RFC 8252, rotation + reuse detection, Argon2id — all tested; **Apple `id_token` now JWKS-verified (issuer/aud/expiry, RS256-pinned)**, `apple.test.ts` | — (TD-1 closed) |
| 4 | Runtime (sandbox/engines) | **Ready** | Engine load, power controls, RBAC actor resolver; tested | Runtime latency benches on target HW |
| 5 | Cloud / multi-tenant | **Modeled** | Schema, surfaces, sync core tested | Live tenant provisioning is modeled |
| 6 | AI Operations platform | **Ready** | plan→reason→orchestrate→simulate→decide→govern→learn; audit log; tested | Live-model latency benches on target HW |
| 7 | Marketplace / packages | **RC** | Download → integrity → signature pipeline; worker install fail-closed | **Unsigned app install bypasses gate when no signature present** (HIGH) |
| 8 | Developer platform / SDK | **Ready** | SDK 15 tests, CLI 30 tests; plugin SDK docs | — |
| 9 | Knowledge / semantic | **Modeled→Ready** | Embedding pipeline, Qdrant config, health/search services tested | Live Qdrant perf validation |
| 10 | Automation | **Ready** | Webhook store + SSRF guard + signing + matcher tested | — |
| 11 | Enterprise Administration | **Ready** | Orgs/RBAC/governance surfaces; Administrator Guide | Some scopes surfaced in UI only partially |
| 12 | Federation | **Modeled** | Runtime, governance, observability surfaces tested | **DR is modeled**, not live |
| 13 | Commercial / billing | **Ready** | Billing router/service/webhook, license core tested | — |
| 14 | Security | **RC** | See §7 — strong controls, 2 HIGH items open | Apple JWKS, marketplace signing |
| 15 | Deployment | **RC** | Real Docker/K8s/Helm manifests; kubernetes-validate PASS; air-gapped bundle | No macOS release automation in CI |
| 16 | Observability | **RC** | Prometheus `/metrics`, structured logs w/ redaction | **No alerting / tracing / capacity** |
| 17 | Documentation | **Ready** | 120 docs incl. full operator set (this RC) | — |
| 18 | API contracts (shared) | **Ready** | Zod IPC contracts shared desktop↔backend | — |
| 19 | Testing | **RC** | 3,856 tests green | **No renderer component/E2E/a11y; no coverage instrument** |
| 20 | Infrastructure / CI | **RC** | backend-ci, deploy-validation, windows-release workflows | **No per-PR desktop test CI; no macOS CI** |

**Tally:** Ready 12 · RC 6 · Modeled 2. No subsystem is Experimental or Beta.

---

## 4. Technical Debt Matrix

| ID | Item | Location | Severity | Note |
|---|---|---|---|---|
| TD-1 | ~~Apple `id_token` decoded, signature not verified against JWKS~~ **CLOSED (GA)** | `apps/backend/src/auth/providers/apple.ts:50-70` | ~~High~~ **Closed** | `verifyAppleIdToken` now verifies signature vs Apple JWKS with issuer/audience/expiry and `algorithms:['RS256']` pin, on the live `fetchProfile` path; `jwt.decode` removed. Evidence: `apple.test.ts` (8 tests, incl. forged/expired/wrong-aud/wrong-iss/alg-confusion rejection) |
| TD-2 | ~~Marketplace app install skips signature check when artifact is unsigned~~ **CLOSED (GA)** | `apps/desktop/src/main/nps/{signature.ts:68-87,packageService.ts:187-193,platform/index.ts:129}` | ~~High~~ **Closed** | Fail-closed policy: unsigned/untrusted/tampered artifacts refused before registry commit; `setAllowUnsignedInstalls(!app.isPackaged)` makes packaged builds fail-closed, dev permissive for the unsigned demo catalog. Evidence: `signature.test.ts` (5 tests) |
| TD-3 | Rate limiter fails open when Redis is unavailable | `apps/backend/src/middleware/rateLimit.ts:37` | **Medium** | Deliberate availability-over-strictness choice, documented in source; acceptable but should be alertable |
| TD-4 | ~~No per-PR desktop test CI; no macOS release automation~~ **CLOSED (GA)** | `.github/workflows/{desktop-ci.yml,macos-release.yml}` | ~~Medium~~ **Closed** | Per-PR desktop CI (typecheck/lint/test/build) added (TD-4a); macOS build+release pipeline added (TD-4b). Residual: macOS code-signing/notarization activate only when Apple cert secrets are present and cannot be exercised without a Developer ID cert + macOS runner |
| TD-5 | Update rollback advisory-only; federation DR modeled | update/rollback path; `docs/federation/disaster-recovery.md` | **Medium** | Real recovery is data-side restore; both honestly labelled |
| TD-6 | No alert routing, distributed tracing, or capacity forecasting | observability layer | **Medium** | Day-2 operational absence, documented in Operations Guide |
| TD-7 | Renderer component/E2E/a11y tests absent; no coverage instrumentation | `apps/desktop` test config | **Medium** | Model/logic layer is well covered; UI interaction layer is not |
| TD-8 | Largest renderer chunk 930 KB | `apps/desktop/out/renderer/assets/index-*.js` | **Low–Med** | Real bundle-size flag; route-level code-splitting already present for views |
| TD-9 | Some admin scopes surfaced in UI partially (subset of total) | enterprise admin renderer | **Low** | Backend model complete; UI exposure incremental |
| TD-10 | FNV-1a used where a cryptographic hash may be expected in one path | per Security Guide | **Low** | Non-security-critical usage; tracked in Security Guide |

---

## 5. Production Risk Matrix

Likelihood × Impact, with the real mitigation already in place and the residual
action for GA.

| ID | Risk | Likelihood | Impact | In-place mitigation | Residual action (GA) |
|---|---|---|---|---|---|
| PR-1 | Forged Apple `id_token` accepted (identity spoof) | ~~Low–Med~~ **Mitigated** | **High** | Apple flow is backend-brokered **and the `id_token` is now signature-verified vs Apple JWKS (issuer/aud/expiry, RS256-pinned)** — a forged token is rejected | **Closed via TD-1** (`apple.test.ts` proves forged/expired/mis-scoped rejection) |
| PR-2 | Malicious unsigned marketplace package installed | ~~Low~~ **Mitigated** | **High** | Integrity hash always checked; **install is now fail-closed — unsigned/untrusted/tampered artifacts are refused in packaged builds**; worker path fail-closed | **Closed via TD-2** (`signature.test.ts` proves refusal) |
| PR-3 | Rate-limit bypass during Redis outage | Low | Med | Documented fail-open; auth still required | Alert on limiter fail-open (TD-3, TD-6) |
| PR-4 | Regression ships because desktop tests not gated per PR | ~~Med~~ **Mitigated** | Med | Full suite runs locally **and is now gated per PR by `desktop-ci.yml`** | **Closed via TD-4a** |
| PR-5 | Unsigned desktop build shipped | Low | Med | Signing configured; env-gated | Enforce signing in mac release CI (TD-4) |
| PR-6 | Slow incident response (no alerting/tracing) | Med | Med | `/metrics` + structured logs exist to scrape | **Wire alert routing + tracing** (TD-6) |
| PR-7 | Botched update with no clean rollback | Low | **High** | Data-side restore documented (DR Guide) | Promote rollback from advisory to automated (TD-5) |
| PR-8 | Fabricated demo data mistaken for real metrics in prod | **Eliminated** | — | **`SEED_STORE_ON_BOOT=false`** in all prod configs; ecosystem/exchange seed tests assert empty | — (closed this RC) |

---

## 6. Architecture Health Matrix

| Dimension | Rating | Basis |
|---|---|---|
| Modularity / boundaries | **Strong** | Clean workspace split (apps/desktop, apps/backend, packages/shared·sdk·cli); shared Zod contracts are the single cross-boundary surface |
| Type safety | **Strong** | `strict: true` repo-wide; typecheck 0 across 5 projects |
| Test architecture | **Strong (logic) / Gap (UI)** | 3,856 tests; pure-model + HTTP layers well covered; renderer interaction layer not |
| Security architecture | **Strong, 2 open items** | Defense-in-depth (see §7); TD-1/TD-2 are finishing items, not design flaws |
| Reuse discipline | **Strong** | "Lens" reuse pattern; no duplicate platforms/stores; new surfaces compose existing IPC |
| Data authenticity | **Strong** | No-fabrication mandate enforced; empty-state twins tested; prod seed gated off |
| Observability | **Adequate, incomplete** | Real metrics/logs; alerting/tracing/capacity absent |
| Deployability | **Strong (server) / Gap (desktop CI)** | Real K8s/Helm/air-gapped; validated. Mac release manual |
| Documentation | **Strong** | 120 docs; complete operator set; honesty labels throughout |
| Coupling to external systems | **Controlled** | Modeled integrations clearly labelled; not silently faked |

---

## 7. Security assessment (summary)

**Verified, tested controls:** secure-by-default Electron (context isolation,
sandbox, no node integration, strict CSP); allow-listed + Zod-validated IPC with
a **fail-closed RBAC permission gate**; backend-brokered OAuth (PKCE / RFC 8252)
with no client secrets on the desktop; refresh-token **rotation + reuse
detection**, stored server-side only as SHA-256 hashes and encrypted at rest via
Keychain (`safeStorage`); **Argon2id** password hashing; **SSRF guard** on
outbound webhooks (tested); **Ed25519** supply-chain signing for manifests;
audit + request-scoped logging with secret redaction; **`SEED_STORE_ON_BOOT`**
gating so production ships no fabricated catalog data.

**Former hardening items (both now CLOSED in the GA Execution Program):** Apple
`id_token` JWKS verification (TD-1/PR-1) — now verified with issuer/audience/expiry
and an RS256 pin (`apple.test.ts`, 8 tests) — and marketplace unsigned-install
enforcement (TD-2/PR-2) — install is now fail-closed for unsigned/untrusted/tampered
artifacts in packaged builds (`signature.test.ts`, 5 tests). Details and the full
backlog are in [`docs/guides/SECURITY-GUIDE.md`](docs/guides/SECURITY-GUIDE.md); the
GA decision is in [`GENERAL-AVAILABILITY-REPORT.md`](GENERAL-AVAILABILITY-REPORT.md).

**Dependency posture:** **0 production vulnerabilities** (`npm audit
--omit=dev`); the 11 advisories are entirely in build/test tooling.

---

## 8. Path to Enterprise GA

Ordered, concrete, and bounded. Closing these moves the classification from RC to
GA; nothing here is open-ended research.

**Security (blockers):**
1. **TD-1** — Verify Apple `id_token` against Apple's JWKS before trusting claims
   (add `jose`/JWKS client; the seam and TODO already exist in `apple.ts`).
2. **TD-2** — Require a valid signature (or explicit non-empty publisher trust
   store) for marketplace **app** install; align with the already-fail-closed
   worker path.

**Release engineering:**
3. **TD-4** — Add a per-PR desktop CI job running typecheck + lint + the 3,548
   desktop tests; add macOS packaging/signing/notarization to release CI
   (mirror the existing `windows-release.yml`).
4. **TD-5** — Promote update rollback from advisory to an automated, tested path.

**Operations (day-2):**
5. **TD-6** — Wire alert routing off `/metrics`, add distributed tracing, and a
   capacity-forecasting baseline; make the rate-limit fail-open (TD-3) an alert.

**Validation:**
6. Produce **real runtime benchmarks** on macOS Apple-Silicon target hardware
   against live infra (the instrumentation already exists — §2.5).
7. **TD-7** — Add renderer component/E2E smoke + accessibility tests and coverage
   instrumentation.

**Nice-to-have:** TD-8 bundle trim, TD-9 remaining admin-scope UI, TD-10 hash
review.

When items 1–6 are closed and green in CI, NeuroPause meets the Enterprise GA bar
in the §1 rubric.

---

## 9. Verdict

> **NeuroPause 1.0.0-rc.1 is a Release Candidate.**
>
> The core platform is production-grade and fully validated by real gates — 0
> typecheck errors, 0 lint warnings, **3,856 passing tests**, a clean production
> build, and **0 production dependency vulnerabilities** — on a large
> (219k-LOC), well-architected, honestly-labelled codebase with no fabricated
> data. A **bounded, documented** set of hardening and operational items (two
> HIGH security finishes, desktop/macOS CI, automated rollback, day-2
> observability, and target-hardware benchmarks) remain before a defensible
> general-availability claim. That is precisely the definition of a Release
> Candidate, and it is the classification the version number already asserts.
>
> **Recommendation:** ship as RC; close §8 items 1–6 to reach Enterprise GA.

The release process that gates every build is in
[`docs/guides/RELEASE-CHECKLIST.md`](docs/guides/RELEASE-CHECKLIST.md); the
documentation index is [`docs/README.md`](docs/README.md).
