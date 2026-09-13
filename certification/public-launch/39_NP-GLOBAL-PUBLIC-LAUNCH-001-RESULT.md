# NP-GLOBAL-PUBLIC-LAUNCH-001 — RESULT

Recorded 2026-09-13T04:01:05.907Z · COMPUTER_B · source 8331185ba41f9eb1b44eeb3656f005491df8f24d (pilot/public-launch) · release NP-OS-1.0.0-rc.30-8331185ba41f

## Direct answers

| Question | Answer |
| --- | --- |
| Can a real user install NeuroPause? | PARTIALLY — packaged app installs from DMG/ZIP and reaches READY on the build machine; clean-machine install NOT_MEASURED; macOS unnotarized (Gatekeeper rejects), Windows unsigned; public host down |
| Can a real user authenticate? | YES against the source backend (26/26 live); NO against production today (HTTP 530); OAuth providers unconfigured |
| Can a device register? | YES (live); identity lacks key material (FAIL on identity strength); revocation fails closed (live) |
| Can NeuroPause connect to backend services? | NO in production (530); YES locally |
| Can Computer-A and Computer-B communicate through governed control infrastructure? | NO — no verifier/observer object or channel exists; VERIFIER not designated |
| Can the live AI model reason over user requests? | YES — live qwen3-coder:30b through the server-side gateway; nonce-bearing answer derived from an observed tool result |
| Can the AI call tools? | YES — it proposes; Computer-B executes admissible READ_ONLY tools (live: 2 tool calls) |
| Can NeuroPause prevent unauthorized tool calls? | YES — default deny, unknown tool refused, side effects stop for a human decision (unit + live) |
| Can the runtime stop safely? | YES — STOP checked before every turn/execution; terminal states; fail-closed on gateway failure |
| Can evidence be generated? | YES — INTENT→MODEL_TURN→POLICY→ACTION→EXECUTION→RESULT→TERMINAL chain with ids |
| Can evidence be verified? | PARTIALLY — independent read-back exists in the CST kernel; no Computer-A verification object |
| Can the application update? | MECHANISM YES (feed/sha512 verified, refusals proven); live old→new transition NOT_MEASURED |
| Can it roll back? | NOT AUTOMATICALLY (by design); manual/feed rollback documented, not exercised |
| Is the artifact signed? | macOS YES (Developer ID J3G89MY3QG); Windows NO |
| Is macOS notarized? | NO |
| Is Windows appropriately signed/distributed? | NO (unsigned; not distributable publicly) |
| Is the release artifact cryptographically identifiable? | YES — NP-OS-1.0.0-rc.30-8331185ba41f; DMG 54b49f19845340b2…, ZIP 22052c3861afc151… |
| Is provenance available? | LOCALLY YES (commit→lockfile→build→digests→signature); CI attestation NO; A/B identity NOT_ESTABLISHED |
| Are credentials protected? | YES for AI keys (server-side gateway) and sessions (vault, hashed refresh); open: unrevocable 15-min access tokens |
| Is user data isolated? | DECLARED (org-scoped tables, membership checks); tenant integration suite not run here |
| Can the system survive AI outage? | YES — 503/fallback, no consequential action executes |
| Can the system survive Computer-A outage? | YES trivially — no A dependency exists |
| Can the system survive backend outage? | YES — local mode, credentials kept (fixed this branch) |
| Can a revoked device be stopped? | YES at the control plane (403 on heartbeat/re-register); desktop-side reaction NOT_MEASURED |
| Can a malicious prompt bypass authorization? | NO in tests and the live injected-document run |
| Can a malicious tool output bypass authorization? | NO — tool output is data; admissibility ignores it |
| Can a recommendation become a decision without a human act? | NO — decision objects are caller-supplied and bound to one proposal |
| Is intended use established? | NO |
| Are required regulatory reviews complete? | NO |
| Has a real external-user pilot succeeded? | NO (not started) |
| Is public support ready? | NO |
| Is rollback proven? | NO |
| Is the release authorized? | NO |

## PUBLIC_LAUNCH_STATUS = NOT_READY

Machine gates that are not PASS: 23 of 36 (see 01_MASTER_GATE_REGISTER.json). Nothing was published, tagged, pushed, or authorized. The certified R3 baseline reproduces (f0ba0e8f / 16 / 27302b87).

## Master gate register (36)

