# NeuroPause — Glossary

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: all users
>
> Plain-language definitions. Where a term implies a dependency or maturity, it's noted.

**NeuroPause OS** — NeuroPause's positioning: an AI-native *enterprise operating system* — one desktop workspace that unifies your business modules, AI, knowledge, and operations instead of many separate tools.

**Local-first** — Your enterprise data (business records, knowledge, AI memory, automations) is stored **on your device** by NeuroPause's local data layer, not in the cloud. You keep working with it even when offline.

**Cloud plane** — The small set of account-level services NeuroPause runs in the cloud: sign-in, the AI Store catalog, your organization/device records, billing, cross-device sync, and semantic-search infrastructure. It does **not** hold your business records.

**Backend** — The NeuroPause server that provides the cloud plane. Signing in requires it; most other features degrade gracefully if it's briefly unavailable.

**AI Workforce** — Where you run and supervise **AI workers** — configurable AI agents that do work for you under governance. The pattern is always *intent → governance → permission → execution → evidence*: an AI action runs only when policy and permissions allow, and it leaves a record. Live execution needs an **AI provider** (see below).

**AI provider** — The model backend that powers live AI. NeuroPause supports **Claude** (Anthropic — needs an API key) or **Ollama** (a local model server). Without one configured, AI features fall back to a deterministic, non-generative path rather than failing. *(External dependency.)*

**Knowledge** — The unified, read-only lens over everything your organization knows: search, AI memory, the knowledge graph, and a summary of the enterprise knowledge fabric — with links out to the full surfaces.

**Enterprise Knowledge** — The deep enterprise **knowledge fabric** explorer: relationships, classification, lineage, evidence, and governance across your systems. *(Preview.)*

**Knowledge Graph** — A map of the entities in your organization (people, units, records) and how they relate — used to explain and trace connections. Stored locally.

**AI Memory** — Your personal AI memory: conversations, notes, and things you've saved. Text (lexical) search works locally; smarter **semantic** ranking needs the external vector/embedding stack.

**Semantic search** — Search that ranks by *meaning* rather than exact words. It requires an external vector database + embedding provider; without them, NeuroPause falls back to local lexical search (and says so).

**Digital Twin** — A modeled representation of your organization built from your data, used to explore and analyze enterprise state. *(Preview.)*

**Operations** — The enterprise operations center: operational health, risk, dependencies, incidents, and recommendations.

**AI Operations** — A read-only overview that frames your whole AI stack as one operating loop (plan → reason → orchestrate → decide → govern → optimize) and links to the canonical surfaces.

**Autonomous Operations** — A view of closed-loop, **approval-gated** autonomous operations. Nothing executes without passing the existing approval engine. *(Preview.)*

**Runtime** — Where you monitor and control what's installed and running: apps, plugins, sessions, downloads, updates, and permissions. (Renamed from the old "Operations" section so it no longer collides with the enterprise Operations center.)

**AI Store** — The consumer catalog to discover, install, and launch AI apps. *(Cloud.)*

**Enterprise Marketplace** — The governed catalog of signed enterprise **packages** (workers, connectors, templates, packs) for your organization. *(Preview.)*

**Connector** — A link to an outside system (e.g. GitHub, Slack, Salesforce, SAP). NeuroPause ships 13 connectable integrations plus 9 shown in the catalog as Preview. Each real connection requires signing in to that provider. *(External dependency.)*

**Industry Pack (Industry Solution Pack)** — A vertical bundle for a specific industry (e.g. healthcare, retail, banking) that reuses the enterprise core. NeuroPause defines **20** packs. *(Preview — the industry catalog is at a preview version.)*

**Enterprise API / SDK** — NeuroPause's programmatic surface. Note: the "Enterprise API/SDK" is primarily an **in-process, typed** interface inside the app — **not** a public HTTP Enterprise API. The **cloud HTTP API** (auth, store, organizations, devices, billing, sync) is a separate surface. See the [API / SDK Guide](../developer/API-SDK-GUIDE.md).

**Command Palette** — Press **⌘K** to jump anywhere, run commands, or hand a question to the Assistant. It lists every non-hidden section and searches your content.

**Advanced (sidebar disclosure)** — A collapsible section at the bottom of the sidebar that holds deeper platform, preview, developer, and admin surfaces — so the default view stays focused. Everything in it is still reachable and always in the Command Palette.

**Governance** — The rules that gate sensitive actions (approvals, permissions, compliance). AI and enterprise actions run through governance and leave an audit trail.

**Tenant / Organization** — Your organization's boundary in the cloud plane. Members, workspaces, and roles are scoped to it, and one organization cannot see another's cloud records.

**Preview** — A surface built on real code but running on **seeded or in-memory data** — not yet live production capability. Shown with a "Preview" label so you can tell it apart.

**RC (Release Candidate)** — The current maturity of NeuroPause: feature-complete enough for a pilot and hardened, but **not** declared general-availability / production-verified.

**Pilot** — A structured evaluation of NeuroPause by a team or enterprise, using the pilot and trial guides — real data paths, honest limitations.

**Maturity labels used in these docs** — **Verified** (independently checked), **Local-first**, **Cloud**, **Preview**, **External dependency**, **Pending GUI** (backend proven; on-screen behavior needs the running app), **Known limitation**, **Not configured**, **Planned**.
