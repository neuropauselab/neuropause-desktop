# Contributing to NeuroPause

Thank you for helping build NeuroPause. This guide covers how to set up the
project, make a change, and get it merged.

> **Who this is for.** NeuroPause is **proprietary software — All Rights
> Reserved** (see [`LICENSE`](LICENSE)). Contribution is currently open to
> **internal maintainers and contracted partners** operating under a written
> agreement with NeuroPause. A **public community-contribution path is
> _proposed_, not yet open** — see [Public contribution (proposed)](#public-contribution-proposed)
> and [`GOVERNANCE.md`](GOVERNANCE.md). Nothing in this document grants a licence
> to use, copy, or redistribute the Software.

The platform is at **1.0.0-rc.1 — Validated Release Candidate**. Anything modeled,
partial, or absent is labelled honestly in the docs; please keep that discipline
in every contribution.

---

## Before you start

- Read the [root `README.md`](README.md) for the architecture and the honest
  caveats.
- Read the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — it applies to every
  interaction.
- For anything security-related, **do not open a public issue or PR** — follow
  [`SECURITY.md`](SECURITY.md).
- For a non-trivial change (new surface, dependency, schema, or behaviour), open
  an issue or a proposal **first** so direction is agreed before code — see the
  RFC process in [`docs/adoption/COMMUNITY-GOVERNANCE.md`](docs/adoption/COMMUNITY-GOVERNANCE.md).

---

## Development setup

**Prerequisites**

- **Node.js ≥ 20.11** — an [`.nvmrc`](.nvmrc) pins `20.11.0` (`nvm use`).
- **npm 10** — this is an npm-workspaces monorepo (`npm@10.5.0`); do not use
  pnpm or yarn.
- **Docker** — for Postgres + Redis via `docker compose`.
- **macOS on Apple Silicon** to _run the Electron desktop app_. The backend runs
  anywhere Node does; the desktop app **cannot** be launched headless.

**First-run, from the repository root:**

```bash
# 1. Install all workspace dependencies
npm install

# 2. Start infrastructure (Postgres + Redis) in the background
npm run infra:up

# 3. Configure the backend
cp .env.example apps/backend/.env
#    → set at minimum JWT_ACCESS_SECRET (openssl rand -base64 48);
#      DATABASE_URL / REDIS_URL defaults match docker-compose.
#      See docs/AUTHENTICATION.md for optional OAuth providers.

# 4. Run database migrations
npm run db:migrate

# 5. Start backend + desktop together (hot-reload)
npm run dev
```

`npm run dev` runs the Express backend (default `http://127.0.0.1:4000`) and the
Electron app concurrently. You can sign in immediately with email/password. Full
detail is in [`docs/guides/INSTALLATION.md`](docs/guides/INSTALLATION.md) and
[`docs/guides/QUICK-START.md`](docs/guides/QUICK-START.md); when something breaks,
[`docs/guides/TROUBLESHOOTING.md`](docs/guides/TROUBLESHOOTING.md).

**Useful scripts** (root `package.json`):

| Script                                        | Purpose                                      |
| --------------------------------------------- | -------------------------------------------- |
| `npm run dev` / `dev:backend` / `dev:desktop` | Run app(s) with hot-reload                   |
| `npm run build`                               | Production build (backend then desktop)      |
| `npm run db:migrate`                          | Apply forward-only DB migrations             |
| `npm run infra:up` / `infra:down`             | Start / stop Postgres + Redis                |
| `npm run typecheck`                           | TypeScript across all workspaces             |
| `npm run lint`                                | ESLint monorepo-wide (`--max-warnings 0`)    |
| `npm run test`                                | Vitest suites (desktop + backend + packages) |
| `npm run format` / `format:check`             | Prettier write / check                       |

---

## Branch & PR workflow

1. **Sync** `main` and branch from it. Use a descriptive branch name matching the
   change type, e.g. `feat/marketplace-review-sort`, `fix/apple-jwks`,
   `docs/contributing`.
2. **Keep PRs focused.** One logical change per PR. Split unrelated work.
3. **Write tests** for new behaviour and bug fixes (Vitest). Do not weaken or
   delete a test to make a gate pass — fix the cause.
4. **Run the gates locally** (next section) before pushing.
5. **Open the PR** using the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).
   Link the issue/RFC, describe the change, and check the gate boxes honestly.