| Gate | Status | Class | Reason |
| --- | --- | --- | --- |
| GATE-01 SOURCE-INTEGRITY | PASS | PROVENANCE | clean tree at 8331185ba41f9eb1b44eeb3656f005491df8f24d; R3 baseline reproduces (porcelain digest 27302b87…; 15/15 dirty-file hashes) |
| GATE-02 VERSION-INTEGRITY | WAITING_FOR_HUMAN | HUMAN | version 1.0.0-rc.30 is unique and bound to 8331185ba41f; RELEASE_VERSION (rc.30 vs 1.0.0) and tagging are release-owner decisions |
| GATE-03 DEPENDENCY-INTEGRITY | WAITING_FOR_HUMAN | SECURITY | npm ci reproducible; prod closure audit: {"info":0,"low":0,"moderate":5,"high":1,"critical":0,"total":6}; 6 findings recorded with reachability; upgrade/acceptance is a release-owner decision |
| GATE-04 TYPECHECK | PASS | TECHNICAL | 55 typecheck invocations exit 0 |
| GATE-05 UNIT-TEST | PASS | TECHNICAL | backend 463/463; desktop node 10864 passed / 7 skipped; ui 539 passed |
| GATE-06 INTEGRATION-TEST | PASS | TECHNICAL | live HTTP journey against the source backend (Postgres+Redis): 26/26; backend __integration__ suite NOT run here (CI-declared) |
| GATE-07 SECURITY-TEST | FAIL | SECURITY | no SAST/secret-scan/DAST wired in CI; artifact secret scan PASS; authz/tenant/injection tests exist; open: trust proxy, OAuth auto-link, public AssistantAsk IPC, unrevocable 15-min access tokens |
| GATE-08 AUTHORIZATION-ENFORCEMENT | PASS | SECURITY | backend pilot authority deny-by-default (32 tests); governed loop default-deny + bound decision objects (11 tests); revoked device fails closed (live); refresh reuse now revokes (live) |
| GATE-09 AI-LIVE-INTEGRATION | BLOCKED | TECHNICAL | live model via the server-side gateway MEASURED on the local source backend (COMPLETED, nonce in answer); production gateway NOT deployed (api host HTTP 530); cloud provider key WAITING_FOR_OPERATOR_SECRET |
| GATE-10 BACKEND-CONNECTIVITY | BLOCKED | DISTRIBUTION | https://api.neuropause033.com/health → HTTP 530 (Cloudflare origin down) on 2026-09-12; local source backend healthy |
| GATE-11 DEVICE-REGISTRATION | FAIL | SECURITY | registration/heartbeat/revoke measured live and revocation fails closed; but device identity is a client-minted UUID with no key material / proof of possession and no enrollment lifecycle |
| GATE-12 DATA-STORAGE | NOT_MEASURED | TECHNICAL | 13 migrations applied on the local Postgres; tenant isolation integration suite CI-declared, not run here; production at-rest encryption/backup unmeasured (host unreachable) |
| GATE-13 PRIVACY | FAIL | TECHNICAL | no account-deletion or data-export path; privacy policy not legal-reviewed; inventory recorded |
| GATE-14 UPDATE | NOT_MEASURED | TECHNICAL | feed integrity, sha512 binding and refusal controls PASS (verifier + negative controls); a live old→new update transition was not exercised (no prior signed release) |
| GATE-15 ROLLBACK | NOT_MEASURED | TECHNICAL | AUTOMATIC_ROLLBACK = NOT_SUPPORTED by design (allowDowngrade=false, ordering fixed); manual/feed rollback documented, not exercised |
| GATE-16 DESKTOP-PACKAGING | PASS | TECHNICAL | clean-room universal package exit 0; verify:release + verify:universal PASS; deep verifier: containers/feed/zip/dmg/identity/plist/architecture/dependencies/config/secrets PASS |
| GATE-17 WINDOWS-DISTRIBUTION | WAITING_FOR_OPERATOR_SECRET | DISTRIBUTION | NSIS x64 built (exit 0); signingStatus=NOT CONFIGURED; WIN_CSC_* absent |
| GATE-18 MACOS-DISTRIBUTION | WAITING_FOR_OPERATOR_SECRET | DISTRIBUTION | signed (Developer ID, Team J3G89MY3QG), hardened runtime, NOT notarized → spctl rejects; public host down |
| GATE-19 CODE-SIGNING | PASS | DISTRIBUTION | codesign --verify --deep --strict PASS; 14 nested objects verified; Windows unsigned (see GATE-17) |
| GATE-20 NOTARIZATION | WAITING_FOR_OPERATOR_SECRET | DISTRIBUTION | notarization-status.json state=skipped; stapler validate exit 65; spctl exit 3 |
| GATE-21 RELEASE-PROVENANCE | BLOCKED | PROVENANCE | SOURCE→BUILD→ARTIFACT bound locally (build-info commit, digests, manifest); no CI provenance (nothing pushed); A/B release identity NOT_ESTABLISHED |
| GATE-22 RELEASE-ARTIFACT-IDENTITY | PASS | PROVENANCE | release_id NP-OS-1.0.0-rc.30-8331185ba41f; every artifact sha256/sha512/size recorded; DMG app bundle digest == ZIP app bundle digest |
| GATE-23 INSTALLATION | NOT_MEASURED | TECHNICAL | no clean external machine available; fresh-profile launch of the packaged app on the build machine PASS (PACKAGE→LOAD→READY) |
| GATE-24 FIRST-RUN | PASS | TECHNICAL | packaged first launch reaches READY in 4604 ms in local mode; no consent/policy-bootstrap/health states exist (gap recorded) |
| GATE-25 AUTHENTICATION | PASS | SECURITY | register/login/refresh-rotation/reuse-burn/logout measured live 26/26; OAuth providers WAITING_FOR_OPERATOR_SECRET; mail delivery FAIL (see 15_AUTHENTICATION_REGISTER) |
| GATE-26 USER-REGISTRATION | FAIL | TECHNICAL | registration works; email verification and password-reset mail undeliverable in production (logging mailer); no account deletion |
| GATE-27 DEVICE-ENROLLMENT | FAIL | SECURITY | no enrollment lifecycle (PENDING/ACTIVE/…), no key enrollment; revoke fails closed (measured) |
| GATE-28 AI-TOOL-EXECUTION | PASS | TECHNICAL | governed loop executes admissible tools, feeds observations back, answers from them (live run: 2 tool calls, nonce in answer) |
| GATE-29 HUMAN-AUTHORITY | PASS | SECURITY | decision objects bind to one proposal; confirmation ≠ authority; AI/tool output cannot populate decisions (tests + live); backend HumanDecision shape lacks authority_basis/policy_version/signature (gap) |
| GATE-30 STOP/FAIL-CLOSED | PASS | SECURITY | STOP honoured before every model turn and execution; gateway 503 when unconfigured; revoked device 403; transient backend failures keep credentials without granting anything |
| GATE-31 OBSERVABILITY | NOT_MEASURED | TECHNICAL | /metrics endpoint and deploy/observability rules exist (DECLARED); mapper did not complete; gateway emits per-call audit lines (ids/tokens only) |
| GATE-32 INCIDENT-RECOVERY | NOT_MEASURED | TECHNICAL | backup/restore scripts and safe-mode paths exist (DECLARED); failure-mode matrix partially measured (AI outage, backend 5xx, revoked device) |
| GATE-33 SUPPORT-READINESS | FAIL | TECHNICAL | no verified support/security/privacy mailbox; mailer undeliverable; no data export/deletion |
| GATE-34 RELEASE-DISTRIBUTION | BLOCKED | DISTRIBUTION | PUBLISH_TO_SITE unset (correct: no auto-publish); site apex has no DNS record and edge answers 530; publish host SSH read denied by session policy |
| GATE-35 ROLLBACK-VERIFICATION | NOT_MEASURED | TECHNICAL | see GATE-15 |
| GATE-36 PUBLIC-LAUNCH-AUTHORIZATION | WAITING_FOR_HUMAN | HUMAN | no PUBLIC_RELEASE_AUTHORIZATION record exists; the machine must not create one |

