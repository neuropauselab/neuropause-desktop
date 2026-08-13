# NeuroPause Mobile — Phase M1 Execution Plan

**Executive Companion Platform · plan of record (2026-08-07) · authored from Stage A repository recon — every load-bearing claim below was verified against source with file:line evidence before this plan was written.**

Decisions taken by the founder before this plan: **client stack = React Native + Expo + TypeScript** (Expo only where it does not limit enterprise requirements; dev builds / native modules where Face ID, secure storage, push, pinning, or background sync demand them; architecture modular so native Swift/Kotlin components can be introduced later), and **connectivity = LAN pairing, relay-ready**. The desktop remains the source of truth; mobile is a companion — visibility, approvals, intelligence, notifications, quick actions. No ERP tables, no complex forms, no duplicated business logic.

---

## 1. What Stage A recon established (the facts this plan stands on)

1. **All enterprise data lives in the desktop main process.** The backend (`apps/backend`) serves identity, store catalog, orgs, devices, billing/license, opaque sync, semantic search — zero business-domain endpoints. A phone must talk to the desktop.
2. **The desktop already has a complete REST semantic layer with no transport under it**: 27 routes with per-route scopes, Zod-derived OpenAPI, cursor pagination (`main/api/routeRegistry.ts`), dispatched only over IPC today. The sanctioned non-IPC front door exists: `runSecureHandler` (`main/ipc/secureBridge.ts:143`) — auth → RBAC → Zod → timeout — already used by the REST gateway and the AI-sandbox runner. It does **not** write the bridge audit line; a gateway must append its own.
3. **Exactly two sockets exist in the whole codebase** (backend `:4000`, OAuth loopback). No WS/SSE server, no mDNS, no QR, no pairing, no TLS machinery, no cert generation anywhere. The Companion Gateway is genuinely new — but it mounts on proven seams.
4. **Permission evaluation is pure and separable** (`enterprise/authz.ts` — `requirePermission(member, roles, permission)`), but the ambient principal is the signed-in desktop user (`authzGate.ts createAuthorize` closes over `sessionEmail()`). M1 therefore pairs the phone **to the desktop owner's identity** (same human, same RBAC, same audit actor, with companion-device attribution appended). Multi-user remote principals are M2 machinery the pure layer already supports.
5. **Approve/reject is the module action path** (`moduleRegistry.ts:353-372`): RBAC write scope → action key must be declared in the descriptor → record loaded → `hooks.runAction`. Nine-plus modules carry real approval flows (PR/PO with budget + vendor-contract gates that refuse dangling references, leave, expense-claim with GL accrual on approve, vendor bills, executive decisions requiring reason strings, schedule proposals, transfer orders, candidates). The companion exposes **only declared actions** — it invents nothing (notably: sales quotes have approval statuses but no approve action; quote approval stays on desktop until the module itself grows the action).
6. **Realtime has a clean seam**: every ERP mutation publishes `enterprise.record.*` on the platform bus with actor/resource/status; `platform.api.on(types, handler)` is the subscription API the notification system itself uses. Only `download.progress` is ephemeral.
7. **The executive KPI aggregator exists** (`composeExecutiveSnapshot`, exec center) for CRM/Sales/Finance-invoices/Inventory/Procurement/Warehouse/Manufacturing/Maintenance + governance. HR/Projects/Helpdesk/Documents/treasury snapshots and any ERP-aware daily briefing are **absent in main** — the briefing generator is connector-data-blind to the 104 modules. M1 builds the missing composers as pure, tested functions.
8. **`packages/shared` is 100% Hermes-portable** (zero `node:*`/Electron/DOM imports across 210 files; only dep is Zod). It ships raw TS (`main`/`exports` → `src/index.ts`) — Metro must alias + transform it, mirroring what every existing consumer does. `familyDashboardModel` (Phase 7.2 dashboards) was renderer-local but pure — **lifted into shared in M1-01** so renderer, gateway, and phone derive dashboards from one implementation. Number formatting via `toLocaleString` can differ slightly under Hermes-without-ICU; KPI strings are formatted desktop-side in view-models wherever exactness matters.
9. **Workspace mechanics**: `apps/*` auto-adopts `apps/mobile`; the release gate is an explicit 5-workspace allowlist (mobile stays OUT, exactly like the 39 dormant packages); root `lint`/`format` sweep mobile unconditionally, so mobile code must pass the house ESLint 8 config from day one; no CI workflow picks mobile up automatically.
10. **`serviceManager` has no register API** — the gateway joins the hardcoded service array (`services/serviceManager.ts:104-112`), starting after all handlers are registered, which is exactly when the app is fully wired.

