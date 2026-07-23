# NeuroPause — Open-Source Strategy & Contribution Process

> **STATUS: NeuroPause is currently proprietary (see [`LICENSE`](../../LICENSE) — Proprietary, All Rights Reserved; `package.json` declares `"license": "UNLICENSED"`). Everything below is a PROPOSED open-source path and an internal/partner contribution process — not a description of current state.**
>
> There are **no public repositories, no external contributor community, no stars/forks/download counts** today, and none are implied anywhere in this document. Where a process is genuinely usable right now, it is usable **only** for authorized internal engineers and contracted partners operating **under the proprietary license and a signed CLA** — not the general public.

A GEAP adoption-enablement artifact. It does not add runtime, architecture, or platform. It defines the **contribution mechanics** (usable now, internally) and the **decision framework** for an eventual public path (proposed). It builds on real assets: the CI gates in [`.github/workflows/backend-ci.yml`](../../.github/workflows/backend-ci.yml), the lint/format/typecheck/test scripts in [`package.json`](../../package.json), the code-standard configs (`.eslintrc.cjs`, `.prettierrc`, `tsconfig.base.json`), and the security policy in [`SECURITY.md`](../../SECURITY.md).

---

## Legend — read every section through this lens

| Tag               | Meaning                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 🟢 **USABLE NOW** | Works today for **internal/partner** contributors under the proprietary license + CLA. Grounded in a real repo asset.             |
| 🟡 **PROPOSED**   | A future path or structure. **Not staffed, not adopted, not public.** Requires an explicit business + legal decision to activate. |

Nothing tagged 🟢 implies public availability. Nothing tagged 🟡 implies a commitment or a date.

| #   | Section                       | Overall tag                       |
| --- | ----------------------------- | --------------------------------- |
| 1   | Public repositories           | 🟡 PROPOSED                       |
| 2   | Contribution guide            | 🟢 USABLE NOW (internal/partner)  |
| 3   | Governance & maintainer roles | 🟡 PROPOSED                       |
| 4   | Issue workflow                | 🟢 internal / 🟡 public templates |
| 5   | Pull request standards        | 🟢 USABLE NOW                     |
| 6   | Maintainer model              | 🟢 internal core / 🟡 external    |
| 7   | Security disclosure           | 🟢 USABLE NOW                     |
| 8   | Community code standards      | 🟢 USABLE NOW                     |

---

## 1. Public repositories — 🟡 PROPOSED

NeuroPause has **no public repository today**. The tables below are an evaluation framework for _if and when_ leadership decides to open any surface. Opening anything requires closing the licensing decision in §1.2 first.

### 1.1 Candidate split — what _could_ open vs. what stays closed (🟡 all proposed)

| Surface                     | Real basis                                        | Proposed disposition               | Rationale                                                               |
| --------------------------- | ------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| SDK (`packages/sdk`)        | `NeuroPauseClient` + 7 resources, 15 tests        | **Candidate to open**              | Client library; low proprietary-IP density; drives integration adoption |
| CLI (`packages/cli`)        | operator/developer commands, 30 tests             | **Candidate to open**              | Thin client over public API surface                                     |
| Plugin / connector SDK docs | `docs/runtime/PLUGIN-SDK.md`, `docs/connectors/*` | **Candidate to open (docs first)** | Enables ecosystem authors without exposing core                         |
| Examples / samples          | `examples/`                                       | **Candidate to open**              | Teaching material, no secrets                                           |
| Backend (`apps/backend`)    | core services                                     | **Stays closed**                   | Core proprietary IP, security-sensitive                                 |
| Desktop main process        | `apps/desktop/src/main/*`                         | **Stays closed**                   | Signing, trust store, keychain, IPC hardening                           |
| Commercial / billing        | `commercialPlatform.ts`, Razorpay flows           | **Stays closed**                   | Revenue logic, secrets                                                  |
| Deploy secrets / infra      | `deploy/*`, `.env.example`                        | **Stays closed**                   | Operational security                                                    |

### 1.2 Licensing options to evaluate before opening anything (🟡 proposed)

| Option                                                 | Character                     | Pros                                | Cons / watch-outs                                   |
| ------------------------------------------------------ | ----------------------------- | ----------------------------------- | --------------------------------------------------- |
| Keep fully proprietary                                 | Status quo (`LICENSE`)        | Max IP control; no new obligations  | No community leverage                               |
| **Source-available** (e.g. BSL / proprietary-view)     | Readable, restricted use      | Transparency without losing control | Not OSI "open source"; must not be marketed as such |
| **Permissive OSS** (Apache-2.0 / MIT) for SDK/CLI only | True OSS on client edges only | Adoption, contributions, trust      | Irrevocable; requires CLA + patent/trademark review |
| Open-core                                              | OSS edges + proprietary core  | Balances both                       | Boundary must be legally crisp                      |

