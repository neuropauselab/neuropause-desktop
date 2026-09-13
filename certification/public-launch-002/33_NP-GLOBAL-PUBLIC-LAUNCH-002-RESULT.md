PUBLIC LAUNCH STATUS:
NOT_READY

TECHNICAL STATUS: GREEN — typecheck (53 invocations), backend 463 tests, desktop node 10864 passed / 7 skipped, UI 539 passed, build exit 0, clean-room universal package exit 0, packaged runtime PASS. NOT_MEASURED: clean-machine install, live update transition, rollback, Intel runtime.
SECURITY STATUS: RED — open findings recorded in 06_SECURITY_REGISTER.json; six defects fixed and re-measured live this branch (refresh-reuse revocation, revoked-device fail-closed, reset session revocation, transient-edge credential loss, AI budget, server-side AI gateway).
AI STATUS: YELLOW — live model reasoning + governed tool loop MEASURED through the gateway (local Ollama); production gateway NOT_DEPLOYED; cloud provider key WAITING_FOR_OPERATOR_SECRET; default desktop assistant lanes remain device-direct (decision).
DISTRIBUTION STATUS: BLOCKED — macOS signed but NOT notarized (Gatekeeper rejects); Windows unsigned; PUBLISH_TO_SITE unset; host HTTP 530; apex DNS absent; domain expiry 2026-09-15 (mapper).
PROVENANCE STATUS: BLOCKED — local chain bound by digests (NP-OS-1.0.0-rc.30-8331185ba41f); no CI attestation; A_RELEASE_IDENTITY == B_RELEASE_IDENTITY NOT_ESTABLISHED.
INSTALLATION STATUS: NOT_MEASURED on a clean machine; fresh-profile packaged launch PASS on the build machine.
UPDATE STATUS: mechanism verified (feed ↔ artifact, refusals proven by negative controls); live transition NOT_MEASURED; rollback NOT_SUPPORTED automatically.
REGULATORY STATUS: WAITING_FOR_HUMAN — GATE-INTENDED-USE NOT_ESTABLISHED; US/EU/India determinations absent.
HUMAN AUTHORITY STATUS: WAITING_FOR_HUMAN — no PUBLIC_RELEASE_AUTHORIZATION; BASELINE_CANDIDATE_VALID (TR-GPR-01 a9afa5e1… verified present) but not designated.

BLOCKING GATES:
- VERSION = WAITING_FOR_HUMAN (HUMAN) — version 1.0.0-rc.30 is unique and bound to 8331185ba41f; RELEASE_VERSION (rc.30 vs 1.0.0) and tagging are release-owner decisions
- DEPENDENCY = WAITING_FOR_HUMAN (SECURITY) — npm ci reproducible; prod closure audit: {"info":0,"low":0,"moderate":5,"high":1,"critical":0,"total":6}; 6 findings recorded with reachability; upgrade/acceptance is a release-owner decision
- SECURITY = FAIL (SECURITY) — no SAST/secret-scan/DAST wired in CI; artifact secret scan PASS; authz/tenant/injection tests exist; open: trust proxy, OAuth auto-link, public AssistantAsk IPC, unrevocable 15-min access tokens
- AI = BLOCKED (TECHNICAL) — live model via the server-side gateway MEASURED on the local source backend (COMPLETED, nonce in answer); production gateway NOT deployed (api host HTTP 530); cloud provider key WAITING_FOR_OPERATOR_SECRET
- BACKEND = BLOCKED (DISTRIBUTION) — https://api.neuropause033.com/health → HTTP 530 (Cloudflare origin down) on 2026-09-12; local source backend healthy
- DEVICE = FAIL (SECURITY) — registration/heartbeat/revoke measured live and revocation fails closed; but device identity is a client-minted UUID with no key material / proof of possession and no enrollment lifecycle
- PROVENANCE = BLOCKED (PROVENANCE) — A/B release identity NOT_ESTABLISHED; no CI attestation; local chain bound by digests
- APPLE = WAITING_FOR_OPERATOR_SECRET (DISTRIBUTION) — signed (Developer ID, Team J3G89MY3QG), hardened runtime, NOT notarized → spctl rejects; public host down
- WINDOWS = WAITING_FOR_OPERATOR_SECRET (DISTRIBUTION) — NSIS x64 built (exit 0); signingStatus=NOT CONFIGURED; WIN_CSC_* absent
- INSTALLATION = NOT_MEASURED (TECHNICAL) — no clean external machine available; fresh-profile launch of the packaged app on the build machine PASS (PACKAGE→LOAD→READY)
- UPDATE = NOT_MEASURED (TECHNICAL) — feed integrity, sha512 binding and refusal controls PASS (verifier + negative controls); a live old→new update transition was not exercised (no prior signed release)
- ROLLBACK = NOT_MEASURED (TECHNICAL) — AUTOMATIC_ROLLBACK = NOT_SUPPORTED by design (allowDowngrade=false, ordering fixed); manual/feed rollback documented, not exercised
- OBSERVABILITY = NOT_MEASURED (TECHNICAL) — /metrics endpoint and deploy/observability rules exist (DECLARED); mapper did not complete; gateway emits per-call audit lines (ids/tokens only)
- SUPPORT = FAIL (TECHNICAL) — no verified support/security/privacy mailbox; mailer undeliverable; no data export/deletion
- PRIVACY = FAIL (TECHNICAL) — no account-deletion or data-export path; privacy policy not legal-reviewed; inventory recorded
- INTENDED_USE = WAITING_FOR_HUMAN (REGULATORY) — GATE-INTENDED-USE NOT_ESTABLISHED (form MODE A, all fields blank)
- REGULATORY_REVIEW = WAITING_FOR_HUMAN (REGULATORY) — qualified reviewer determinations absent for US/EU/India
- HUMAN_RELEASE_AUTHORITY = WAITING_FOR_HUMAN (HUMAN) — no PUBLIC_RELEASE_AUTHORIZATION record; machine must not create one

OPERATOR INPUT REQUIRED:

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

MACHINE-CLOSABLE REMAINING:
- clean-machine macOS/Windows installation runs once notarized/signed artifacts exist
- live update transition (previous signed release → this release) and feed rollback exercise on the host
- backend integration suite (Postgres+Redis) execution and tenant-isolation measurement
- observability/incident mapper completion (session limit) — /metrics, alert thresholds, failure matrix
- renderer prompt-injection regression on the legacy assistant lanes; AssistantAsk authority gating
- backend HumanDecision shape (authority_basis, policy_version, signature, expiry) and DB invariants
- Computer-A observer/verification object + evidence transport (design → code) once a verifier is designated
- CI run of the pinned macos-15 signing path (requires push)

EVIDENCE REFERENCES:
- certification/public-launch-002/00..32 (this namespace) · certification/public-launch/00..39 · certification/NP-MAC-PUBLIC-DISTRIBUTION-CLOSURE/00..36
- certification/public-launch/evidence/* (verification JSON, smoke screenshot, journey, loop, execution register)
- certification/public-launch/discovery/* (11 mapper reports, npm audit)
- verify: npm run neuropause:public-launch:verify
