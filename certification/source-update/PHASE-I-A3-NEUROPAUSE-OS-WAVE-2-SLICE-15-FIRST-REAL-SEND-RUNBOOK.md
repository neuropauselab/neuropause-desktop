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
- **Implementation note (S15 execution, gated):** the allowlist guard lands in the send path. If it must sit inside a
  FROZEN surface (`connectors/index.ts` / `connectors/m365/mail.ts`), it goes through an **FG gate** — it is NOT
  smuggled. Preferred: a non-frozen pre-admission check in the capability/propose layer, plus the compiled-in constant.

## 4 · Single send, no retry storm

- **Exactly one** send. No automatic retry on UNKNOWN/timeout — a non-acknowledged result goes to a HOLD for manual
  reconciliation (S16/S22), never an automatic re-send (idempotency + no-duplicate-effect is S21; until then, manual).
- Rate/allowlist guard rejects a second send attempt in the session without an explicit human re-confirm.

## 5 · Human confirmation (unchanged architecture)

- The **only** consent path is the existing one: proposal → human review in `M365WritePanel` → explicit **Confirm send**
  click. The human reads the exact recipient/subject/body before confirming. No second confirmation surface.
- The human — not Claude — clicks Confirm for the real send.

## 6 · Rollback / containment

- If anything is wrong pre-send: cancel in the panel (no effect), or `connectorService.disconnect` (drops tokens from
  the vault). Revoke the app's consent in the test tenant.
- Post-send: the recipient is the operator's own mailbox, so containment is inherent. Delete the app registration +
  revoke tokens to end the capability. No other mailbox can have been reached (allowlist).

## 7 · Evidence capture

- Capture: consent record (tenant/app/scopes/time), the proposal shown, the exact confirmed params, the executor
  outcome, and the **`internetMessageId`** returned by the real Graph (the handle S16's read-back oracle will verify).
- Honest labeling: a real ACKNOWLEDGED is **LIVE-VERIFIED (Profile A — acknowledged)**, NOT `VERIFIED_SUCCESS`. Read-back
  verification (S16) is required before any success claim.

## 8 · The hard stop

Claude stops here. The human executes §1–§2 (credentials/consent), lands the §3 allowlist guard (gated if frozen),
and personally clicks Confirm for the one real send in §5. **Real credentials, OAuth consent, and the real send are the
human's keyboard gate.**
