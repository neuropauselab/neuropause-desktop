# Public SDK & CLI

Two published-shape workspace packages let developers build on the platform from
their own code and terminal.

## `@neuropause/sdk`

A **transport-agnostic** TypeScript/JavaScript client. It speaks to a `Transport`
interface, and ships an `HttpTransport` for the public REST gateway; a custom
transport (mock, in-process over IPC, proxy) can be injected. It declares its own
minimal fetch shape, so it compiles under a plain ES2022 target with no DOM
dependency.

```ts
import { NeuroPauseClient, defineWorker } from '@neuropause/sdk';

const np = new NeuroPauseClient({ apiKey: process.env.NEUROPAUSE_API_KEY });

const listings = await np.marketplace.list();

const worker = defineWorker({
  name: 'Research Analyst',
  version: '1.0.0',
  entry: 'worker/main.js',
  permissions: ['workers:read'],
  role: 'research',
});

const version = await np.marketplace.publishVersion('lst_123', worker.toManifest(), 'Initial release');
await np.marketplace.submit(version.id);
```

**Resources** — `marketplace` (list/get/stats/publishVersion/submit/review/
publish/rollback/install), `workers`, `connectors`, `usage`, `billing`. Each
method maps to a versioned REST path and carries the scope the route requires;
the gateway enforces it.

**Builders** — `defineWorker`, `defineConnector`, `definePlugin`,
`defineExtension` produce a validated `ListingManifest` (failing fast on a
missing name, version, or entry) ready to publish. These mirror the in-app
workforce SDK contract, so a worker built with the public SDK is the same shape
the runtime governs.

**Webhooks** — `signWebhook(payload, secret)` produces a
`t=<unix_ms>,v1=<hex>` HMAC-SHA256 header over `<t>.<payload>`;
`verifyWebhook(payload, header, secret)` checks it with a constant-time compare
and a timestamp tolerance to resist replay; `parseWebhook` decodes the event.
Used both by integrators (to verify inbound deliveries) and as the contract the
platform signs with.

## `@neuropause/cli`

A command-line tool built on the SDK. It reads `NEUROPAUSE_API_KEY` and
`NEUROPAUSE_BASE_URL` from the environment and dispatches commands:

```
neuropause marketplace list
neuropause marketplace stats
neuropause workers list
neuropause connectors list
neuropause usage
neuropause billing summary
neuropause publish <listingId> <manifest.json>
```

The dispatcher is pure of stdio (it takes a client + output sinks), so it is
unit-tested directly; the bin wires real streams around it.

## Languages & surfaces

| Surface     | Package                    | Status                                    |
|-------------|----------------------------|-------------------------------------------|
| TypeScript  | `@neuropause/sdk`          | Fully implemented + tested                |
| CLI         | `@neuropause/cli`          | Fully implemented + tested                |
| Webhooks    | `@neuropause/sdk/webhooks` | Fully implemented + tested                |
| REST        | `https://api.neuropause.dev` | Specified by the gateway contract       |
| Python      | `neuropause` (pip)         | Published-shape; not in the npm workspace |

## Verification

Both packages typecheck at 0 errors and pass their test suites (`sdk.test.ts`,
`commands.test.ts`): client routing, version-publish body, webhook
sign/verify/tamper/expiry, builder validation, and CLI dispatch.
