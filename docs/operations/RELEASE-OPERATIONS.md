# NeuroPause EOSP — Release Operations Operating Manual

> **What this is.** The **release operating model** for the Enterprise Operations & Scale
> Program (EOSP): the calendar, governance, hotfix path, rollback discipline, and
> maintenance-window practice that decide _when and how_ NeuroPause ships. It sits **above**
> the per-release gate: [`RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md) is executed
> _inside_ every train described here — this manual is the cadence and decision layer around
> it, not a second copy of it. It adds **no runtime and no platform** — cadences, roles, and
> decision rules over the **real** CI (`backend-ci`, `deploy-validation`, `windows-release`),
> the **real** quality gates, and the **proven** recovery mechanics.
>
> **Honesty banner (non-negotiable).** The project has shipped exactly **one** version —
> `1.0.0-rc.1` (Validated Release Candidate; see [`CHANGELOG.md`](../../CHANGELOG.md)). **No
> release cadence has yet run: every schedule in §1 is a _proposed_ train, never a claimed
> track record, and there is no version history beyond `1.0.0-rc.1`.** The versioning scheme
> (**SemVer**), commit convention (**Conventional Commits**), and changelog format (**Keep a
> Changelog**) are **real and in use** (`CONTRIBUTING.md`, `CHANGELOG.md`). **Application-binary
> rollback is _advisory only_** (`appUpdater.ts` `allowDowngrade=false`); the **real** recovery
> lever is **data-side restore** via the proven `pg_dump`/`pg_restore` scripts — see §4 and
> [`DISASTER-RECOVERY-GUIDE.md`](../guides/DISASTER-RECOVERY-GUIDE.md). **macOS release
> automation does not exist**; Windows release CI does (`windows-release`) — §1 and §3 carry
> that gap rather than paper over it.

## 1. Release calendar

NeuroPause ships on **release trains, not on dates**. A train is a fixed cut point at which
whatever has merged, passed the gates, and been accepted is packaged and tagged; unfinished
work waits for the next train rather than holding the one in motion. The tiers below map
**directly onto SemVer** (`MAJOR.MINOR.PATCH`, plus a `-rc.N` pre-release suffix, exactly as
`CONTRIBUTING.md` and `CHANGELOG.md` already use).

> **Proposed schedule — not history.** The cadences in the next table are **proposed operating
> targets to be ratified once a team is staffed**. The only release that has actually been cut
> is `1.0.0-rc.1`. Every later identifier used in this document (`1.0.0-rc.2`, `1.0.0`,
> `1.0.1`, `1.1.0`, `2.0.0`) is an **illustrative forward slot to show the mechanics** — none
> has shipped, and nothing here claims an attained frequency.

| Tier       | SemVer effect                                          | Proposed train cadence                   | Cuts from                        | Gate depth                                                         | Changelog treatment               |
| ---------- | ------------------------------------------------------ | ---------------------------------------- | -------------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| **Major**  | `X.0.0` — breaking change (`feat!`/`BREAKING CHANGE:`) | On demand; announced ≥1 train ahead      | `release/X.y` branch off `main`  | Full [`RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md) §1–8 | New top section + migration notes |
| **Minor**  | `x.Y.0` — additive `feat`                              | Scheduled train (proposed: **monthly**)  | `release/x.Y` branch off `main`  | Full checklist §1–8                                                | New top section                   |
| **Patch**  | `x.y.Z` — `fix`/`perf` only, no new surface            | Rolling (proposed: **as-needed, ≤2-wk**) | `release/x.y` maintenance branch | Full checklist; §4 packaging scoped to changed artifacts           | Dated patch entry                 |
| **Hotfix** | `x.y.Z` — single urgent `fix`                          | Out-of-band (**hours**, not a train)     | Branch off the affected **tag**  | **Reduced-but-defined** gate — see §3                              | Dated hotfix entry + disclosure   |

### Version scheme (real convention)

| Slot                        | Meaning                                                                         | Status today                                 |
| --------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| `1.0.0-rc.N`                | Pre-GA release candidate; each `-rc.N` is a **stabilization iteration**         | **`1.0.0-rc.1` is the only cut that exists** |
| `1.0.0`                     | GA — the `-rc` suffix is dropped once the checklist passes with no open blocker | Proposed forward slot                        |
| `1.0.Z` / `1.Y.0` / `X.0.0` | Patch / minor / major per the tiers above                                       | Proposed forward slots                       |

### Train mechanics

1. **Cut.** At the train time, branch `release/x.y` from `main`; from that moment the branch
   takes **fix-only** commits (stabilization), while `main` continues to take features.
