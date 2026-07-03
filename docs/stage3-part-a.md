# Phase 3 · Stage 3 — Part A: The Marketplace

Part A transforms the AI Store from a placeholder grid into a premium, navigable
marketplace. It is **renderer-only** work: every screen is built on the Stage 1
backend and Stage 2 runtime, consumed through the existing secure IPC bridge
(`renderer/src/lib/ipc.ts`). No backend, preload, or main-process changes were
required (the CSP already permits remote screenshot images).

## What ships in Part A
- **Marketplace Home** — a rotating editorial hero plus eleven lazy-loaded
  section rails (Recommended, Trending, New, Staff Picks, MCP Servers, AI Agents,
  Automation, Local AI, Open Source, Enterprise, Verified). Live search and
  category filtering switch the home into a paginated results grid.
- **App Detail** — a dedicated page per app: hero, screenshot carousel,
  description, capabilities, permissions, what's-new + version history, ratings &
  reviews, and an information sidebar (developer, runtime, platform, license,
  links) plus the Phase-4 connection panel.
- **Install Flow** — a visual, stepped install modal (permission review →
  resolve → download → verify → signature → install/register → launch) driven by
  the **real** NPS pipeline and its live progress events.
- **Phase-4 seam** — every card and detail page renders connection state
  (connected / connector available / none) so connectors slot in cleanly later.

## Folder structure (new)
```
renderer/src/store/
  StoreApp.tsx          Root: home ↔ detail switch + install modal host
  StoreProvider.tsx     Store state: route, installed set, install modal, launch
  MarketplaceHome.tsx   Hero + rails, or search/category results grid
  HeroBanner.tsx        Rotating featured hero (ipc.catalog.featured)
  AppRail.tsx           Lazy horizontal shelf (IntersectionObserver-armed fetch)
  StoreAppCard.tsx      Premium app card (glyph, rating, pricing, connection)
  AppDetail.tsx         Full detail page (+ Reviews subcomponent)
  ScreenshotCarousel.tsx Snap-scrolling screenshot gallery
  InstallFlow.tsx       Visual stepped install modal over real NPS
  RatingStars.tsx       Five-star display
  StoreImage.tsx        <img> with graceful tinted fallback (offline-friendly)
  sections.ts           Rail definitions (section key | search params)
  lib.ts                Pure helpers: tone/glyph/price/bytes, permission meta,
                        connection seam, literal tint classes
components/ui/Icon.tsx   Extended with 24 store icons (60 total, exhaustive)
views/StoreView.tsx      Thin wrapper → <StoreApp/> (keeps the shell's export)
```

## State management
The shell stays route-free: the AI Store lives in the `store` shell section, and
its **internal** navigation (home ↔ app detail) is local React state in
`StoreProvider` (`route: {name:'home'} | {name:'detail', slug}`). This keeps
`AppShell` untouched and detail navigation instant. The provider also holds:
- `installs: Map<slug, RegistryEntryDto>` — read from the Local Application
  Registry (`ipc.registry.list`), refreshed after every install.
- `installing: StoreAppDetail | null` — the app whose install modal is open.
- `launch(slug, name)` — opens the app in a Workspace tab (`useShell().openApp`).

## Runtime interaction (install)
`InstallFlow` calls `ipc.nps.install({ slug, grantedPermissions })` and subscribes
to `ipc.nps.onProgress` to animate the stepper from real status transitions
(`resolving → downloading → verifying → installing → completed`). On success it
refreshes the registry so the app immediately shows **Installed / Open**.

## Honest boundaries
- Install works end-to-end for **web** apps (ChatGPT, Claude, etc.) — they
  register in the Local Registry and then show "Open". Non-web packages reach the
  artifact-CDN boundary and surface a clear error in the flow (no fabrication).
- Fields without a backing column (video preview, separate company, dependency
  list, install size) are **derived where sensible or omitted** — never invented.
- **Launch** opens the app in a Workspace tab (the proven path). Live runtime
  instances, plugin UI rendering, and the management cockpit are **Part B**.

## Deferred to Stage 3 · Part B (the management cockpit)
Runtime Panel · Plugin Manager · Download Center · Update Center · Permission
Center · App Collections.
