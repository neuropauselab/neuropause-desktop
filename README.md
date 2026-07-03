# NeuroPause Desktop

An **AI Operating Layer** for the desktop — a native macOS workspace for
discovering, launching, connecting, and remembering your AI tools. Not a
chatbot; a place your AI work *lives*.

> **Status: Phase 1 of 6 — Foundation.**
> This repository currently contains the project architecture, the Electron +
> React shell, the backend service, and a complete, secure **authentication**
> system (Google / GitHub / Microsoft / Apple / email). The feature modules
> (AI Store, Workspace, Connectors, Activity Intelligence, Reminders, Summaries,
> AI Memory, Automation) are scaffolded as labelled "coming in Phase N"
> placeholders in the UI and are built in later phases. See
> [Roadmap](#roadmap).

This is an honest foundation, not a finished product. What is here is built to
production standards; what is not here is clearly marked as not-here.

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
- **macOS on Apple Silicon** is the first-class target for *running the desktop
  app*. The backend runs anywhere Node does.

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

| Script | What it does |
|--------|--------------|
| `npm run dev` | Backend + desktop together, hot-reload |
| `npm run dev:backend` | Backend only |
| `npm run dev:desktop` | Desktop only (expects a backend running) |
| `npm run build` | Production build of backend then desktop |
| `npm run db:migrate` | Apply forward-only DB migrations |
| `npm run infra:up` / `infra:down` | Start / stop Postgres + Redis |
| `npm run lint` | ESLint across the monorepo (zero-warning policy) |
| `npm run format` / `format:check` | Prettier write / check |
| `npm run typecheck` | TypeScript check across workspaces |
| `npm run test` | Run workspace tests (Vitest) |

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

| Phase | Scope | State |
|-------|-------|-------|
| **1** | Project init, architecture, Electron + React shell, DB, **Authentication** | ✅ This release |
| 2 | Dashboard, Sidebar, Workspace, Navigation, Settings, Theme | ⏳ Planned |
| 3 | AI Store, Search, Categories, Marketplace | ⏳ Planned |
| 4 | OAuth connectors, Connector SDK, Plugin architecture | ⏳ Planned |
| 5 | Activity Intelligence, Timeline, Daily Summary, Reminder Engine | ⏳ Planned |
| 6 | Automation Builder, Notification Center, AI Memory, Analytics | ⏳ Planned |
| 7 | Enterprise Operating System (org runtime, governance, executive surface) | ✅ Shipped |
| 8 | **Ecosystem Platform** — Developer Portal, Marketplace, Public SDK + CLI, API Gateway, Billing | ✅ Shipped |
| 9 | **Cloud & Federation** — multi-tenant cloud control plane (Stage 1) + cross-org Federation Platform (Stage 2) | ✅ Shipped |

> Phases 2–9 are implemented incrementally; each subsystem has its own docs under
> [`docs/`](docs/). The Phase 8 platform is documented in
> [`docs/ecosystem/`](docs/ecosystem/README.md); the Phase 9 cloud and federation
> layers in [`docs/cloud/`](docs/cloud/README.md) and
> [`docs/federation/`](docs/federation/README.md). Phase 9 Stage 2 completes the
> core platform architecture — see
> [`docs/federation/final-platform-architecture.md`](docs/federation/final-platform-architecture.md).

---

## Honest caveats for this phase

- The **feature module cards** on the home screen are intentional, labelled
  placeholders — they do nothing yet by design.
- **Apple sign-in** decodes but does **not yet verify** the `id_token`
  signature against Apple's JWKS — a tracked TODO documented in
  `docs/AUTHENTICATION.md`. Don't ship Apple to real users until that's done.
- **Email verification / password reset** are not implemented yet.
- **Code-signing & notarization** for macOS distribution are left to you
  (`electron-builder.yml` is configured for `arm64` dmg/zip; signing identities
  are not committed).
- This was developed and statically reviewed but **the Electron app has not
  been launched in this build environment** (no macOS GUI available here); run
  it on your Mac per the steps above.

---

## License

Proprietary — internal project scaffold. Add a license before any external
distribution.