2. **Stabilize.** Run the full gate (§2) against the release branch until green; iterate the
   `-rc.N` counter for each candidate build (`1.0.0-rc.1` → `1.0.0-rc.2` → …).
3. **Tag.** Tag the accepted commit `vX.Y.Z`. A `v*` tag push is the **real trigger** for the
   `windows-release` workflow, which builds the Windows artifacts and publishes a GitHub
   Release (marked _prerelease_ automatically for `-rc`/`-beta` tags — `windows-release.yml`).
4. **Publish backend.** The backend image is built/pushed per the checklist §6; `backend-ci`
   proves the image builds on every backend change (`docker-build` job, no push).

> **Platform-coverage gap (carry honestly).** Tag-driven release automation exists for
> **Windows only**. **macOS packaging/signing is run manually** per
> [`LAUNCH-02-MAC-PACKAGING.md`](../launch/LAUNCH-02-MAC-PACKAGING.md) (checklist §4) — a macOS
> train has an **extra manual step** and must be scheduled with that labour budgeted in. There
> is also **no per-PR desktop CI**, so desktop regressions are caught at the `windows-release`
> build, not on the PR. Both are tracked gaps (`ENTERPRISE-GA-REPORT.md`), not omissions.

## 2. Release governance

Governance answers two questions for every train: **who owns each decision**, and **what makes
it a go**. Roles are **hats, not headcount** — any qualified operator may wear one; the model
names roles, never people.

### Roles (hats, not people)

| Role                               | Owns                                                                                                | Engaged            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------ |
| **Release Manager (RM)**           | The train: version decision, changelog cut, tag, go/no-go call                                      | Every release      |
| **Engineering Lead / code owners** | Code correctness; `CODEOWNERS` approval per touched path (`CONTRIBUTING.md` §Branch & PR)           | Every release      |
| **Gate Verifier (QA)**             | Re-running the real gates and **recording the actual numbers** (never transcribed)                  | Every release      |
| **Security Reviewer**              | `npm audit --omit=dev` triage + confirming the tracked pre-GA security items have **not regressed** | Every release      |
| **On-call / SRE**                  | Deploy, post-release `/health`+`/metrics` verification, rollback readiness (§4)                     | Every release      |
| **DR owner**                       | Confirms a current backup exists **before** any migrating release (checklist §5)                    | Migrating releases |

### The quality-gate ledger (the real go/no-go inputs)

The go decision is bound to the **same real gates** CI and `CONTRIBUTING.md` enforce — nothing
aspirational. These are inputs to the checklist, not a restatement of it.