6. **Review.** At least one code owner for each touched path must approve — see
   [`CODEOWNERS`](CODEOWNERS). Address review comments by pushing follow-up
   commits; maintainers squash-merge.
7. **Green CI is required.** PRs merge only when the relevant workflows pass —
   `backend-ci` for backend/shared changes, `deploy-validation` for `deploy/**`.

---

## Quality gates (must pass)

These are the **real** gates the project enforces — the same ones in the
[Release Checklist](docs/guides/RELEASE-CHECKLIST.md) and CI
([`.github/workflows/backend-ci.yml`](.github/workflows/backend-ci.yml)). Run them
from the repository root; all must be green with **zero errors and zero
warnings** before you request review:

```bash
npm run typecheck     # TypeScript, all workspaces — 0 errors
npm run lint          # ESLint, --max-warnings 0 (zero-warning policy)
npm run test          # Vitest suites — all pass
npm run build         # Production build of backend then desktop — exit 0
npm run format:check  # Prettier — no drift (run `npm run format` to fix)
```

Changes under `deploy/**` additionally pass `deploy-validation`
(`yamllint`, `helm lint`, `helm template`, and strict `kubeconform`) —
see [`.github/workflows/deploy-validation.yml`](.github/workflows/deploy-validation.yml).

**Do not** transcribe test counts, benchmarks, or timings from a previous run —
re-run and copy the actual output. **Never** fabricate results, customers,
metrics, or certifications; the project's honesty labels
([`docs/README.md`](docs/README.md#reading-the-honesty-labels)) are load-bearing.

---

## Commit convention

Commits follow [**Conventional Commits**](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body explaining what and why]

[optional footer(s), e.g. Refs: #123, BREAKING CHANGE: ...]
```

- **Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`,
  `perf`, `style`, `revert`.
- **Suggested scopes** (match the workspaces/areas): `backend`, `desktop`, `sdk`,
  `cli`, `shared`, `deploy`, `docs`, `ci`.
- **Breaking changes:** add `!` after the type/scope (`feat(sdk)!: …`) **and** a
  `BREAKING CHANGE:` footer.

Examples:

```
feat(backend): add marketplace review sort by helpfulness
fix(desktop): fail closed when publisher trust store is empty
docs(adoption): add community governance framework
```

Conventional Commits feed the [`CHANGELOG.md`](CHANGELOG.md) (Keep a Changelog +
SemVer). Keep messages accurate; the summary is what a reader sees.

---

## Licensing, DCO & CLA

Because NeuroPause is **proprietary**, contribution terms are stricter than a
typical open-source project:

- **Sign off every commit (DCO).** Add a `Signed-off-by: Name <email>` trailer to
  each commit (`git commit -s`), certifying you have the right to submit the work
  under the project's terms — the [Developer Certificate of Origin 1.1](https://developercertificate.org/).
- **Contributor Licensing Agreement (CLA).** Internal contributors are covered by
  their employment agreement; **partner/external contributors must have a signed
  CLA (or the contribution clause of their partner agreement) on file** assigning
  the necessary rights to NeuroPause **before** a PR can be merged. A contribution
  grants you **no** licence to the Software.
- **No third-party code** without a compatible licence and explicit maintainer
  approval. Declare the source and licence of any non-original code in the PR.

If you are unsure whether you are cleared to contribute, ask a maintainer before
opening a PR rather than after.

---

## Public contribution (proposed)

A public, open-community contribution path — a public issue tracker, a published
CLA bot, and an open-source subset of the codebase — is a **proposed future
direction**, not a current offering, and is contingent on a licensing decision
that has **not** been made. It is described, with its proposed governance, in
[`docs/adoption/COMMUNITY-GOVERNANCE.md`](docs/adoption/COMMUNITY-GOVERNANCE.md)
and [`GOVERNANCE.md`](GOVERNANCE.md). Until that path is opened, treat this repo
as internal/partner-only.

---

## Where to get help

See [`SUPPORT.md`](SUPPORT.md) for the routes to documentation and the honest
statement of what support channels do and do not yet exist.
