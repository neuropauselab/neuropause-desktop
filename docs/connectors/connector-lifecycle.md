# NeuroPause Connector Framework — Connector Lifecycle & OAuth

This document describes the **runtime**: the account state machine, the OAuth2 /
PKCE flow, token storage, multi-account support, and error recovery. It pairs
with **connector-sdk.md** (the static contract).

---

## 1. Lifecycle phases

Every account moves through these phases (`ConnectorLifecyclePhase`), which also
tag log lines and events:

```
connect → authenticate → refresh → reconnect → sync → disconnect
                              health_check ↺        error_recovery ↺
```

| Phase            | Trigger                          | Effect |
|------------------|----------------------------------|--------|
| `connect`        | user connects a connector        | starts the OAuth flow, creates a provisional account |
| `authenticate`   | within connect/reconnect         | browser sign-in + token exchange |
| `refresh`        | token near expiry / manual       | exchanges refresh token for a new access token |
| `reconnect`      | recover an existing account      | re-runs authorize, keeps the same account id |
| `sync`           | manual / (Stage 2) scheduler     | verifies token; Stage 2 pulls data |
| `disconnect`     | user disconnects                 | revoke (best-effort) + drop tokens + drop metadata |
| `health_check`   | manual / periodic                | recompute health, emit transitions |
| `error_recovery` | a flow failed                    | mark `error` / `reauth_required`, surface a clear message |

### Status state machine

```
            ┌───────────── connect ─────────────┐
            ▼                                    │
   unavailable ──(configured)──▶ disconnected ──(connect)──▶ connecting
        ▲                                   ▲                    │
   (no creds)                               │            success │  failure
                                            │                    ▼        ▼
                                disconnect  │              connected    error
                                            │                  │  ▲        │
                                            │        token bad  │  │ refresh ok
                                            │                   ▼  │        │
                                            └──────────── reauth_required ◀─┘
```

- **`unavailable`** — no client credentials configured (shows a setup hint).
- **`disconnected`** — configured, no accounts.
- **`connecting`** — OAuth in flight (transient; not persisted to the timeline).
- **`connected`** — at least one valid account.
- **`reauth_required`** — refresh failed or no refresh token; user must reconnect.
- **`error`** — a connect/reconnect attempt failed.

Connector-level status aggregates its accounts (worst-of, with `connecting` and
`error`/`reauth_required` surfaced ahead of `connected`).

---

## 2. The OAuth2 flow (RFC 8252 native-app)

Implemented in `oauthEngine.ts`, reusing the same loopback server the app's own
sign-in uses.

```
1. Build PKCE pair (S256)         — if manifest.oauth.usePkce
2. Generate unguessable `state`   — CSRF defense
3. Start loopback server          — 127.0.0.1:<random port>, unguessable path
4. Open system browser to:
     authorizeUrl?response_type=code
       &client_id=…&redirect_uri=<loopback>
       &scope=<scopes joined by scopeSeparator>
       &state=…[&code_challenge=…&code_challenge_method=S256]
       &<extraAuthParams>        — e.g. access_type=offline, prompt=consent
5. User approves in the browser; provider redirects to the loopback
6. Verify `state` matches; extract `code`
7. POST authorizeUrl→tokenUrl:
     grant_type=authorization_code&code=…&redirect_uri=<loopback>
       &client_id=…[&code_verifier=…]
       [client_secret in body OR HTTP Basic, per tokenAuthStyle]
8. Parse standard token response → access/refresh/expires_in/scope/token_type
9. Vault tokens (encrypted), persist the account, emit `connected`
```

The loopback server binds to an OS-assigned ephemeral port on `127.0.0.1` only,
accepts exactly one callback on a random path, shows a "return to NeuroPause"
page, and shuts down. The browser flow is bounded by a timeout (the connect/
reconnect IPC handlers allow a generous 6-minute window for the user to finish).

### PKCE vs confidential clients

- **PKCE (`oauth2_pkce`)** — Google (Drive, Calendar), Microsoft 365, Canva. No
  client secret; the `code_verifier` proves possession. Ideal for a desktop app.
