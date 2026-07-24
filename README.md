# NeuroPause Desktop

An **AI Operating Layer** for the desktop — a native macOS workspace for
discovering, launching, connecting, and remembering your AI tools. Not a
chatbot; a place your AI work _lives_.

> **Status: 1.0.0-rc.1 — Enterprise Release Candidate.**
> The full platform is implemented across desktop and backend: the Enterprise
> Business, Administration, Intelligence, Knowledge, Automation, Collaboration,
> Federation, Commercial and Developer platforms; the Enterprise AI Operating
> layer; the Enterprise Runtime, Cloud & Deployment infrastructure; and the
> Platform Ecosystem (Extensibility) control plane. This is a **Release
> Candidate**, not yet Enterprise GA — the remaining gaps are documented
> honestly in the [Enterprise GA Assessment](ENTERPRISE-GA-REPORT.md) and the
> [caveats](#honest-caveats) below.

Everything shipped is built to production standards and validated by real gates
(typecheck, lint, ~3,800 tests, production build); anything modeled, partial, or
absent is labelled as such — never fabricated.

---

## Architecture at a glance

A TypeScript **monorepo** (npm workspaces):

```
neuropause-desktop/
├── apps/
│   ├── desktop/          # Electron app (main + preload + React renderer), built with electron-vite
│   │   └── src/
│   │       ├── main/     # Main process: windows, security (CSP), secure storage, auth, IPC router
│   │       ├── preload/  # contextBridge — the only surface the renderer can call
│   │       └── renderer/ # React + Tailwind + Framer Motion UI
│   └── backend/          # Node + Express API: auth, OAuth providers, sessions, users
│       └── src/
│           ├── auth/     # PKCE, JWT, passwords (Argon2), sessions, provider integrations, router
│           ├── db/       # Postgres pool + forward-only SQL migrations
│           ├── cache/    # Redis (OAuth flow state)
│           └── middleware/# request-id, validation, rate-limit, audit, error handling
└── packages/
    └── shared/           # Types + Zod IPC contracts shared by desktop and backend
```

**Why these choices** (the load-bearing ones):

- **npm workspaces** over pnpm — most reliable story for Electron's native
  modules.
- **electron-vite** — handles the main/preload/renderer split and context
  isolation correctly instead of hand-rolling Vite.
- **Backend-mediated OAuth (RFC 8252 + PKCE)** — provider client secrets live
  only on the server; the desktop app holds nothing extractable. Full detail in
  [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md).
- **Secure-by-default Electron** — context isolation on, node integration off,
  sandbox on, a strict Content-Security-Policy, an allow-listed + Zod-validated
  IPC router, and refresh tokens encrypted via `safeStorage` (Keychain).

---

## Prerequisites

- **Node.js ≥ 20.11** (an `.nvmrc` pins `20.11.0`; run `nvm use`).
- **Docker** (for Postgres + Redis via `docker compose`).
- **macOS on Apple Silicon** is the first-class target for _running the desktop
  app_. The backend runs anywhere Node does.

> **Note:** the Electron desktop app must be run on macOS — it cannot be
> launched from a headless Linux environment, and several features assume a
> native macOS window (vibrancy, traffic-light insets, Keychain).

---

## Getting started

From the repository root:

```bash
# 1. Install all workspace dependencies
npm install

# 2. Start infrastructure (Postgres + Redis) in the background
npm run infra:up

# 3. Configure the backend
cp .env.example apps/backend/.env
#    → open apps/backend/.env and set, at minimum:
#        JWT_ACCESS_SECRET   (generate: openssl rand -base64 48)
#        DATABASE_URL, REDIS_URL  (defaults match docker-compose)
#    → add OAuth client IDs/secrets for any providers you want enabled
#      (see docs/AUTHENTICATION.md). Providers left blank are simply disabled;
#      email/password sign-in works with no provider config at all.

# 4. Run database migrations
npm run db:migrate

# 5. Start backend + desktop together (hot-reload)
npm run dev
```

`npm run dev` launches the Express backend (default `http://127.0.0.1:4000`)
and the Electron app concurrently. The desktop app talks to the backend at
`NEUROPAUSE_BACKEND_URL` (defaults to the same address).

You can sign in immediately with **email/password** (register, then log in).
OAuth buttons appear for every provider; one you haven't configured will return
a clean "provider not enabled" error rather than breaking the screen.

---

## Scripts

Run from the repository root:

| Script                            | What it does                                     |
| --------------------------------- | ------------------------------------------------ |
| `npm run dev`                     | Backend + desktop together, hot-reload           |
| `npm run dev:backend`             | Backend only                                     |
| `npm run dev:desktop`             | Desktop only (expects a backend running)         |
| `npm run build`                   | Production build of backend then desktop         |
| `npm run db:migrate`              | Apply forward-only DB migrations                 |
| `npm run infra:up` / `infra:down` | Start / stop Postgres + Redis                    |
| `npm run lint`                    | ESLint across the monorepo (zero-warning policy) |
| `npm run format` / `format:check` | Prettier write / check                           |
| `npm run typecheck`               | TypeScript check across workspaces               |
| `npm run test`                    | Run workspace tests (Vitest)                     |

---

## Security model (summary)

- **No provider secrets on the client.** OAuth is brokered by the backend.
- **PKCE + state** on the native flow; one-time codes bound to the PKCE
  challenge.
- **Access tokens** live in main-process memory only; **refresh tokens** are
  encrypted at rest (Keychain) and stored server-side only as SHA-256 hashes
  with **rotation + reuse detection**.
- **Passwords** hashed with **Argon2id**.
- **Every IPC message is allow-listed and Zod-validated** before a handler sees
  it; the renderer reaches the main process only through a minimal
  `contextBridge`.
- **Audit logging** and **request-scoped logging** (with secret redaction) on
  the backend.

Full detail and the configuration guide live in
[`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md).

---

## Roadmap

NeuroPause is delivered as a full platform; each layer ships with its own docs under [`docs/`](docs/).

| Layer                                                  | State                      | Docs                                                                                           |
| ------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------- |
| Foundation, Experience, Authentication                 | ✅ Shipped                 | [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md)                                             |
| Enterprise Business, Modules & Certification           | ✅ Shipped                 | [`docs/enterprise/`](docs/enterprise/README.md)                                                |
| Product Operations, Administration, Intelligence       | ✅ Shipped                 | [Administrator Guide](docs/guides/ADMINISTRATOR-GUIDE.md)                                      |
| Knowledge, Automation, Collaboration                   | ✅ Shipped                 | [`docs/`](docs/)                                                                               |
| Federation, Commercial, Developer platforms            | ✅ Shipped                 | [`docs/ecosystem/`](docs/ecosystem/README.md), [`docs/federation/`](docs/federation/README.md) |
| Enterprise AI Operating Platform                       | ✅ Shipped                 | [`PHASE-3-REPORT.md`](PHASE-3-REPORT.md)                                                       |
| Enterprise Runtime, Cloud & Deployment                 | ✅ Shipped                 | [`deploy/README.md`](deploy/README.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)             |
| Platform Ecosystem (Extensibility)                     | ✅ Shipped                 | [`PHASE-5-REPORT.md`](PHASE-5-REPORT.md)                                                       |
| **Enterprise GA (production readiness)**               | 🔶 **Release Candidate**   | [`ENTERPRISE-GA-REPORT.md`](ENTERPRISE-GA-REPORT.md)                                           |
| **Enterprise Validation Program (operational proof)**  | 🔷 **Validated RC**        | [`ENTERPRISE-VALIDATION-REPORT.md`](ENTERPRISE-VALIDATION-REPORT.md)                           |
| **Scientific & Standards Program (formalization)**     | 🔬 **Reference framework** | [`SCIENTIFIC-STANDARDS-REPORT.md`](SCIENTIFIC-STANDARDS-REPORT.md)                             |
| **Global Ecosystem & Adoption Program (enablement)**   | 🌐 **Adoption blueprint**  | [`GLOBAL-ADOPTION-REPORT.md`](GLOBAL-ADOPTION-REPORT.md)                                       |
| **Enterprise Operations & Scale Program (operations)** | ⚙️ **Operating manual**    | [`ENTERPRISE-OPERATIONS-REPORT.md`](ENTERPRISE-OPERATIONS-REPORT.md)                           |
| **Customer Deployment & Evidence Program (pilots)**    | 🧪 **Pilot manual**        | [`CUSTOMER-DEPLOYMENT-REPORT.md`](CUSTOMER-DEPLOYMENT-REPORT.md)                               |

> The full, evidence-based production-readiness assessment — with real benchmarks and
> an honest GA classification — is the [Enterprise GA Assessment](ENTERPRISE-GA-REPORT.md).
> The [Enterprise Validation Program](ENTERPRISE-VALIDATION-REPORT.md) then _executed_
> that evidence — load tests, chaos/reliability runs, and deployment validation
> (reproducible harnesses in [`bench/`](bench/), results in `bench/results/`,
> narrative in [`docs/validation/`](docs/validation/)) — classifying the platform a
> **Validated Release Candidate**. The [Scientific & Standards Program](SCIENTIFIC-STANDARDS-REPORT.md)
> then _formalized_ that platform into an internal engineering-science reference
> ([`docs/science/`](docs/science/README.md)) — every concept carrying an explicit
> evidence level (L0 Proposed … L4 Validated), adding documentation only. The
> [Global Ecosystem & Adoption Program](GLOBAL-ADOPTION-REPORT.md) then built the
> **adoption surface** — customer-success, partner, developer, marketplace, training,
> deployment, documentation, community-governance and business frameworks
> ([`docs/adoption/`](docs/adoption/README.md)) plus real contributor files
> (`CONTRIBUTING`, `CODE_OF_CONDUCT`, `GOVERNANCE`, issue/PR templates) — with no
> invented customers, certifications, or metrics (open source is a _proposed_ path;
> the license is proprietary). The
> [Enterprise Operations & Scale Program](ENTERPRISE-OPERATIONS-REPORT.md) then wrote
> the **operating manual** — SRE, support, security, release, business, developer,
> executive, scaling, compliance and continuous-improvement frameworks
> ([`docs/operations/`](docs/operations/README.md)) — with capacity math from the
> _measured_ benchmarks, SLOs as proposed targets, and no fabricated operational
> metrics, uptime, or certifications (there is no production fleet yet). The
> [Customer Deployment & Evidence Program](CUSTOMER-DEPLOYMENT-REPORT.md) then wrote
> the **pilot manual** — pilot methodology, a proven evidence-generation toolchain
> wrapped in blank collection templates, feedback instruments, case-study templates,
> and a knowledge base ([`docs/pilots/`](docs/pilots/README.md)) — so a real customer
> deployment can produce measured evidence. No pilot has run: every customer value
> ships blank, and nothing invents a customer, deployment, benchmark, or ROI. A
> per-layer documentation index is in [`docs/README.md`](docs/README.md).

---

## Honest caveats

The platform is a Release Candidate; these are the honest, tracked gaps (full detail
in the [Enterprise GA Assessment](ENTERPRISE-GA-REPORT.md)):

- **Apple sign-in** decodes but does **not yet verify** the `id_token` signature
  against Apple's JWKS (`apps/backend/src/auth/providers/apple.ts`) — a tracked
  hardening item and the top pre-GA security blocker. The other providers resolve
  identity from authenticated userinfo/Graph endpoints and are unaffected.
- **Marketplace app install** accepts unsigned packages when the publisher trust
  store is empty; worker-package install is fail-closed. See the
  [Security Guide](docs/guides/SECURITY-GUIDE.md).
- **macOS code-signing/notarization** are configured but env-gated (unsigned builds
  ship if secrets are absent), and macOS **release automation is not yet in CI**
  (Windows is).
- Enterprise day-2 disciplines — **alert routing, distributed tracing, capacity
  forecasting** — are not implemented; **update rollback is advisory** (data-side
  recovery is the real path) and **federation DR is modeled**.
- The Electron desktop app is **not launched in headless/CI environments** — run it
  on macOS per the steps above.

---

## License

Proprietary — All Rights Reserved. Copyright © 2026 NeuroPause. See [`LICENSE`](LICENSE).
