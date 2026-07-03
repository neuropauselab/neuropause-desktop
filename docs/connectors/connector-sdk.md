# NeuroPause Connector Framework — Connector SDK

This document describes the **Connector SDK**: the typed contract every connector
is defined by, the runtime that drives it, and how to add a new connector. It
covers Stage 1 of the framework (the Connector Platform). The Unified Data Model
and synchronization architecture that the SDK feeds are documented separately as
part of Stage 2.

> **Scope note.** Stage 1 delivers the *platform* — the SDK, the OAuth engine, the
> registry, the lifecycle runtime, and the IPC surface. OAuth flows are fully
> implemented and production-correct; they activate the moment a connector's
> client credentials are supplied (see *The credentials seam*). The data adapters
> that read provider data into a unified model arrive in Stage 2; in Stage 1 the
> sync lifecycle runs and verifies the connection.

---

## 1. Anatomy of a connector

A connector is **data, not code**. It is a `ConnectorManifest` (a static
description) plus the behaviour the shared runtime provides for its `authType`.
There is no per-connector imperative class to write — adding a provider means
adding a manifest entry.

```ts
interface ConnectorManifest {
  id: ConnectorId;                 // stable slug, e.g. "github"
  name: string;                    // "GitHub"
  provider: string;                // "GitHub" / "Atlassian" / "OpenAI"
  description: string;
  category: ConnectorCategory;     // developer | productivity | ...
  website: string;
  docsUrl: string;
  brandColor: string;              // hex, for the UI
  version: string;                 // connector/manifest semver
  authType: ConnectorAuthType;     // oauth2_pkce | oauth2_confidential | api_key
  capabilities: ConnectorCapability[];
  scopes: ConnectorScope[];        // human-readable permissions
  oauth: OAuthEndpointConfig | null;
  multiAccount: boolean;
}
```

### Identity & versioning

`id` is the stable key used everywhere (vault, store, IPC, timeline). `version`
is the manifest's semantic version: bump it when a connector's scopes, endpoints,
or capabilities change so the UI and any future migrations can react. The SDK
itself is versioned by the shared `@neuropause/shared` package.

### Capabilities

`capabilities` declare which **unified data domains** a connector can surface.
These are the seams the Stage-2 intelligence layer reads through:

```
projects · tasks · files · documents · conversations · messages
notifications · events · activities · calendar · repositories · issues
```

A connector lists only what it can actually provide (GitHub →
`repositories, issues, activities, notifications`; Google Calendar →
`calendar, events`). Declaring a capability is a promise the Stage-2 adapter will
honour; it does not by itself move any data.

### The permission model (scopes)

Each connector declares two parallel views of its permissions:

- **`scopes: ConnectorScope[]`** — human-readable `{ id, label, description }`
  entries rendered at consent time and in the Connectors UI.
- **`oauth.scopes: string[]`** — the exact scope strings sent to the provider.

Scopes are deliberately **read-only / least-privilege**. NCF reads provider data
to build memory, timelines, and search; it never requests write/mutate scopes.
The renderer only ever sees the human-readable `scopes` and the
**granted** scopes the provider returned (`ConnectedAccount.grantedScopes`).

### Auth types

| `authType`            | Flow                                              | Secret? |
|-----------------------|---------------------------------------------------|---------|
| `oauth2_pkce`         | Authorization Code + PKCE, public client          | No      |
| `oauth2_confidential` | Authorization Code, secret at the token endpoint  | Yes     |
| `api_key`             | User-supplied API token (no browser flow)         | n/a     |

The AI assistants (ChatGPT, Claude, Gemini, Perplexity, Cursor) have no public
user-data OAuth API, so they are modelled as `api_key` connectors — first-class
registry slots whose key is supplied in configuration rather than via a browser
sign-in.

---

## 2. Health monitoring

Every account carries a `health` derived **structurally** from its status, token
expiry, and last error (`accountHealth` in `connectors/health.ts`):

- `healthy` — connected, token valid and not near expiry.
- `degraded` — connected but the access token is expired/expiring (a refresh
  token makes this benign and self-healing on next use).
- `down` — `error` or `reauth_required`.
- `unknown` — disconnected, unavailable, or mid-connect.

