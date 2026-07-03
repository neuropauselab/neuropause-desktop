# RC1 Audit — 01: Repository, Startup, Environment (Parts 1–3, 13)

Evidence rules for this audit: prior sprint guides are treated as claims, not
proof. Admissible evidence is (a) the repository itself, and (b) the developer's
terminal logs from 2026-07-02/03, which executed the full startup on the target
machine (Docker services 4/4, backend "No pending migrations" + "listening on
http://127.0.0.1:4000", `POST /auth/email/login → 200`, desktop boot with 327
secure IPC handlers, suites desktop 525 / backend 168 green).

---

## 1. Repository map (Part 1)

npm-workspaces monorepo (`packages/*`, `apps/*`), Node >= 20.11.

| Path | What it is |
| --- | --- |
| `apps/desktop/` | Electron 30 + electron-vite + React/TS/Tailwind. `src/main` (subsystems, IPC), `src/renderer` (shell, views), `src/preload`. Tests: 66 files / 525. |
| `apps/backend/` | Express + Postgres + Redis. `src/<module>` per domain, `src/db/migrations` 0001–0009. Tests: 17 files / 168. |
| `packages/shared/` | Types + IPC contract (Zod) shared by both. Barrel `src/index.ts`. |
| `docs/` | `DEPLOYMENT.md`, `guides/SPRINT-1..5-*.md`, `audit/` (this). |
| `scripts/` | `backup-db.sh`, `restore-db.sh`. |
| `docker-compose.yml` | Dev infra: postgres, redis, meilisearch, qdrant. |
| `docker-compose.prod.yml` | Prod stack: backend image + postgres + redis (validated on the dev machine in Sprint 4). |
| `tools/`, `examples/` | Auxiliary; inventoried in A9. |

Dependency direction: `shared → backend`, `shared → desktop`; desktop→backend
only over HTTP (`127.0.0.1:4000` dev). Root `package-lock.json` exists for local
installs; per protocol it is never shipped in increment zips.

## 2. Verified startup sequence (Part 2)

Each step below was executed on the target macOS machine (log evidence dated
above). Repo root assumed: `~/Desktop/neuropause-desktop`.

1. Prerequisites: Node 20.11+, npm, Docker Desktop (running).
2. `npm install` at the repo root (workspaces install everything).
3. `cp .env.example .env` and fill values (see §3; JWT secret and Postgres
   password minimum for local dev).
4. Terminal 1: `docker compose up -d` → 4/4 containers.
5. Terminal 1: `npm run dev -w @neuropause/backend` → runs migrations itself on
   boot ("No pending migrations" when current), seeds catalog once, then
   "listening on http://127.0.0.1:4000".
6. Terminal 2: `cd apps/desktop && npm run dev` → Electron app; main log shows
   `backendUrl: http://127.0.0.1:4000` and all subsystems ready.
7. Sign in from the app (email login verified 200).
8. Verify suites any time: `npm test -w @neuropause/desktop` (525) and
   `cd apps/backend && npm test` (168); `npm run lint`; typechecks per workspace.

Production path: `docs/DEPLOYMENT.md` (image build + `docker compose -f
docker-compose.prod.yml up -d --build`; migrate-then-serve entrypoint;
`/live` liveness vs `/health` readiness) — build and healthy stack previously
validated on this machine; re-execution is queued in A8.

## 3. Environment variable reference (Part 3)

Operator surface = the 30 keys in `.env.example` (authoritative for the running
system). Security level: **S** secret, **C** config.

| Group | Keys | Req. dev | Notes |
| --- | --- | --- | --- |
| Postgres (compose) | POSTGRES_USER / POSTGRES_PASSWORD (S) / POSTGRES_DB | yes | Feed the containers; DATABASE_URL must match. |
| Search infra | MEILI_MASTER_KEY (S) | compose-only | Dev compose service. |
| Backend core | NODE_ENV, PORT, PUBLIC_BACKEND_URL, DATABASE_URL (S), REDIS_URL | yes | PORT default 4000. |
| Auth tokens | JWT_ACCESS_SECRET (S), JWT_ACCESS_TTL, JWT_REFRESH_TTL | secret yes | |
| OAuth providers | GOOGLE_/GITHUB_/MICROSOFT_(+TENANT)/APPLE_ CLIENT ids + secrets/keys (S) | optional | Email login works without; provider login needs its pair. |
| Billing | RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET (S), RAZORPAY_PLAN_{STARTER,PROFESSIONAL,ENTERPRISE} | optional | Billing disabled until key id+secret set. |
| Prod compose | BACKEND_PORT | prod | Host port mapping. |

**Referenced in code but NOT in `.env.example` (Finding A1-1):**
`ANTHROPIC_API_KEY` (S — cloud-model path), `LOG_LEVEL`, `TEST_DATABASE_URL`
(backend integration smoke), and desktop-process vars
`NEUROPAUSE_LLM_PROVIDER`, `NEUROPAUSE_OLLAMA_URL`, `NEUROPAUSE_OLLAMA_MODEL`,
`NEUROPAUSE_PLUGINS_DIR`, `NEUROPAUSE_CHANNEL`, `NEUROPAUSE_BUILD_COMMIT/TIME`
(injected at build/run, not via .env). Action: document these (A9 env
reference); note that backend config indirection means the direct-grep list is
a floor, to be completed when A3 reads `config.ts`.

## 13. Startup verification checklist (Part 13)

Verified on the target machine (☑ = log evidence exists):

- ☑ Node + Docker installed; containers 4/4
- ☑ Dependencies installed; typecheck node+web+backend clean; lint clean
- ☑ `.env` configured (system runs; secrets present)
- ☑ Migrations current (auto-migrate: "No pending migrations")
- ☑ Backend listening on 4000; ☑ email login 200
- ☑ Desktop boots, 327 secure IPC handlers registered
- ☑ Desktop suite 525 / Backend suite 168

Pending (☐ — not yet reported by the developer; carried from Sprint 5):

- ☐ Onboarding wizard greets a first-run install; Continue / deep-link /
  no-reappear after finish or skip
- ☐ Welcome checklist, Restart tour, deep links behave
- ☐ Operations → Diagnostics shows the three AI rows (Ollama "down + ollama
  serve" is a PASS when Ollama isn't running)
- ☐ Feedback card saves an entry; ☐ Pilot Join/Leave toggles and badges
- ☐ OAuth provider login (needs provider credentials); ☐ Connect GitHub and
  observe a sync (A5 scopes what "working" means per connector)
- ☐ Ollama installed → AI check reads ok; ☐ prod compose re-run (A8)

Next increment: **A2 — Database audit** (read migrations 0001–0009, tables /
indexes / FKs, Redis usage, ER diagram).