**Decision gate checklist (must all be ✅ before any repo is made public):**

- [ ] Legal sign-off on the chosen license and its **irreversibility**
- [ ] Trademark policy for the "NeuroPause" name and marks
- [ ] CLA (§2.1) finalized and countersign workflow live
- [ ] Secret-scan history rewrite / clean-room export of the candidate surface
- [ ] `SECURITY.md` disclosure path confirmed to cover external reporters
- [ ] Confirm public materials **never** claim OSI "open source" unless a true OSS license is chosen

---

## 2. Contribution guide — 🟢 USABLE NOW (internal engineers & contracted partners only)

This workflow is usable **today** because the tooling exists. It applies to authorized internal engineers and partners under contract — **not the public**. All contribution occurs under the proprietary [`LICENSE`](../../LICENSE).

### 2.1 Prerequisite — the proprietary CLA (🟢 required now)

Before any branch is merged, the contributor must be covered by a **Contributor License Agreement (CLA)** that assigns/ licenses contributed IP to NeuroPause:

- **Internal engineers:** covered by employment IP-assignment terms (no separate signature needed; verify with your manager).
- **Contracted partners:** must have a countersigned CLA on file (template owned by Legal). No CLA on file ⇒ PR cannot be merged.
- The CLA does **not** grant redistribution rights to the contributor — the software remains proprietary.

### 2.2 Fork / branch / PR workflow (🟢 usable now)

1. **Sync** the private repo `main`.
2. **Branch** off `main` using the naming convention below (fork the private repo only if you lack direct push rights).
3. **Implement** following the §8 code standards.
4. **Run the local pre-flight** (§2.4) — every gate must pass before you open the PR.
5. **Open a PR** into `main`, fill the PR checklist (§5.2), link the tracking issue.
6. **Request review** from the relevant owner(s) (§6).
7. **Merge** once approvals + all required CI gates are green.

### 2.3 Branch naming (🟢 convention, usable now)

| Prefix      | Use                 | Example                           |
| ----------- | ------------------- | --------------------------------- |
| `feat/`     | New capability      | `feat/connectors-retry`           |
| `fix/`      | Bug fix             | `fix/billing-webhook-idempotency` |
| `docs/`     | Docs only           | `docs/sdk-quickstart`             |
| `chore/`    | Tooling/deps        | `chore/bump-eslint`               |
| `security/` | Hardening (private) | `security/apple-jwks-verify`      |

### 2.4 Local pre-flight checklist (🟢 real commands from `package.json`)

- [ ] `npm run typecheck` — passes (workspaces, TS strict)
- [ ] `npm run lint` — passes at **`--max-warnings 0`**
- [ ] `npm run format:check` — Prettier clean
- [ ] `npm run test` — all workspace tests green (SDK 15 / CLI 30 as applicable)
- [ ] `npm run build` — builds
- [ ] Commit messages follow **Conventional Commits** (§8.4)

---

## 3. Governance & maintainer roles — 🟡 PROPOSED

No community governance body exists. The roles below are a **proposed** structure to activate only alongside a public path (§1). Until then, ownership follows internal engineering management.

| Role                    | Proposed responsibility                     | Proposed scope                |
| ----------------------- | ------------------------------------------- | ----------------------------- |
| **Contributor**         | Submits issues/PRs under CLA                | Any authorized contributor    |
| **Reviewer**            | Reviews PRs in a domain; cannot merge alone | Per subsystem                 |
| **Maintainer**          | Merge rights; guards standards + security   | Per package/app               |
| **Area lead**           | Roadmap + final call in an area             | SDK / CLI / backend / desktop |
| **Steering (proposed)** | Cross-cutting policy, license, releases     | Program-wide                  |

**Proposed decision model:** lazy consensus on PRs (≥1 maintainer approval + green gates); contested or cross-area changes escalate to the area lead; license/security/roadmap changes escalate to steering. **None of these roles are staffed today** — this is a blueprint.

---

## 4. Issue workflow — 🟢 internal tracking now · 🟡 public templates proposed

Internal/partner issue tracking is usable now via the private tracker. Public-facing issue templates in `.github/ISSUE_TEMPLATE/` **do not exist yet** (only workflow files live under `.github/`) and are a 🟡 proposed artifact for a future public path.

### 4.1 Issue types (🟢 usable now for internal triage)

| Type     | Use                    | Never use for                   |
| -------- | ---------------------- | ------------------------------- |
| Bug      | Reproducible defect    | Security vulnerabilities (→ §7) |
| Feature  | New capability request | —                               |
| Task     | Internal work item     | —                               |
| Docs     | Documentation gap      | —                               |
| Question | Clarification          | Support SLAs                    |

