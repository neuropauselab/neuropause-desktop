# NeuroPause — Phase 8 · Stage 2 (Enterprise Ecosystem)

Overlay onto the existing repo (with Stage 1 already applied) from the **repo
root**. No new workspace packages this stage, so **no `npm install` is needed**.

## New files

### Shared
- packages/shared/src/types/ecosystem-exchange.ts   (installs, packs, partners, analytics types)

### Main process — exchange layer (apps/desktop/src/main/ecosystem/exchange)
- installsStore.ts        (per-org installations)
- packsStore.ts           (Organization Exchange packs; seeded)
- partnersStore.ts        (Partner directory; seeded)
- analytics.ts            (pure ecosystem analytics rollup)
- installsInstance.ts, packsInstance.ts, partnersInstance.ts
- exchange.test.ts        (installs / packs / partners stores)
- analytics.test.ts       (ecosystem analytics)

### Renderer — Ecosystem surface (apps/desktop/src/renderer/src/ecosystem)
- lib.ts, EcosystemProvider.tsx, MarketplaceCard.tsx
- WorkerMarketplacePanel.tsx, ConnectorMarketplacePanel.tsx, TemplateMarketplacePanel.tsx
- OrgExchangePanel.tsx, PartnersPanel.tsx, EcosystemAnalyticsPanel.tsx
- EcosystemView.tsx
- apps/desktop/src/renderer/src/views/EcosystemView.tsx

### Documentation (docs/ecosystem)
- worker-marketplace.md, connector-marketplace.md, template-marketplace.md
- organization-exchange.md, partner-platform.md, ecosystem-analytics.md

## Modified files
- packages/shared/src/index.ts                       (export ecosystem-exchange types)
- packages/shared/src/ipc/channels.ts                (+15 Stage 2 channels)
- packages/shared/src/ipc/contracts.ts               (+Stage 2 zod contracts)
- apps/desktop/src/main/ecosystem/index.ts           (load stores + 15 handlers + share-worker bridge)
- apps/desktop/src/renderer/src/lib/ipc.ts           (+15 ipc.ecosystem methods)
- apps/desktop/src/renderer/src/shell/sections.ts    (+ "ecosystem" section)
- apps/desktop/src/renderer/src/shell/AppShell.tsx   (+ ecosystem route)
- docs/ecosystem/README.md                           (Stage 2 overview)

## Verification (in-container)
- node tsc: 0 errors · web tsc: 0 errors
- electron-vite build: succeeds; EcosystemView chunk emitted (~58 kB)
- vitest (whole repo): 40 files / 212 tests passing
- IPC parity: 53 ecosystem channels = 52 invokable handlers + 1 broadcast

On boot, secure-IPC registers **185 handlers** (170 prior + 15) and logs a
second ecosystem line: `Ecosystem network ready { installs, packs, partners }`.

## Phase 8 status
Stage 2 completes **Phase 8 (Developer & Marketplace Platform + Enterprise
Ecosystem)**. Awaiting your go-ahead before Phase 9 (Cloud & Federation).
