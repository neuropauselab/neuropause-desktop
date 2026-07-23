# NSSP Framework — Assurance Science

> **Program:** NeuroPause Scientific & Standards Program (NSSP).
> **Nature:** *Formalization over the existing platform* — this framework names,
> structures, and evidence-grades the assurance properties the shipping code
> already provides. It engineers nothing new. Every control below is traced to a
> real file or executed artifact; every gap is stated at its real severity.
> **Companion:** [`../manuals/ASSURANCE-MANUAL.md`](../manuals/ASSURANCE-MANUAL.md).
> **Anchors:** [`../_grounding.md`](../_grounding.md) ·
> [`../SCIENTIFIC-MATRICES.md`](../SCIENTIFIC-MATRICES.md) ·
> [`../../guides/SECURITY-GUIDE.md`](../../guides/SECURITY-GUIDE.md) ·
> [`../../../ENTERPRISE-GA-REPORT.md`](../../../ENTERPRISE-GA-REPORT.md) ·
> [`../../validation/RELIABILITY-RESULTS.md`](../../validation/RELIABILITY-RESULTS.md).

**Assurance**, in the NSSP, is the *grounded justification for believing a
property holds* — never a proof, and only as strong as the evidence behind it and
the risk it covers. This framework maps the platform's real controls to the
properties they defend, grades each with an evidence level (L0–L4), and records
the **residual risk** each leaves — including the three open security items,
treated as disclosed risks, not hidden defects.

---

## 1. Assurance vocabulary

The framework uses five terms consistently. They are the columns of nearly every
table that follows.

| Term | Definition |
|---|---|
| **Assurance property** | A statement we want to be true of the running system (e.g. "a privileged IPC channel cannot ship unguarded"). |
| **Control** | The real mechanism that makes the property hold (code, gate, test, or run). |
| **Evidence level** | The L0–L4 ladder grade of the *evidence* for the control, per `_grounding.md`. |
| **Assurance confidence** | How strongly the evidence lets us claim the property (the confidence model, §3) — derived from, but not identical to, evidence level. |
| **Residual risk** | What the control does **not** cover: the honest remainder, up to and including a named open item. |

The cardinal rule (inherited from `_grounding.md`): **a framework may *propose*
freely at L0, but may only *claim* what a cited L2+ artifact supports.** Assurance
confidence never exceeds the evidence level of its control.

---

## 2. Risk models

Assurance begins from risk. This section formalizes the documented threat model
(Security Guide) as an assurance surface — surface, defending control, residual.

### 2.1 Threat surfaces and defending controls