### 4.2 Lifecycle & triage checklist (🟢)

`new → triaged → accepted/declined → in-progress → in-review → done`

- [ ] Has clear title + repro/acceptance criteria
- [ ] Labeled with a type and an area
- [ ] Assigned an owner (or parked in backlog)
- [ ] **Not** a security vulnerability — if it is, redirect privately per §7 and close the public trace
- [ ] Linked to a branch/PR when work starts

---

## 5. Pull request standards — 🟢 USABLE NOW (tied to real CI gates)

PR standards are enforceable **today** because the gates already run. On backend paths, [`.github/workflows/backend-ci.yml`](../../.github/workflows/backend-ci.yml) runs typecheck, lint at `--max-warnings 0`, tests, and build on every PR.

### 5.1 Required merge gates (🟢 real)

| Gate         | Command / source                                        | Requirement          |
| ------------ | ------------------------------------------------------- | -------------------- |
| Typecheck    | `npm run typecheck` (TS `strict`)                       | ✅ zero errors       |
| Lint         | `eslint . --max-warnings 0`                             | ✅ **zero warnings** |
| Format       | `prettier --check`                                      | ✅ clean             |
| Tests        | `npm run test` (workspaces)                             | ✅ all pass          |
| Build        | `npm run build`                                         | ✅ succeeds          |
| CI (backend) | `backend-ci.yml` typecheck→lint→test→build→docker-build | ✅ green             |
| CLA          | §2.1                                                    | ✅ on file           |
| Review       | ≥1 owner/maintainer (§6)                                | ✅ approved          |

> **Known CI gap (honest):** there is **no per-PR desktop test CI and no macOS CI** (`ENTERPRISE-GA-REPORT.md`). For desktop/`apps/desktop` changes, run the §2.4 pre-flight locally and note results in the PR — do not assume CI covers them.

### 5.2 PR author checklist (🟢)

- [ ] Scoped to one logical change; title uses Conventional Commits
- [ ] All §2.4 gates pass locally
- [ ] Tests added/updated for the change
- [ ] Docs updated if behavior/API changed
- [ ] Linked issue; screenshots/logs where useful
- [ ] No secrets, keys, or `.env` values committed
- [ ] Security-sensitive change? Flag a security reviewer (§7)

---

## 6. Maintainer model — 🟢 internal core now · 🟡 external expansion proposed

**Usable now:** ownership maps to internal engineering leads per subsystem — SDK (`packages/sdk`), CLI (`packages/cli`), backend (`apps/backend`), desktop (`apps/desktop`). They hold merge rights and guard the §5 gates and §8 standards.

**Proposed (🟡):** a `CODEOWNERS` file to auto-request reviews, and an external-maintainer ladder (Contributor → Reviewer → Maintainer) with documented promotion criteria. Neither exists today; `CODEOWNERS` is absent from the repo.

| Aspect          | 🟢 Now (internal)        | 🟡 Proposed (external)             |
| --------------- | ------------------------ | ---------------------------------- |
| Merge authority | Internal subsystem leads | Vetted external maintainers        |
| Review routing  | Manual request           | `CODEOWNERS` auto-request          |
| Promotion       | N/A                      | Sustained quality + trust criteria |
| Cadence         | Continuous               | Published review SLAs              |

---

## 7. Security disclosure — 🟢 USABLE NOW

Security reporting is live today. **Do not** use the issue tracker or PRs for vulnerabilities.

- **Policy of record:** [`SECURITY.md`](../../SECURITY.md) — report **privately and responsibly** to the NeuroPause security team; acknowledgment targeted within a few business days; good-faith research under the policy is not pursued legally.
- **Control detail & hardening backlog:** [`docs/guides/SECURITY-GUIDE.md`](../../docs/guides/SECURITY-GUIDE.md) (every control cited to `file:line`).
- **Supported version:** `1.0.0-rc.1` (Enterprise Release Candidate); fixes land on the latest release.

### 7.1 Known open items to reference (🟢 honest, from `ENTERPRISE-GA-REPORT.md`)

| ID   | Item                                                                                                           | Severity | Status                                     |
| ---- | -------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------ |
| TD-1 | Apple `id_token` signature not verified against JWKS (`apps/backend/src/auth/providers/apple.ts`)              | **HIGH** | Open, tracked (explicit `HARDENING TODO`)  |
| TD-2 | Marketplace app install skips signature check when artifact unsigned + trust store empty (`packageService.ts`) | **HIGH** | Open, tracked (worker path is fail-closed) |
| CI   | No per-PR desktop CI; no macOS signing CI                                                                      | Med      | Open, tracked                              |

