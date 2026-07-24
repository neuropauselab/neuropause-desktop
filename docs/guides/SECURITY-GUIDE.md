# NeuroPause Enterprise — Security Guide

> **Audience:** Enterprise security reviewers, IT administrators, and platform operators evaluating or deploying NeuroPause Enterprise.
> **Scope:** This guide documents the security posture that is **actually implemented in the shipping source tree**. Every control below is cited to `file:line`. Known gaps are documented honestly in [Security Considerations & Hardening Backlog](#security-considerations--hardening-backlog) — the platform does not claim protections it lacks.
> **Last reviewed:** 2026-07-18 (Enterprise GA)

---

## Overview

NeuroPause Enterprise is a desktop-first platform: an **Electron desktop application** (`apps/desktop`) that holds the user's data and runs privileged operations locally, paired with a **stateless backend API** (`apps/backend`) that provides authentication, licensing, billing, sync, and semantic-memory services. A shared package (`packages/shared`) defines the typed contracts — IPC channels, permission scopes, and data shapes — used by both.

The security design rests on a small number of load-bearing ideas:

1. **The renderer is untrusted.** The browser layer performs no network I/O and holds no secrets; every privileged action crosses a single, typed, fail-closed IPC boundary into the main process.
2. **Fail closed, not open.** Privileged IPC channels that are not explicitly classified refuse to boot the app. Unsigned worker packages are rejected. Encryption-unavailable states refuse to persist secrets rather than fall back to plaintext.
3. **Least privilege via RBAC.** A 57-scope enterprise permission model gates privileged channels; the single-user owner holds all scopes, so the model only "bites" for multi-user enterprise installs.
4. **Secrets live in the OS keychain.** Long-lived tokens are encrypted at rest with Electron `safeStorage` (macOS Keychain / platform equivalents) and never exposed to the renderer.

This guide walks each layer, then documents the gaps we know about.

---

## Threat Model

**Assets we protect**

- Long-lived OAuth refresh tokens and connector access tokens (highest-value at-rest secret).
- The user's connected-source data and AI memory corpus.
- Developer API keys / OAuth client secrets.
- The integrity of installed executable extensions (plugins, catalog apps, worker packages).

**Adversaries and entry points we design against**

- **A compromised or malicious renderer / injected web content.** Mitigated by context isolation, a sandboxed renderer, a strict CSP, navigation lockdown, and a channel-allowlisted preload bridge — the renderer can only speak a fixed set of typed channels (`apps/desktop/src/preload/index.ts:15-34`).
- **A malicious IPC caller** (e.g. a foreign frame). Mitigated by sender-trust checks on every channel plus the fail-closed authorization pipeline (`apps/desktop/src/main/ipc/secureBridge.ts:93-150`).
- **A lower-privileged enterprise user** attempting privileged actions. Mitigated by RBAC scope enforcement (`apps/desktop/src/main/enterprise/authz.ts`).
- **A network attacker** against the backend, or **SSRF** via user-supplied webhook URLs. Mitigated by helmet, loopback-only CORS, rate limiting, and an SSRF egress guard (`apps/desktop/src/main/webhooks/urlGuard.ts`).
- **A forged inbound webhook.** Mitigated by per-provider HMAC verification with timing-safe comparison (`apps/desktop/src/main/connectors/inbound/verify.ts`).
- **Supply-chain tampering** of extensions. Mitigated by Ed25519 signing + static scanning for first-party/worker artifacts (fail-closed for worker packages).

**Explicitly out of scope / residual** (see the backlog for detail): DNS-rebinding across the SSRF check window and tampering (as opposed to corruption) of the AI-memory hash chain. *(Forged Apple `id_token`s were previously listed here and are now mitigated — the `id_token` is signature-verified against Apple's JWKS; see backlog item 1, RESOLVED.)* These are documented, not hidden.

---

## Application Security

### Electron process hardening

The main BrowserWindow is created with hardened `webPreferences` (`apps/desktop/src/main/window.ts:31-38`):

- `contextIsolation: true` (`:33`) — renderer and preload run in separate JS worlds.
- `nodeIntegration: false` (`:34`) — no Node.js in the renderer.
- `sandbox: true` (`:35`) — the renderer runs in an OS-level sandbox.
- `webSecurity: true` (`:36`) — same-origin policy enforced.

**Navigation is locked to our own content.** New-window requests are denied outright, with `http(s)` links handed to the system browser (`apps/desktop/src/main/window.ts:50-55`), and in-app navigation away from `file://` (or the dev server) is prevented (`:58-64`). This denies the classic "renderer navigates itself to attacker content" pivot.

**Content-Security-Policy.** A CSP header is attached to every response in the default session (`apps/desktop/src/main/security/csp.ts:39-49`). The packaged (production) policy is strict (`:12-36`): `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`, and `frame-ancestors 'none'`. The development build relaxes `script-src`/`connect-src` only enough for Vite HMR (`:13-20`); the strict policy is what ships.

**The preload bridge is the entire renderer-reachable surface.** It exposes exactly two functions — a guarded `invoke` and a guarded `subscribe` — each checked against the shared channel allowlists, so the renderer can never reach an unintended channel and no Node/Electron internals leak (`apps/desktop/src/preload/index.ts:15-34`).

### The fail-closed IPC pipeline

Every runtime/registry/NPS/catalog call passes through one middleware pipeline (`apps/desktop/src/main/ipc/secureBridge.ts`). The transport-neutral core, `runSecureHandler` (`:93-117`), enforces in order:

1. **Auth gate** — channels marked `requireAuth` require an authenticated user (`:98-100`).
2. **Permission (RBAC)** — a channel declaring a `permission` calls the injected `authorize`, which throws if the actor lacks the scope; if the authorize dependency is absent, the channel **fails closed** (`:101-106`).
3. **Zod validation** — the raw payload is parsed against the channel's schema before any handler runs (`:107-111`).
4. **Bounded execution (timeout)** — handlers are wrapped so a hung backend cannot wedge IPC (`:112-116`, default 30 s at `:26`).

The IPC-facing wrapper `registerSecureHandlers` (`:119-150`) adds **sender-trust** (rejects any frame that is not our own renderer, `:124-126`) and **audit** (structured per-call record: channel, ok/fail, duration, `:129-142`). Errors are shaped to clean, non-leaking messages (`:143-145`).

**Sender trust** is defined once and shared by both IPC front doors (`apps/desktop/src/main/ipc/router.ts:88-98`): a frame is trusted only if it loads from `file://` (packaged) or a registered dev origin. The legacy router additionally re-validates the Zod schema on every call (`:105-113`).

**Runtime authorization is enforced by construction.** A whole class of privileged base/core channels (execute, plugin lifecycle, permission grants, automation/runtime/memory mutations, migration/backup/recovery, billing, device registration, etc.) is mapped to the existing enterprise permission it requires in a single source of truth (`apps/desktop/src/main/ipc/runtimeAuthz.ts:47-168`). The `withRuntimeAuthz` annotator **throws at composition time** for any channel handed to it without a classification (`:177-190`), so a privileged channel can never be shipped silently unguarded. Genuinely-public channels live on a vetted allowlist (`PUBLIC_CHANNELS`, `:213-335`).

**A startup invariant makes this fail-closed at boot.** After every handler def is assembled, the composition root collects the channels that ended up gated (carrying `permission` and/or `requireAuth`) and requires every remaining invokable channel to be on the public allowlist. If any channel is neither gated nor allowlisted, the app **refuses to start** with a loud error (`apps/desktop/src/main/runtimeCore.ts:1647-1659`; the invariant helper `assertAllChannelsClassified` is at `apps/desktop/src/main/ipc/runtimeAuthz.ts:347-355`). A channel riding on sender-trust alone cannot reach production.

### Role-Based Access Control (RBAC)

The enterprise permission model defines **57 coarse-grained, least-privilege scopes** as a closed union type (`packages/shared/src/types/enterprise.ts:72-142`), spanning org/people/workspace/workforce/marketplace/governance/operations, the industry verticals (CRM, sales, inventory, procurement, warehouse, manufacturing, maintenance), and the platform layers (federation, cloud, developer, intelligence, etc.).

Enforcement is a set of pure resolver functions over the org model (`apps/desktop/src/main/enterprise/authz.ts`):

- `effectivePermissions` computes the union of permissions across a member's roles — **but only for `active` members**; `invited` and `suspended` members hold no permissions regardless of their roles (`:36-48`, gate at `:41`).
- `requirePermission` throws an `AuthorizationError` when a member lacks a scope (`:80-86`); `can` / `canAny` / `canAll` are the non-throwing predicates (`:50-77`).

As the runtime-authz module notes, the owner role holds every permission, so single-user installs are unaffected; the RBAC gate is meaningful for multi-user enterprise tenants.

---

## Authentication

### OAuth 2.0 with PKCE (S256) + RFC 8252 loopback

Desktop sign-in uses the OAuth Authorization Code flow with **PKCE, method `S256` only**. The backend's start endpoint accepts only `code_challenge_method: 'S256'` — a literal-typed Zod field rejects anything else (`apps/backend/src/auth/router.ts:54-59`) — and only **loopback** redirect targets (`http://127.0.0.1` or `http://localhost`) are accepted from the desktop client (`:42-52`, enforced at `:83-85`). At token exchange the backend recomputes the SHA-256/base64url challenge from the presented verifier and rejects any mismatch (`:158`). The PKCE primitives (`createPkcePair`, `sha256Base64url`) live in `apps/backend/src/auth/pkce.ts:8-16`.

On the desktop, the redirect is caught by an **ephemeral loopback HTTP server per RFC 8252** (`apps/desktop/src/main/auth/loopbackServer.ts`): it binds `127.0.0.1` on an OS-assigned random port, listens on an **unguessable random callback path** (`randomBytes(16)`, `:55`), accepts exactly one callback, and shuts down (`:50-127`). This avoids a fixed, guessable local redirect endpoint.

**Provider identity resolution.** Google, Microsoft, and GitHub resolve the user's identity from the **authenticated resource server** using the access token — Google's `userinfo` endpoint with a `Bearer` token and an `email_verified` check (`apps/backend/src/auth/providers/google.ts:46-64`), Microsoft Graph `/me` (`apps/backend/src/auth/providers/microsoft.ts:9,46`), and the GitHub `/user` + `/user/emails` APIs (`apps/backend/src/auth/providers/github.ts:6-7,42`). (Apple is the exception — see the backlog.)

### JWT access tokens — algorithm-pinned HS256

Access tokens are signed HS256 and, critically, **verified with the algorithm pinned** (`algorithms: ['HS256']`) along with issuer and audience checks (`apps/backend/src/auth/jwt.ts:25-33`; signing at `:14-23`). Pinning the accepted algorithm on verification closes the classic JWT algorithm-confusion / `alg: none` downgrade attack.

### Refresh-token rotation with reuse detection

Refresh tokens are **stored only as SHA-256 hashes**, never in plaintext (`apps/backend/src/auth/session.ts:28`; `hashToken` at `apps/backend/src/auth/pkce.ts:27-29`). On refresh, `rotateTokens` (`apps/backend/src/auth/session.ts:50-102`) issues a new pair and links old→new inside a `FOR UPDATE` transaction. If a token that has already been rotated or revoked is presented again — the signature of a stolen token — it treats this as possible theft and **revokes the entire session chain for that user** (`:66-74`). Expired tokens are rejected (`:76-78`).

### Passwords — Argon2id

Email/password credentials are hashed with **Argon2id** at interactive parameters (memoryCost 19,456 KiB, timeCost 2, parallelism 1) via `@node-rs/argon2` (`apps/backend/src/auth/passwords.ts:1-16`). Verification is exception-safe (returns `false` rather than throwing on a malformed digest). Login and registration endpoints are additionally rate-limited (`apps/backend/src/auth/router.ts:172,186`).

---

## Secrets & Encryption

### OS-keychain-backed secret storage

The single most sensitive value the desktop holds at rest — the long-lived refresh token — is encrypted with Electron `safeStorage`, which is backed by the OS keychain (macOS Keychain, and platform equivalents) (`apps/desktop/src/main/security/secureStore.ts`). Only ciphertext is written to disk. If OS encryption is unavailable, the store **refuses to persist rather than fall back to plaintext** (`:64-68`); the on-disk file is written with mode `0o600` and replaced atomically (`:37-41`).

### The connector vault

Connector OAuth tokens (potentially many connectors × many accounts) are held in a per-account encrypted vault with the same discipline (`apps/desktop/src/main/connectors/connectorVault.ts`): each account's token bundle is `safeStorage`-encrypted, the file holds nothing but ciphertext, and encryption-unavailable **refuses to write plaintext** (`:78-81`). Tokens never leave the main process and are never exposed over IPC (`:10`). A key-rotation hook (`reencryptAll`) re-encrypts every entry in place under the current OS key, writing no plaintext (`:120-143`).

### Developer keys and OAuth client secrets

Developer API keys and OAuth client secrets are high-entropy tokens; **only their SHA-256 hash is persisted**, and the clear secret is returned exactly once at creation (`apps/desktop/src/main/ecosystem/developer/developerStore.ts:1-5,50-52`). Keys are created with a non-secret prefix + last-4 for display (`:172-194`), verified by hash lookup with revocation/expiry checks (`:220-233`), can be rotated (`:211-217`), and access tokens can be revoked by `jti` until natural expiry (`:284-301`). The persisted file is written `0o600` and atomically (`:113-115`). (SHA-256 without a slow KDF is appropriate here because these are high-entropy random tokens, not user-chosen passwords.)

---

## Network Security

### SSRF egress guard for webhooks

User-supplied webhook target URLs are validated by a pure classifier before the platform will ever POST to them (`apps/desktop/src/main/webhooks/urlGuard.ts`). `classifyWebhookUrl` (`:57-83`) accepts **only public HTTPS endpoints** and rejects:

- non-`https` schemes and embedded credentials (`:64-65`);
- `localhost` and internal-resolution suffixes such as `.local`, `.internal`, `.lan`, `.home.arpa` (`:20,70-72`);
- loopback / private / link-local / CGNAT / multicast IPv4 — including the **cloud-metadata address 169.254.169.254** (`:30-38`);
- private/loopback/link-local IPv6, including the `::ffff:` IPv4-mapped bypass (`:40-54`).

The guard is applied at registration (`assertSafeWebhookUrl`, `:86-89`) **and re-checked before every dispatch** (defense-in-depth against a host that later resolves internally). The documented residual is DNS-rebinding across the check window, mitigated — not eliminated — by the send-time recheck (`:1-12`).

### Inbound webhook authenticity — HMAC with timing-safe comparison

Inbound provider webhooks are authenticated before any action is taken (`apps/desktop/src/main/connectors/inbound/router.ts`). A connector with **no configured secret is rejected — the router never trusts an unsigned delivery** (`:77-79`), and any exception during verification **fails closed** to a rejection (`:84-88`). Per-provider verification (`apps/desktop/src/main/connectors/inbound/verify.ts`) uses HMAC-SHA256 over the raw body with **constant-time comparison** (`timingSafeEqual`, `:29-47`):

- GitHub / Notion: `sha256=<hex>` HMAC over the raw body (`:53-69`);
- Slack: `v0=` HMAC over `v0:<ts>:<body>` **with a 5-minute replay window** (`:75-91`);
- Microsoft Graph: constant-time `clientState` match (Graph carries no HMAC) (`:109-111`).

### Backend network hardening

The Express app applies `helmet()` security headers (`apps/backend/src/app.ts:51`) and restricts **CORS to loopback origins** (`127.0.0.1`/`localhost`), matching the desktop client's loopback + no-Origin-main-process model (`:45-50`). JSON and urlencoded bodies are size-capped (256 KB, `:62-63`), and the Razorpay billing webhook is verified against its raw body before JSON parsing (`:54-61`). Authentication endpoints are rate-limited (see below), and all org/devices/billing/license/sync/semantic routers sit behind `requireAuth` (`:127-169`).

---

## Supply-Chain Security

### Marketplace signing + static scan (Ed25519)

The marketplace publishing pipeline provides two security-critical, pure operations (`apps/desktop/src/main/ecosystem/marketplace/pipeline.ts`):

- **Static security scan** of a package manifest (`securityScan`, `:30-66`): flags dangerous permissions (`system:exec`, `fs:*:all`, `secrets:read`, `process:spawn`, …), network capability without declared domains, suspicious dependency references (`..`, absolute/`file:`/`http:`), and excessive permission counts, and grades the result pass/warn/fail.
- **Ed25519 signing** of a canonical, reproducible SHA-256 manifest digest (`signManifest`, `:89-93`; `verifyManifest`, `:96-105`). Verification pins `algorithm === 'ed25519'`, recomputes and matches the digest (defeating digest-swap), then verifies the signature.

### Worker-package install — fail closed

Worker packages are content-hashed (SHA-256 over the canonical manifest) and Ed25519-signed by a trusted publisher key, reusing the shared crypto primitives (`apps/desktop/src/main/workforce/install/packaging.ts`). `verifyWorkerPackage` (`:56-62`) requires **both** the checksum to match **and** the signature to verify against a **trusted** key — a valid checksum with an absent or untrusted signature is **rejected** (`:60`). Worker-package install is fail-closed by construction.

The Ed25519 trust store and verification primitive live in `apps/desktop/src/main/nps/signature.ts` (`verifySignature`, `:38-52`): a missing signature returns `no_signature` and an unregistered key returns `no_trusted_key`, both non-verifying.

> **Note:** The *catalog-app* install path is now fail-closed in packaged builds, matching the worker-package path (unsigned/untrusted/tampered artifacts are refused). See [Unsigned catalog-app install — RESOLVED](#3-unsigned-catalog-app-install--resolved-2026-07-24) in the backlog.

---

## Backend Security

Beyond the network hardening above, the backend applies:

- **Rate limiting** on sensitive auth flows — login, registration, and password-reset requests each have their own Redis-backed bucket (`apps/backend/src/app.ts:108-111`; `apps/backend/src/auth/router.ts:172,186`; limiter at `apps/backend/src/middleware/rateLimit.ts`). *(Fail-open behavior on a Redis outage is documented in the backlog.)*
- **Authenticated, role-checked resources** — organizations, devices, billing, licensing, sync, and semantic memory all require a valid access token and resolve the caller's active org membership/role before acting (`apps/backend/src/app.ts:122-169`).
- **Append-only audit log** — security-relevant auth events are written to an append-only `audit_log` table, and audit failures are logged-and-swallowed so they never break the request they describe (`apps/backend/src/middleware/audit.ts:9-26`). *(Not hash-chained — see backlog.)*
- **Separated liveness/readiness** — `/live` never touches dependencies (so a DB/Redis blip won't trigger container restarts), while `/health` checks them (`apps/backend/src/app.ts:84-96`).

**Deployment note (not a code defect):** `/metrics` exposes aggregate, non-sensitive Prometheus counters and is unauthenticated by design; the source explicitly recommends network-restricting it in production (`apps/backend/src/app.ts:98-103`). Operators should place it behind their ingress/network policy.

---

## Security Considerations & Hardening Backlog

The following are gaps verified in source. They are documented here in the interest of honest disclosure. **Items 1 and 3 were closed in the GA Execution Program (2026-07-24)** and are retained below marked ✅ RESOLVED with their fix and test evidence; the remainder are still-open, honestly-disclosed items.

### 1. Apple `id_token` signature verification — ✅ RESOLVED (2026-07-24)

**Previously:** For Sign in with Apple, the provider's `fetchProfile` called `jwt.decode` on the returned `id_token` and trusted its `sub`/`email` claims **without verifying the token signature against Apple's JWKS**, so a forged or altered `id_token` presented through this path would be trusted. (Always Apple-specific — Google, Microsoft, and GitHub resolve identity from the *authenticated* userinfo/Graph/API resource server and were never affected.)

**Now:** `fetchProfile` calls `verifyAppleIdToken`, which verifies the `id_token` signature against Apple's JWKS (`https://appleid.apple.com/auth/keys`, via jose `createRemoteJWKSet`) and enforces issuer (`https://appleid.apple.com`), audience (the Services ID / `APPLE_CLIENT_ID`), expiry, and an `algorithms: ['RS256']` pin, throwing before any claim is trusted (`apps/backend/src/auth/providers/apple.ts:50-70,125-137`). The `jwt.decode` path and the `HARDENING TODO` are removed. **Evidence:** `apps/backend/src/auth/providers/apple.test.ts` — 8 tests: accepts a valid token; rejects forged-signature, wrong-audience, wrong-issuer, expired, missing-subject, and non-RS256 (algorithm-confusion) tokens; reports `email_verified` honestly.

### 2. Auth rate-limiting fails **open** on a Redis outage

The rate limiter is a Redis-backed fixed-window counter; if Redis is unreachable, it **fails open** and allows the request (`apps/backend/src/middleware/rateLimit.ts:32-39`, comment at `:37`). This is a deliberate availability trade-off (an outage never locks all users out) but means brute-force / abuse protection on login, registration, and password-reset is disabled during a Redis outage.

- **Recommended mitigation:** Add a local in-process fallback limiter, monitor/alert on Redis availability, and consider fail-closed behavior for the most sensitive buckets (e.g. password reset).

### 3. Unsigned catalog-app install — ✅ RESOLVED (2026-07-24)

**Previously:** Unlike worker-package install (fail-closed), the **catalog/marketplace-app** install path only rejected a package when a signature was present *and* failed to verify (`if (artifact.signature && !sig.verified)`). An **unsigned** artifact skipped signature verification entirely and installed, and the Ed25519 trust store shipped empty — so signatures were not effectively required for catalog apps.

**Now:** the install path is **fail-closed** by policy. The gate is `if (!installAllowedForSignature(sig)) throw …` (`apps/desktop/src/main/nps/packageService.ts:187-193`), evaluated **before** the package is committed to the registry. `installAllowedForSignature` (`signature.ts:83-87`) permits install only when the signature verifies against a trusted key; an **unsigned** artifact is allowed **only** when the dev/demo policy explicitly permits it, and a **tampered** (`bad_signature`) or **untrusted-key** (`no_trusted_key`) artifact is **always** refused — even under the dev opt-in. Production wiring: `setAllowUnsignedInstalls(!app.isPackaged)` (`platform/index.ts:129`) makes packaged builds fail-closed while leaving the unsigned demo catalog usable in unpackaged dev. The module default is `false` (fail-closed) even if the setter never runs. SHA-256 download integrity is still enforced as before.

- **Scope:** catalog-app install now matches the fail-closed spirit of the worker-package path (which remains independently fail-closed at `workforce/install/packaging.ts:60`).
- **Evidence:** `apps/desktop/src/main/nps/signature.test.ts` — 5 tests: valid-signature install; unsigned refused by default; unsigned allowed only under the explicit dev opt-in; tampered always refused (even permissive); untrusted-key always refused.

### 4. AI-memory integrity chain uses a non-cryptographic hash (FNV-1a)

The shared memory-sync engine chains each memory version with a content hash, but that hash is a **two-seed FNV-1a fingerprint**, explicitly labeled "not a cryptographic guarantee" (`packages/shared/src/types/memorySync.ts:84,95-106`). `verifyHistoryIntegrity` (`:115-125`) uses it to detect that content matches its recorded hash and that chain links are consistent.

- **Impact:** This reliably detects **accidental corruption** but not **deliberate tampering** — FNV-1a is not collision-resistant, so an attacker who can write history could forge a colliding hash.
- **Recommended fix:** Replace FNV-1a with a cryptographic hash (e.g. SHA-256) for the content/chain hashes if the memory chain is to be relied on for tamper-evidence.

### 5. Audit logs are append-only but not hash-chained

Both the desktop IPC audit trail (`apps/desktop/src/main/ipc/secureBridge.ts:53-60`) and the backend `audit_log` (`apps/backend/src/middleware/audit.ts:9-26`) are append-only, but neither links each record to the previous one with a hash. An attacker with write access to the log store could delete or alter entries without detection.

- **Recommended fix:** Add a per-record hash chain (each entry commits to the previous entry's hash) and/or ship logs to append-only external storage (WORM / SIEM).

### 6. No on-disk log rotation

The desktop logger writes diagnostics to the console with no file sink or rotation (`apps/desktop/src/main/logger.ts`), and the desktop IPC audit trail is appended to a single `audit.log` file with no size cap or rotation (`apps/desktop/src/main/ipc/secureBridge.ts:49-60`). Long-lived installs can grow the audit file unbounded.

- **Recommended fix:** Add size/time-based rotation and retention for the on-disk audit log.

---

## Reporting a Vulnerability

We take the security of NeuroPause Enterprise seriously and welcome responsible disclosure.

**How to report**

- Email **security@neuropause.example** with a description of the issue, affected component/version, and reproduction steps or a proof-of-concept. If you can, encrypt sensitive details with our published PGP key.
- Please report privately and **do not** open a public issue, post details publicly, or share them with third parties until a fix has shipped and we have coordinated disclosure with you.

**What to include**

- The affected component (desktop app / backend / a specific connector or provider) and version or commit.
- Impact and, where relevant, the `file:line` or endpoint involved.
- Reproduction steps, PoC, and any preconditions (e.g. multi-user tenant, specific IdP, Redis outage).

**Our commitment**

- **Acknowledgement** within 3 business days.
- A **triage assessment and severity rating** within 10 business days.
- Regular status updates through remediation, and coordinated disclosure timing agreed with the reporter.
- Credit for the reporter in release notes where desired.

**Safe harbor**

Good-faith security research conducted in accordance with this policy — testing only against your own installation/tenant, avoiding privacy violations, data destruction, and service degradation, and not accessing or exfiltrating other users' data — will not be pursued or reported by us as a violation. If you are unsure whether an action is authorized, ask first at the address above.

**Scope note**

The items already listed in the [Hardening Backlog](#security-considerations--hardening-backlog) are known to us; reports that add materially new impact, a working exploit, or additional affected surface for those items are still welcome.
