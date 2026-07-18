# Release Checklist

The gate every NeuroPause release passes before it ships. It is deliberately
concrete: each item is either a command with an expected result, or a decision
with an owner. Nothing here is aspirational — where a control is not yet
automated, it says so and names the manual step.

The authoritative readiness classification for the current release is the
[Enterprise GA Assessment](../../ENTERPRISE-GA-REPORT.md).

---

## 1. Versioning

- [ ] Decide the version per [SemVer](https://semver.org/). Pre-GA releases use a
      `-rc.N` suffix (current line: `1.0.0-rc.1`).
- [ ] Bump the version in the root and workspace `package.json` files.
- [ ] Update [`CHANGELOG.md`](../../CHANGELOG.md): move items out of "unreleased",
      date the release, keep the honest "known limitations" section current.
- [ ] Confirm the root [`README.md`](../../README.md) status blockquote matches the
      version and classification.

## 2. Quality gates (must be green)

Run from the repository root. All four must pass with zero errors before a
release is cut.

- [ ] `npm run typecheck` — TypeScript across every workspace, **0 errors**.
- [ ] `npm run lint` — ESLint monorepo-wide under the zero-warning policy
      (`--max-warnings 0`).
- [ ] `npm run test` — the Vitest suites (desktop + backend) all pass.
- [ ] `npm run build` — production build of backend then desktop, **exit 0**.
- [ ] `npm run format:check` — Prettier reports no drift.

Record the real numbers (test count, build time, bundle sizes) in the release
notes. Do **not** transcribe numbers from a previous release — re-run and copy
the actual output.

## 3. Dependency & security review

- [ ] `npm audit --omit=dev` — review **production** advisories. The RC baseline
      is **0 production vulnerabilities**; any new one is triaged before release.
- [ ] `npm audit` (including dev) — note the dev-only advisories; they do not
      block a release but are tracked.
- [ ] Review the [Security Guide](SECURITY-GUIDE.md) hardening backlog. The
      following are tracked pre-GA security items — confirm their status has not
      regressed and is disclosed in the release notes:
  - [ ] Apple `id_token` signature is **not yet verified against JWKS**
        (`apps/backend/src/auth/providers/apple.ts`) — top pre-GA blocker.
  - [ ] Marketplace app install accepts **unsigned packages when the trust store
        is empty** (worker-package install is fail-closed).

## 4. Packaging & signing

- [ ] Backend: container image builds from the production Dockerfile.
- [ ] Desktop (macOS): code-signing and notarization are **configured but
      env-gated** — unsigned builds ship if the signing secrets are absent.
      Confirm secrets are present for a public release, or consciously accept an
      unsigned build.
- [ ] macOS **release automation is not yet in CI** — the mac packaging steps are
      run manually per [`docs/launch/LAUNCH-02-MAC-PACKAGING.md`](../launch/LAUNCH-02-MAC-PACKAGING.md).
      Windows release automation exists ([`docs/windows/WINDOWS-RELEASE.md`](../windows/WINDOWS-RELEASE.md)).

## 5. Migrations & data

- [ ] Review any new forward-only SQL migrations; confirm they are additive and
      reversible by a documented data-side path.
- [ ] Production deploys set **`SEED_STORE_ON_BOOT=false`** so the catalog starts
      empty — no fabricated apps, ratings, or download counts. Verify this is set
      in the target environment (`docker-compose.prod.yml`,
      `deploy/kubernetes/backend.yaml`, and the Helm `values.yaml` already default
      it off).
- [ ] Production deploys set **`RUN_MIGRATIONS_ON_BOOT=false`** and run migrations
      as a deliberate deploy step.
- [ ] Confirm a current backup exists per the
      [Disaster Recovery Guide](DISASTER-RECOVERY-GUIDE.md) before applying
      migrations.

## 6. Release

- [ ] Tag the release commit.
- [ ] Publish the backend image / desktop artifacts.
- [ ] Attach the real gate output (section 2) and the honest known-limitations
      list to the release notes.
- [ ] Follow the go-live runbook: [`docs/launch/LAUNCH-04-GO-LIVE-RUNBOOK.md`](../launch/LAUNCH-04-GO-LIVE-RUNBOOK.md).

## 7. Post-release verification

- [ ] Backend `/health` and `/metrics` respond on the deployed environment.
- [ ] A smoke sign-in (email/password) succeeds end to end.
- [ ] Review backend logs for errors during the first period of traffic.
- [ ] **Rollback readiness:** update rollback is **advisory** — the real recovery
      path is data-side restore per the
      [Disaster Recovery Guide](DISASTER-RECOVERY-GUIDE.md). Confirm the restore
      path is understood by whoever is on call before declaring the release done.

## 8. Operational readiness (known gaps)

These are **not implemented** and are disclosed so no one assumes coverage that
does not exist. Track them; do not silently rely on them:

- Alert routing, distributed tracing, and capacity forecasting are absent — see
  the [Operations Guide](OPERATIONS-GUIDE.md).
- Federation disaster recovery is **modeled**, not live.
- Renderer component/E2E and accessibility test suites are absent; coverage
  instrumentation is not wired.

---

Reaching the end of this list with every box honestly checked is what "ready to
ship" means for NeuroPause. A box that cannot be checked is either a release
blocker or an explicitly disclosed limitation — never an omission.
