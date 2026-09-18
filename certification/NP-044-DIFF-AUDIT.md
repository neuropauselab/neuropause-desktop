# NP-044 DIFF AUDIT

Base: `7a0fb3aa` (tree `06e2269a`) · Date: 18/09/2026 · Auditor: Computer-A

Scope: the complete NP-042/NP-043/NP-044 working-tree change set (21 modified,
13 new files). `git diff --check` clean. Credential/private-key sweep:
NOT_DETECTED. gitleaks 8.24.3: working tree = no leaks; full history (1,261
commits) = no leaks.

## Modified files

| FILE | PURPOSE | SECURITY IMPACT | TEST EVIDENCE | UNRELATED CHANGE? |
|---|---|---|---|---|
| apps/backend/src/config/env.ts | TRUST_PROXY, REVOCATION_FAIL_MODE, SUPPORT/SECURITY/PRIVACY_EMAIL config | Constrained proxy trust; explicit fail-mode; no secrets | rateLimit.test.ts, requireAuth.test.ts | No |
| apps/backend/src/app.ts | trust proxy set; /support/contact; /auth export+deletion mounted behind requireAuth | Per-client rate-limit keying; authenticated data endpoints | rateLimit.test.ts | No |
| apps/backend/src/auth/jwt.ts | Access-token revocation: local deny cache + Redis deny list + 3-state check | Revocable 15-min tokens; fail-closed cross-process semantics | jwt.test.ts (7) | No |
| apps/backend/src/auth/requireAuth.ts | Revocation check on every protected request; deterministic 503 when authority unavailable | Closes unrevocable-token FAIL; DECISION-4 fail-closed | requireAuth.test.ts (5) | No |
| apps/backend/src/auth/router.ts | Logout revokes access token too | Immediate token invalidation at logout | jwt.test.ts | No |
| apps/backend/src/auth/accountRouter.ts | GET /auth/export, POST /auth/delete-account, /auth/confirm-delete-account | GDPR export/deletion paths, authenticated | accountManagement.test.ts (6) | No |
| apps/backend/src/users/service.ts | OAuth auto-link by email REMOVED | Account-takeover fix | users/service.test.ts (4) | No |
| apps/backend/src/devices/types.ts | publicKey on Device/RegisterDeviceInput | PoP data model | devices tests | No |
| apps/backend/src/devices/schemas.ts | publicKey+challenge fields on registration; dead heartbeat fields removed | PoP enforcement surface; no fictional verification fields | challenge.test.ts | No |
| apps/backend/src/devices/router.ts | /devices/challenge endpoint; signature + enrolled-key verification | PoP + enrolled-key binding (§4); mismatch = 403 | challenge.test.ts (14) | No |
| apps/backend/src/devices/repository.ts | public_key persisted; COALESCE never overwrites enrolled key | Storage-layer key-binding invariant | integration (schema), memory-repo parity | No |
| apps/backend/src/devices/memoryRepository.ts | Same key semantics as pg repo | Test-repo parity | service.test.ts | No |
| apps/backend/src/devices/service.test.ts | +publicKey in fixture (1 line) | — | 10/10 pass | No (verified byte-level) |
| apps/backend/src/runtime/backendRuntime.test.ts | +publicKey in fixture (1 line) | — | pass | No (verified byte-level) |
| apps/backend/src/middleware/rateLimit.test.ts | +2 trust-proxy keying tests | Evidence for TRUST_PROXY | 10/10 pass | No |
| apps/backend/src/auth/jwt.test.ts | 3-state revocation matrix | Evidence for DECISION-4 | 7/7 pass | No |
| apps/backend/vitest.config.ts | REVOCATION_FAIL_MODE='open' for infra-free unit run (documented) | Explicit availability-first opt-in, test-env only | closed path covered by requireAuth.test.ts | No |
| apps/desktop/src/main/ipc/runtimeAuthz.ts | AssistantAsk/Cancel gated workspace:read | Closes public billable-IPC FAIL | channelStoreCoverageGate 4/4 | No |
| apps/desktop/src/main/assistant/index.ts | declareChannelResource for assistant:ask | Store-reach declaration for the newly gated channel | coverage gate | No |
| apps/desktop/src/main/tenancy/channelStoreCoverageGate.test.ts | Baselines 198→200, 6→7 with named justification | Ratchet moved deliberately, not silently | 4/4 pass | No |
| apps/desktop/electron-builder.yml | win.forceCodeSigning=true; false "repo private" comment corrected; publisherName operator note | Unsigned Windows artifact cannot be packaged | release workflow fails closed already; builder-level now too | No |
| SUPPORT.md | Support/security/privacy addresses + /support/contact | Vulnerability-report path exists on paper; mailboxes = operator item | — | No |

## New files

| FILE | PURPOSE | SECURITY IMPACT | TEST EVIDENCE | UNRELATED? |
|---|---|---|---|---|
| .github/workflows/security-ci.yml | SAST (CodeQL) + secret scan (gitleaks) + DAST (ZAP) | CI security controls; all actions SHA-pinned; least-privilege | verify:workflow-perms + check-workflows pass; execution pending push | No |
| .gitleaks.toml | Secret-scan config, exact-value allowlist only | No blanket test-path exclusions; 23 values triaged | local scans: no leaks (tree + history) | No |
| .zap/rules.tsv | DAST rules, per-rule justification | 2 FAILs map to helmet guarantees | execution pending push | No |
| apps/backend/src/devices/challenge.ts | Ed25519 PoP: issue/consume (atomic Lua)/verify + enrollment decision | Device identity core | challenge.test.ts 14/14 | No |
| apps/backend/src/devices/challenge.test.ts | PoP test matrix incl. replay-by-race, wrong key, key binding | Evidence | 14/14 | No |
| apps/backend/src/auth/accountManagement.ts | Export + two-step deletion | GDPR paths; no secrets in export | accountManagement.test.ts 6/6 | No |
| apps/backend/src/auth/accountManagement.test.ts | Export/deletion authorization matrix | Evidence | 6/6 | No |
| apps/backend/src/auth/requireAuth.test.ts | Fail-closed middleware matrix | Evidence for DECISION-4 | 5/5 | No |
| apps/backend/src/users/service.test.ts | OAuth anti-takeover tests | Evidence | 4/4 | No |
| apps/backend/src/db/migrations/0014_device_identity.sql | devices.public_key column | PoP persistence | migration applied in integration env | No |
| apps/backend/src/db/migrations/0015_account_deletion.sql | account_deletion_requests table | Deletion lifecycle persistence | accountManagement tests | No |
| release-policy/update-feed-policy.md | UNSIGNED → CANNOT ENTER FEED; current violation recorded | Update-channel governance | — | No |
| website/privacy.html | Privacy policy draft | LEGAL_REVIEW = AWAITING HUMAN | factual audit vs code done (NP-043 §15) | No |

## Verdict

UNRELATED CHANGES: **none found**. Every hunk serves a named NP-042/043/044
requirement. The change set is fit for the single governed commit authorized by
NP-RELEASE-044 DECISION-1.
