# NeuroPause — Final Platform Architecture

> The capstone document. With Phase 9 Stage 2 complete, the core NeuroPause
> platform architecture is **feature-complete**. This describes the whole system
> as it now stands and how the nine phases compose into one coherent product.
> The next milestone is **Release 1.0**, not Phase 10.

## What NeuroPause is

NeuroPause is an **AI Operating Layer** delivered as a production macOS
(Apple Silicon) desktop application — Electron + React + TypeScript, with a
local-first data core and a distributed, federated control plane. It is not a
chatbot. It is the workspace in which a person (and an organization) discovers AI
products, launches them, connects their accounts, builds an AI memory timeline,
receives intelligent summaries and reminders, automates workflows, and — at the
top of the stack — collaborates securely across organizations.

## The layered architecture

The platform is built in nine phases that stack into five conceptual layers.
Each layer depends only on the ones below it; each is type-checked and unit-
tested; every cross-boundary call is a Zod-validated IPC message behind a secure
bridge with context isolation.

```
┌─────────────────────────────────────────────────────────────────────┐
│  FEDERATION              Phase 9 · Stage 2                            │
│  cross-org runtime · signed exchange · marketplace scopes ·          │
│  global governance · observability · disaster recovery · admin       │
├─────────────────────────────────────────────────────────────────────┤
│  CLOUD                   Phase 9 · Stage 1                            │
│  multi-tenant runtime · identity federation · cloud sync ·           │
│  API platform · enterprise administration                            │
├─────────────────────────────────────────────────────────────────────┤
│  ECOSYSTEM & ENTERPRISE  Phases 7–8                                   │
│  org / workspace / governance · developer portal · marketplace       │
│  (Ed25519) · gateway · billing · SDK · CLI · exchange                │
├─────────────────────────────────────────────────────────────────────┤
│  INTELLIGENCE & WORKFORCE  Phases 5–6                                 │
│  knowledge graph · timeline · summaries · reminders (no-LLM) ·       │
│  AI workforce (registry · jobs · orchestrator · audit · policy)      │
├─────────────────────────────────────────────────────────────────────┤
│  FOUNDATION              Phases 1–4                                   │
│  Electron shell · auth · dashboard / workspace · AI Store ·          │
│  16 OAuth connectors · Unified Data Model                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Foundation (Phases 1–4)

The Electron shell with secure context isolation, OAuth/OIDC authentication with
secure token storage, the dashboard / sidebar / workspace / command palette, the
AI Store with categories and search, sixteen OAuth connectors over official APIs
with a connector SDK and plugin architecture, and the **Unified Data Model** that
normalizes every connector's data into one shape.

### Intelligence & Workforce (Phases 5–6)

The **Enterprise Intelligence** layer: a knowledge graph, activity timeline,
daily summaries, and a reminder engine — all **deterministic and LLM-free**,
projecting and querying 5,000 entities in under 20ms. On top of it the **AI
Workforce**: a registry of nine worker roles, a job store, an orchestrator that
runs workflow branches in parallel, an immutable audit log, and a policy engine —
with twenty skills and four governance policies. Every AI-facing surface is
read-only or propose-only; side effects require human approval.

### Ecosystem & Enterprise (Phases 7–8)

The **Enterprise Operating System**: organizations, units, roles, members,
workspaces, governance, and an org graph — the persistence template the whole
platform reuses. The **Developer & Marketplace** ecosystem: a developer portal,
a marketplace with real Ed25519 package signing, an API gateway, billing, an SDK,
a CLI, and a partner exchange.

### Cloud (Phase 9 · Stage 1)

The control plane that makes one organization's platform distributed: a
multi-tenant runtime across regions with storage isolation, identity federation
(SAML / OIDC / SCIM / MFA), offline-first cloud synchronization of every
local-first store, the API gateway deployed as a cloud service, and enterprise
administration.

### Federation (Phase 9 · Stage 2)

The final layer, documented throughout this folder: secure collaboration across
organizations — a federation runtime with trust-gated sharing, a signed
organization exchange, marketplace scopes, global governance with a shared audit
trail, enterprise observability, disaster recovery, and centralized
administration — all while preserving tenant isolation.

## Cross-cutting principles

These hold at every layer and are what make the architecture coherent rather than
a pile of features:

1. **Security by construction.** Context isolation; a single secure IPC bridge;
   every message validated by a Zod schema; sensitive material in the OS
   keychain or encrypted; least privilege; audit logging. **270 IPC handlers**
   all register the same way.
2. **Determinism where it counts.** The intelligence engines are LLM-free and
   reproducible; the governance engine is a pure function of its inputs. The same
   inputs always yield the same outputs, which is what makes the platform
   testable and auditable.
3. **Human approval for side effects.** Every AI-facing surface is read-only or
   propose-only; anything with a side effect requires explicit human approval and
   lands in an audit trail.
4. **Local-first, then distributed.** Data lives locally first (atomic JSON
   stores that are `EventEmitter`s) and synchronizes outward. The same store
   interface is the extension point to Postgres/Redis.
5. **Honest seams.** Where something is modeled rather than physically wired
   (federation peers, cloud sync transport, DR restore), it is labeled as such in
   code and docs. Nothing fabricates data; synthetic numbers are marked and
   modeled guarantees are named. Each phase's seams are documented in its folder.

## Engineering posture

- **TypeScript everywhere**, strict, with `noUnusedLocals` / `noUnusedParameters`
  enforced. Two projects (Node main, web renderer) both at **0 `tsc` errors**.
- **Tested.** A full `vitest` suite — **38 files, 242 tests** — covering every
  store, every engine, and the cross-subsystem rollups.
- **Builds.** `electron-vite build` produces the packaged main + renderer with
  per-section code-split chunks.
- **Documented.** Every phase has a docs folder; this folder documents the
  federation layer and the platform as a whole.

## From here to Release 1.0

The architecture is complete. Release 1.0 is a **productization** milestone, not
an architectural one. The work that remains is the kind that turns a complete
architecture into a shipped product: replacing the modeled seams with their named
production backends (a real sync transport, a graph database, a DR target
cluster, live federation nodes), packaging and code-signing the macOS app,
hardening, and the operational scaffolding (telemetry, crash reporting, update
delivery) that a 1.0 needs. The capacity envelopes and extension points in
[scalability.md](./scalability.md) are the map for that work.