Connector-level health is the **worst** across its accounts. Health is recomputed
on every read so the dashboard is always current; `connectors:health` additionally
persists transitions and emits events so health changes land on the timeline.
(No provider is pinged for a health read — a real round-trip belongs to *sync*.)

---

## 3. What each connector exposes

The renderer never sees the manifest's endpoints or any token. It sees a
`ConnectorDto`:

```
Name · Provider · Category · Description · Capabilities · Permissions (scopes)
Status · Health · Connected Account(s) · Last Sync · Configured? · Setup hint
```

`ConnectedAccount` is one authenticated identity:

```
id · label · externalId · status · health · grantedScopes
connectedAt · lastSyncAt · lastSyncState · accessTokenExpiresAt (display only)
```

---

## 4. The credentials seam

OAuth client ids — and, for confidential clients, secrets — are **operator-supplied
via environment variables**, named by each manifest:

```
NEUROPAUSE_GITHUB_CLIENT_ID / NEUROPAUSE_GITHUB_CLIENT_SECRET
NEUROPAUSE_GOOGLE_CLIENT_ID           (shared by Drive + Calendar)
NEUROPAUSE_MICROSOFT_CLIENT_ID
NEUROPAUSE_SLACK_CLIENT_ID / _SECRET
NEUROPAUSE_NOTION_CLIENT_ID / _SECRET
NEUROPAUSE_ATLASSIAN_CLIENT_ID / _SECRET   (Jira)
NEUROPAUSE_LINEAR_CLIENT_ID / _SECRET
NEUROPAUSE_FIGMA_CLIENT_ID / _SECRET
NEUROPAUSE_CANVA_CLIENT_ID                  (PKCE, no secret)
NEUROPAUSE_ZAPIER_CLIENT_ID / _SECRET
```

`credentials.ts` reads these. A connector is **`configured`** when its required
variables are present:

- **Configured** → the connect flow runs end to end.
- **Not configured** → the connector reports `status: 'unavailable'` with a
  `setupHint` naming the variable to set. Nothing else about it changes.

This is the deliberate, honest seam of the framework: registering an OAuth app
with each provider (client id, redirect URI) is a step no code can perform for
you. Every flow is written and correct; supplying credentials activates it.

The redirect URI to register with each provider is the **loopback** form
`http://127.0.0.1:<random-port>/callback/<random>` (RFC 8252). Providers that
require an exact redirect generally accept `http://127.0.0.1` with a wildcard
port for native apps; register accordingly.

---

## 5. Adding a new connector

1. **Add a manifest** to `CONNECTOR_MANIFESTS` in `connectors/manifests.ts`:
   choose `id`, `category`, `authType`, `capabilities`, human `scopes`, and (for
   OAuth) the `oauth` block with real `authorizeUrl` / `tokenUrl`, the provider's
   `scopes`, `scopeSeparator`, `usePkce`, `tokenAuthStyle`, and the `clientIdEnv`
   / `clientSecretEnv` names.
2. **Pick the token-auth style.** Most providers accept client credentials in the
   body (`tokenAuthStyle: 'body'`); a few require HTTP Basic (`'basic'`, e.g.
   Notion). PKCE-capable providers set `usePkce: true` and need no secret.
3. **That's it for the platform.** The OAuth engine, vault, store, health, logs,
   IPC, and UI all work off the manifest. No new wiring is required.
4. **Stage 2:** add a sync adapter that uses `getValidAccessToken(connectorId,
   accountId)` to read the provider and map results into the Unified Data Model.

### Files

```
packages/shared/src/types/connectors.ts     SDK types (this contract)
apps/desktop/src/main/connectors/
  manifests.ts        the registry (16 providers)
  credentials.ts      env-var credential resolution + the seam
  pkce.ts             PKCE (S256) + state helpers
  oauthEngine.ts      authorize / refresh / revoke
  connectorVault.ts   per-account encrypted token vault (Keychain)
  connectorStore.ts   non-secret account metadata (connectors.json)
  health.ts           health derivation + aggregation
  connectorService.ts lifecycle runtime + events + logs
  index.ts            initConnectors() → IPC handlers + platform-event bridge
```

See **connector-lifecycle.md** for the runtime state machine, the OAuth flow, and
error recovery.
