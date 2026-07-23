# NeuroPause Developer Ecosystem

> **GEAP adoption artifact** for the _Developer enablement_ row of the Global
> Adoption Matrix and every row of the **Developer Readiness Matrix**
> (`ADOPTION-MATRICES.md` §3). This is **enablement over the real developer
> surface** — it adds no SDK, runtime, or API. Every command, method, and path
> below was read from source: `packages/sdk/src`, `packages/cli/src`,
> `tools/nps/cli.mjs`, `docs/runtime/PLUGIN-SDK.md`, `docs/connectors/*`,
> `packages/shared/src/types/developerPlatform.ts`.
>
> **Maturity:** Validated Release Candidate (`ENTERPRISE-VALIDATION-REPORT.md`) —
> not GA. **License:** Proprietary / All Rights Reserved (`LICENSE`), so the
> SDK/CLI are **workspace packages** today (`@neuropause/sdk` = `packages/sdk`);
> public-registry distribution is a **proposed** path. No download, star, or usage
> numbers appear here because none are real.

| Surface            | Package / path                                             | Version | Entry                                  |
| ------------------ | ---------------------------------------------------------- | ------- | -------------------------------------- |
| SDK                | `@neuropause/sdk` (`packages/sdk/src`)                     | `0.1.0` | `NeuroPauseClient`, builders, webhooks |
| CLI                | `@neuropause/cli` (`packages/cli/src`)                     | `0.3.0` | `neuropause` bin                       |
| Plugin SDK         | `nps` (`tools/nps/cli.mjs`) + `docs/runtime/PLUGIN-SDK.md` | —       | `neuropause.plugin.json`               |
| Connector SDK      | `docs/connectors/connector-sdk.md`                         | —       | `ConnectorManifest`                    |
| Portal view-models | `developerPlatform.ts` (P12)                               | —       | catalog projections                    |

---

## 1. Developer onboarding — 0 → first API call

The gateway fronts everything; auth, scope, rate, quota, and audit apply to every
call whether from the SDK, the CLI, or your own HTTP client.

**Step 0 — get a credential.** Two grant types are real: an **API key** (long-lived
Bearer secret) or **OAuth 2.1 client-credentials** (a `client-id`/`client-secret`
pair exchanged for a short-lived `access_token` via `OAuthResource.token`,
`POST /oauth/token`).

**Step 1 — log in** (writes `~/.neuropause/credentials.json`, mode `0600`;
`packages/cli/src/credentials.ts`):

```bash
neuropause login --api-key np_live_xxx --base-url https://api.neuropause.dev
# or exchange client credentials (stores the returned access token + its expiry):
neuropause login --client-id dev_123 --client-secret s3cr3t --scope "records:read marketplace:read"
```

**Step 2 — confirm + reach the gateway:** `neuropause whoami` (decodes the token
for display only) then `neuropause health` (`GET /health`).

**Step 3 — first SDK call** (canonical import from `packages/sdk/src/index.ts`):

```ts
import { NeuroPauseClient } from '@neuropause/sdk';
const np = new NeuroPauseClient({ apiKey: process.env.NEUROPAUSE_API_KEY });
const listings = await np.marketplace.list(); // GET /v1/marketplace/listings
```

`NeuroPauseClient` defaults to `baseUrl: https://api.neuropause.dev` and
`version: 'v1'`. Env vars `NEUROPAUSE_API_KEY` / `NEUROPAUSE_BASE_URL` override the
stored login for CI.

**Checklist:** [ ] account + API key (or OAuth client) issued · [ ] `login`
succeeds and `whoami` shows expected scopes · [ ] `health` returns 200 ·
[ ] `np.enterprise.getHealth()` runs from your app · [ ] scopes match the endpoints
you call (§9).

---

## 2. SDK learning path — progressive, per resource

Every resource hangs off `NeuroPauseClient` and shares one transport. Each rung
uses only **real** methods from `packages/sdk/src`.

