# NeuroPause EOSP — Security Operations Manual

> **What this is.** The security-operations (**SecOps**) **execution** manual for the Enterprise
> Operations & Scale Program (EOSP): how the platform's **already-verified** security controls
> are _run_ — watched, exercised, patched, reviewed, and defended during an incident. It adds
> **no runtime and no platform**: only roles, cadences, workflows, and decision rules over the
> controls that already ship. The controls themselves and the honest hardening backlog are
> documented in `docs/guides/SECURITY-GUIDE.md` and disclosed in `SECURITY.md` — **cited and
> operated here, never restated.**
>
> **Honesty banner (non-negotiable).** There is **no production fleet and no staffed SOC** —
> this document reports **no incidents, no breach counts, no CVE tallies, and no "0 breaches"
> claim.** It states the **real** posture: verified controls (RBAC 57 scopes, PKCE S256,
> Argon2id, Ed25519 signing, SSRF egress guard, append-only `audit_log`, **0 production
> npm-audit vulnerabilities**) and carries the **real open items** honestly (Apple JWKS
> **HIGH**, unsigned marketplace install **HIGH**, rate-limiter fail-open **MEDIUM**, 11
> dev-only advisories). **Detection is manual today** — SIEM, alert routing, and paging are
> **absent / proposed wiring** over the real substrate, not shipped platform. Roles, never
> people. Reliability incident mechanics (on-call, severity, error budgets) live in
> `SRE.md` and are **invoked, not duplicated**; incident runbooks live in
> `docs/validation/OPERATIONAL-RUNBOOKS.md`.

## 1. Security operations guide

### Mission

Keep every **verified** security control in `SECURITY-GUIDE.md` **in force, exercised, and
un-regressed** across releases; convert responsible-disclosure reports into tracked, triaged,
remediated work; and make the platform's honestly-disclosed gaps a **managed backlog**, not a
surprise. SecOps owns the control inventory, the security incident lifecycle, vulnerability
intake/triage, the security-patch path, and the review cadence — the **assurance contract** the
platform ships under, not feature delivery.

### Operating principles

1. **Operate what is verified; disclose what is not.** Every control below is cited to
   `file:line` in `SECURITY-GUIDE.md`. Every gap is carried as a tracked register entry (§3),
   never silently assumed closed.
2. **Fail closed is the default, so watch the fail-open exceptions.** The IPC pipeline, worker
   install, and secret store fail closed by construction; the **rate limiter fails open** on
   Redis loss (deliberate) — that exception is an explicit monitoring obligation (§2, §6).
3. **Detection is manual until wired.** No SIEM/alerting ships. Security signals
   (`audit_log`, `/health`, request counters) are **queried and watched by a role**, not paged
   — treat that as standing toil to close, not a capability to assume.
4. **Roles, not people; cadences, not heroics.** SecOps duties are staffable roles layered onto
   the existing SRE on-call model (`SRE.md §1`); this manual sets _what_ and _when_, not _who_.

### The control inventory — the thing being operated

These are the **verified, shipping** controls. SecOps' job is the right-hand column — keeping
each in force and proving it every release (§5). Descriptions are **not** repeated from
`SECURITY-GUIDE.md`; only the operating obligation is stated.