| Threat surface | Adversary / entry point | Defending control | Evidence | Residual |
|---|---|---|---|---|
| Untrusted renderer | Injected web content, compromised UI | Context isolation, sandbox, `nodeIntegration:false`, strict CSP, navigation lockdown (`apps/desktop/src/main/window.ts:31-64`, `security/csp.ts:12-49`) | **L2** | Renderer E2E/a11y tests absent (TD-7) |
| Malicious IPC caller | Foreign frame invoking privileged channels | Sender-trust + fail-closed authz pipeline (`ipc/secureBridge.ts:93-150`, `ipc/router.ts:88-98`) | **L2** | IPC audit not hash-chained (Open #5) |
| Privilege escalation | Lower-privileged enterprise user | RBAC scope gate, active-member-only permissions (`enterprise/authz.ts:36-86`) | **L2** | Meaningful only for multi-user tenants |
| Network / SSRF | Attacker-supplied webhook URL | SSRF egress classifier, re-checked at dispatch (`webhooks/urlGuard.ts:57-89`) | **L2 (tested)** | DNS-rebinding across the check window |
| Forged inbound webhook | Spoofed provider delivery | Per-provider HMAC-SHA256, timing-safe, unsigned rejected (`connectors/inbound/verify.ts:29-111`) | **L2** | — |
| Supply-chain tampering (workers) | Malicious worker package | Ed25519 + SHA-256, fail-closed (`workforce/install/packaging.ts:56-62`) | **L2** | — |
| Supply-chain tampering (catalog apps) | Unsigned marketplace app | Integrity hash enforced; signature enforced *only when present* (`nps/packageService.ts:179-184`) | **L2** | **Open item #2 (HIGH)** |
| Federated identity forgery | Crafted Apple `id_token` | Backend-brokered flow; other IdPs use authenticated userinfo | **L2 (partial)** | **Open item #1 (HIGH)** |
| Auth abuse / brute force | Credential stuffing on login/reset | Redis-backed rate limiter (`middleware/rateLimit.ts`) | **L2** | **Open item #3 (MED, fails open)** |
| Secret disclosure at rest | Disk/theft of token store | `safeStorage` (OS keychain); refuses plaintext fallback (`security/secureStore.ts:37-68`) | **L2** | Keychain-availability dependent |

### 2.2 The three open items — stated at real severity

These are **L-real risks**: verified in source, disclosed in the Security Guide
backlog and the GA report's Technical-Debt / Production-Risk matrices, and never
presented anywhere as protections the platform provides. Severities are the GA
report's, unaltered.

| # | Open item | Location | Severity | Honest impact | In-place partial mitigation | Fix (GA §8) |
|---|---|---|---|---|---|---|
| 1 | Apple `id_token` decoded, **not** JWKS-verified | `apps/backend/src/auth/providers/apple.ts:77` (TODO `:14-16`) | **HIGH** (TD-1/PR-1) | A forged/altered Apple token on this path would be trusted | Apple-only; Google/Microsoft/GitHub resolve identity from the *authenticated* userinfo/Graph/API | Verify vs `appleid.apple.com/auth/keys` (ES256, iss, aud) before trusting claims |
| 2 | Unsigned catalog-app install when trust store empty | `apps/desktop/src/main/nps/packageService.ts:184` | **HIGH** (TD-2/PR-2) | An unsigned artifact (`!artifact.signature`) skips signature verification and installs | SHA-256 **integrity** still enforced (`:179-182`); worker-package path is fail-closed (`workforce/install/packaging.ts:60`) | Require a verified signature / non-empty publisher trust store, matching the worker path |
| 3 | Rate limiter **fails open** on Redis outage | `apps/backend/src/middleware/rateLimit.ts:32-39` (comment `:37`) | **MED** (TD-3/PR-3) | Brute-force protection on login/register/reset is off during a Redis outage | Deliberate availability trade-off; auth still required; `/health` reports `redis:"down"` | Local fallback limiter + alert on the degraded signal; consider fail-closed for reset |

Three lower-severity backlog items — FNV-1a memory hash (`memorySync.ts:84`),
non-hash-chained audit, no log rotation — sit in the residual register (§11).

---

## 3. Confidence models

Assurance confidence answers: *given the evidence, how strongly may we claim the
property?* The NSSP maps the ladder onto a five-band scale, conservatively —
confidence tracks the **weakest** evidence in the chain, and residual risk is
scored **separately**, so a good control with a known gap is not laundered into
false comfort.

### 3.1 Evidence level → assurance confidence

| Evidence | Ladder meaning | Assurance confidence | What we may claim |
|---|---|---|---|
| **L4** | Validated (executed tests/gates/reliability runs) | **Demonstrated** | "Observed to hold under executed conditions" |
| **L3** | Measured (recorded telemetry/benchmarks) | **Measured** | "Holds at the recorded operating point" |
| **L2** | Implemented (exists and runs in code) | **Implemented** | "The mechanism is present and runs; not independently validated as a scientific claim" |
| **L1** | Modeled (typed surface, not live) | **Modeled** | "A designed surface exists; behaviour is not exercised end-to-end" |
| **L0** | Proposed (framework model only) | **Asserted** | "A concept named by this framework; no operational claim" |

### 3.2 Two axes, kept separate

Confidence in *"the control behaves as written"* is distinct from *"the control
covers the whole risk."* The `audit_log` illustrates the discipline: **Implemented**
confidence (L2 — table, indexes, and write path real at `0001_init.sql` and
`middleware/audit.ts:9-26`) coexists with a real **residual** (not hash-chained, so
a writer with store access could alter records). This framework always reports both.

### 3.3 Worked examples

- **"A privileged IPC channel cannot ship unguarded."** Composition-time throw
  (`runtimeAuthz.ts:177-190`) plus boot invariant `assertAllChannelsClassified`
  (`:347-355`; `runtimeCore.ts:1647-1659`), both test-covered → **Demonstrated
  (L4)** for the invariant, **Implemented (L2)** for the wiring; no residual.
- **"Restart returns the backend to healthy quickly."** SIGTERM → restart →
  `/health` healthy in **0.46 s** (`reliability.json`) → **Demonstrated (L4)**;
  residual: single-node/single-run, sustained fault storms not executed.
- **"Marketplace apps are authentic."** Ed25519 verification is correct, but the
  catalog path admits unsigned artifacts (Open #2) → **Implemented (L2)** for the
  crypto, **residual = HIGH** for authenticity until signatures are required.

---

## 4. Integrity assurance

Integrity is the property that data and artifacts are what they claim to be and
have not silently changed. Three mechanisms carry it.

**Cryptographic signing (Ed25519).** Manifests are signed over a canonical SHA-256
digest; verification pins `algorithm === 'ed25519'`, recomputes/matches the digest
(defeating digest-swap), then verifies the signature (`marketplace/pipeline.ts:89-105`;
primitive `nps/signature.ts:38-52`). Worker packages require **both** a matching
checksum **and** a trusted-key signature or install is refused (`packaging.ts:56-62`).

**Token/secret hashing (SHA-256).** Refresh tokens (`auth/session.ts:28`; `hashToken`
`auth/pkce.ts:27-29`), developer API keys, and OAuth client secrets
(`developerStore.ts`) are persisted **hash-only**, the clear value returned once —
correct without a slow KDF because these are high-entropy random tokens, not
passwords (which use Argon2id, §6).

**Forward-only migrations.** Schema evolves through idempotent forward-only
migrations: **12** in `schema_migrations`, re-run applied **0**
(`RELIABILITY-RESULTS.md §1`, `reliability.json`) — every deploy re-invokes safely.

| Assurance property | Control | Evidence | Residual risk |
|---|---|---|---|
| Artifact authenticity (workers) | Ed25519 + SHA-256, fail-closed | **L2** `packaging.ts:56-62` | — |
| Artifact authenticity (catalog apps) | Ed25519 when signature present | **L2** `packageService.ts:184` | **Open #2 (HIGH)** — unsigned admitted |
| Manifest tamper-evidence | Digest recompute + signature | **L2** `pipeline.ts:96-105` | Trust store empty until pipeline wired (`signature.ts:22`) |
| Refresh-token confidentiality at rest | SHA-256 hash-only + rotation | **L2** `session.ts:28,50-102` | — |
| Migration integrity | Forward-only, idempotent | **L4** `reliability.json` (12→0) | Update *rollback* advisory, not automated (TD-5) |
| AI-memory chain integrity | FNV-1a content/chain fingerprint | **L2** `memorySync.ts:84-125` | Detects corruption, **not** tampering (Open #4) |

---

## 5. Trust assurance

Trust is *who* the platform is willing to believe. It rests on an Ed25519
publisher **trust store** — a key-id → public-key map returning `no_signature`
for an absent signature and `no_trusted_key` for an unregistered key
(`nps/signature.ts:22,38-52`). Federated sign-in trust is resolved from
**authenticated resource servers** for Google, Microsoft, and GitHub
(userinfo/Graph/API with a bearer token), which is why `id_token` forgery does
not affect them.

The gap is disclosed plainly: **the trust store ships empty** until a signing
pipeline registers keys (`signature.ts:6-11`). While empty, the worker path still
**fails closed** but the catalog-app path **does not** — it installs unsigned
artifacts (Open #2). Trust assurance is therefore **asymmetric by path**, and this
framework says so rather than averaging two paths into one misleading claim.

| Assurance property | Control | Evidence | Residual risk |
|---|---|---|---|
| Publisher authenticity (workers) | Trusted-key requirement, fail-closed | **L2** `packaging.ts:60` | Depends on populated trust store |
| Publisher authenticity (catalog apps) | Signature enforced only when present | **L2** `packageService.ts:184` | **Open #2 (HIGH)** |
| Federated identity (Google/MS/GitHub) | Authenticated userinfo/Graph/API | **L2** `auth/providers/*` | — |
| Federated identity (Apple) | Backend-brokered; token decoded not verified | **L2 (partial)** `apple.ts:77` | **Open #1 (HIGH)** |
| Inbound provider trust | HMAC-SHA256, unsigned rejected, fail-closed | **L2** `inbound/verify.ts:29-111` | — |

---

## 6. Security assurance

Security assurance is the aggregate of the verified controls — a posture that is
**strong with two HIGH items open** (GA report §7). Each control is cited below.

| Assurance property | Control | Evidence | Residual risk |
|---|---|---|---|
| Renderer is untrusted & isolated | Context isolation, sandbox, no node integ., strict CSP | **L2** `window.ts:31-64`, `csp.ts:12-49` | Renderer E2E/a11y absent (TD-7) |
| Only typed channels reach main | Allow-listed preload bridge (`invoke`/`subscribe`) | **L2** `preload/index.ts:15-34` | — |
| Privileged channels always gated | Fail-closed authz + boot invariant | **L4/L2** `runtimeAuthz.ts:177-190,347-355`; `runtimeCore.ts:1647-1659` | — |
| Least-privilege authorization | 57-scope RBAC, active-member-only | **L2** `enterprise.ts:72-142`; `authz.ts:36-86` | Bites only multi-user tenants |
| Native OAuth without local secrets | PKCE (S256-only) + RFC 8252 loopback | **L2** `auth/router.ts:54-59`; `loopbackServer.ts` | — |
| JWT downgrade resistance | HS256 algorithm-pinned verify + iss/aud | **L2** `auth/jwt.ts:25-33` | — |
| Token-theft containment | Rotation + reuse detection revokes chain | **L2** `session.ts:50-102` (`:66-74`) | — |
| Password hardness | Argon2id (19456/2/1) | **L3** `passwords.ts:1-16`; `argon2.json` (hash ~21 ms) | — |
| SSRF containment | Egress classifier, re-checked at dispatch | **L2 (tested)** `urlGuard.ts:57-89` | DNS-rebind window |
| Secret confidentiality at rest | `safeStorage` keychain, no plaintext fallback | **L2** `secureStore.ts:37-68`; `connectorVault.ts:78-143` | Keychain-availability dependent |
| Supply-chain integrity | Ed25519 signing + static scan | **L2** `pipeline.ts:30-105` | **Open #2** on catalog path |
| Clean production dependencies | `npm audit --omit=dev` — **0 prod vulns** | **L4** GA §2.3 | 11 advisories, all dev/test tooling (unaltered) |

---

## 7. Operational assurance

Operational assurance is the property that the running system reports its own
state honestly and recovers from disruption. It is the strongest *executed*
evidence in the program (all L4 reliability runs, 2026-07-18, live Postgres 16.13
/ Redis 7.0.15).

**Honest health & degradation.** `/health` returns
`{status: ok|degraded, components:{database,redis}, uptime}`; `/live` never touches
dependencies so a datastore blip does not trigger container restarts (`app.ts:84-96`).
Under a Redis outage `/health` reported `degraded / redis:"down"` and kept serving;
under a Postgres outage it reported `degraded / database:"down"`, failed DB-reads
fast with a clean 500, and the pool **auto-reconnected with no restart**
(`RELIABILITY-RESULTS.md §4–5`).

**Recovery & backup.** SIGTERM → restart → healthy in **0.46 s** (`reliability.json`);
cold start to healthy **0.66 s** cold / **0.624 s** warm (`startup.json`). `pg_dump
-Fc` → fresh DB → `pg_restore` reproduced every table **row-for-row** (applications
20, versions 40, categories 14; `RELIABILITY-RESULTS.md §2`) — the basis for the
recommended RTO/RPO. Application-level update **rollback remains advisory** (data-side
restore is the real path).

| Assurance property | Control | Evidence | Residual risk |
|---|---|---|---|
| Honest health reporting | `/health` component states; `/live` dependency-free | **L4** `reliability.json`; `app.ts:84-96` | — |
| Graceful degradation | Serve-through on cache loss; fail-fast on DB loss | **L4** `RELIABILITY-RESULTS.md §4–5` | Rate-limit off during Redis loss (Open #3) |
| Restart recovery | Graceful stop + sub-second re-health | **L4** 0.46 s, `reliability.json` | Single-node, single-run |
| Datastore self-heal | Pool auto-reconnect, no restart | **L4** `RELIABILITY-RESULTS.md §5` | Long-run/partition chaos not executed |
| Backup / restore | `pg_dump`/`pg_restore` row-exact | **L4** `RELIABILITY-RESULTS.md §2` | Rollback advisory (TD-5) |
| Air-gapped bundle | `build-offline-bundle.sh` shellcheck-clean | **L4 (partial)** `deployment.json` | Full `docker save/load` needs a daemon (PARTIAL) |

---

## 8. Reliability assurance

Reliability assurance formalizes the platform's **fail-posture**: which faults it
answers by staying available (fail-open) and which by refusing to act
(fail-closed). The posture is deliberate — availability trade-offs are taken only
where they do not weaken an authenticated boundary, and every one is disclosed.

| Fault | Posture | Rationale | Evidence | Residual |
|---|---|---|---|---|
| Unclassified privileged IPC channel | **Fail-closed** (won't boot) | A channel must be gated or allow-listed | **L2** `runtimeCore.ts:1647-1659` | — |
| Missing authorize dependency | **Fail-closed** (throws) | No silent unguarded path | **L2** `secureBridge.ts:101-106` | — |
| Encryption unavailable | **Fail-closed** (won't persist) | Never write secrets in plaintext | **L2** `secureStore.ts:64-68` | — |
| Unsigned/unverifiable worker pkg | **Fail-closed** (reject) | Supply-chain integrity | **L2** `packaging.ts:60` | — |
| Unsigned inbound webhook | **Fail-closed** (reject) | Never trust an unsigned delivery | **L2** `inbound/router.ts:77-88` | — |
| Redis (rate limiter) down | **Fail-open** (allow) | An outage must not lock out all users | **L4** `reliability.json`; `rateLimit.ts:37` | **Open #3** — brute-force window |
| Postgres down | **Degrade** (fail-fast reads, survive) | Process survives; self-heals on return | **L4** `RELIABILITY-RESULTS.md §5` | — |
| **Unsigned catalog app** | **Fail-open** (install) | *Unintended* asymmetry vs worker path | **L2** `packageService.ts:184` | **Open #2 (HIGH)** |

The table sets the one *unintended* fail-open — the catalog-app path — beside the
deliberate ones. That is the point of reliability assurance: a fail-open is
acceptable only when it is chosen, bounded, and disclosed.

---

## 9. Governance assurance

Governance assurance is the property that authority is bounded and actions are
recorded. Two controls carry it.

**Fail-closed RBAC gate.** Authorization is enforced by construction: every
privileged runtime channel is mapped to the `EnterprisePermission` it requires
(`runtimeAuthz.ts:47-168`), `withRuntimeAuthz` throws at composition time for any
unclassified channel (`:177-190`), and the boot invariant refuses to start if any
invokable channel is neither gated nor allow-listed (`runtimeCore.ts:1647-1659`).
Permissions resolve only for **active** members (`enterprise/authz.ts:36-48`).

**Append-only audit.** Security-relevant events are written to an append-only
`audit_log` (indexed on `user_id`/`action`), with audit failures logged-and-swallowed
so they never break the request (`0001_init.sql`; `middleware/audit.ts:9-26`). The
desktop IPC pipeline emits a structured per-call record (`secureBridge.ts:53-60`).

| Assurance property | Control | Evidence | Residual risk |
|---|---|---|---|
| Bounded authority | 57-scope RBAC, active-only, fail-closed | **L2** `enterprise.ts:72-142`; `authz.ts:36-86` | Multi-user only |
| No unguarded privileged channel | Composition + boot invariant | **L2** `runtimeAuthz.ts:177-190,347-355` | — |
| Action recording | Append-only `audit_log` + IPC audit | **L2** `0001_init.sql`; `audit.ts:9-26` | **Open #5** — not hash-chained |
| Non-repudiation | (partial) append-only storage | **L2** | No WORM/SIEM shipping; no rotation (Open #6) |

> **Count reconciliation (assurance discipline applied to our own docs).** The
> enforced authorization model is the **57-scope** `EnterprisePermission` union,
> verified by direct count at `packages/shared/src/types/enterprise.ts:72-142`
> and cited identically in the Security Guide. A **separate 18-scope**
> developer-API vocabulary (`ApiScope`) exists for the public REST/OAuth surface
> (`packages/shared/src/types/ecosystem.ts`); the underlying enterprise RBAC
> permission still applies beneath it. An early reconnaissance over-count of "~85
> scopes" (a broad grep across all authorization registries) was corrected to the
> source-verified **57 + 18**; the grounding and matrices now cite 57 canonical
> enterprise scopes (with ~85 total scope literals noted across all registries).
> Correcting a number against its cited file is exactly what assurance requires.

---

## 10. Quality assurance

Quality assurance is the property that the codebase meets its own bar before it
ships — the broadest **Validated (L4)** evidence in the program. Every figure is
from an executed gate (GA §2), unaltered.

| Assurance property | Control (gate) | Evidence | Residual risk |
|---|---|---|---|
| Type safety | `npm run typecheck` (`strict`) | **L4** — **0 errors** across 5 projects | — |
| Style/correctness | `eslint . --max-warnings 0` | **L4** — **0 warnings** | — |
| Behavioural coverage (logic) | `npm run test` | **L4** — **3,856 tests / 442 files** pass | Renderer E2E/a11y absent; no coverage instrument (TD-7) |
| Buildability | `npm run build` | **L4** — exit 0 (~25 s) | — |
| Supply-chain (prod) | `npm audit --omit=dev` | **L4** — **0 prod vulns** | 11 dev-only advisories |
| Deployment validity | `kubernetes-validate` strict; `shellcheck` | **L4** — PASS / CLEAN (`deployment.json`) | Helm render in CI only; no per-PR desktop CI (TD-4) |
| Continuous-validation model | `ValidationPipeline`/`StageResult` | **L2/L1** `continuousValidation.ts` | Orchestration model over the sandbox lab |

The desktop suite (3,548 tests) is **not yet gated per PR by CI** (TD-4) — a real
quality-*process* residual, distinct from the quality-*artifact* evidence above.

---

## 11. Residual-risk register (summary)

The consolidated register — with live status — is in the
[Assurance Manual](../manuals/ASSURANCE-MANUAL.md). In summary:

| # | Residual | Severity | Class | Source |
|---|---|---|---|---|
| 1 | Apple `id_token` not JWKS-verified | **HIGH** | Security / trust | `apple.ts:77`; TD-1/PR-1 |
| 2 | Unsigned catalog-app install (empty trust store) | **HIGH** | Supply chain / trust | `packageService.ts:184`; TD-2/PR-2 |
| 3 | Rate limiter fails open on Redis loss | **MED** | Reliability / abuse | `rateLimit.ts:37`; TD-3/PR-3 |
| 4 | AI-memory chain uses FNV-1a (non-crypto) | **LOW** | Integrity | `memorySync.ts:84`; TD-10 |
| 5 | Audit logs append-only, not hash-chained | **LOW–MED** | Governance | `audit.ts`; `secureBridge.ts:53-60` |
| 6 | No on-disk audit-log rotation | **LOW** | Operations | `secureBridge.ts:49-60`; `logger.ts` |

---

## Closing honesty statement

This framework claims exactly what the cited artifacts support and no more. The
posture is **Demonstrated for reliability, quality, and integrity**, **Implemented
for security and governance controls**, and carries **two HIGH and one MEDIUM open
item, disclosed not hidden**. NeuroPause holds **no** external certification, and
none is claimed here; the evidence is the executed gates, the reliability runs, and
the source itself — and assurance is a justified belief proportioned to it.