| Rung | Resource                               | Real methods                                                                               | Learn                       |
| ---- | -------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------- |
| 1    | `client.enterprise`                    | `getHealth`, `getMetrics`                                                                  | Auth + a first GET          |
| 2    | `client.marketplace`                   | `list`, `get`, `stats`                                                                     | Read the ecosystem          |
| 3    | `client.workers` / `client.connectors` | `list`                                                                                     | Listing kinds               |
| 4    | `client.usage` / `client.billing`      | `summary`, `plans`                                                                         | Quota + plan awareness      |
| 5    | `client.enterprise` records            | `getModulesModuleIdRecords`, `postModulesModuleIdRecords`, `patchModulesModuleIdRecordsId` | CRUD over ERP modules       |
| 6    | `client.enterprise` graph              | `getGraphCounts`, `getContextId`, `getTimeline`, `getSearch`                               | Graph + Entity-360          |
| 7    | `client.oauth`                         | `token`                                                                                    | Service-account auth        |
| 8    | `builders`                             | `defineWorker`, `defineConnector`, `definePlugin`, `defineExtension`                       | Produce a `ListingManifest` |
| 9    | `webhooks`                             | `signWebhook`, `verifyWebhook`, `parseWebhook`                                             | Verify inbound events       |
| 10   | `pagination`                           | `paginate`, `collect`, `stream`                                                            | Drain cursor pages          |

**Rung 5 — records CRUD** (generated `EnterpriseResource`, `generated/enterprise.ts`):

```ts
const page = await np.enterprise.getModulesModuleIdRecords('crm.contacts', {
  limit: 50,
  status: 'active',
});
const rec = await np.enterprise.postModulesModuleIdRecords('crm.contacts', {
  name: 'Acme',
  tier: 'A',
});
await np.enterprise.patchModulesModuleIdRecordsId('crm.contacts', rec.id, { tier: 'B' });
await np.enterprise.postModulesModuleIdRecordsIdSummarize('crm.contacts', rec.id); // AI summary + risk
```

**Rungs 8 + 10 — build a manifest, then drain pages:**

```ts
import { defineWorker, collect } from '@neuropause/sdk';
const manifest = defineWorker({
  name: 'Deal Summarizer',
  version: '1.0.0',
  entry: 'worker.js',
  role: 'analyst',
}).toManifest();
const all = await collect((cursor) =>
  np.enterprise.getModulesModuleIdRecords('crm.contacts', {
    cursor: cursor ?? undefined,
    limit: 100,
  }),
);
```

Builders fail fast on a missing `name`/`version`/`entry` (`builders.ts`).
`HttpTransport` retries `429/502/503/504` + network errors (backoff, `maxRetries`
default 2) and throws `GatewayError` (`status`, `body`) on `>=400`; inject a custom
`Transport` to embed over IPC or mock in tests (`transport.ts`).

---

## 3. CLI tutorials — real commands

`neuropause <command>` (full surface: `packages/cli/src/commands.ts`). Output is
JSON, so everything pipes into `jq`.

**A — inspect the enterprise API**

```bash
neuropause modules                                   # ERP modules + live record counts
neuropause records crm.contacts list --status active --limit 20 --sort updatedAt --order desc
neuropause records crm.contacts get rec_123
neuropause records crm.contacts summarize rec_123    # AI summary + risk
neuropause search "overdue invoice" --limit 10       # cross-domain search
neuropause timeline --entityRef rec_123 --limit 50   # unified timeline
```

**B — record lifecycle from JSON files**

```bash
neuropause records crm.contacts create ./contact.json
neuropause records crm.contacts update rec_123 ./patch.json
neuropause records crm.contacts status rec_123 archived
neuropause records crm.contacts action lead_9 convert ./opts.json   # module-defined action
```

**C — graph, context & operations**

```bash
neuropause graph counts ; neuropause graph neighbors node_42 --direction out --limit 25
neuropause graph subgraph node_42 --depth 2
neuropause context rec_123           # Entity-360 (neighbors + impact + timeline + memory)
neuropause diagnostics --windowDays 7 ; neuropause logs --limit 100 ; neuropause traces --limit 100
```

**D — ecosystem**

```bash
neuropause marketplace list ; neuropause workers list ; neuropause connectors list ; neuropause plugins
neuropause usage --windowDays 30 ; neuropause billing plans ; neuropause billing summary
```

Flags parse generically (`args.ts`): `--flag value`, `--flag=value`, bare booleans; numbers coerce to gateway-query integers.

---

## 4. Plugin development — `nps` toolchain

A plugin extends **NeuroPause itself**: a versioned, optionally signed bundle with
a `neuropause.plugin.json` manifest and (for code plugins) a CommonJS entry that
runs **isolated in its own process** behind a **permission-gated host API**
(`docs/runtime/PLUGIN-SDK.md`).

