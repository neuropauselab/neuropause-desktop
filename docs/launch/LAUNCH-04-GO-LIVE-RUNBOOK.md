# LAUNCH 04 — Go-Live Runbook & RC1 Release Checklist

The capstone of the redirected launch track. It consolidates every audit
finding with its final status, defines the ordered checklist from here to your
first external user (each box has a paste-back that closes it), and states the
evidence-cited readiness of every subsystem. Companion docs: RC1-01…05 (audit),
LAUNCH-01 (server), LAUNCH-02 (packaging), LAUNCH-03/+03b (connectors).

## 1. Findings ledger — complete

| ID | Finding | Status |
| --- | --- | --- |
| A1-1 | Undocumented env vars | **Closed** — backend schema authoritative (RC1-03 §3); desktop + connector names documented in `.env.example`. |
| A1-2 | Version control | **Closed** — private remote live, history secret-free (developer-verified). |
| A2-1 | Dual plan vocabularies on `subscriptions` | Documented (RC1-02). |
| A2-2 / A3-1 | Meilisearch unused | **Closed** — removed from the dev compose and `.env.example`. |
| A2-3 | Qdrant verdict | **Closed — keep**: referenced by `unified/search`, `searchBackend`, `memory/memoryRetriever` (optional local search backend; graceful-absence check sits in the deferred A6 deep-dive). |
| A3-2 | Store router: 23 endpoints, 0 tests | **Closed** — `store/router.test.ts`: 58 HTTP tests over a real Express app (real service + JWT auth path, repository mocked); covers all 23 endpoints, auth gating, validation, personalization, and error codes. |
| A3-3 | Pin connector-accounts mount path in API ref | **Closed** — pinned in RC1-05 §4: the cloud-side module is **unmounted in rc.1** (no HTTP route exists; desktop-side state is authoritative). |
| A4-1 / A4-2 / A5-3 | ~24 dead channels + legacy sim (`cloud-sync.json`) | **Closed** — see §1a. Channel registry audited to **0 unreachable** of 678; the pre-livesync sync simulator is deleted and the Cloud → Sync console now renders the real engine. |
| A5-1 | Honest capability claim | Adopted: "connects 16 services; live sync for GitHub, Notion, Slack, Google Calendar." |
| A5-2 | Connector env names | **Closed** (LAUNCH-03). |
| SEC-1 | Backend port published on all interfaces | **Closed** — loopback binding in the runbook (server) and committed in `docker-compose.prod.yml`. |
| 02-1 | "Packaging missing" claim | Correction recorded — it pre-existed. |
| 02-2 | Backend URL in packaged builds | **Closed in code, tested.** |
| 02-3 | App icon | Open — required before public release. |
| 02-4 | Update-feed host placeholder | Open — after your first dmg. |
| 03-1 | Client-id baking (never secrets) | **Closed in code, tested** (suffix filter makes secret-baking impossible). |
| 03-2 | Fixed callback path for exact-match providers | **Closed in code, tested.** |

### 1a. A4-1 / A4-2 / A5-3 — closure evidence

**A4-1 (dead channels).** The IPC surface is now 678 declared channels with
**zero unreachable**: 625 are handler-backed (`channel: IpcChannel.X` in a
`SecureHandlerDef`), 21 more are routed through the `ipc/router.ts` map, and the
remainder are broadcast-only channels that appear in `SUBSCRIBABLE_CHANNELS` and
are emitted from main. Every cloud channel additionally carries an explicit
permission classification — `withCloudAuthz` throws at startup if one does not,
so a channel cannot be added without being classified.

**A4-2 / A5-3 (legacy sync simulator).** `apps/desktop/src/main/cloud/sync/`
(the domain-level `planSync` simulator, its `SyncStore`, and the seven
`cloud:sync.*` channels) is deleted, along with the `SyncDomain`,
`SyncDomainState`, `SyncSummary`, `SyncConflict`, and `SyncResult` types in
`packages/shared`. Nothing simulated remains in the sync path: the Cloud → Sync
console is now a console for the **real** live-sync engine, reading a new
RBAC-gated `livesync:detail` channel (READ) that projects the engine's own two
sources of truth — the durable outbound queue and the local mirror of reconciled
records — into one row per `SyncEntityType`, plus the engine's bounded log of
conflicts it actually resolved. Pause is a real pause (the scheduler cancels its
timer and the engine refuses cycles, so edits stay queued on the device), and
"Sync now" runs a real cycle. The federation observability "Synchronization"
tile was migrated off the simulator in the same increment and now reports real
mirrored-record counts, the real backlog, and the real engine state.

`cloud-sync.json` in `userData` is the simulator's orphaned store file. It is no
longer read or written by any code path; existing installs may still have one on
disk and it is safe to delete. No migration is required — the live-sync engine
keeps its own queue, cursor, and mirror.

