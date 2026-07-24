# PERG Grounding — REAL GOVERNANCE INPUTS + ANTI-FABRICATION RULES

> Shared source of truth for every Product Evolution & Release Governance Program
> (PERG) document. PERG is the **governance manual for how NeuroPause evolves after
> GA** — product decisions, release/version policy, prioritization, technical debt,
> roadmap, architecture stewardship, and long-term vision. It is **governance, not
> engineering, marketing, or a new platform.** It **adds no runtime and no
> architecture.** Every process must be **actionable** and **evidence-based**.

## The four-way evidence split (use on every roadmap/decision item)

| Label             | Meaning                                                                     | Maps to (NSSP ladder)       |
| ----------------- | --------------------------------------------------------------------------- | --------------------------- |
| **Implemented**   | Runs in the codebase today (cite file)                                      | L2                          |
| **Validated**     | Implemented **and** verified by executed tests/gates/reliability/benchmarks | L3–L4                       |
| **Proposed**      | Committed intent, near-term, grounded in a real backlog item                | L1 / near-term L0           |
| **Future Vision** | Aspirational, long-term, **not committed**, no timeline                     | L0 (explicitly speculative) |

Every roadmap entry, decision, or capability carries exactly one label. **1.x** items
are Implemented/Validated/Proposed; **2.x** items are **Future Vision** unless
explicitly grounded.

## Hard anti-fabrication rules (non-negotiable)

1. **No fabricated customers or customer feedback.** No named customer, no quoted request, no satisfaction/adoption number. Personas/segments only.
2. **No fabricated metrics.** Product KPIs are **definitions + telemetry source**, never values. No usage, revenue, or adoption figures.
3. **No fabricated roadmap achievements or progress.** No feature is "shipped/delivered" unless it is truly Implemented (cite file). Roadmap items carry their honest label; nothing is marked done that isn't.
4. **No unsupported business claims.** Investment/portfolio content is a framework; no budget, headcount, or financial figure is asserted.
5. **Honest maturity:** the platform is a **Validated Release Candidate** (`1.0.0-rc.1`). **No GA release, no post-GA release, no production fleet, no completed customer deployment exists.** PERG is the model to be _activated at GA_ — today it governs the real backlog.
6. **Elevate, do not duplicate.** Build on the prior docs (map below); PERG adds the _governance layer_ (policies, boards, lifecycle), not a restatement.

## Elevate-not-duplicate map

| Prior doc                                                                       | What it is                                                                                                    | PERG elevates it into…                                                                                |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| CDEP `docs/pilots/PRODUCT-EVOLUTION.md`                                         | pilot-evidence intake + prioritization rubric `P=(E×I×R)÷Effort` + ADR-001 + roadmap seeded with 7 open items | the **governance** prioritization framework + roadmap governance (quarterly, acceptance, deprecation) |
| EOSP `docs/operations/CONTINUOUS-IMPROVEMENT.md`                                | improvement backlog = real open items; maturity model                                                         | technical-debt **governance** (register, remediation workflow, retirement)                            |
| EOSP `docs/operations/EXECUTIVE-OPERATIONS.md`                                  | operational dashboards + risk register (blank specs)                                                          | executive **product** governance (portfolio/roadmap dashboards, investment framework)                 |
| EOSP `docs/operations/RELEASE-OPERATIONS.md`                                    | release calendar/hotfix/rollback operating model                                                              | release **governance** (version policy, SemVer, LTS, support lifecycle, deprecation)                  |
| GEAP `GOVERNANCE.md` + `docs/adoption/COMMUNITY-GOVERNANCE.md`                  | RFC process, community governance                                                                             | architecture **stewardship** (ARB, RFC workflow, breaking-change/compat policy)                       |
| NSSP `docs/science/manuals/RESEARCH-ROADMAP.md` + CDEP `RESEARCH-VALIDATION.md` | research questions + replication                                                                              | innovation **management** (research intake, experiment, prototype, validation gates)                  |
| GA `ENTERPRISE-GA-REPORT.md` §4/§5/§6                                           | TD-1..10, PR-1..8, Architecture Health matrices                                                               | the seeded **debt register** + **risk register** governed here                                        |

## The REAL backlog / debt register (seed — from `ENTERPRISE-GA-REPORT.md`, verbatim severities)

Technical debt (TD): **TD-1** Apple `id_token` not JWKS-verified — _High_ (`apps/backend/src/auth/providers/apple.ts`); **TD-2** marketplace unsigned-install bypass — _High_ (`apps/desktop/src/main/nps/packageService.ts:184`); **TD-3** rate-limit fail-open on Redis loss — _Medium_ (`rateLimit.ts:37`); **TD-4** no per-PR desktop CI / no macOS release automation — _Medium_; **TD-5** advisory rollback; federation DR modeled — _Medium_; **TD-6** no alerting/tracing/capacity forecasting — _Medium_; **TD-7** no renderer E2E/a11y tests; no coverage instrumentation — _Medium_; **TD-8** 930 KB renderer chunk — _Low–Med_; **TD-9** partial admin-scope UI — _Low_; **TD-10** FNV-1a in one non-security-critical path — _Low_.

Production risk (PR, likelihood×impact): **PR-1** forged Apple token — _High_; **PR-2** malicious unsigned package — _High_; **PR-3** rate-limit bypass in Redis outage — _Med_; **PR-4** regression from no desktop CI — _Med_; **PR-5** unsigned desktop build — _Med_; **PR-6** slow incident response (no alerting) — _Med_; **PR-7** botched update, no clean rollback — _High_; **PR-8** fabricated demo data — **Eliminated** (`SEED_STORE_ON_BOOT=false`).

The **7 governed open items** (the near-term Proposed roadmap): Apple JWKS (TD-1), signed-install enforcement (TD-2), per-PR desktop CI (TD-4a), macOS release automation (TD-4b), automated rollback (TD-5), alerting/tracing (TD-6), target-hardware desktop benchmarks (TD-7-adjacent).

## Real facts (cite these)

- Version `1.0.0-rc.1`; **SemVer** + **Keep a Changelog** + **Conventional Commits** adopted.
- Quality gates: typecheck 0, lint 0 (`--max-warnings 0`), **3,856 tests**, build 0, `npm audit --omit=dev` 0 prod vulns.
- CI: `backend-ci.yml`, `deploy-validation.yml`, `windows-release.yml` (no per-PR desktop / macOS).
- Telemetry substrate (for product analytics — definitions only): `/metrics` (`neuropause_http_requests_total{method,status}`, `_resident_memory_bytes`, `neuropause_pg_pool_connections{state}`), `/health`, `audit_log`.
- Classification chain: RC (GA report) → Validated RC ~76/100 (EVP) → science/adoption/ops/pilot manuals. No GA declared.

## Authoring rules

1. Every item carries one of Implemented / Validated / Proposed / Future Vision, with a citation for Implemented/Validated.
2. Elevate prior docs into governance; never restate them.
3. No fabricated customers, feedback, metrics, budgets, or roadmap progress.
4. The debt/risk registers are the real GA matrices — govern them, don't reinvent them.
5. No architecture change; roles/boards, never named people.