These are **known**; a report adds value when it brings a working exploit, new impact, or additional affected surface.

### 7.2 Disclosure do / don't (🟢)

- [ ] **DO** report privately to the security team per `SECURITY.md`
- [ ] **DO** include impact, repro/PoC, affected component + version
- [ ] **DO** allow reasonable remediation time before any disclosure
- [ ] **DON'T** open a public issue or PR for a vulnerability
- [ ] **DON'T** violate privacy, destroy data, or disrupt service while testing

---

## 8. Community code standards — 🟢 USABLE NOW (real configs)

Every standard below is enforced by a real config file in the repo and by the §5 gates.

### 8.1 TypeScript strict (🟢 `tsconfig.base.json`)

| Setting                                                | Value  |
| ------------------------------------------------------ | ------ |
| `strict`                                               | `true` |
| `noUnusedLocals` / `noUnusedParameters`                | `true` |
| `noFallthroughCasesInSwitch`                           | `true` |
| `noImplicitOverride`                                   | `true` |
| `forceConsistentCasingInFileNames` / `isolatedModules` | `true` |

### 8.2 ESLint — zero-warning (🟢 `.eslintrc.cjs` + `npm run lint`)

- Extends `eslint:recommended`, `@typescript-eslint/recommended`, `react`, `react-hooks`, `prettier`.
- `no-unused-vars` = **error** (allow `_` prefix); `eqeqeq` = error (smart).
- `no-explicit-any` and `consistent-type-imports` = **warn** — and because CI runs `--max-warnings 0`, **warnings fail the build**. Treat every warning as blocking.

### 8.3 Prettier (🟢 `.prettierrc` + `npm run format:check`)

`semi: true` · `singleQuote: true` · `trailingComma: "all"` · `printWidth: 100` · `tabWidth: 2` · `arrowParens: "always"` · `endOfLine: "lf"`. Run `npm run format` to auto-fix.

### 8.4 Conventional Commits (🟢 required)

| Type                         | Meaning      | Example                                |
| ---------------------------- | ------------ | -------------------------------------- |
| `feat`                       | New feature  | `feat(sdk): add usage resource`        |
| `fix`                        | Bug fix      | `fix(cli): correct base-url parsing`   |
| `docs`                       | Docs only    | `docs(adoption): open-source strategy` |
| `chore`                      | Tooling/deps | `chore: bump prettier`                 |
| `refactor` / `test` / `perf` | As named     | `test(cli): cover automation cmd`      |

**Commit checklist:** [ ] type prefix present · [ ] imperative subject ≤ ~72 chars · [ ] `!` or `BREAKING CHANGE:` footer for breaking changes · [ ] references issue where relevant.

---

## Rollout — 🟡 PROPOSED path to a public presence (not committed)

| Phase                       | Gate to enter       | Outcome                                                                           |
| --------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| 0 — Internal (now)          | 🟢 CLA + gates live | Internal/partner contribution operating                                           |
| 1 — Author public artifacts | Legal review        | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS`, issue/PR templates drafted |
| 2 — License decision        | §1.2 gate ✅        | License chosen; trademark policy set                                              |
| 3 — Open edges              | Clean-room export   | SDK/CLI/docs published (if approved)                                              |
| 4 — Community governance    | Steering stood up   | §3 roles staffed                                                                  |

Phases 1–4 are **proposals**. No phase implies a date or a commitment, and no public community exists until Phase 3+ is explicitly executed.

---

## Artifact status summary

| Artifact                        | Exists in repo today? | This doc's treatment                            |
| ------------------------------- | --------------------- | ----------------------------------------------- |
| `LICENSE` (proprietary)         | ✅ Yes                | Cited as binding constraint                     |
| `SECURITY.md`                   | ✅ Yes                | Referenced (§7)                                 |
| CI gates (`backend-ci.yml`)     | ✅ Yes                | Enforced (§5)                                   |
| Lint/format/type/test scripts   | ✅ Yes                | Enforced (§2.4, §5, §8)                         |
| `CONTRIBUTING.md`               | ❌ No                 | Workflow defined here (§2), file 🟡 proposed    |
| `CODE_OF_CONDUCT.md`            | ❌ No                 | 🟡 proposed                                     |
| `GOVERNANCE.md` / `CODEOWNERS`  | ❌ No                 | 🟡 proposed (§3, §6)                            |
| Issue/PR templates              | ❌ No                 | 🟡 proposed (§4)                                |
| Public repositories / community | ❌ No                 | 🟡 proposed only (§1) — never stated as current |

> **Reminder:** NeuroPause is proprietary. This document is a **proposed** open-source path plus an **internal/partner** contribution process. It does not describe any current open-source status, public repository, or contributor community.