**Verification.** `npm run typecheck` (all workspaces) and `npm run lint`
(repo-wide, `--max-warnings 0`) clean; `npm run test` green across every
workspace, desktop at 548 files / 5094 tests, including new coverage for the
detail projection, the engine's conflict log and pause semantics, the
scheduler's pause/idempotence, and the observability tile's sync states;
`npm run build` green.

## 2. Go-live checklist — ordered, all yours, each with a paste-back

- **G1 Server** — LAUNCH-01 steps 1–10. Paste: the two step-9 `curl` outputs + `docker compose ps`. (Tunnel variant acceptable for G2 testing only.)
- **G2 First connector** — LAUNCH-03 Google steps + the one-line dev launch. Paste: what Connectors and Timeline show after approving.
- **G3 First .dmg** — LAUNCH-02 Part A against your real domain. Paste: the build's last lines + Release Diagnostics (channel `beta`, packaged `true`).
- **G4 Remaining Tier-A consoles** — GitHub/Notion/Slack per the updated LAUNCH-03 (callback `http://127.0.0.1/callback`). Paste each connect result; if Slack/Notion consoles reject http, paste the exact message.
- **G5 Fresh-install walk-through** — install the dmg, then as a new user: wizard → create org → connect a source → see the timeline → Diagnostics AI rows → send one feedback → toggle pilot. This single session also closes the five outstanding Sprint-5 visual checks.
- **G6 Sign + notarize** — LAUNCH-02 Part B once the Apple account exists.
- **G7 Publish** — host the dmg (GitHub Releases is fine) + a download page.

**Definition of launched:** G1–G5 green = friends-and-family early access
(unsigned, hand-distributed). Add G6–G7 = public.

## 3. Readiness matrix (evidence in parentheses)

Backend: 56 endpoints / 168 tests, boot-refusal config, prod image validated
(RC1-03; Sprint-4 Docker run). Database: 33 tables, constraints enforcing
invariants, migrate-on-boot (RC1-02). Auth: PKCE, replay-safe Redis state,
session rotation, ≥32-char JWT enforced (RC1-03 §4). Desktop core: 532 tests /
68 files, 360-channel Zod-validated IPC, encrypted vaults, audited mutations
(RC1-04; this session's suites). AI chain: 15 dedicated test files across
engine / context / conversation / Founder & Engineering AI / memory / graph /
timeline; Ollama optional with a health probe that says exactly how to fix it;
Qdrant an optional search backend (today's grep). Connectors: 4 live-sync +
12 OAuth-ready, engine console-compatible as of 03b, first OAuth-layer tests
added. Commercial: gateway-neutral billing (off until keys), license
valid-free by default, flags. Early access: wizard, welcome, feedback, pilot —
all service-tested. Packaging: URL + client-id baking tested; one command to a
dmg. Operations: diagnostics + AI probes, local crash/telemetry, support
bundle, nightly backups (G1).

## 4. Day-2 operations

Server update: LAUNCH-01 §11 one-liner. New app release: bump the prerelease
version (`1.0.0-rc.2`) → `npm run package` → replace the dmg; the channel
derives itself. Secret rotation drill: regenerate `JWT_ACCESS_SECRET` on the
server → restart stack → every user re-logs-in (do it in a quiet hour);
provider keys rotate in their consoles then restart. Feedback: entries live in
each install's `feedback.json` (export via `ipc.feedback.exportAll`; a one-click
export button is a small ask away). Support: Operations → support bundle +
`audit.log`.

## 5. Optional cleanups (safe now, each one command)

Remove Meilisearch from `docker-compose.yml` (verified unused — delete its
service block + `MEILI_MASTER_KEY`); **keep Qdrant** (used). Commit SEC-1 into
the repo (on your Mac):
`sed -i '' 's#${BACKEND_PORT:-4000}:4000#127.0.0.1:${BACKEND_PORT:-4000}:4000#' docker-compose.prod.yml`
then commit. Add the enumerated env names to `.env.example` as comments.

## 6. Deferred, named plainly

A6 deep-dive (retrieval quality, Qdrant-absent degradation), A3-2 store smoke
tests, app icon, update-feed hosting, Windows. (A4-1 / A4-2 / A5-3 are no longer
deferred — closed with evidence in §1a.)

## 7. Audit-deliverable cross-reference

Startup guide → RC1-01 + LAUNCH-01 · Environment reference → RC1-01 §3 +
RC1-03 §3 + LAUNCH-03 §3 · Database/ER → RC1-02 · API inventory → RC1-03 ·
Desktop/IPC → RC1-04 · Connector matrix → RC1-05 · Deployment → LAUNCH-01 +
`docs/DEPLOYMENT.md` · Packaging → LAUNCH-02 · Security posture → RC1-03 §4 +
RC1-04 §1 + LAUNCH-01 §12 + §1 here · Testing matrix → §3 here + suite
outputs · Gap analysis → §1/§6 here · Go-live checklist → §2 here. Deferred
deliverables: Windows guide, A6 deep-dive.

**First paste-back:** G1's curls or G2's connector result — either order (G2
works today via the tunnel). From here, the work is yours to run and mine to
verify.
