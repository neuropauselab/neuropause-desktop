# NeuroPause Engineering Standards — Enforceable Manual

> The checkable form of [`../frameworks/STANDARDS.md`](../frameworks/STANDARDS.md).
> Each standard is restated as a rule with a box and the exact **way it is
> verified** — a gate, a tool, a runtime probe, or review. Rule IDs match the
> framework (`STD-NAM-3`, `STD-SEC-6`, …) one-to-one.
>
> **Read the conformance disclaimer (§0) first.** NeuroPause holds **no**
> external certification and claims **none**. This manual enforces *internal*
> standards and the *correct use* of adopted external specifications — never
> conformance to them.

---

## 0. Conformance disclaimer (read first)

- This is an **internal** engineering standards manual. It is **not** an audit
  against, or a certificate of conformance to, any external standard.
- NeuroPause **adopts** external specifications (SemVer, RFC 8252 / PKCE,
  Prometheus exposition, Conventional Commits, Keep a Changelog, Ed25519 /
  Argon2id / SHA-256, the Kubernetes schema). "Adopts" = *uses*. It does **not**
  mean certified, accredited, or conformant.
- NeuroPause **holds no** ISO / IEC / NIST or other international-standard
  certification, and has **authored no** external standard.
- Where a rule is a **Proposed (L0)** standard of this program, it is labelled so;
  it binds NSSP documents, not the outside world.
- The full posture rule is **STD-CONF-1** (§12).

## How to use this manual

Verification methods (the "Verified by" column):

| Method | Meaning | Example |
|---|---|---|
| **Gate** | Automated command that must pass with a fixed threshold | `npm run typecheck` = 0 |
| **Tool** | External validator run against an artifact | `kubernetes-validate`, `shellcheck` |
| **Probe** | Check against a live endpoint/process | `GET /health`, `GET /metrics` |
| **Test** | A specific executed test guards the rule | `runtimeAuthz.test.ts` |
| **Review** | Human inspection at code/doc review (used for L0 honesty and lens rules) | changelog/evidence review |

A box may be checked only when its verification method has actually been run for
the change under review — never by assertion.

---

## 1. Naming conventions

| ✓ | Rule | Verified by | ID |
|---|---|---|---|
| ☐ | File casing is consistent (camelCase modules, PascalCase components/types) | Gate — `tsc` (`forceConsistentCasingInFileNames`) + `lint` | STD-NAM-1 |
| ☐ | Exported types are PascalCase, grouped in `packages/shared/src` domain files | Gate — `typecheck`; Review | STD-NAM-2 |
| ☐ | New RBAC scopes follow `domain:action` | Review against `channels.ts` / `runtimeAuthz.ts` | STD-NAM-3 |
| ☐ | New IPC channels follow `domain:verb` | Review against `channels.ts` | STD-NAM-4 |
| ☐ | New backend metrics are `neuropause_*` snake_case with a unit suffix | Review of `observability/metrics.ts`; Probe `/metrics` | STD-NAM-5 |
| ☐ | Bench outputs are written to `bench/results/<domain>.json` | Review; harness output path | STD-NAM-6 |

## 2. Architecture

| ✓ | Rule | Verified by | ID |
|---|---|---|---|
| ☐ | Cross-boundary types live only in `@neuropause/shared`; no app-to-app cycles | Gate — `build` + `typecheck` | STD-ARCH-1 |
| ☐ | Every inbound IPC payload is Zod-validated in main before use | Test — contract/IPC suites | STD-ARCH-2 |
| ☐ | New surfaces are reuse-only lenses (compose IPC, mutate nothing, deep-link) | Review (reuse discipline) | STD-ARCH-3 |
| ☐ | No privileged runtime channel is unclassified (fail-closed) | Test — `runtimeAuthz.test.ts` startup invariant | STD-ARCH-4 |
| ☐ | `/live` (liveness) and `/health` (readiness) remain distinct | Probe — both endpoints | STD-ARCH-5 |

## 3. Measurement

| ✓ | Rule | Verified by | ID |
|---|---|---|---|
| ☐ | Durations reported as `{count, avg, p50, p95, max}` (+p90/p99 for load) | Review of `DurationSummary` / bench output | STD-MEAS-1 |
| ☐ | Units explicit and SI-consistent (ms/s, bytes, req/s, ratio, count) | Review of results JSON | STD-MEAS-2 |
| ☐ | Reported numbers are re-measured, never transcribed from a prior release | Gate — rerun harness; `RELEASE-CHECKLIST` §2 | STD-MEAS-3 |
| ☐ | Every measured claim cites a reproducible harness + raw artifact | Review; `bench/*` → `bench/results/*.json` | STD-MEAS-4 |
| ☐ | Metrics carry no PII/paths/secrets (aggregate only) | Review of `metrics.ts`; Probe `/metrics` | STD-MEAS-5 |

## 4. Validation

| ✓ | Rule | Verified by | ID |
|---|---|---|---|
| ☐ | `typecheck` passes with 0 errors | Gate — `npm run typecheck` | STD-VAL-1 |
| ☐ | `test` suites pass (desktop + backend) | Gate — `npm run test` | STD-VAL-2 |
| ☐ | Deployment assets validate | Tool — `kubernetes-validate` strict, `shellcheck` | STD-VAL-3 |
| ☐ | Each claim published at its cited evidence level, no higher | Review (L0–L4 grading) | STD-VAL-4 |
| ☐ | Absent gates (per-PR desktop CI, coverage, E2E/a11y) are disclosed, not implied | Review | STD-VAL-5 |

## 5. Documentation