## OPERATOR INPUT REQUIRED

1. APPLE CI SIGNING — STATUS: SECRETS PRESENT, SIGNING STEP FAILED (rc.29 keychain unlock). ACTION: push `pilot/public-launch` and dispatch `macos-release` (runner now pinned to macos-15) OR re-export the .p12 + password into `APPLE_CSC_LINK`/`APPLE_CSC_KEY_PASSWORD`. SECRET VALUE: DO NOT SEND HERE.
2. APPLE NOTARIZATION (local path) — STATUS: ABSENT locally. ACTION: run `xcrun notarytool store-credentials np-notary --apple-id <id> --team-id J3G89MY3QG` on this Mac (password stays in the keychain); then a session can notarize + staple the exact DMG/ZIP. SECRET VALUE: DO NOT SEND HERE.
3. WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD — STATUS: MISSING. ACTION: obtain an Authenticode certificate (or Azure Artifact Signing) and configure in the CI secret manager. SECRET VALUE: DO NOT SEND HERE.
4. neuropause033.com — STATUS: apex has no DNS record, edge answers HTTP 530, registry expiry 2026-09-15 (mapper). ACTION: renew the domain, restore DNS/origin (tunnel) for api. and the site. DECISION: keep this domain or not.
5. PUBLISH_TO_SITE — STATUS: UNSET (correct until authorized). ACTION: none until PUBLIC_RELEASE_AUTHORIZATION exists.
6. RELEASE_VERSION — REQUIRED DECISION: A) 1.0.0-rc.30  B) 1.0.0
7. MAC_ARCHITECTURE — REQUIRED DECISION: A) Universal (built, verified)  B) Apple Silicon only
8. GIT PUSH of `pilot/public-launch` — REQUIRED DECISION (durability + CI provenance; outward-facing).
9. DEPENDENCY FINDINGS — REQUIRED DECISION: accept (with rationale recorded) or schedule upgrades for js-yaml (high), qs/express/body-parser (moderate), react-router (moderate).
10. GATE-INTENDED-USE + QUALIFIED REGULATORY REVIEW — complete and sign the NP-GLOBAL-PILOT-003 form (MODE A today).
11. PUBLIC_RELEASE_AUTHORIZATION — a separate human act; the machine has prepared everything else.
12. Production-host read access for a session (SSH read-only) — STATUS: denied by session policy; grant or perform the host checks yourself (artifacts, feeds, HTTPS).

## Evidence
All registers under `certification/public-launch/` (index: 39_INDEX.json); raw evidence copies under `certification/public-launch/evidence/`; mapper reports under `certification/public-launch/discovery/`. `npm run neuropause:public-launch:verify` reproduces the verdict read-only.
