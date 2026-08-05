# NeuroPause Desktop — Project State Record

**Date:** 2026-08-05
**Author:** Dishant Dobariya
**Repo HEAD at time of writing:** `2baead8` on `phase6-stage13-enterprise-digital-twin-platform`
**Purpose:** Durable record of repository state, the A8–A17 loss investigation, infrastructure inventory, and remaining work. Written because the evidence below existed only in an ephemeral chat session.

---

## 1. Incident record — A8–A17 work loss

### Verdict

**A8–A17 implementation code does not exist in any reachable location. Recovery is closed.**

The correct wording for capability documents is **"specified, not implemented"** — not "lost." The distinction matters under due diligence.

### What happened

A8–A17 were executed inside a cloud container session (2026-08-04). The work was committed *inside that container only*. It was never pushed to GitHub (the container's GitHub token returned `Invalid username or token`) and never written to the Mac's object store (the Mac's device VM had no network egress by design). The container was reclaimed. The objects were destroyed with it.

The session recorded its own forensic conclusion before the container was lost, and produced a file `INCIDENT-2026-08-04-container-loss.md` that could not be exported.

### Evidence — searches performed 2026-08-05

Every surface below was searched for `generalLedger`, `journalEntry`, `chartOfAccounts`, `periodClose`, and A-series identifiers. **All returned nothing beyond A6/A7.**

| Surface | Method | Result |
|---|---|---|
| All 89 remote branches, full history | `git log --all -S "journalEntry"` | No match |
| All branches, commit messages | `git log --all --grep` (ledger, journal, GL, A9–A11) | Only unrelated operational "ledger" usages |
| Windows clone working tree | Recursive content grep | No match |
| Mac clone working tree | Recursive content grep | No match |
| `~/neuropause-desktop`, `~/NeuroPause` | Recursive content grep | No match |
| ~400 archives in `~/Downloads` | Recursive `--include="*.ts"` grep | No match |
| Mac reflog | `git reflog` | A-series tops out at A7 (`93167ef`) |
| Mac stash | `git stash list` | Empty |
| Dangling commits | `git fsck --lost-found` | One: `2f619e17` — duplicate of the benchmark-threshold commit |
| 230 interrupted temp objects | zlib-inflated and content-searched (by the container session) | 101 trees, 124 blobs, 5 commits — all A6/A7/LiveSync/docs era |
| Dangling commit `21d4075` | Fully inspected (by the container session) | "P6.2: Azure Cloud Platform", Jul 14, `infrastructure/azure/*` — not A-series |
| Cloud container `/home/claude` | Inspected (by the container session) | Empty, reclaimed |
| Claude Code transcripts | `~/.claude/projects/` on Mac | Directory does not exist |
| Spotlight (macOS) | `mdfind "INCIDENT-2026-08-04"` | Only a photograph of the screen |

### Confirmed absent from the codebase

No table, module, or code path exists for: general ledger, journal entries, chart of accounts, accounting periods, period close, HR, or projects. The 36 database tables contain none of these.

### Root cause

**Work existed only in ephemeral environments with a manual export step.** Two variants of the same failure:

1. Earlier increments delivered as downloadable archives that had to be clicked to survive
2. A8–A17 executed in a container that had to stay connected to survive

Everything that was pushed to GitHub survived perfectly — 9,625 objects, byte-identical, rebuilt into a working app in one afternoon.

### Standing rule adopted

**No work session ends without a verified push.** A task is not complete when a progress panel says so; it is complete when the commit is confirmed on the remote. If a tool cannot push, the output is committed manually the same hour it is produced.

---

## 2. Repository state (verified 2026-08-05)

- **Branch:** `phase6-stage13-enterprise-digital-twin-platform`
- **HEAD:** `2baead8`, matching `origin`
- **Working tree:** clean
- **Remote branches:** 89
- **Total commits:** ~340

### Commits made this session

| Hash | Change |
|---|---|
| `d393a70` | `fix(enterprise): retry rename on EPERM/EACCES/EBUSY in record-store persist (Windows AV file locking)` |
| `2baead8` | `chore(build): untrack generated build-info.json (regenerated per build; stale null backendUrl shipped to fresh clones)` |

### Gate status

| Gate | Result |
|---|---|
| Typecheck | Pass |
| Lint | Pass |
| Build (backend tsup + desktop electron-vite) | Pass |
| Tests | 5,157 pass / 2 fail across 556 files |
| `package:win` | Pass — produces installer, portable exe, zip |

---

## 3. Architecture (as verified)

npm workspaces monorepo, 44 workspaces.

- `apps/desktop` — Electron (main / preload / renderer), built with electron-vite, packaged with electron-builder 24.13.3, Electron 30.5.1
- `apps/backend` — Node/Express, built with tsup, target node20
- `packages/*` — shared types (`@neuropause/shared`) and libraries
- Infrastructure — Postgres 16, Redis 7, Qdrant 1.9 via Docker Compose

### Two deliberate patterns in the desktop main process

**Projection subsystems** — `strategy`, `digitalTwinPlatform`. Pure functions composing a snapshot from injected platform signals via a single `readState` reader. Memoized with a 3s TTL, invalidated on store-change events (workerRegistry, connectorService, governanceStore, marketplaceStore, fedStore). Hold no state of record. Read-only IPC.

**Record subsystems** — 46 enterprise modules across CRM, executive, finance, inventory, maintenance, manufacturing, procurement, sales, warehouse. All persist through `EnterpriseRecordStore` (`apps/desktop/src/main/enterprise/framework/enterpriseRecordStore.ts`) using atomic temp-write + rename to local JSON.

### IPC contract (A7)

Typed at compile time. `IpcResponseMap` covers 636 invokable channels; `IpcBroadcastMap` covers 29 broadcast channels. Renderer call-site assertions collapsed to one, at the `invoke` boundary. Response-side Zod validation was deliberately rejected (would have required ~1,990 hand-authored schemas — a second source of truth).

### Backend

Auth (email/password + OAuth PKCE for Google/GitHub/Microsoft/Apple), store/marketplace, billing (Razorpay), semantic/embedding with Qdrant. `GET /auth/providers` returns which providers are configured.

---

## 4. Database

36 tables, 12 migrations (`0001_init` through `0012_embedding_state`).

Seeded on a fresh install: the store/marketplace catalog (applications, developers, reviews, screenshots, pricing_plans, versions, releases, plugin_packages, categories, tags, collections, featured_apps, app_permissions, app_ratings, developer_verifications, update_channels), plus 3 organizations and 4 users.

Empty on a fresh install: memberships, workspaces, connector_accounts, subscriptions, devices, installations, downloads, bookmarks, sync_state, embedding_state, auth_identities, auth_tokens.

**No tables exist for outcomes, objectives, evidence, dependencies, or approvals.** Mission Control's outcome *definitions* are static templates in `apps/desktop/src/main/strategy/strategyModel.ts` (782 lines, no imports beyond types); its *progress values* are computed live from real platform signals.

---

## 5. Infrastructure inventory

### Live — DigitalOcean droplet

| Item | Value |
|---|---|
| Droplet | `ubuntu-s-1vcpu-2gb-blr1`, Ubuntu 24.04, 2 GB RAM, 50 GB disk, BLR1 |
| IP | `64.227.128.218` |
| Compose project | `/opt/neuropause` |
| Containers | `neuropause-prod-backend-1`, `neuropause-prod-postgres-1`, `neuropause-prod-redis-1` |
| Uptime at check | ~32 days continuous, all healthy |
| Deployed commit | `35eedc0` (June-era — far behind the desktop app) |
| Port binding | Changed 2026-08-05 from `127.0.0.1:4000` to `0.0.0.0:4000` |
| Backup of compose file | `/opt/neuropause/docker-compose.prod.yml.bak` |
| **No Qdrant** | Semantic/vector features unavailable on this deployment |
| **No TLS** | Plaintext HTTP |
| **No offsite DB backup** | Single Postgres container, no dump, no snapshot |

### Destroyed — previous Kubernetes production

Documented in `deploy/PHASE4-EVIDENCE.md` as live on 2026-07-30. Confirmed gone 2026-08-05: DigitalOcean billing shows only 1 droplet ($1.71 MTD), no Kubernetes or Databases line items. Load balancer `134.199.250.188` does not accept TCP on 443.

- Cluster `do-nyc3-nems-prod-cluster` — gone
- Managed PostgreSQL `nems-prod-pg`, Valkey `nems-prod-cache` — gone
- `api.neuropause033.com` DNS still resolves to the dead LB IP

### DNS

`neuropause033.com` is on Cloudflare (`norah.ns.cloudflare.com`, `max.ns.cloudflare.com`). `info.neuropause033.com` is a Cloudflare-proxied static site, fully edge-cached, returns 404 on `/health` — it is not an API host. **Cloudflare account access is held by a team member, not currently by Dishant.**

---

## 6. Packaging

`npm run package:win` produces, in `apps/desktop/dist/`:

- `NeuroPause-Setup.exe` (~76 MB, NSIS installer)
- `NeuroPause 1.0.0-rc.1.exe` (~76 MB, portable)
- `NeuroPause-1.0.0-rc.1-win.zip`

Backend URL is baked at build time via `NEUROPAUSE_BACKEND_URL`, written by `scripts/generate-build-info.cjs` into `apps/desktop/resources/build-info.json` (now gitignored) and shipped as an `extraResources` entry.

Verified 2026-08-05: a build with `NEUROPAUSE_BACKEND_URL=http://64.227.128.218:4000` launches and reaches the hosted backend with no local backend running.

### Windows packaging gotchas

- Symlink extraction of `winCodeSign` fails without **Developer Mode** enabled (or an elevated shell) — `A required privilege is not held by the client`
- A running portable exe holds its own binary from a Temp directory and blocks rebuilds — close it before packaging
- The installer is **unsigned**; Windows SmartScreen will warn on any machine

---

## 7. Windows development environment

Verified working end to end: clone → `npm ci` → `docker compose up -d` → `npm run db:migrate -w @neuropause/backend` → `npm run build` → `npm run dev` → `npm run package:win`.

Prerequisites and gotchas:

- `git config --global core.autocrlf false` and `core.longpaths true` **before cloning** — otherwise LF→CRLF rewriting breaks scripts mounted into Linux containers
- Clone to a short native path (`C:\dev\...`); not OneDrive, not `\\wsl$\`
- `.env` files must be created from `.env.example` at repo root and `apps/backend/`; `JWT_ACCESS_SECRET` must be identical in both
- Node 24 / npm 11 work despite `engines: >=20.11.0` and `packageManager: npm@10.5.0`
- Docker Desktop must be launched as an application; the CLI reports a version without the engine running

---

## 8. Known issues

| Issue | Status |
|---|---|
| EPERM on record-store rename (Windows AV file locking) | **Fixed** in `d393a70` — retry with backoff on EPERM/EACCES/EBUSY |
| Stale `build-info.json` shipping `backendUrl: null` to fresh clones | **Fixed** in `2baead8` — untracked and gitignored |
| OAuth buttons render for unconfigured providers | Open. Backend correctly returns `provider_disabled`; frontend does not filter. Requires a new IPC channel (shared type + enum + response map + main handler + preload + renderer) — not a frontend-only change |
| `knowledgeBench.test.ts` Stage 7 benchmark | Flaky. Wall-clock assertion (≤120 ms) measured 146 ms and 183 ms under full-suite load. Machine-load sensitive, not a product defect |
| `syncReliability.test.ts` worker-pool concurrency | Flaky. Expects peak 4, observes 3 under full-suite load; passes in isolation. Either an orchestrator race or a timing-dependent test measurement — undetermined |
| Renderer bundle size | `index-Dh8e3oPD.js` 988 kB, `EnterpriseView` 377 kB. Startup latency cost, not a defect |
| npm audit | 16 vulnerabilities (3 moderate, 11 high, 2 critical), predominantly dev tooling. **Do not run `npm audit fix --force`** — it rewrites the lockfile across major versions |

---

## 9. Remaining work — priority order

1. **TLS on the hosted backend.** Get Cloudflare access, point `api.neuropause033.com` at `64.227.128.218` with proxy enabled, set SSL/TLS mode to Flexible, rebuild the exe against the https URL. Closes plaintext credentials on the public path. ~15 min once access exists.
2. **Offsite database backup for the droplet.** Currently a single Postgres container with no dump and no snapshot. Highest data-loss risk in the system.
3. **Deploy current code to the droplet.** It runs `35eedc0`; the desktop app is months ahead. Requires a database backup first.
4. **A8 — migration and data durability.** Schema versioning and backup/restore for the 46 record stores. Prerequisite for any further enterprise module work.
5. **Code signing certificate.** OV/EV certificate purchase plus identity verification. Business decision, not engineering.
6. **A9–A15 (Finance GL, Projects, HR, connector resilience, Copilot unification, analytics).** Demand-gated. These are Mode 2 native ERP modules; Mode 1 (governing existing systems) is the defensible near-term product.

### Deliberately deferred

- Kubernetes/Helm deployment (manifests exist in `deploy/` and are schema-valid, but a single-host Compose deployment is correct for current scale)
- Qdrant on the droplet
- The two flaky tests

---

## 10. Not verified

Stated explicitly rather than implied:

- Data paths of ~25 renderer views beyond strategy and digital twin
- Backend route inventory
- Connector runtime behaviour against any real external system
- Plugin system
- AI/Ollama integration
- Whether the performance overlay is genuinely gated in packaged builds (source comment claims "renders null on packaged builds"; the gating code was not read)
- Whether `apps/desktop/src/main/enterprise/modules/finance/` invoice/payment logic constitutes any part of an accounting system (it does not appear to — no double-entry primitives exist)