| Verified control                                         | Source (`SECURITY-GUIDE.md` cite)                                                                   | Operating obligation (SecOps)                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Fail-closed IPC + boot invariant**                     | `secureBridge.ts:93-117`; boot check `runtimeCore.ts:1647-1659`, `runtimeAuthz.ts:347-355`          | Confirm the app **refuses to boot** on any unclassified channel every release (§5); a green build _is_ the assertion.         |
| **RBAC — 57 scopes**                                     | `packages/shared/src/types/enterprise.ts:72-142`; `enterprise/authz.ts:36-86`                       | Review scope union on change; verify `invited`/`suspended` members resolve to **no** permissions (`:41`).                     |
| **PKCE (S256-only) + loopback**                          | `apps/backend/src/auth/router.ts:54-59,83-85`                                                       | Verify the method allowlist still rejects non-`S256`; part of per-release auth check.                                         |
| **JWT HS256 algorithm-pinned**                           | `apps/backend/src/auth/jwt.ts:25-33`                                                                | Confirm `algorithms:['HS256']` + iss/aud pinning intact (blocks `alg:none` downgrade).                                        |
| **Refresh rotation + reuse detection**                   | `apps/backend/src/auth/session.ts:50-102`, revoke-chain `:66-74`                                    | This is a **live detect→contain primitive** for token theft (§2); confirm chain-revocation path on review.                    |
| **Argon2id password hashing**                            | `apps/backend/src/auth/passwords.ts:1-16`                                                           | Hold parameters (mem 19,456 KiB, time 2, par 1); any change re-runs auth capacity sizing (`SRE.md §6`).                       |
| **OS-keychain secret store / connector vault**           | `secureStore.ts:64-68`; `connectorVault.ts:78-81`, rotate `:120-143`                                | Verify plaintext-refusal on encryption-unavailable; exercise `reencryptAll` on key rotation.                                  |
| **Developer-key / client-secret hashing**                | `developerStore.ts:50-52`, revoke-by-`jti` `:284-301`                                               | Operate rotation/revocation as containment levers (§2).                                                                       |
| **SSRF egress guard**                                    | `webhooks/urlGuard.ts:57-83`, metadata `169.254.169.254` at `:30-38`                                | Confirm denylist (loopback/private/link-local/CGNAT/IPv4-mapped + metadata) on review; recheck-before-dispatch stays enabled. |
| **Inbound webhook HMAC (timing-safe)**                   | `connectors/inbound/verify.ts:29-47`                                                                | Confirm unsigned deliveries are rejected and verification failure fails closed.                                               |
| **Ed25519 supply-chain signing**                         | marketplace `pipeline.ts:89-105`; worker `packaging.ts:56-62`; trust store `nps/signature.ts:38-52` | Operate the trust store; worker install is fail-closed — **catalog-app install is the open item** (§3).                       |
| **Backend hardening (helmet, loopback CORS, body caps)** | `apps/backend/src/app.ts:45-63`                                                                     | Verify headers/CORS on review; ensure `/metrics` is network-restricted at ingress (`:98-103`).                                |
| **Append-only `audit_log`**                              | `apps/backend/src/middleware/audit.ts:9-26`                                                         | Primary detection substrate (§2, §6); **not hash-chained** — carried as backlog.                                              |
| **Split liveness/readiness**                             | `apps/backend/src/app.ts:84-96`                                                                     | `/health` degradation is a security signal (fail-open window); wired into IR detection (§2).                                  |

### SecOps roles (overlay on the SRE on-call model)

SecOps does **not** define a second pager. It layers two hats onto the roles in `SRE.md §1`.

| Hat                                      | Layers onto                                        | Engaged when                                                                                            |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Security Incident Commander (Sec-IC)** | The SRE **IC** (`SRE.md §1`) — a hat, not a person | Any confirmed security incident; owns severity call (§2), containment authority, and disclosure timing. |
| **Vulnerability triage owner**           | Primary on-call / eng                              | Every inbound `SECURITY.md` report; runs intake→triage→register (§3) within the published SLA.          |

## 2. Incident response (security)

A **security incident** is a suspected or confirmed compromise of a protected asset
(`SECURITY-GUIDE.md` "Threat Model"): token/secret exposure, unauthorized privileged action,
supply-chain tampering, or abuse of a fail-open window. It runs the standard lifecycle below;
mechanics it shares with reliability incidents (severity roles, escalation timers, comms) are
**invoked from `SRE.md §1`**, not restated.

### Security severity mapping

Security severity maps onto the SRE SEV scheme so one pager, one escalation timer, and one comms
path serve both.

| Sec severity | Definition                                                       | Maps to (`SRE.md`) | Example (real surface)                                                              |
| ------------ | ---------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| **SEC-CRIT** | Active exploitation, secret/data exposure, or auth bypass        | **SEV1**           | Confirmed refresh-token theft chain; forged-identity sign-in via an unverified path |
| **SEC-HIGH** | Exploitable-but-not-yet-exploited HIGH open item; failed control | **SEV2**           | The two tracked HIGH items (§3) reaching exploit-ready conditions                   |
| **SEC-MED**  | Degraded control / elevated-risk window, no impact yet           | **SEV2/3**         | Redis outage → rate-limiter fail-open (abuse window; Runbook 1)                     |
| **SEC-LOW**  | Single anomaly, no confirmed vector                              | **SEV3**           | Anomalous `audit_log` auth-failure cluster from one source                          |

### Lifecycle: detect → triage → contain → eradicate → recover → postmortem

