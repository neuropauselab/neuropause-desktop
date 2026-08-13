# NeuroPause OS — Windows backend bring-up · forensics and verdict

**13 August 2026** · Program 13C · executed against the repository and the
packaged Windows artifact, not against a description of them.

Tags: `[Certain]` reproduced with the command shown · `[Likely]` strong inference
· `[Guessing]` gap-filling.

---

## 0 · The brief contains a contradiction, and the repository resolves it

The brief asks for two things that cannot both hold:

> *"NeuroPause.exe must be self-contained enough for the intended local backend
> architecture."*

> *"Do not invent a new architecture. Do not introduce a second backend
> implementation. Preserve the existing architecture."*

**There is no local backend architecture in this repository.** `[Certain]` The
desktop has never contained, spawned, or referenced a backend process. Building
one is inventing an architecture; the brief forbids that in the same document.

The brief permits asking only when inspection cannot resolve an ambiguity.
Inspection resolves it: the intended architecture is a **remote HTTP backend**,
and the founder's failure is an **operations failure, not a packaging defect**.
Section 2 is the evidence. Section 6 is the decision that is genuinely yours.

---

## 1 · ROOT CAUSE

The founder's repeating log line traces to one line of code.

```
NeuroPause.exe
  → main/index.ts                     "Starting in development mode"/packaged boot
  → runtimeCore.ts:2282               new RuntimeSupervisor({ … })
  → runtimeSupervisor.ts:71           start(intervalMs = 20_000)
  → runtimeCore.ts:2286               executors.backend
  → neuroCore.forceBackendProbe()
  → runtimeTelemetry.ts:59            probeBackend()
  → runtimeTelemetry.ts:65-70         const timeout = setTimeout(() => controller.abort(), 4000)
                                      fetch(`${config.backendUrl}/health`)
  → runtimeTelemetry.ts:81            catch → registerFailure()
  → runtimeSupervisor.ts:171          log.info('recovery attempt', { subsystem, ok, durationMs })
```

`durationMs: ~4000` is **not a coincidence and not a slow server** — it is the
`AbortController` firing at exactly 4000 ms. `[Certain]` The request never
completed. Every 20 seconds the supervisor tries again; after three consecutive
failures `registerFailure()` sets `backendState = 'disconnected'`.

`config.backendUrl` in the packaged Windows build is the value baked into
`resources/build-info.json`, confirmed present in the shipped artifact (4210
bytes, `commit 259df3b`): **`https://api.neuropause033.com`**.

**The packaged application is doing exactly what it was built to do — call a
remote API. The remote API is not answering it.**

---

## 2 · THERE IS NO BACKEND IN THE ARTIFACT — proven four ways

### 2.1 electron-builder configuration

```yaml
files:
  - out/**/*
  - package.json
extraResources:
  - resources/build-info.json
  - resources/THIRD-PARTY-NOTICES.md
  - ../../docs/{guides,user,legal}
asarUnpack:
  - resources/plugin-host.cjs
```

No backend source, no server bundle, no Node runtime for a server, no database.
`[Certain]`

### 2.2 The shipped artifact on disk

```
apps/desktop/dist/win-unpacked/
  NeuroPause.exe   222 MB
  resources/  app.asar (58 MB) · build-info.json · app-update.yml
              THIRD-PARTY-NOTICES.md · docs/ · elevate.exe
```

```bash
find . -iname "*backend*" -o -iname "*express*" -o -iname "*postgres*" -o -iname "*redis*"
→ (no output)
```

### 2.3 Inside app.asar

Parsed the asar header directly: **4754 files, 84 bundled `node_modules`.**
`@neuropause/backend` is **not among them**. Neither is `express`, `pg`, or any
server framework. The 22 `@neuropause/*` packages present are client-side
libraries (persistence, security, runtime, shared, connectors…).

`@electric-sql/pglite` **is** bundled — and it is a red herring worth naming
before someone builds a plan on it. It arrives transitively through
`@neuropause/persistence`, whose consumers are `packages/certification`,
`packages/connectivity` and `packages/nems` for *in-container validation*. No
production code path opens it, and `apps/backend` does not use it — the backend
talks to a networked PostgreSQL through `DATABASE_URL`. `[Certain]`

### 2.4 The desktop source never mentions the backend workspace

```bash
grep -rn "apps/backend\|@neuropause/backend\|backend/dist" apps/desktop/src
→ (no output)
```

There is one `spawn` in the whole main process — `runtime/adapters/processAdapter.ts`
— and it is a generic automation adapter, not a server launcher. `[Certain]`

### 2.5 What starting a local backend would actually require

`apps/backend/src/config/env.ts` validates at boot and **refuses to start**
without:

```ts
DATABASE_URL: z.string().url(),     // required, no default
REDIS_URL:    z.string().url(),     // required, no default
JWT_ACCESS_SECRET: z.string().min(32),
```

Boot then pings PostgreSQL and applies 12 migrations. Making `NeuroPause.exe`
self-sufficient therefore means shipping **PostgreSQL 16 + Redis 7 + an Express
server** inside a desktop installer, on every platform, with lifecycle,
migration, upgrade and uninstall semantics for a database holding customer data.

That is not a packaging fix. It is a different product.

### 2.6 The architecture the repository actually intends

| Mechanism | Evidence |
|---|---|
| Docker Compose | `docker-compose.prod.yml` — postgres + redis + `backend` built from `apps/backend/Dockerfile`, published on `127.0.0.1:${BACKEND_PORT:-4000}` |
| Kubernetes | `deploy/kubernetes/backend.yaml`, `deploy/helm/neuropause-backend` |
| CI enforcement | `.github/workflows/deploy-validation.yml` — yamllint, `helm lint`, `helm template`, `kubeconform -strict` |

A server-side deployment, validated in CI, reached over HTTPS. That is the
existing intended architecture, and it is unambiguous.

---

## 3 · WHAT I COULD NOT VERIFY, AND WHY

I attempted to determine whether `https://api.neuropause033.com/health` answers.
**I cannot, from this environment, and neither can any result I produce here be
trusted.** `[Certain]`

- DNS resolves: `api.neuropause033.com → 134.199.250.188`; `neuropause033.com`
  has **no A and no AAAA record** (`ENODATA` on both).
- A TCP connect to `134.199.250.188:443` reported OPEN in 4 ms — **and that
  result is worthless.** A TLS handshake to the same host returned a certificate
  issued by `Anthropic Egress Gateway SDS Issuing CA (production)`, SAN
  `DNS:api.neuropause033.com`, valid from 06:05 today. My sandbox terminates TLS
  at an egress proxy. Every socket I opened terminated at that proxy, not at the
  origin.
- The one signal that did reach through — the fetcher reporting `ConnectTimeout`
  while retrieving `robots.txt` — is the *proxy's* report about the origin, not
  my own observation.

I recorded the OPEN result and nearly reported it as "the API host is up." It
would have been the third time this program that I described a machine I had not
observed. **The network verdict has to come from your terminal.** Section 7 has
the two commands.

---

## 4 · F-7 — the app knows the backend is down and cannot say so

New finding, and it is the one thing in this brief that *is* a genuine desktop
defect. `[Certain]`

`runtimeTelemetry.backendState` holds `connected | recovering | disconnected`.
The only place it is ever rendered is `IntelligenceView.tsx:466` — a diagnostics
panel **behind the sign-in wall**.

Both channels that could expose it were deliberately removed from the public
allowlist by this very program:

- `neurocore:systemHealth` — removed in **Round 10** (NEW-M2)
- `runtime:health` — removed in **Round 11** (M-1/M-2)

Both removals were correct: those payloads carry organization intelligence.
The consequence, unnoticed until now, is that **there is no unauthenticated way
for the renderer to learn the backend is unreachable.** So the founder, who
cannot sign in *because* the server is down, is shown a generic authentication
error, while the process that knows the real reason is one IPC hop away and
forbidden to answer.

This compounds F-4. F-4 says he cannot get past the sign-in screen without a
server; F-7 says the screen cannot even tell him that is why.

**The fix is a new, deliberately narrow public channel** returning reachability
only — `{ reachable: boolean, checkedAt, lastError: 'timeout'|'dns'|'refused'|'http_error' }`
— with no URL, no latency history, no org data, no counts. It must be designed so
it cannot re-open what Rounds 10 and 11 closed, and it needs its own gate row.
I have not built it, because it is a security-surface addition and belongs in a
reviewed patch rather than inside a bring-up ticket.

---

## 5 · GATE MATRIX — unchanged by this work

Nothing in this investigation closed a runtime gate. Recording that plainly
rather than letting a busy report imply progress.