| Gate             | Command (repo root)    | Pass bar                                                                | Enforced by                          |
| ---------------- | ---------------------- | ----------------------------------------------------------------------- | ------------------------------------ |
| Typecheck        | `npm run typecheck`    | **0 errors**, all workspaces                                            | `backend-ci`, `windows-release`      |
| Lint             | `npm run lint`         | **0 warnings** (`--max-warnings 0`)                                     | `backend-ci`, `windows-release`      |
| Tests            | `npm run test`         | **all pass** — RC baseline **3,856 tests** (re-count, don't transcribe) | `backend-ci`, `windows-release`      |
| Build            | `npm run build`        | backend then desktop, **exit 0**                                        | `backend-ci`, `windows-release`      |
| Format           | `npm run format:check` | no Prettier drift                                                       | local / release gate                 |
| Prod deps        | `npm audit --omit=dev` | RC baseline **0 production vulns**; new ones triaged                    | Security Reviewer                    |
| Deploy manifests | `deploy-validation`    | `yamllint` + `helm lint`/`template` + strict `kubeconform` green        | `deploy-validation` (on `deploy/**`) |

> The **3,856** figure is the **RC baseline**, not a fixed constant. Per checklist §2 and
> `CONTRIBUTING.md`, re-run the suite and copy the **actual** count into the release notes.

### Go / No-Go checklist

Run at the go/no-go review; the RM records each line. A red line is a **blocker**, not a
footnote — the only way past one is an **explicitly disclosed** known-limitation (checklist
§8), never a silent omission.

- [ ] **Version** decided per SemVer; bumped in root + workspace `package.json` (checklist §1).
- [ ] **Changelog** updated — items moved out of _unreleased_, dated, honest _known
      limitations_ current (Keep a Changelog format; checklist §1).
- [ ] **Typecheck / lint / tests / build** all green; **real numbers recorded** (§2 ledger).
- [ ] **`format:check`** clean; **`npm audit --omit=dev`** reviewed (0-prod-vuln baseline held).
- [ ] **Tracked pre-GA security items not regressed and disclosed:** Apple `id_token` still
      **not JWKS-verified**; marketplace install still accepts **unsigned packages on an empty
      trust store** (checklist §3; `ENTERPRISE-GA-REPORT.md` HIGH risks).
- [ ] **Deploy hygiene:** `SEED_STORE_ON_BOOT=false` and `RUN_MIGRATIONS_ON_BOOT=false` in the
      target env; migrations run as a **gated Job**, not on boot (checklist §5; DR §4.2).
- [ ] **Backup confirmed current** before any migration (DR owner; checklist §5, DR §2.2).
- [ ] **Packaging:** Windows via `windows-release`; **macOS built manually** if in scope, with
      signing secrets consciously present-or-accepted-unsigned (checklist §4).
- [ ] **Rollback readiness understood by on-call:** app rollback is **advisory**; the real
      lever is **data-side restore** (§4; checklist §7). On-call can state the restore path.
- [ ] **Post-release plan:** `/health` + `/metrics` probe, smoke sign-in, log review (checklist §7).

**Decision rule.** All boxes checked → **GO**, tag and ship (§1 mechanics). Any unchecked box
→ **NO-GO** unless the RM records it as a disclosed limitation with an owner and a tracking
item. "Ready to ship" is the honest end of the checklist — never an assumed pass.

## 3. Hotfix workflow

A **hotfix** is a single, urgent `fix` to an already-released tag that cannot wait for the next
train — a security regression, a data-integrity bug, or a break in the core read/auth path. It
is deliberately **narrow**: one logical change, no new surface. Anything larger is a normal
patch train (§1), not a hotfix.

### Reduced-but-defined gates

A hotfix trades train breadth for speed, but the gate is **reduced, not skipped** — the fast
path is defined, not ad hoc. What is waived is waived **on the record**.

| Gate                                    | Hotfix status                                                                                                    | Rationale                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Typecheck / lint / build                | **Mandatory**                                                                                                    | Cheap, fast, non-negotiable correctness floor                                                                   |
| Tests                                   | **Mandatory** — full suite **or** the changed workspace (`npm run test -w @neuropause/backend`) with a rationale | `backend-ci` runs backend-scoped tests already; scope-narrowing is allowed **only** with recorded justification |
| `format:check`                          | Mandatory                                                                                                        | Trivial to satisfy                                                                                              |
| `npm audit --omit=dev`                  | Mandatory for a **security** hotfix; else deferred to next train                                                 | A security hotfix must not introduce a new prod advisory                                                        |
| Full checklist §4 packaging (both OSes) | **Scoped** to the affected platform                                                                              | Ship only the artifact that needs the fix                                                                       |
| `deploy-validation`                     | Only if `deploy/**` changed                                                                                      | Path-triggered; irrelevant to a code-only fix                                                                   |

### Hotfix runbook

1. **Declare.** RM + Security Reviewer (if security) agree it is a hotfix, not a train. Record
   the reason and the target tag.
2. **Branch from the tag.** `git switch -c hotfix/x.y.(z+1) vX.Y.Z` — branch off the **released
   tag**, not `main`, so the fix ships without unrelated in-flight work.
3. **Minimal change.** One `fix(scope): …` Conventional Commit; add a regression test that
   fails before and passes after (`CONTRIBUTING.md` — do not weaken a test to pass a gate).
4. **Run the reduced gate** (table above) locally; record the **actual** results.
5. **Version + changelog.** Bump `PATCH` (`x.y.z` → `x.y.z+1`); add a dated hotfix entry to
   [`CHANGELOG.md`](../../CHANGELOG.md) that **discloses the fix and any accepted limitation**.
6. **Tag `vX.Y.(Z+1)`.** The tag push triggers `windows-release` (build + GitHub Release;
   `-rc`/`-beta` still auto-marked prerelease). **macOS: package manually** —
   [`LAUNCH-02-MAC-PACKAGING.md`](../launch/LAUNCH-02-MAC-PACKAGING.md) — there is no mac
   automation to lean on under time pressure; budget that step.
7. **Backend.** Build/push the backend image; if the fix touched `deploy/**`, confirm
   `deploy-validation` is green.
8. **Deploy.** Roll out via the zero-downtime path (§5); if the hotfix includes a migration,
   run it as a **gated Job first** (DR §4.2) and confirm a backup exists (§2 checklist).
9. **Verify** (checklist §7): `/health` + `/metrics` up, smoke sign-in, watch logs for the
   first traffic window; confirm the fixed behaviour.
10. **Backport.** Cherry-pick the fix to `main` (and any active `release/x.y`) **same day**, so
    the next train does not silently regress the hotfix.

## 4. Rollback workflow

**Honest framing.** NeuroPause has **no automatic application-binary rollback**. The desktop
updater sets `allowDowngrade = false` and its rollback surface is **advisory** — it computes
the version it _would_ revert to (`pickRollbackTarget`, _"no side effect"_) but installs
nothing (DR §5.1, §7.2; `_grounding.md` risk register). The **real, proven** recovery lever is
**data-side**: the `pg_dump`/`pg_restore` scripts (backend) and the `BackupManager` restore
(desktop), both exercised in the reliability suite (DR §2–§3, Runbook 5). Roll **data** back,
not the binary.

One asymmetry matters for the backend: the API container is **stateless for reads**, so
redeploying a prior image tag is a genuine rollback **only when the release carried no
migration**. Migrations are **forward-only** (no down-migrations; DR §4.2), so once a schema
change has applied, the honest path back is **restore the pre-deploy dump**, not "un-migrate".

### Which lever for which symptom

| Situation                                                 | Real recovery lever                                                                                                    | Cite               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Bad **backend** release, **no migration** in it           | Redeploy previous image tag: `kubectl -n neuropause rollout undo deploy/neuropause-backend` (or re-tag prior image)    | K8s rollout; DR §8 |
| Bad **backend** release **with** a forward-only migration | **Restore the pre-deploy dump** (`restore-db.sh`), then deploy the prior image; do **not** expect schema un-apply      | DR §3.2, §4.2      |
| Bad **desktop** update (app unstable / wrong data)        | **Advisory** target only → operator **reinstalls prior version out-of-band**; recover data via Recovery Center restore | DR §5.1, §3.1      |
| Bad desktop **data migration**                            | Already **auto-restored** — engine reverts to the pre-migration backup on failure                                      | DR §4.1            |
| Corruption / wrong state, no clean prior version          | Restore the most recent good backup (data-side)                                                                        | DR §3, Runbook 5   |

### Rollback runbook (step-by-step)

1. **Stop the bleed.** Declare severity (SRE on-call model); if actively harmful, take the bad
   version out of the serving path (scale down / drain) before deciding the lever.
2. **Locate the pre-deploy backup.** Confirm the dump taken before this release exists
   (`backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz`; checklist §5, DR §2.2). **No backup → no
   safe data-side rollback** — this is why the backup box is a go/no-go blocker (§2).
3. **Pick the lever** from the table above.
4. **Backend, no migration:** `kubectl -n neuropause rollout undo deploy/neuropause-backend`;
   the rollout is zero-downtime (`maxUnavailable: 0`, §5). Verify `/health` 200.
5. **Backend, migration involved:** run `scripts/restore-db.sh backups/<pre-deploy>.sql.gz`
   (destructive — `--clean --if-exists`; prompts for `yes`; `ON_ERROR_STOP=1`), **then** deploy
   the prior image, **then restart the backend** so pooled connections re-establish (DR §3.2).
   Restore is **whole-dump** — there is **no PITR** in-repo (DR §3.2 caveat, §6).
6. **Desktop:** take the advisory rollback target as the version number to fetch, and
   **reinstall that version out-of-band** (Windows: the prior GitHub Release / self-hosted
   installer from `windows-release`; **macOS: the manually-built prior artifact**). For wrong
   data, use **Recovery Center → Restore Backup**, which validates integrity and takes a
   **safety snapshot** first (DR §3.1).
7. **Verify.** `/health` + `/metrics` healthy, smoke sign-in, logs clean (checklist §7); for
   desktop, confirm stores reload after the required restart.
8. **Record.** Note the rollback, the lever used, and root cause; feed the follow-up fix into a
   hotfix (§3) or the next train. Never re-ship the bad tag.

> **Do not treat the Federation DR screen as a rollback plan** — it is **modeled**, not infra
> (DR §7.1). Your real levers are the `pg_dump`/`psql` scripts, `BackupManager`, the migration
> engines, and out-of-band reinstall.

## 5. Maintenance windows

A maintenance window is a **planned, announced** interval for an operation that a normal
rolling deploy cannot absorb transparently. The point of planning one is to know **whether you
even need it** — most NeuroPause operations are **zero-downtime by proven behaviour**.

### Does this need a window?

| Operation                                 | Window needed?                         | Basis (proven)                                                                                                                  |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Backend code-only rollout                 | **No**                                 | Rolling update `maxUnavailable: 0`, `maxSurge: 1` — old pods serve until new pass readiness (`backend.yaml:107–162`; Runbook 3) |
| Planned backend restart                   | **No**                                 | SIGTERM → healthy in **0.46 s** (reliability scenario, PASS; `_grounding.md`)                                                   |
| Postgres blip / failover                  | **No** (self-heals)                    | Process survives DB loss; pool **auto-reconnects, no restart** (DR; Runbook 2)                                                  |
| Redis outage                              | **No** (degrades honestly)             | Fail-open preserves reads; `/health` reports `degraded` (Runbook 1)                                                             |
| Forward-only **schema migration**         | **Usually yes** (or gated-Job pre-cut) | Run as a gated Job **before** pods serve so a failure blocks rollout (DR §4.2)                                                  |
| Destructive **data restore** / DB replace | **Yes**                                | `restore-db.sh` overwrites the DB (`--clean`); requires backend restart (DR §3.2)                                               |
| Managed-Postgres / infra upgrade          | **Yes**                                | External to the app; provider-dependent                                                                                         |

> **Zero-downtime is the default, not the exception.** Reserve a window for **migrations that
> aren't backward-compatible, destructive data operations, and infra upgrades** — a plain code
> rollout or restart does **not** spend a window (the recovery budget is sub-second).

### Window planning

1. **Classify** the change against the table; if every line is _No_, ship it as a normal deploy
   and skip the window.
2. **Schedule** at low-traffic hours; announce lead time proportional to blast radius (routine
   patch ≥24 h; migrating/major ≥72 h).
3. **Pre-stage:** confirm a **current backup** (DR §2.2), rehearse the change, and write the
   **rollback lever** (§4) _before_ the window opens — decide the abort path in advance.
4. **Define done:** the explicit post-checks (`/health` 200, smoke sign-in, error-free logs)
   that close the window.

### Comms template

```
SUBJECT: [NeuroPause] Scheduled maintenance — <YYYY-MM-DD HH:MM–HH:MM TZ>

What:     <e.g. backend schema migration 0013 + image vX.Y.Z>
When:     <start>–<end> <TZ>  (planned duration <N> min)
Impact:   <"No expected downtime — zero-downtime rolling update">  OR
          <"Brief read-path interruption during DB restore, ~<N> min">
Scope:    <backend / desktop channel / both>
Rollback: <the §4 lever, e.g. "restore pre-deploy dump + prior image">
Contact:  <on-call role / incident channel>

We announce maintenance in advance and post a completion note. No data loss is
expected; a current backup is confirmed before any migrating or destructive step.
```

### Window runbook

1. **T-minus:** post the notice; confirm backup exists and is **restorable** (a backup never
   restored is a hypothesis — DR §8.5); stage artifacts; confirm the abort lever.
2. **Open:** apply the change on the zero-downtime path (§ table). Migrations → **gated Job
   first** (DR §4.2). Destructive restore → follow §4 step 5.
3. **Verify:** run the _define-done_ checks (checklist §7). If any fail, **execute the
   pre-decided rollback (§4)** — do not improvise inside the window.
4. **Close:** post completion (or rollback) note; record duration and any deviation for the
   next window's plan.

## Provenance & scope

- **Real and in use:** SemVer, Conventional Commits, Keep-a-Changelog, the quality gates
  (typecheck/lint/tests/build/format, `npm audit`), and CI (`backend-ci`, `deploy-validation`,
  `windows-release`) — `CONTRIBUTING.md`, `RELEASE-CHECKLIST.md`, `CHANGELOG.md`, `.github/workflows/*`.
- **Proven (measured):** 0.46 s restart recovery, zero-downtime rolling update
  (`maxUnavailable: 0`), PG degrade-and-recover, Redis fail-open, and the `pg_dump`/`pg_restore`
  - `BackupManager` restore paths — `_grounding.md`, `DISASTER-RECOVERY-GUIDE.md`, Runbooks 1–5.
- **Proposed (not history):** the release calendar and every cadence in §1 — **only
  `1.0.0-rc.1` has shipped**; no attained frequency or version history beyond it is claimed.
- **Advisory / data-side (honest):** application-binary rollback is **advisory** (`allowDowngrade
= false`); the **real** recovery is **data-side restore**, and there is **no PITR** in-repo.
- **Absent (carried, not hidden):** macOS release automation, per-PR desktop CI, native
  alerting/tracing/capacity forecasting; Federation DR is **modeled**, not failover
  (`ENTERPRISE-GA-REPORT.md`, `DISASTER-RECOVERY-GUIDE.md §7`). This manual **extends** the
  release checklist and DR guide into an operating model; it does not restate their mechanics.
