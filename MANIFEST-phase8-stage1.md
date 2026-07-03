# NeuroPause — Phase 8 · Stage 1 (Developer & Marketplace Platform)

Overlay onto the existing repo from the **repo root**. Two new workspace packages
(`packages/sdk`, `packages/cli`) require `npm install` after unzip so npm links
their symlinks.

## New files

### Shared domain + contracts
- packages/shared/src/types/ecosystem.ts

### Main process — ecosystem engines (apps/desktop/src/main/ecosystem)
- developer/developerStore.ts
- developer/developerInstance.ts
- developer/analytics.ts
- marketplace/pipeline.ts            (security scan + Ed25519 signing, pure)
- marketplace/marketplaceStore.ts
- marketplace/marketplaceInstance.ts
- marketplace/seeds.ts
- gateway/gateway.ts                 (decision engine, pure)
- gateway/gatewayStore.ts
- gateway/gatewayInstance.ts
- billing/billing.ts                 (plan catalog + invoice math, pure)
- billing/billingStore.ts
- billing/billingInstance.ts
- index.ts                           (composition root + 37 IPC handlers + gateway request path)
- marketplace/pipeline.test.ts
- gateway/gateway.test.ts
- billing/billing.test.ts
- stores.test.ts

### Public SDK (packages/sdk — @neuropause/sdk)
- package.json, tsconfig.json
- src/transport.ts, src/resources.ts, src/client.ts, src/webhooks.ts, src/builders.ts, src/index.ts
- src/sdk.test.ts

### CLI (packages/cli — @neuropause/cli)
- package.json, tsconfig.json
- src/commands.ts, src/cli.ts, src/index.ts
- src/commands.test.ts

### Renderer — Developer Portal (apps/desktop/src/renderer/src/developer)
- lib.ts, DeveloperProvider.tsx, primitives.tsx
- DeveloperDashboardPanel.tsx, ApiKeysPanel.tsx, MarketplacePanel.tsx
- GatewayPanel.tsx, BillingPanel.tsx, SdkDocsPanel.tsx
- DeveloperView.tsx
- apps/desktop/src/renderer/src/views/DeveloperView.tsx

### Documentation (docs/ecosystem)
- README.md, developer-portal.md, marketplace.md, sdk.md, api-gateway.md, billing.md

## Modified files
- packages/shared/src/index.ts                         (export ecosystem types)
- packages/shared/src/ipc/channels.ts                  (+38 ecosystem channels)
- packages/shared/src/ipc/contracts.ts                 (+ecosystem zod contracts)
- apps/desktop/src/main/runtimeCore.ts                 (init + register ecosystem handlers)
- apps/desktop/src/renderer/src/lib/ipc.ts             (+ipc.ecosystem namespace)
- apps/desktop/src/renderer/src/shell/sections.ts      (+ "developer" section)
- apps/desktop/src/renderer/src/shell/AppShell.tsx     (+ developer route)
- README.md                                            (roadmap + docs pointer)

## Verification (in-container)
- node tsc (tsconfig.node.json): 0 errors
- web  tsc (tsconfig.web.json): 0 errors
- @neuropause/sdk tsc: 0 errors · @neuropause/cli tsc: 0 errors
- electron-vite build: succeeds; DeveloperView chunk emitted (~93 kB)
- vitest (whole repo): 38 files / 205 tests passing
- IPC parity: 38 channels = 37 invokable handlers + 1 broadcast

On boot, secure-IPC registers **170 handlers** (133 prior + 37 ecosystem) and logs
`Ecosystem platform ready { developer, plan, listings, signingKey, seats }`.