| Phase          | Executable actions (real substrate)                                                                                                                                                                                                                                                                                                                                                                                 | Tie-in                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Detect**     | Query `audit_log` for auth anomalies (`middleware/audit.ts:9-26`); watch desktop IPC audit trail (`secureBridge.ts:53-60`, ok/fail per channel); `/health` `degraded` + `components.redis:"down"` = fail-open window; `neuropause_http_requests_total{status}` spike = coarse brute-force proxy. **Refresh-reuse is auto-detected** by `rotateTokens` (`session.ts:66-74`).                                         | §6; Runbook 1              |
| **Triage**     | Sec-IC assigns severity (table above), scopes affected asset/tenant/provider, confirms precondition (multi-user tenant? Apple provider enabled? Redis down?). Open an incident record in the register (§3) even for a confirmed exploit of a known gap.                                                                                                                                                             | `SRE.md §1`                |
| **Contain**    | Real levers: **revoke session chain** (`session.ts:66-74`) / **revoke access token by `jti`** (`developerStore.ts:284-301`); **rotate connector vault** (`reencryptAll`, `connectorVault.ts:120-143`); **rotate developer keys** (`:211-217`); throttle upstream (WAF/ingress) during a fail-open window (Runbook 1 step 3); **disable the affected auth provider or catalog-install source** (§3 worked examples). | Runbook 1                  |
| **Eradicate**  | Ship the fix via the security-patch path (§4): patch the code/dependency, **rotate exposed secrets** (`JWT_ACCESS_SECRET`, client secrets), remove any malicious package, re-run the quality + `npm audit --omit=dev` gate.                                                                                                                                                                                         | §4; `RELEASE-CHECKLIST.md` |
| **Recover**    | If data was tampered/corrupted, restore data-side (Runbook 5 / `DISASTER-RECOVERY-GUIDE.md §4`) — app-binary rollback is **advisory only**. Restore the failed-open control (Redis back → limiter re-arms). Verify `/health` `ok` + a smoke sign-in.                                                                                                                                                                | Runbook 3/5                |
| **Postmortem** | Blameless writeup; every finding becomes a register (§3) or hardening-backlog item; if a **verified** control failed, add a regression check to the review checklist (§5).                                                                                                                                                                                                                                          | §5                         |

### Detection is manual — the honest gap