## 2. Architecture

### 2.1 Companion protocol — end-to-end sealed envelopes (this is what makes it relay-ready)

A new pure-TS workspace **`packages/companion-protocol`** (in the release gate, fully vitest-tested, Hermes-portable) defines the security layer both ends share:

- **Identity**: desktop and phone each hold a static X25519 keypair. Desktop's private key lives in the OS-keychain-backed vault (`safeStorage` pattern already in `secureStore.ts`); the phone's in `expo-secure-store` (Keychain/StrongBox).
- **Pairing (TOFU via QR, out-of-band)**: desktop Settings shows a QR = `{host, port, desktopPublicKey, oneTimePairingToken (5-min TTL, single use, constant-time compared), desktopName, orgName, protocolVersion}`. The phone scans it, sends its public key + device info sealed to the desktop key with the token; the desktop registers the device (name, platform, public key, bound member, createdAt/lastSeenAt, revocable) in an **envelope-backed `companionDeviceStore`** (auto-backup via the Phase 8 store registry) and returns the sealed device credential.
- **Transport security**: every request/response and WS frame is an **XChaCha20-Poly1305 sealed envelope over X25519 ECDH** (@noble/curves + @noble/ciphers — pure JS, audited, runs identically in Node and Hermes), with monotonic counters + timestamp window for replay protection. The HTTP/WS underneath carries only ciphertext and the device id.
- **Why not TLS + certificate pinning**: RN cannot trust a self-signed LAN cert without per-platform native trust surgery, and a TLS-terminating M2 relay would become a trusted middlebox. Pinned static identity keys + E2E sealing are *stronger* than cert pinning (the requirement's intent), work in Expo Go on day one, and make the M2 relay a zero-trust ciphertext forwarder — the "relay-ready" property is a consequence of the crypto design, not a promise.

### 2.2 Desktop Companion Gateway (main process)

New subsystem `main/companion/`, instantiated in `runtimeCore.ts` immediately after `initEnterpriseApi` (the proven slot where every needed handle exists: module registry, authorize, platform bus, timeline, search, exec center, assistant handlers, notifications, briefing). A `node:http` + WS server (LAN bind, off by default, started/stopped from Settings and via the service manager). Request path: unseal → device lookup (revoked ⇒ refuse) → **desktop must be signed in** (companion refuses while `sessionEmail()` is null) → dispatch to a small phone-shaped route table → seal response. Every privileged call goes through the same RBAC gate as IPC, is bridge-audited with `via: companion:<deviceId>`, and governance-audited where module writes occur. Rate limiting per device; payload caps; no route exposes raw bulk CRUD — the phone gets **view-models** (KPIs, dashboard data, approval items, timeline pages, briefing), which is both the premium-UX shape and the never-fork-logic shape.

### 2.3 Mobile app (`apps/mobile`)

Expo + TypeScript, expo-router, strict house tsconfig extending `tsconfig.base.json`, Metro monorepo config for raw-TS `@neuropause/shared` + `@neuropause/companion-protocol`. State: React Context + reducers (the desktop's own pattern) over a typed sealed-channel client with a small query cache. Charts are hand-rolled SVG (react-native-svg) on the validated Phase 7 dark palette — no DOM chart library. Face ID/Touch ID gate (expo-local-authentication), keypair + cached snapshots encrypted at rest, QR pairing via expo-camera. Screens (V1, nothing else): Home/Today, AI Briefing, Approvals, Notifications, Enterprise Dashboard, Timeline, AI Chat, Search, Profile/Settings. Runs in **Expo Go for the whole M1 development loop** (all M1 dependencies are Go-compatible); an EAS dev build is only needed when we adopt modules Go lacks — remote push being the known one.

## 3. Honest boundaries (stated up front, restated in user docs)

- The phone works when the desktop app is **running, signed in, and reachable** (same network or user-provided VPN such as Tailscale). Away-from-network access is M2 (relay). Offline, the app shows its last-synced snapshots with explicit staleness labels — never stale data dressed as live.
- **Remote push notifications (APNs/FCM) are human-gated** (Apple/Google/Expo push credentials). M1 ships realtime WS updates + local notifications while the app runs; the gap is documented, not papered over.
- Approval scopes are the modules' real scopes (approving leave requires `operations:manage`, etc.); the companion inherits, and documents, that coarseness. Executive decisions keep their reason-string requirements and `executive:*` scope splits.
- Enterprise search on the phone = the existing enterprise search (UDM/graph/memory/timeline) plus per-module record search fan-out with declared limits — record bodies are not globally indexed today and M1 does not pretend otherwise.
- No fake data anywhere: every widget renders real gateway data or an honest empty state (the Phase 7 rule, inherited).

## 4. Increments (each: cloud author + typecheck/lint smoke → bridge delivery → Mac full gates `typecheck:release && lint:release && test:release` → user commit + push → verify)

| # | Increment | Proof at the gate |
|---|---|---|
| M1-01 | Lift `familyDashboardModel` → `packages/shared` (pure move; test stays in desktop gate) + this plan | Desktop suite green; zero behavior change |
| M1-02 | `packages/companion-protocol`: envelopes, pairing schemas, replay guard, versioning | New vitest suite; joins release gate |
| M1-03 | Gateway core: identity vault, device store (envelope-backed), HTTP+WS sealed server, pairing, Settings UI (enable/QR/devices/revoke), audit, channel classification | Store/gateway/pairing tests; authz self-test stays green |
| M1-04 | Read endpoints: exec snapshot, family dashboards (shared model), approvals inbox aggregator | Aggregator tests over the 9 approval modules' real descriptors |
| M1-05 | Write path: approve/reject/comment via declared module actions; gate refusals surfaced | Action-path tests incl. budget/contract refusal passthrough |
| M1-06 | Timeline page, search fan-out, notifications drain, WS realtime with replay-on-reconnect | Subscription + cursor tests |
| M1-07 | ERP-aware briefing composer (morning/evening; approvals + KPIs + existing briefing) | Pure composer tests |
| M1-08 | `apps/mobile` scaffold: Expo app, Metro monorepo config, tokens, pairing flow, Face ID gate, sealed client | Cloud typecheck/lint; **first on-device pairing via Expo Go** |
| M1-09 | Home + Enterprise Dashboard screens (SVG charts, live data) | On-device verification against real desktop data |
| M1-10 | Approval Center screens + act flows | On-device approve/reject round-trip visible in desktop audit |
| M1-11 | AI Chat, Search, Timeline screens | On-device |
| M1-12 | Notifications screen, live updates, encrypted offline cache + staleness labels | On-device incl. airplane-mode check |
| M1-13 | Profile/Settings, pairing + security docs, M1 completion report | Full-repo gates; report with per-increment evidence |

**New dependencies (declared here, adopted in their increments):** desktop/protocol — `@noble/curves`, `@noble/ciphers`, `@noble/hashes`, `ws` (server), a zero-dep QR encoder for the pairing screen; mobile — Expo SDK stack, `react-native-svg`, `expo-secure-store`, `expo-local-authentication`, `expo-camera`. Nothing else without being recorded here first.

**Out of scope for M1 (named, not implied):** cloud relay, remote push delivery, multi-user device binding, module CRUD/forms on the phone, offline writes, Windows/web clients, App Store / Play submission (EAS build + store metadata are M2 release engineering).