```bash
nps init my-plugin        # scaffold manifest + index.cjs   (nps = node tools/nps/cli.mjs)
nps validate my-plugin    # manifest + entry checks
nps dev my-plugin         # validate, then print hot-reload steps
```

| Manifest field      | Rule (validator in `tools/nps/cli.mjs`)                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | lowercase, `>=3` chars, `[a-z0-9._-]`                                                                                                                                 |
| `version`           | semver `x.y.z`                                                                                                                                                        |
| `engine.neuropause` | host range (`>=0.1.0 <1.0.0`, `^`, `~`, `*`)                                                                                                                          |
| `kind`              | `background` · `automation` · `ai_agent` · `mcp_server` · `ui`                                                                                                        |
| `main`              | entry module — required for every kind except `ui`                                                                                                                    |
| `contributions`     | surfaces: `sidebar` · `toolbar` · `panel` · `widget`                                                                                                                  |
| `permissions`       | subset of 11: `network`, `filesystem_read/write`, `clipboard`, `notifications`, `camera`, `microphone`, `local_models`, `automation`, `background`, `shell_execution` |

**Module contract** (from `examples/plugins/hello-automation/index.cjs`):

```js
module.exports = {
  async activate(host) {
    // called once on enable
    host.log('perms: ' + host.permissions.join(', '));
    await host.storage.set('startedAt', new Date().toISOString());
    await host.notify('Title', 'Body').catch((e) => host.log('notify denied: ' + e.message)); // needs "notifications"
  },
  async deactivate() {
    /* stop timers, listeners */
  },
};
```

Host API: `host.log` / `host.emit` / `host.storage.get/set` (ungated);
`host.notify` (`notifications`) and `host.runModel` (`local_models`) are gated and
reject cleanly when revoked. **Package & sign** — Ed25519 over the package SHA-256 digest, the exact scheme the runtime verifies:

```bash
nps pack my-plugin -o my-plugin-0.1.0.npkg              # tar.gz + .sha256 sidecar
nps keygen -o my-signing                                 # Ed25519 pair; prints a key id
nps sign my-plugin-0.1.0.npkg -k my-signing.private.pem  # writes .sig + key id
```

**Carry the open items:** `host.runModel`/`local_models` is a **declared seam**,
not a live model call; live rendering of `ui` contributions and the host-side MCP
client are **forthcoming** (the MCP _server_ half is real — `examples/mcp/clock-server`);
the **trust store ships empty**, so registering a signing key is an admin step
before signatures verify.

---

## 5. Marketplace publishing — publish → submit → review → publish

Two real paths land a version through the same pipeline; the gateway enforces
`marketplace:publish` on every write (`MarketplaceResource`, `resources.ts`).

```bash
# Path A — CLI drafts + submits in one step (commands.ts `publish`):
neuropause publish lst_123 ./manifest.json   # → publishVersion(...) then submit(version.id)
```

```ts
// Path B — SDK full lifecycle:
const version = await np.marketplace.publishVersion('lst_123', manifest, 'Initial release'); // draft
const submitted = await np.marketplace.submit(version.id); // enter scan → sign → review
const reviewed = await np.marketplace.review(version.id, 'approved', 'LGTM'); // reviewer action
const live = await np.marketplace.publish(version.id); // make current
// await np.marketplace.rollback('lst_123');                        // revert to previous version
```

| Step    | Method                                           | Path                                      | Who       |
| ------- | ------------------------------------------------ | ----------------------------------------- | --------- |
| Draft   | `publishVersion(listingId, manifest, changelog)` | `POST /marketplace/listings/:id/versions` | Publisher |
| Submit  | `submit(versionId)`                              | `POST /marketplace/versions/:id/submit`   | Publisher |
| Review  | `review(versionId, decision, notes?)`            | `POST /marketplace/versions/:id/review`   | Reviewer  |
| Go live | `publish(versionId)`                             | `POST /marketplace/versions/:id/publish`  | Reviewer  |
| Revert  | `rollback(listingId)`                            | `POST /marketplace/listings/:id/rollback` | Publisher |