| ✓ | Rule | Verified by | ID |
|---|---|---|---|
| ☐ | Every concept/row carries an evidence level (citation for L2+) | Review | STD-DOC-1 |
| ☐ | "Platform does X" (cited) vs "framework proposes X" (L0) kept distinct | Review | STD-DOC-2 |
| ☐ | No fabricated proofs, papers, peer review, certifications, or numbers | Review | STD-DOC-3 |
| ☐ | Changelog follows Keep a Changelog with a current known-limitations section | Review of `CHANGELOG.md` | STD-DOC-4 |
| ☐ | Open gaps stated inline where a reader might assume coverage | Review | STD-DOC-5 |

## 6. Operational

| ✓ | Rule | Verified by | ID |
|---|---|---|---|
| ☐ | `/health` returns `ok`/`degraded` with per-component status + 200/503 | Probe — `GET /health` | STD-OPS-1 |
| ☐ | Metrics served in Prometheus text format v0.0.4 at `/metrics` | Probe — `GET /metrics` | STD-OPS-2 |
| ☐ | Security-relevant actions written to append-only `audit_log` | Review of `0001_init.sql:50`; DB inspection | STD-OPS-3 |
| ☐ | `/metrics` network-restricted in production | Review of deploy config (loopback/NetworkPolicy) | STD-OPS-4 |

## 7. Security

| ✓ | Rule | Verified by | ID |
|---|---|---|---|
| ☐ | Passwords hashed with Argon2id (m=19456, t=2, p=1) | Test — auth/password suite; `passwords.ts:4` | STD-SEC-1 |
| ☐ | Manifests signed/verified with Ed25519 | Test — signature suites | STD-SEC-2 |
| ☐ | Refresh tokens rotated with reuse detection; stored as SHA-256 | Test — auth token suite | STD-SEC-3 |
| ☐ | Native OAuth uses PKCE / RFC 8252, backend-brokered | Test — auth flow suite | STD-SEC-4 |
| ☐ | Authorization fail-closed; **0** production-dependency vulnerabilities | Gate — `npm audit --omit=dev`; `runtimeAuthz.test.ts` | STD-SEC-5 |
| ☐ | Known weaknesses tracked + disclosed (Apple JWKS, unsigned marketplace install, deliberate rate-limiter fail-open) | Review — `RELEASE-CHECKLIST` §3; source `HARDENING TODO` | STD-SEC-6 |

## 8. Release

| ✓ | Rule | Verified by | ID |
|---|---|---|---|
| ☐ | Version follows SemVer (pre-GA `-rc.N`) and is bumped in root + workspaces | Review — `RELEASE-CHECKLIST` §1 | STD-REL-1 |
| ☐ | Commits follow Conventional Commits | Review of history | STD-REL-2 |
| ☐ | The full `RELEASE-CHECKLIST` is completed with honest boxes | Review — `docs/guides/RELEASE-CHECKLIST.md` | STD-REL-3 |
| ☐ | Prod config gates set: `SEED_STORE_ON_BOOT=false`, `RUN_MIGRATIONS_ON_BOOT=false` | Review of env / deploy manifests | STD-REL-4 |
| ☐ | Release notes attach real gate output + known-limitations list | Review of release notes | STD-REL-5 |

## 9. Quality

| ✓ | Rule | Verified by | ID |
|---|---|---|---|
| ☐ | TypeScript `strict` (+ unused/override/switch checks) passes | Gate — `npm run typecheck` = 0 | STD-QUAL-1 |
| ☐ | Lint passes under zero-warning policy | Gate — `npm run lint` (`--max-warnings 0`) | STD-QUAL-2 |
| ☐ | Formatting clean | Gate — `npm run format:check` | STD-QUAL-3 |
| ☐ | Production build exits 0 (backend then desktop) | Gate — `npm run build` | STD-QUAL-4 |

## 10. Evidence

| ✓ | Rule | Verified by | ID |
|---|---|---|---|
| ☐ | Every claim graded L0–L4 | Review | STD-EVID-1 |
| ☐ | L2+ cites a source/artifact; L4 cites executed tests/gates/reliability runs | Review | STD-EVID-2 |
| ☐ | Absent evidence recorded as "none — not claimed" | Review | STD-EVID-3 |

## 11. Gate reference (thresholds)

The automated bar, in one place. Every "Gate" row above resolves to one of these.

| Gate | Command | Threshold |
|---|---|---|
| Type check | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | 0 warnings (`--max-warnings 0`) |
| Format | `npm run format:check` | no drift |
| Tests | `npm run test` | all pass (3,856 baseline) |
| Build | `npm run build` | exit 0 |
| Prod audit | `npm audit --omit=dev` | 0 production vulnerabilities |
| Deploy | `kubernetes-validate` (strict), `shellcheck` | PASS / clean |

## 12. Conformance disclaimer (full statement) — STD-CONF-1

**STD-CONF-1 (internal convention).** No NeuroPause document may state or imply
that the platform is *certified against*, *accredited to*, or *conformant with*
any external standard or standards body (ISO, IEC, NIST, or any other). The
platform **adopts** external specifications and enforces **internal conventions**;
it holds **no** international-standard certification and authored **no** external
standard.

- *Adoption claim (permitted):* "manifests are validated with `kubernetes-validate`"
  — true, evidence level L4.
- *Conformance claim (prohibited):* "NeuroPause is Kubernetes-certified" — never
  made.
- Any compliance mapping in a vertical pack is a **self-assessment mapping only**
  — no certifications, no accreditations, no named customers.

*Verified by:* Review at every release and every NSSP document sign-off, against
Standards Matrix §5 (conformance **not claimed**) and `_grounding.md` §Standards.
This is the manual's controlling rule: if any other box's wording would breach
STD-CONF-1, STD-CONF-1 wins and the wording is corrected.