> There is **no SIEM, no alert routing, and no paging** (`OPERATIONS-GUIDE.md` "Known
> Operational Gaps"; `_grounding.md`). Auth events are written to `audit_log` but there is **no
> query/alert layer over them**, and the log is **append-only but not hash-chained**
> (`SECURITY-GUIDE.md` backlog #5) — an attacker with log-store write access could alter entries
> undetected. Therefore, until the proposed wiring lands (§6), the **Detect** row above is a
> **standing manual watch by a role**, not an automated alert. Do not assume an incident
> self-announces.

## 3. Vulnerability handling

### Intake — via the published disclosure policy

Inbound reports arrive through the disclosure channel in `SECURITY.md` / `SECURITY-GUIDE.md`
("Reporting a Vulnerability"). The triage owner (§1) operates against the **already-published
SLA** — do not invent a new one:

- **Acknowledge** within **3 business days**.
- **Triage assessment + severity rating** within **10 business days**.
- Status updates through remediation; coordinated disclosure timing agreed with the reporter.

Every accepted report becomes a **register entry** (below), whether it is novel or adds impact
to a known backlog item.

### Severity rubric (definitions — no fabricated scores)

| Severity           | Definition (used for triage)                                                   | Default track                                    |
| ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| **Critical**       | Remote auth bypass, secret/data exposure, or RCE with a realistic precondition | Hotfix now (§4 hotfix path)                      |
| **High**           | Exploitable integrity/authenticity failure; realistic but bounded precondition | Next patch release; interim mitigation mandatory |
| **Medium**         | Degraded control / risk window; no direct impact without a second failure      | Backlog with owner + target release              |
| **Low / dev-only** | Non-production surface (e.g. dev-only advisory) or defense-in-depth nit        | Tracked; non-blocking                            |

### The real `npm audit` workflow

Grounded in `RELEASE-CHECKLIST.md §3` — a **gate**, not a suggestion.

```bash
# Production dependency posture — the release gate. Baseline: 0 production advisories.
$ npm audit --omit=dev        # any NEW production advisory is triaged BEFORE release
# Full posture incl. dev — the 11 dev-only advisories are tracked, non-blocking.
$ npm audit                   # dev-only advisories: record, do not ship-block
```

**Decision rule.** A **production** advisory (`--omit=dev`) at **High/Critical** → hotfix path
(§4) before the next deploy; a dev-only advisory → backlog entry, verified again at the next
gate. **Cadence:** the gate runs every release (mandatory) **plus** a proposed weekly scheduled
`npm audit --omit=dev` so a mid-cycle advisory is caught before the release window, not at it.
Current posture carried honestly: **0 production vulnerabilities, 11 dev-only advisories**
(`_grounding.md`).

### Vulnerability register (tracked entries)

The two **HIGH** open items are tracked here as first-class entries and worked through triage
below. Lower-severity backlog items (FNV-1a memory hash, non-chained audit log, no log rotation)
remain tracked in `SECURITY-GUIDE.md` "Hardening Backlog" — referenced, not duplicated.

| ID                        | Item                                                                          | Sev      | Source (`file:line`)                                                                 | Scope / precondition                                                                                                                 | Status                                               | Interim mitigation (operational)                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **VULN-APPLE-JWKS**       | Apple `id_token` decoded, signature **not** JWKS-verified                     | **HIGH** | `apps/backend/src/auth/providers/apple.ts:77`; TODO `:14-16`                         | **Apple sign-in only**; attacker forges/alters `id_token`. Google/MS/GitHub unaffected (authenticated userinfo)                      | Open (top pre-GA blocker, `RELEASE-CHECKLIST.md §3`) | **Keep Apple provider disabled** until fixed; if enabled, gate behind confirmation that fix has shipped                                  |
| **VULN-UNSIGNED-INSTALL** | Catalog/marketplace app installs **unsigned** packages when trust store empty | **HIGH** | `apps/desktop/src/main/nps/packageService.ts:184`; empty store `nps/signature.ts:22` | Catalog-app **authenticity** only. SHA-256 **integrity** still enforced (`:179-182`); worker install fail-closed (`packaging.ts:60`) | Open                                                 | **Install only from the curated first-party catalog**; restrict install source operationally until signing pipeline + trusted keys exist |
| **VULN-RL-FAILOPEN**      | Auth rate limiter **fails open** on Redis loss                                | **MED**  | `apps/backend/src/middleware/rateLimit.ts:32-39`                                     | Deliberate availability trade-off; abuse protection off **only during** a Redis outage                                               | Accepted / monitored                                 | Runbook 1 step 3: watch request-rate spikes, throttle upstream until Redis returns                                                       |

### Worked example A — VULN-APPLE-JWKS (HIGH)

**Intake→triage.** Classified **High**: an authenticity/identity-forgery failure with a bounded
precondition (the Apple provider must be enabled and reachable). **Scope confirmed** against
source: the flaw is isolated to `apple.ts` `fetchProfile` (`:77`); the other IdPs resolve
identity from the _authenticated_ resource server, so `id_token` forgery does not reach them.
**Remediation (eradicate):** fetch + cache Apple JWKS (`https://appleid.apple.com/auth/keys`),
verify `ES256`, issuer `https://appleid.apple.com`, audience = Services ID **before** trusting
`sub`/`email` — closing the code's own `HARDENING TODO`. **Ship** via §4, then flip the register
to closed only after a §5 checklist item confirms the verification path is live.

### Worked example B — VULN-UNSIGNED-INSTALL (HIGH)

**Intake→triage.** Classified **High**, but **narrowed** in triage: this is an _authenticity_
gap, not _integrity_ — the catalog-declared SHA-256 hash is still enforced (`:179-182`), and
worker-package install remains fail-closed (`packaging.ts:60`). The exposure is that an
**unsigned** catalog artifact (`artifact.signature` absent) skips verification because the guard
is `if (artifact.signature && !sig.verified)` and the Ed25519 trust store ships empty
(`signature.ts:22`). **Interim mitigation:** operationally constrain installs to the curated
first-party catalog. **Remediation (eradicate):** once a signing pipeline and trusted publisher
keys exist, require a _verified_ signature and **reject absent** ones — matching the
worker-package policy. Tracked closed only when §5 confirms the guard rejects unsigned artifacts.

## 4. Patch workflow

Two patch classes, both routed through the existing release gate — SecOps adds cadence and a
hotfix lane, not a new pipeline.

| Patch class             | Trigger & cadence                                                   | Path                                                                                            |
| ----------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Dependency patch**    | `npm audit --omit=dev` finding (weekly scan + per-release gate)     | Bump → full quality gate → `npm audit --omit=dev` clean → release (`RELEASE-CHECKLIST.md §2-3`) |
| **Platform/code patch** | A register item (§3), or a control regression from §5               | Fix → gate → migration review (§ below) → deploy → post-verify                                  |
| **Security hotfix**     | Any **Critical**, or a production **High** with a live precondition | Out-of-cycle patch through the **same gate**, expedited (below)                                 |

### The gate every security patch still passes

No security patch skips the release gate (`RELEASE-CHECKLIST.md §2`): `npm run typecheck`,
`lint`, `test`, `build` all **0/green** (baseline **typecheck 0, lint 0, 3,856 tests, build 0**,
`_grounding.md`), `npm audit --omit=dev` reviewed, and the `SECURITY-GUIDE.md` backlog checked
for **regression** (`RELEASE-CHECKLIST.md §3`). A hotfix compresses the _calendar_, never the
_gate_.

### Platform patches tie to forward-only migrations

Schema-touching patches follow the **transactional, forward-only** backend migrator (12 SQL
migrations; `DISASTER-RECOVERY-GUIDE.md`) and `RELEASE-CHECKLIST.md §5`:

1. **Additive + reversible by a documented data-side path** — review every new migration against
   this rule; no destructive in-place rewrites.
2. **`RUN_MIGRATIONS_ON_BOOT=false`** in production — migrations run as a **deliberate deploy
   step**, never silently at boot.
3. **Confirm a current backup exists before applying** (Runbook 5) — the real recovery path is
   data-side restore, since app-binary rollback is **advisory**.

### Hotfix path (expedited, same gate)

```
confirm precondition & scope (§3) → branch a hotfix → apply fix + rotate any exposed secret
→ run the full quality gate (§ above), 0/green → npm audit --omit=dev clean
→ backup (Runbook 5) → deploy rolling (maxUnavailable:0 → zero-downtime, backend.yaml:107-162)
→ post-verify: /health ok, /metrics responding, smoke sign-in (RELEASE-CHECKLIST.md §7)
→ rollback IF needed = data-side restore, NOT binary rollback (advisory)
```

Because rolling update keeps old pods serving until new pods pass readiness (`SRE.md §5`;
`backend.yaml:107-162`), a security patch need **not** spend the availability error budget.

## 5. Security reviews

### Cadence

| Review                          | When                                         | Owner hat    | Output                                                                    |
| ------------------------------- | -------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| **Per-release security review** | Every release (gate)                         | Triage owner | `RELEASE-CHECKLIST.md §3` boxes checked; backlog non-regression confirmed |
| **Quarterly control audit**     | Quarterly                                    | Sec-IC       | Full control-inventory checklist (below) re-verified against source       |
| **Trigger review**              | Any new **High**, or a §2 postmortem finding | Sec-IC       | Register update + a new regression check added to the checklist           |
| **Dependency review**           | Weekly                                       | Triage owner | `npm audit --omit=dev` diff vs. the 0-production baseline                 |

### Control-verification checklist (grounded in the real controls)

Each item asserts a **verified** control still holds; a failed box is a §3 register entry, not a
footnote.

- [ ] **Boot invariant holds** — app refuses to start on any unclassified privileged channel
      (`runtimeCore.ts:1647-1659`; a green `build` proves it).
- [ ] **RBAC intact** — 57-scope union unchanged or reviewed; `invited`/`suspended` → no perms
      (`enterprise/authz.ts:41`).
- [ ] **PKCE S256-only** rejects other methods (`auth/router.ts:54-59`); loopback-only redirect.
- [ ] **JWT algorithm-pinned** `['HS256']` + iss/aud (`auth/jwt.ts:25-33`).
- [ ] **Refresh reuse-detection** revokes the session chain on replay (`session.ts:66-74`).
- [ ] **Argon2id** parameters unchanged (any change → re-run auth sizing, `SRE.md §6`).
- [ ] **Secret stores refuse plaintext** on encryption-unavailable (`secureStore.ts:64-68`;
      `connectorVault.ts:78-81`).
- [ ] **SSRF denylist** intact incl. `169.254.169.254` and IPv4-mapped bypass
      (`urlGuard.ts:30-54`); recheck-before-dispatch enabled.
- [ ] **Inbound HMAC** timing-safe; unsigned deliveries rejected (`inbound/verify.ts:29-47`).
- [ ] **Ed25519 verify** pins algorithm; worker install fail-closed (`packaging.ts:60`).
- [ ] **`/metrics` network-restricted** at ingress (`app.ts:98-103`); CORS loopback (`:45-50`).
- [ ] **`npm audit --omit=dev`** = 0 production advisories; dev-only count noted.
- [ ] **Backlog non-regression** — the two HIGH items and every `SECURITY-GUIDE.md` backlog item
      confirmed **not worsened**, and disclosed in release notes.

## 6. Threat monitoring

What the **real substrate** supports **today** versus the **proposed** detections. The left
column is operable now (manually); the right is proposed wiring over the same real signals —
**not** shipped platform.

| Threat / signal                     | Real substrate **today**                                                                                       | **Proposed** detection (not shipped)                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Token theft / replay**            | **Auto-detected + auto-contained**: `rotateTokens` revokes the session chain on reuse (`session.ts:66-74`)     | Alert on chain-revocation events once `audit_log` has a query/alert layer               |
| **Auth abuse / brute force**        | `audit_log` auth events (`middleware/audit.ts:9-26`); coarse `neuropause_http_requests_total{status}` spike    | Per-identity rate/anomaly detection; burn-style alerting (`SRE.md §4`) via Alertmanager |
| **Fail-open abuse window**          | `/health` `degraded` + `components.redis:"down"` (Runbook 1) — a **known** window while the limiter fails open | Blackbox probe on `/health` + page on `redis:"down"` (external, proposed)               |
| **Privileged IPC misuse (desktop)** | IPC audit trail: per-channel ok/fail, duration (`secureBridge.ts:53-60`)                                       | Ship the trail off-box; hash-chain records (backlog #5)                                 |
| **Supply-chain tampering**          | Ed25519 verify + static scan on publish (`pipeline.ts:30-105`); worker install fail-closed                     | Require signatures for **catalog** install too (closes VULN-UNSIGNED-INSTALL)           |
| **Audit-trail tampering**           | `audit_log` append-only (`middleware/audit.ts`)                                                                | Per-record **hash chain** + WORM/SIEM export (backlog #5)                               |

> **Absent / proposed (honest).** No **SIEM**, no **alert routing/paging**, no **distributed
> tracing correlation**, no **capacity/abuse forecasting** (`OPERATIONS-GUIDE.md` "Known
> Operational Gaps"; `_grounding.md`). Every "proposed" cell is wiring over the **real** series
> and tables above — authoring it is the highest-leverage SecOps toil-reduction item (it
> converts the manual **Detect** watch of §2 into automated detection). Until then, threat
> monitoring is a **scheduled human review** of `audit_log`, `/health`, and the request
> counters — real signals, manual eyes.

## Provenance & scope

- **Verified (real):** every control in §1's inventory and §5's checklist — cited to `file:line`
  in `docs/guides/SECURITY-GUIDE.md`; disclosure policy in `SECURITY.md`. Dependency posture (**0
  production / 11 dev-only advisories**) and quality baseline (**typecheck 0, lint 0, 3,856
  tests, build 0**) from `_grounding.md` / `RELEASE-CHECKLIST.md §2-3`.
- **Open items carried honestly:** VULN-APPLE-JWKS (HIGH), VULN-UNSIGNED-INSTALL (HIGH),
  VULN-RL-FAILOPEN (MED), and the remaining `SECURITY-GUIDE.md` hardening backlog — tracked in
  §3, referenced not duplicated.
- **Proposed / absent (not shipped):** SIEM, alert routing/paging, hash-chained audit, blackbox
  probing, per-identity anomaly detection — proposed wiring over the real substrate (§2, §6).
- **Invoked, not restated:** incident severity/on-call/comms mechanics (`SRE.md §1`); reliability
  runbooks (`OPERATIONAL-RUNBOOKS.md`); release gate (`RELEASE-CHECKLIST.md`); recovery
  (`DISASTER-RECOVERY-GUIDE.md`). **No incidents, breach counts, CVE tallies, or "0 breaches"
  claim appear anywhere in this document — no production fleet and no staffed SOC exist.**