Signature verification is **Ed25519** (`verifySignature`/`verifyManifest` in the
desktop package service); the store returns only `status='published'` listings.
**Open item:** an unsigned app install is currently allowed when the trust store is
empty — a publisher-side control, not a runtime guarantee. **Pre-submit
checklist:** manifest built via a `define*` builder · fresh semver ·
least-privilege permissions · changelog written · package signed with a trusted
key. Publisher-program framing lives in `MARKETPLACE-GROWTH.md`.

---

## 6. Sample projects — blueprints (specs to build, not shipped repos)

Each blueprint names the **real** APIs to wire; no fabricated repos, stars, or
install counts.

| Blueprint                | Primary surface        | Real anchors                                                                                                                                                |
| ------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record-sync-worker`     | SDK enterprise         | `collect` + `getModulesModuleIdRecords` (page), `postModulesModuleIdRecordsIdSummarize` (risk), `patchModulesModuleIdRecordsId` (write back), `oauth.token` |
| `webhook-receiver`       | SDK webhooks           | `verifyWebhook` (HMAC, `t=..,v1=..`), `parseWebhook`, then `client.enterprise.*`                                                                            |
| `deal-summarizer-worker` | Builders + Marketplace | `defineWorker(...).toManifest()`, `publishVersion` → `submit`, `nps sign` → `ListingManifest` `kind:'ai_worker'`                                            |
| `ops-console`            | CLI + jq               | `neuropause diagnostics`, `usage`, `billing summary`, `metrics --windowDays 7` — zero code                                                                  |
| `hello-plugin`           | Plugin SDK             | `nps init/validate/pack/sign`, `activate/deactivate`, `host.storage` + `host.notify` (start from `examples/plugins/hello-automation`)                       |

---

## 7. Reference applications — annotate the app itself

The repository **is** the reference implementation. Point developers at these real
apps to see the SDK/CLI surface exercised end to end.

| App                     | Package                                                 | What to study                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend gateway + store | `@neuropause/backend` `0.1.0` (`apps/backend/src`)      | The Express gateway everything calls; `store/*` (`apps`, `categories`, `versions`, `reviews`, install/download) is the publishing lifecycle the SDK drives; Razorpay billing behind `billing.*` |
| Desktop app             | `@neuropause/desktop` `1.0.0-rc.1` (`apps/desktop/src`) | Electron + React "AI operating layer"; hosts the marketplace, connector runtime (`main/connectors/*`), plugin loader, and package service (Ed25519 verification)                                |
| CLI                     | `@neuropause/cli` `0.3.0` (`packages/cli/src`)          | A thin, typed front-end over the SDK — the canonical example of consuming every resource                                                                                                        |
| Plugin examples         | `examples/plugins/*`, `examples/mcp/clock-server`       | `hello-automation` (background), `echo-agent` (`local_models` seam), `clock-server` (real stdio MCP server)                                                                                     |

**Reading the desktop app as a reference:** trace one connector from
`main/connectors/manifests.ts` (16-provider registry) through `oauthEngine.ts`
(authorize/refresh/revoke), `connectorVault.ts` (encrypted token vault), and
`health.ts` — the contract in `docs/connectors/connector-sdk.md`. Adding a provider
is a **manifest entry**, not new code; Stage-2 sync adapters read through
`getValidAccessToken`.

---

## 8. Developer portal architecture — docs over `developerPlatform.ts`

The portal is a **documentation + view-model** layer, not a new service. P12
(`packages/shared/src/types/developerPlatform.ts`) defines **catalog projections**
derived from stores the ecosystem already owns — "no new SDK, runtime, API server,
or marketplace." Build the portal's IA directly on these view-models:

| Portal area         | View-model                              | Renders                                                                                               |
| ------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| SDK catalog         | `SdkRegistry` / `DevSdkEntry`           | language, `packageName`, `install`, `status` (`available`/`beta`/`planned`), `docsPath`, capabilities |
| API explorer        | `ApiExplorer` / `DevApiEntry`           | `basePath`, `version`, `visibility`, `scopes`, `rps`; gateway versions                                |
| Templates / samples | `TemplateRegistry` / `DevTemplate`      | `kind`, `scaffold` (`nps init`, `defineWorker(...)`), `produces`, `docsPath`                          |
| Developer console   | `DeveloperConsole`                      | `apiKeys`, `oauthApps`, `listings`, `published`, `pendingReview`, quota, `health`                     |
| Publishing console  | `PublishingConsole` / `PublishingEntry` | per-listing `status`, `currentVersion`, `versions`, `certified`                                       |
| Analytics           | `DeveloperPlatformAnalytics`            | `byDay` requests/errors, `topRoutes`, `p95LatencyMs`                                                  |
| Overview home       | `DeveloperPlatformOverview`             | the bundle of all six                                                                                 |

**Authoring rule:** the SDK catalog lists the real authoring surfaces — TypeScript
SDK and CLI (`available`), REST + webhooks — and marks Python/Go/Java/.NET as
`planned` (`DevSdkLanguage` includes them as **catalog slots, not shipped
clients**). Never render a `planned` entry as if it exists; analytics fields are
**definitions to populate from real telemetry**, never seeded with invented numbers.

---

## 9. API examples — copy-paste recipes

All recipes use only methods present in `packages/sdk/src`.

**9.1 Authenticate as a service account (OAuth client-credentials)**

```ts
import { NeuroPauseClient } from '@neuropause/sdk';
const { access_token } = await new NeuroPauseClient().oauth.token({
  clientId: process.env.NP_CLIENT_ID!,
  clientSecret: process.env.NP_CLIENT_SECRET!,
  scope: 'records:read records:write',
});
const np = new NeuroPauseClient({ apiKey: access_token }); // reuse the token as the Bearer
```

**9.2 Verify an inbound webhook (Express)**

```ts
import { verifyWebhook, parseWebhook } from '@neuropause/sdk';
app.post('/webhooks/neuropause', (req, res) => {
  const raw = req.rawBody; // exact bytes delivered
  const sig = req.header('x-neuropause-signature') ?? ''; // format: t=<unix_ms>,v1=<hex>
  if (!verifyWebhook(raw, sig, process.env.NP_WEBHOOK_SECRET!)) return res.sendStatus(400);
  const event = parseWebhook(raw); // { id, type, createdAt, data }
  res.sendStatus(200);
});
```

**9.3 Publish an AI Worker + handle gateway errors**

```ts
import { defineWorker, GatewayError } from '@neuropause/sdk';
try {
  const manifest = defineWorker({
    name: 'Deal Summarizer',
    version: '1.0.0',
    entry: 'worker.js',
    role: 'analyst',
    permissions: ['records:read'],
  }).toManifest();
  const version = await np.marketplace.publishVersion('lst_123', manifest, 'Initial release');
  await np.marketplace.submit(version.id); // enter scan → sign → review
} catch (e) {
  if (e instanceof GatewayError) console.error(e.status, e.body); // 429/5xx already retried by transport
}
```

**9.4 Mock the transport in a unit test** (the pattern from `sdk.test.ts`)

```ts
import type { Transport, TransportRequest, TransportResponse } from '@neuropause/sdk';
class MockTransport implements Transport {
  calls: TransportRequest[] = [];
  async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
    this.calls.push(req);
    return { status: 200, data: [] as T, headers: {} };
  }
}
const np = new NeuroPauseClient({ transport: new MockTransport() });
```

**Scope reference** (informational in the SDK; the gateway enforces):

| Resource / method                                                                       | Scope                                                           |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `marketplace.list/get/stats/install` · `.publishVersion/submit/review/publish/rollback` | `marketplace:read` · `marketplace:publish`                      |
| `workers.list` · `connectors.list`                                                      | `workers:read` · `connectors:read`                              |
| `usage.summary` · `billing.summary/plans`                                               | `usage:read` · `billing:read`                                   |
| `enterprise.get*Records*` · `enterprise.post/put/patch/delete*Records*`                 | `records:read` · `records:write`                                |
| `getGraph*` · `getContextId` · `getTimeline` · `getSearch`                              | `graph:read` · `context:read` · `timeline:read` · `search:read` |
| `getAutomation*` · `getObservability*` / `getHealth` / `getMetrics`                     | `automation:read` · `observability:read`                        |

---

## Cross-references

- Getting started / auth: `docs/guides/INSTALLATION.md`, `QUICK-START.md`, `docs/AUTHENTICATION.md`
- Plugin runtime: `docs/runtime/PLUGIN-SDK.md` · Connectors: `docs/connectors/connector-sdk.md`, `connector-lifecycle.md`
- Publisher program: `MARKETPLACE-GROWTH.md` · Partners: `PARTNER-ECOSYSTEM.md`
- Basis: `ADOPTION-MATRICES.md` §3 · Grounding: `docs/adoption/_grounding.md`