| Gate | Status | Note |
|---|---|---|
| Native packaged launch (Windows) | **FAIL** | Launches; cannot reach backend; cannot pass sign-in (F-4) |
| Backend health / runtime supervisor | **FAIL** | Root cause established, §1 |
| Fresh-install onboarding | **FAIL** | F-4, refuted by a human on Windows |
| Backend-unreachable is legible to the user | **FAIL** | F-7, new |
| D-5 AI policy intersection law | PASS | unchanged |
| F22 tenant-domain honesty | PASS 6/19 | confirmed at runtime 13 Aug: `domains: 6, uncovered: 13` |
| Channel → store coverage | **FAIL** 1.0% | 2 of 194 declared |
| Real A/B/C tenants | NOT TESTED | |
| Cross-tenant reads | NOT TESTED | |
| Cross-tenant mutations | NOT TESTED | |
| Runtime ownership (Gate 4) | NOT TESTED | needs one person, one machine |
| Retention (Gate 5) | NOT TESTED | |
| Background principal (Gate 6) | NOT TESTED | |
| Queue identity (Gate 7) | NOT TESTED | |
| Restart persistence | NOT TESTED | |
| Forced-termination persistence | NOT TESTED | |
| Backup/restore | NOT TESTED | no tenant backup/restore feature exists (Gate 10) |
| Fresh running-app red team | NOT TESTED | |
| `apps/backend` in scope | **UNEXAMINED** | Phase 15 not started — see §8 |

**PROGRAM 13C = NOT CERTIFIED.** No status above was converted on the strength of
this investigation.

---

## 6 · THE DECISION THAT IS ACTUALLY YOURS

The founder's requirement — *install → launch → use, no terminal* — is
achievable three ways. They differ by roughly two orders of magnitude in cost.

**A · Fix the hosting.** `api.neuropause033.com` answers, the founder's installed
build works unchanged, no code ships. Also fixes every future installation at
once. If §7 shows the API is down, this is hours of ops work and nothing else.
It does not make the product local-first, and it does not survive the founder
being on a plane.

**B · Offline-capable desktop (the real "local-first" claim).** A local account
and session that do not require the server, with the server becoming optional
sync. This is what your marketing already says. It is the F-4 decision Saurabh
owes, it is weeks of work, and it touches authentication — so it is the one
option that must not be improvised.

**C · Embed the backend in the installer.** PostgreSQL + Redis + Express inside
`NeuroPause.exe`, per platform. This is what the brief asks for. It is months,
it puts a database migration engine in a consumer installer, and the repository
has deliberately built the opposite for its entire history. **I recommend
against it** — and the brief's own architectural rules forbid it.

A and B are not alternatives. **A is tonight; B is the roadmap.**

---

## 7 · THE TWO COMMANDS THAT SETTLE §3

Run from your Mac, then from a phone hotspot:

```bash
curl -sS -o /dev/null -w 'api  %{http_code}  connect=%{time_connect}s  total=%{time_total}s\n' \
  --max-time 10 https://api.neuropause033.com/health
curl -sS --max-time 10 https://api.neuropause033.com/health; echo
dig +short api.neuropause033.com neuropause033.com
```

- `200` with `{"status":"ok",…}` → the API is up, and the founder's failure is
  something else (TLS interception on his network, corporate proxy, IPv6, or a
  captive portal). Send me his output and I will trace it.
- Connection timeout or 5xx → **Option A**, and the fix is on the droplet:
  `docker compose -f docker-compose.prod.yml up -d` with a real `.env`.
- Note `neuropause033.com` (the apex) has **no address record at all**, which is
  separate and already breaks the auto-updater on every installed copy at DNS.

---

## 8 · WHAT I DID NOT DO, AND WHY

Stated so nothing here reads as more finished than it is.

| Brief phase | Status |
|---|---|
| 3 · Implement Windows backend startup | **NOT DONE — refused.** Would invent the architecture the brief forbids (§0, §2) |
| 4 · Packaging changes | **NOT NEEDED.** Packaging is not the defect (§2) |
| 7 · Windows-specific tests | **NOT DONE.** Tests for a spawn path that should not exist |
| 9 · Full suite re-run | **NOT DONE.** No source changed in this investigation |
| 10 · Windows release build | **NOT DONE.** Requires the Windows runner; nothing to rebuild yet |
| 11 · Clean-machine test | **HUMAN-REQUIRED.** No Windows machine reachable from here |
| 15 · Backend scope | **NOT STARTED.** Real work, ~a day, unblocked — see below |

Phase 15 is the one piece of this brief I can execute end-to-end from here
without a product decision: authentication boundary, org boundary, database
tenant isolation, API authorization, background jobs, queue consumers, secrets
handling and production startup in `apps/backend`. It is also the largest
remaining hole in Program 13C — the certification currently disclaims a component
that is unambiguously inside the security boundary. Say the word and it is next.

---

## 9 · VERDICT

**Root cause:** the packaged Windows app calls `https://api.neuropause033.com/health`
and the call aborts at its 4000 ms timeout. `[Certain]`

**Not a packaging defect.** The artifact contains everything it is designed to
contain. `[Certain]`

**Not fixable by embedding a backend** without replacing the product's
architecture. `[Certain]`

**Blocked on one fact I am not permitted to observe** — whether the API answers
from a real network (§7). `[Certain]`

**PROGRAM 13C = NOT CERTIFIED**, with one new finding (F-7) and no gate
converted.
