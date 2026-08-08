# NeuroPause — Release Blocker Register

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: program, release owner, operator
>
> The owned list of what stands between the current RC and a distributable, externally-evaluated pilot. Each item has a class, owner, action, evidence, and status. Honesty rule: nothing here is marked resolved without evidence; external/operator items are not counted as engineering failures.

**Classes:** `P0` pilot-blocking, no workaround · `P1` high · `P2` medium · `P3` low · `EXTERNAL` needs a provider you configure · `OPERATOR` needs an operator credential/action.

## Open — operator / external (do not block engineering)

| ID | Class | Item | Owner | Action | Evidence | Status |
|---|---|---|---|---|---|---|
| RB-1 | OPERATOR · P1 | macOS code signing + notarization | Operator (Apple) | Provide `APPLE_CSC_LINK`/`APPLE_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; run the release workflow | Signing/notarize fully wired, fail-open to unsigned (`electron-builder.yml`, `scripts/notarize.cjs`, `macos-release.yml`) | OPEN — credentials required |
| RB-2 | OPERATOR · P2 | Windows Authenticode signing + timestamp | Operator | Provide `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`; add an RFC3161 timestamp server | env-driven, no cert configured (`windows-release.yml`) | OPEN — credentials required |
| RB-3 | OPERATOR · P1 | Update feed hosting + a signed build to serve | Operator | Publish signed artifacts + `beta*.yml` to `https://neuropause033.com/updates` via `DEPLOY_SSH_KEY`; verify update discovery→install→restart | electron-updater configured (generic, channel beta) | OPEN — needs hosted feed + signed build |
| RB-4 | OPERATOR · P1 (security) | Rotate real secrets present in local dotfiles | Operator | **Revoke + rotate** GitHub OAuth secret (`.env.github`), Microsoft Entra secret (`.env.entra`), backend `JWT_ACCESS_SECRET` + DB password (`apps/backend/.env`), `MEILI_MASTER_KEY` (`.env`); move all to secret management | Security scan (values redacted); `.env*` are git-ignored (not committed) | OPEN — operator action |
| RB-5 | EXTERNAL · P2 | OAuth provider registration (GitHub / Microsoft Entra) | Operator | Register OAuth apps; supply client IDs/secrets | PKCE providers implemented | OPEN — social sign-in off until configured (email/password works) |
| RB-6 | EXTERNAL · P2 | AI provider (Anthropic key or Ollama) | Operator | Configure a provider for live AI | Honest deterministic fallback without one | OPEN — live AI off until configured |
| RB-7 | EXTERNAL · P2 | Qdrant + embeddings | Operator | Deploy vector store + embedding service | Degrades to local lexical | OPEN — semantic ranking off until configured |
| RB-8 | EXTERNAL · P3 | Billing (Razorpay) | Operator | Provide Razorpay keys | Billing disabled unless configured | OPEN — billing off (not needed for a functional pilot) |

## Open — engineering / verification

| ID | Class | Item | Owner | Action | Evidence | Status |
|---|---|---|---|---|---|---|
| RB-9 | P1 | Desktop GUI / visual QA on macOS | NeuroPause QA (human) | Execute on-device install→first-run→smoke→clean-machine; sign off | `claude/PHASE-2-UX-QA.md`; renderer tests are Node-only | OPEN — PENDING GUI |
| RB-10 | P2 | Standalone checksums for manual downloads | Release owner | Publish `SHA256SUMS` for DMG/EXE alongside the electron-updater feed | Feed uses sha512 blockmap; no standalone checksum | OPEN |
| RB-11 | P3 (hardening) | Tracked `.env.example` carries a populated dev `POSTGRES_PASSWORD` | Backend owner | Replace with a placeholder; keep docker-compose default documented separately so `infra:up` bootstrap still works | Security scan | OPEN — low risk (dev default, not a production secret) |
| RB-12 | P3 | Packaging/update docs cite a stale placeholder feed URL | Docs owner | Align `docs/release/PACKAGING-SIGNING-NOTARIZATION.md` + `docs/launch/LAUNCH-02-MAC-PACKAGING.md` to the real `neuropause033.com/updates` | Release-config audit | OPEN |
| RB-13 | P3 | `knowledgeBench.test.ts` (Stage-7) asserts an absolute-ms budget (`compose ≤120ms`) that is environment-sensitive | Test-infra owner | Normalize the budget to hardware or gate it to CI (do **not** silently weaken); measured `compose=131ms` on the shared cloud VM, passes on calibrated hardware | `test:release` (cloud): **5702/5703**, the sole miss is this perf bench; not a functional regression | OPEN |

## Resolved this phase

| ID | Item | Evidence |
|---|---|---|
| RB-R1 | Legacy/operator docs used pre-rename surface names | Fixed to Phase-2 labels; validator extended (`operatorDocuments`); **38/38 clean** |
| RB-R2 | CHANGELOG lacked a `[1.0.0-rc.15]` section | Added, summarizing the Global Product RC program |
| RB-R3 | Documentation coherence (Phase-4 finding) | Reconciled; `docs:validate` green |

## Known limitations (accepted for pilot, not blockers)

- **Cold-launch auth requires the backend** — an outage strands users on login despite local data.
- **Marketplace install is worker-oriented** — non-worker package install is not implemented.
- **Preview surfaces** run on seeded/in-memory data.
- **OTLP tracing is IPC-only/uncorrelated** — no cross-tier distributed tracing out of the box.

## Gate to "distributable signed pilot"

The minimum to move from *technically pilot-ready* to *distributable signed pilot*: **RB-1** (macOS signing/notarization) + **RB-3** (hosted feed + served build) + **RB-9** (GUI sign-off), with **RB-4** (secret rotation) done before any real-data pilot. Everything else is either an accepted external dependency or a low-priority hardening item.

## Related
[Product Maturity Matrix](PRODUCT-MATURITY-MATRIX.md) · [Pilot Acceptance Criteria](../enterprise/PILOT-ACCEPTANCE-CRITERIA.md) · [Download Catalog](../downloads/DOWNLOAD-CATALOG.md) · `claude/PHASE-5-CLOSEOUT.md`
