# LOCAL-FIRST FULL STACK — status after the overnight run
### 20–21 Aug 2026 · Tier-2 (nothing here can produce an external effect) · **no boundary was crossed**

## THE ONE COMMAND

```bash
./np-local-up.sh              # services → migrations → backend → health-verified
./np-local-up.sh --desktop    # …and start the desktop against it
./np-local-up.sh --down       # stop the local backend (containers stay up)
```

**Verified end to end, ~25 s cold:** postgres accepting · redis PONG · migrations current · backend
`{"status":"ok","components":{"database":"up","redis":"up"}}`.

**Boundaries held by construction, not by care:**
- **Razorpay INERT** — the generated env blanks the keys, so `billingConfigured()` is false and every billing call
  throws `billing_disabled` **before a client is constructed** (the SDK is lazily built inside `rzp()`). The script
  **refuses to start** if those keys are ever non-empty.
- **`apps/desktop/out/` is never rebuilt** — that artifact carries P4-MIN and is what P1 attempt 2 runs against.
  The desktop here runs from source via electron-vite dev.
- No outbound network; local docker services only. m365 send path, CST kernel and `first-real-send.latch`
  untouched.
- `.env.local-stack` is generated with a fresh random JWT secret and **gitignored**. No secret committed.

## WHAT EXISTS (Phase 1)

**1.1 · Backend — REAL and already running.** `apps/backend`, Express + `pg` + `ioredis` + `jose`/`jsonwebtoken` +
argon2, 13 SQL migrations, `dev`/`build`/`start`/`db:migrate`/`db:seed` scripts. **A backend has been up for 6.2
days** (`neuropause-prod-backend-1` on 127.0.0.1:4000) reporting healthy. Six containers run in total across
**two** stacks — dev (`neuropause-postgres`/`-redis`/`-qdrant`, 2 weeks) and prod (`neuropause-prod-*`, 7 days).

**1.2 · The desktop↔backend seam — the two-day-owed read, answered.** `runtimeTelemetry.probeBackend()` fetches
**`${config.backendUrl}/health`** with a 4 s abort, and `res.ok` ⇒ `connected`. `config.backendUrl` =
`NEUROPAUSE_BACKEND_URL` ?? (`app.isPackaged` ? baked : **`http://127.0.0.1:4000`**). Running
`Electron out/main/index.js` is **not** packaged, so the ceremony build probes `127.0.0.1:4000` — **and that
endpoint returns 200.** `/healthz` and `/readyz` are **404** (S18 would add them).

**`S18` = "Backend revival + live sync proof"** (Wave 5, S18): `infra/compose` with postgres/redis/backend/MinIO/
Caddy, `make up`, audited migrations + deterministic seed, `/healthz` `/readyz`, structured logs, auth hardening,
pgBackRest → MinIO, `make backup` / `make restore-drill`, and a two-instance sync proof via testcontainers.
**Not landed.**

**1.3 · ERP — partly wired.** `deriveSourceLineage` has **5** non-test callers (FG-11 landed it as a shared
one-rule authority — genuinely wired). `composeBusinessFacts` and `draftOverdueReminder` have **no production
caller** — matching CLAUDE §1's own note that *lane wiring is an explicit post-ceremony gate*.
`aggregatedImports` is **test-only**.

**1.4 · CRM — does not exist as a wired product.** `packages/business/src/crm.ts` is **149 lines** of preview
module (accounts/contacts/leads/opportunities), and **`@neuropause/business` is not imported by the desktop main
at all**. The `crm` hits inside main are in `connectors/bridge/entityMap.ts` — mappings that fold *external* CRM
providers' entities into the customer master. **That is ingestion, not a CRM.** Nothing was built.

## WHAT GOT WIRED

**The one command**, which did not exist. Previously the stack was `infra:up` + `db:migrate` + `dev` as separate
steps with no health verification, no port handling, no payment guard, and no secret generation.

**A real bug found and fixed in the same pass:** a subshell wrapping the backgrounded backend kept the caller's
stdout pipe open, so `./np-local-up.sh | tail` hung **forever after the work had already succeeded**. Subshell
removed; verified under a pipe.

## WHAT DOES NOT RUN — one line each

- **`/healthz`, `/readyz`** — not implemented; the probe uses `/health`, which works. S18 scope.
- **`composeBusinessFacts`, `draftOverdueReminder`** — no production caller by design (post-ceremony gate).
- **CRM** — a 149-line preview package with no main-process import.
- **Desktop-side probe confirmation** — not observed in a running desktop; see below.

## THE UNEXPLAINED THING, RECORDED NOT CHASED

The r3 log shows **43 × `subsystem:"backend","ok":false`**, zero `ok:true`, while the backend it probes was up and
healthy throughout. Two hypotheses were **tested and killed**: the e2e global-fetch mock passes non-Graph URLs
through to `realFetch`, and **no backend URL is baked into the bundle**. So the desktop was probing a live,
healthy endpoint and still reported failure. **Cause unknown. It does not block the wiring** — the endpoint is
reachable from this machine and the probe targets it correctly — so it is recorded and left.

## DECISIONS WAITING ON THE OPERATOR

**1 · THE BUNDLING FORK (asked for, deliberately not taken).** Bundle Postgres + Redis with the product, or
replace them with embedded equivalents (SQLite + an embedded KV)? Docker was used because it was already
installed and running. The consequences are install-complexity, not code: **bundling** keeps the backend code
unchanged but makes the installer carry containers or require Docker; **embedding** removes that dependency but
means a `pg`→SQLite data-layer port and losing Redis semantics. **A real fork; not a task.**

**2 · TWO STACKS ARE RUNNING.** Dev and prod compose stacks coexist, and the prod backend holds :4000 — the port
the desktop defaults to. The script falls back to :4010 and says so. **Which stack is "the" local stack, and
should the prod containers be stopped?**

**3 · CRM — build on the ERP spine, or not at all?** The design note, as requested and no further: a CRM would
reuse the ingestion spine (importer write path, `sourceTrust` labelling, `deriveSourceLineage`) and the customer
master that `entityMap.ts` already targets — accounts and contacts are *already* the fold destination for external
CRM providers. What it would need that does not exist: an opportunity/lead lifecycle with governed state
transitions, and a decision about whether any CRM action is ever consequential (which would put it on the
certification ladder rather than in the read-only spine).

**4 · A cosmetic honesty defect, not fixed:** the backend's startup line prints
`listening on http://127.0.0.1:4000 (port 4010)` — the URL is hardcoded while the port is real. F-5 family, one
line, left alone because the run's instruction was to record only what blocks the wiring.
