# SLICE 15 — First real email · RUNBOOK (PREPARATION ONLY — human at keyboard)

**This is preparation. NOTHING in it has been executed.** No real credentials exist, no OAuth consent has been given,
no real send has occurred. Everything below is a plan for the human to execute at their own keyboard. ⛔ **The hard
stop is any real credential, any OAuth consent screen, or any real external send** — Claude prepares up to that line
and no further.

## Preconditions the real send inherits (already TEST-VERIFIED, Slice 14)

The governed loop is proven end-to-end against a mock Graph: NL turn → intent → proposal → human confirm → certified
executor (governedSend → CST → scopesOk → actor → admission) → outcome, with recipient literalism, trigger discipline,
and ambiguity all holding in the real app. S15 replaces the **mock** endpoint with the **real** Graph, once — and only
once — under human control. The e2e seed seam is NOT used for a real send (it is compile-stripped from release builds).

## 1 · Test tenant + consent

- Use a **dedicated Microsoft 365 test tenant** (not a production/organizational tenant). One test mailbox.
- Register an **Entra app** (client id + secret/redirect) with the **minimum** delegated scope for this action:
  `Mail.Send` (+ `User.Read`, `offline_access` for token refresh). No broader mailbox scopes.
- The human personally completes the **OAuth consent** in a browser (⛔ Claude does not enter credentials or click
  consent). Consent is recorded (tenant, app id, scopes, timestamp, who consented).

## 2 · Real-credential setup (human performs)

- Client id/secret live only in the human's environment / OS keychain via the existing `connectorVault` — never in
  source, never committed, never in a log. `.env.example` documents the variable names only.
- Connect the account through the **normal OAuth flow** (`connectorService.connect`) — NOT the e2e seed. This writes a
  real `ConnectedAccount` + real tokens to the vault, scoped to the active workspace.

## 3 · Recipient allowlist — the human's OWN address only (compiled in)

- The single permitted recipient is **`neuropause033@gmail.com`** (the operator's own address). This is a **compiled-in
  constant** checked in the send path, fail-closed: any recipient not exactly equal is DENIED before any Graph call.
- Rationale: the first real send can only reach the operator. It cannot email anyone else even if the AI proposed it or
  a bug slipped a different address through — the allowlist is the last deterministic gate before the wire.
- **LANDED (FG-4, `b0ac3c5`):** `firstRealSendGuard` is enforced BEFORE the executor in `connectors/index.ts`, via a
  compile-stripped, dynamically-imported hook (absent from release builds; `verify-e2e-strip` PASS). It covers ALL
  recipient fields: `to` must be exactly the operator address; ANY cc/bcc → DENIED; unparseable → DENIED (fail closed).
  It is inert unless `NEUROPAUSE_FIRST_REAL_SEND=1`. It never weakens the certified path — it only refuses.

## 4 · Single send, no retry storm — LATCH SEMANTICS (condition 4)

- **At most ONE send, by design.** The guard writes a durable `first-real-send.latch` (in userData) **BEFORE** the send.
  A second attempt — including any retry, and after a restart (the latch is a file) — is DENIED (`SINGLE_SEND_LATCH`).
- **A failed attempt CONSUMES the send.** Because the latch is written before the send, a send that fails still latches.
  Re-running requires **deliberately deleting** `first-real-send.latch`. This is intentional: no retry storm, ever.
- No automatic retry on UNKNOWN/timeout — a non-acknowledged result goes to a HOLD for manual reconciliation (S16/S22).

## 5 · Human confirmation (unchanged architecture)

- The **only** consent path is the existing one: proposal → human review in `M365WritePanel` → explicit **Confirm send**
  click. The human reads the exact recipient/subject/body before confirming. No second confirmation surface.
- The human — not Claude — clicks Confirm for the real send.

## 6 · Rollback / containment

- If anything is wrong pre-send: cancel in the panel (no effect), or `connectorService.disconnect` (drops tokens from
  the vault). Revoke the app's consent in the test tenant.
- Post-send: the recipient is the operator's own mailbox, so containment is inherent. Delete the app registration +
  revoke tokens to end the capability. No other mailbox can have been reached (allowlist).

## 7 · Evidence capture + vocabulary (conditions 5, 6, 7)

- **Capture (condition 5):** consent record (tenant/app/scopes/time), the proposal shown, the exact confirmed params,
  the executor outcome, the **exact UTC send time**, a **screen recording of the whole session** (consent → send), and
  a **screenshot of the received email in the destination inbox** (destination-side proof, ahead of S16).
- **Vocabulary — three SEPARATE outcomes, never a collapsed "SUCCESS" (condition 6):**
  - **AUTHORIZED** — governance passed (CST admitted; actor/scope/tenant OK).
  - **SUBMITTED** — Microsoft Graph returned 202 (accepted for delivery).
  - **EXTERNALLY OBSERVED** — an independent read-back saw the message (S16; or the manual inbox screenshot as interim).
  Describe the run as a **single real-send ATTEMPT**, not a "successful send" — the latch consumes the attempt even if
  it fails (condition 4). A real ACKNOWLEDGED is **LIVE-VERIFIED (Profile A — acknowledged)**, NOT `VERIFIED_SUCCESS`.
- **S16 read-back match criteria (design ahead; condition 7):** the oracle matches on **internetMessageId + recipient +
  subject/body fingerprint + timestamp window** — NEVER the id alone. This is recorded for S16 implementation.

## 8 · The hard stop

The safety infrastructure is LANDED (FG-4 guard + mode coupling, all TEST-VERIFIED). Claude stops here. The human
executes §1–§2 (credentials/consent) and personally clicks Confirm for the one real send in §5. **Real credentials,
OAuth consent, and the real send are the human's keyboard gate.**

## 9 · GO / NO-GO CHECKLIST (hand-off — the human's keyboard session)

Run mode A build: `NP_E2E_BUILD=1 npx electron-vite build`, then launch with
`NEUROPAUSE_S15_APPPRINCIPAL=1 NEUROPAUSE_FIRST_REAL_SEND=1` (do NOT set `NEUROPAUSE_E2E=1` — the app HARD-FAILS at
startup if you mix them, or if you set S15APPPRINCIPAL without FIRST_REAL_SEND).

GO only when ALL are true:
- [ ] Dedicated **TEST** tenant (never a production identity); Tenant ID noted.
- [ ] Single-tenant app registration; **delegated `Mail.Send` only** (+ `User.Read`, `offline_access`); nothing broader.
- [ ] `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT` set in your shell/keychain — never committed.
- [ ] Window title shows **`-e2e (app-principal — not for release)`** (confirms the seeded, non-release build).
- [ ] `first-real-send.latch` does NOT exist in userData (a stale latch would block the send).
- [ ] Screen recording started; you will capture the **exact UTC send time** and an **inbox screenshot**.
- [ ] The proposal's recipient reads **exactly** `neuropause033@gmail.com`, no cc/bcc. You will read it before Confirm.

Then: **you** click **Confirm send** — once. Expect a governed **AUTHORIZED** → **SUBMITTED** (Graph 202) →
**LIVE-VERIFIED (Profile A — acknowledged)**. Do NOT claim SUCCESS: it is a single **ATTEMPT**; EXTERNALLY OBSERVED
comes from the inbox screenshot now and S16's programmatic read-back later.

NO-GO / STOP if: the recipient is anything else, any cc/bcc appears, the guard returns DENIED, the title lacks `-e2e`,
or the latch already exists. Containment (§6): revoke consent, delete the app registration, drop vault tokens.