- **Confidential (`oauth2_confidential`)** — GitHub, Slack, Notion, Figma, Jira,
  Linear, Zapier. The client secret is read from configuration and used **only**
  at the token endpoint, in the main process. It never reaches the renderer.

### Token response handling

Responses are parsed against the **OAuth2 standard fields**
(`access_token`, `refresh_token`, `expires_in`, `scope`, `token_type`), which
covers the standards-compliant providers. Best-effort identity hints
(`account_id` / `sub` / `team.id`, `workspace_name` / `team.name`) are captured
when present. Provider-specific response shapes (e.g. Slack's nested
`authed_user` token, Notion's workspace fields) and richer profile/avatar
enrichment are handled by each connector's **Stage-2 sync adapter**, which has the
provider's API available to fetch identity directly.

---

## 3. Token storage (macOS Keychain)

Two stores, cleanly separated:

- **`connectorVault.ts` — secrets.** Per-account access/refresh tokens, encrypted
  with Electron `safeStorage` (macOS Keychain) and written as ciphertext to
  `connector-vault.bin` in `userData`, keyed by `connectorId → accountId`. If OS
  encryption is unavailable the vault **refuses to write** rather than persist a
  token in plaintext. **No vault value is ever returned over IPC.**
- **`connectorStore.ts` — metadata.** Everything the UI renders (label, status,
  granted scopes, sync timestamps) as plain JSON in `connectors.json`. No secrets.

The single internal accessor `connectorService.getValidAccessToken(connectorId,
accountId)` returns a valid token, transparently refreshing first if it is
missing or within the 60-second expiry skew. This is the only path to a raw
token, and it is the accessor Stage-2 adapters use.

---

## 4. Multi-account support

Connectors whose manifest sets `multiAccount: true` (GitHub, Slack, Notion, Jira,
Linear, Google Drive/Calendar, Microsoft 365, and the API-key assistants) can hold
several connected identities at once. Each account has its own id, its own vaulted
tokens, and its own status/health/sync state. Single-account connectors (Cursor,
Canva, Figma, Zapier) reject a second connect until the first is disconnected.

---

## 5. Refresh & error recovery

- **Refresh** (`refresh` / inside `getValidAccessToken`): posts
  `grant_type=refresh_token`. Providers frequently omit a new refresh token on
  refresh — the old one is retained. On success the account returns to
  `connected` and its expiry is updated.
- **No refresh token / refresh fails** → the account is marked
  `reauth_required` (health `down`) with a clear message, and a high-priority
  `connector.reauth_required` event is published. The UI offers **Reconnect**,
  which re-runs authorize against the same account id.
- **Connect failure** leaves **no** account behind — the provisional account is
  never persisted, and the error is surfaced via the connect result and the log
  feed. There is nothing to clean up.
- **Disconnect** revokes the token at the provider when a `revokeUrl` is known
  (best-effort, never throws), then deletes the vault entry and the metadata.

---

## 6. Sync in Stage 1

`sync(connectorId, accountId?)` runs the full sync **lifecycle**: it transitions
each connected account through `syncing`, obtains a valid access token (refreshing
if needed), records `lastSyncAt` / `lastSyncState`, emits `connector.sync_started`
/ `connector.sync_completed` events, and logs the outcome. In Stage 1 this
**verifies the connection** end to end; the adapters that read provider data into
the Unified Data Model are added in Stage 2, at which point this same lifecycle
gains the data-pull step. The scheduler and background synchronization that drive
sync automatically are also Stage 2.

---

## 7. Events & observability

The connector service emits a `ConnectorEvent` for every transition
(status / health / sync / log / account add/remove). `initConnectors` bridges
these two ways:

- **To the renderer** — broadcast on `connectors:event` for live UI updates.
- **To the Platform Event Bus** — meaningful transitions are republished as
  `connector.connected` / `connector.disconnected` / `connector.reauth_required`
  / `connector.sync_started` / `connector.sync_completed` / `connector.error`, so
  connector activity appears in the **Activity feed**, **Timeline**, and
  **Diagnostics** alongside everything else. (Logs and per-read health checks are
  kept off the bus to avoid flooding it.)

A per-connector **log feed** (ring buffer, newest-first) is available over
`connectors:logs` and surfaced in the Connectors UI.
