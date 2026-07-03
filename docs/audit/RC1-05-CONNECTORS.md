# RC1 Audit — 05: Connectors (Part 7)

Evidence: directory inventories of `main/connectors` and `main/unified`,
provider-id greps of the manifests and sync layer, `credentials.ts` code read,
the boot log ("Connector service ready { connectors: 16, accounts: 2 }"), and
the fetch/sample greps of the entire layer.

## 1. Architecture (verified)

`connectors/` holds the account layer: `manifests.ts` (the 16 provider
definitions), `oauthEngine.ts` + `pkce.ts` (**real** OAuth token exchange over
HTTP with PKCE), `connectorVault.ts` (tokens encrypted at rest —
`connector-vault.bin`), `credentials.ts` (client-key resolution), `health.ts`,
and the store/service. `unified/` holds the data layer: an adapter SDK,
per-provider adapters, a **tested orchestrator**, rate limiter, retry queue,
scheduler, real HTTP transport (`sync/http.ts`), its own persisted sync state
(`sync-state.json`), and the unified store feeding query/search. Exactly two
files in the whole layer perform network fetches (the OAuth engine and the sync
transport) and **zero generate sample data** — demo timeline content comes from
a separate seeding module, not from fake connector responses.

Client keys resolve per provider from the manifest's declared env-var names:
`readEnv(oauth.clientIdEnv)` → missing key ⇒ `null` ⇒ that connector cannot
begin OAuth. Secrets are optional (PKCE public clients run with
`clientSecret: null`).

## 2. The sixteen connectors, tiered

Tier definitions — **A: Real-API sync** (OAuth path + a data adapter in
`unified/sync/adapters`); **B: OAuth-ready** (manifest + PKCE engine + vault +
health + account model; no data adapter, so connecting yields status but
ingests nothing); C: framework-only; D: absent.

| Connector | Tier | Evidence |
| --- | --- | --- |
| GitHub | **A** | 21 provider refs in sync layer (flagship adapter) |
| Notion | **A** | adapter refs (3) |
| Slack | **A** | adapter refs (3) |
| Google Calendar | **A** | adapter refs (2) |
| ChatGPT | **B**⁺ | manifest + a single sync-layer reference (entity mapping only) |
| Claude, Gemini, Perplexity, Cursor | **B** | manifest + OAuth engine; no adapter |
| Canva, Figma, Jira, Linear, Zapier | **B** | manifest + OAuth engine; no adapter |
| Google Drive, Microsoft 365 | **B** | manifest + OAuth engine; no adapter |

Distribution: **4 × Tier A, 12 × Tier B, 0 framework-only, 0 absent** — every
charter connector exists at least to the authenticate-and-hold-account level,
and none is faked. The two "accounts: 2" in the boot log are the developer's
own dev connections.

## 3. What go-live requires

Per provider: (1) register an OAuth app in that provider's console and export
the client id (and secret where required) under the env names its manifest
declares; (2) Tier B providers additionally need a sync adapter written against
the adapter SDK if data ingestion (timeline/memory) is wanted — OAuth alone
gives connection status only. The sync spine (orchestrator, rate limiting,
retries, scheduling) is already production-shaped and tested.

## 4. Findings

- **A5-1** — honest capability statement for release material: "connects 16
  services; live data sync for GitHub, Notion, Slack, Google Calendar" is the
  claim the code supports today.
- **A5-2** — the per-connector client-key **env names are undocumented**
  (extends A1-1). A9's environment reference must enumerate them from
  `manifests.ts` (they are desktop-process variables).
- **A5-3 (correction to A4-2)** — the evidence reassigns the artifacts: the
  legacy simulator's file is `cloud-sync.json` (matching the other `cloud-*`
  sim stores); **`sync-state.json` belongs to the active unified sync layer**
  and is not legacy. A4-2's retirement item stands, with the corrected file
  list. This audit corrects itself when the code says so.

Next increment: **A6 — AI chain audit** (engine, context builder, memory,
graph, timeline, Ollama client, Founder/Engineering AI; Qdrant verdict).
