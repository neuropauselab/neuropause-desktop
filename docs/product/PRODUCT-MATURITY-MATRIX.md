# NeuroPause — Product Maturity Matrix

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: program, product, pilot leads
>
> The definitive release-readiness view, per capability, grounded in the repository. Honesty rule: a column is only ticked where evidence exists. **GUI Verified is PENDING across the board** — desktop visual/interaction QA is a human task on macOS and has not been signed off. **E2E** ticks reflect the Phase-3 backend certification (cloud plane) against real PostgreSQL 16 + Redis 7; desktop end-to-end through the GUI is pending.

**Legend:** ✓ evidence exists · — not applicable / not present · **P** pending (GUI) · **dep** requires external provider.

| Capability | Implemented | Unit tested | Integration | E2E (cloud) | GUI verified | Pilot ready | Class / dependency |
|---|---|---|---|---|---|---|---|
| Authentication (JWT/argon2) | ✓ `apps/backend/src/auth` | ✓ (~52) | ✓ (auth `__integration__`) | ✓ (Phase 3) | P | ✓ | Cloud |
| — OAuth (GitHub/Entra/Google/Apple) | ✓ PKCE providers | ✓ | — | — | P | dep | External (IdP registration) |
| Local-first record persistence | ✓ `enterpriseRecordStore` | ✓ (~32) | — | — | P | ✓ | Local-first |
| Finance | ✓ `modules/finance` | ✓ (~192) | — | — | P | ✓ | Local-first |
| CRM | ✓ `modules/crm` | ✓ | — | — | P | ✓ | Local-first |
| HR | ✓ `modules/hr` | ✓ (~83) | — | — | P | ✓ | Local-first · RBAC privacy gating |
| Procurement | ✓ `modules/procurement` | ✓ | — | — | P | ✓ | Local-first |
| Inventory / Warehouse | ✓ `modules/inventory`,`/warehouse` | ✓ | — | — | P | ✓ | Local-first |
| Manufacturing | ✓ `modules/manufacturing` | ✓ | — | — | P | ✓ | Local-first |
| Projects | ✓ `modules/projects` | ✓ | — | — | P | ✓ | Local-first |
| Knowledge + AI Memory (lexical) | ✓ `main/memory`,`/knowledge` | ✓ (~235) | — | — | P | ✓ | Local-first |
| Semantic search | ✓ `apps/backend/src/semantic` | ✓ (~102) | — | — | P | dep | External (Qdrant + embeddings); degrades to lexical |
| AI Workforce (governed) | ✓ `main/workforce` | ✓ (~219) | — | — | P | ✓ fallback / dep live | External (AI provider) for live execution |
| Automation engine | ✓ `main/executeEngine`,`automationPlatform` | ✓ | — | — | P | ✓ | Local-first |
| Digital Twin | ✓ `main/digitalTwinPlatform` | ✓ (13F) | — | — | P | Preview | **Preview / in-memory** |
| Operations (health/status) | ✓ `main/operationsPlatform` | ✓ (10F) | — | ✓ backend observability | P | ✓ | Local-first + seeded registries |
| Connectors (OAuth) | ✓ `main/connectors` | ✓ (9F) | — | — | P | dep | External (per-provider OAuth apps) |
| AI Store / Marketplace | ✓ `apps/backend/src/store`,`main/marketplace` | ✓ | ✓ (store, Phase 3) | ✓ (Phase 3) | P | catalog ✓ | Cloud catalog (seeded); **install worker-only** |
| Industry solution packs | ✓ `main/industry`,`packages/industry` | ✓ (3F) | — | — | P | Preview | **Preview** (static catalog) |
| Cross-device Sync | ✓ `apps/backend/src/sync`,`main/companion` | ✓ (4F) | ✓ (Phase 3 tenancy) | ✓ (Phase 3) | P | dep | Cloud (opt-in) |
| Mobile companion | ✓ `apps/mobile` | ✓ (11F) | — | — | P | companion scope | External (pairs with desktop gateway) |
| Documentation system | ✓ `docs/` + tooling | ✓ (`docs:validate` 38/38) | n/a | n/a | n/a | ✓ | — |

## How to read this

- **The ERP core (Finance…Projects) and Knowledge/AI-Memory/AI-Workforce are the most mature and best-tested surfaces**, all local-first, with the highest test counts (Finance ~192, Memory ~235, Workforce ~219).
- **Cloud-plane capabilities** (auth, store, sync, tenancy) are the ones with real integration/E2E certification (Phase 3, real Postgres+Redis).
- **Preview** = Digital Twin, Industry, and the other advanced centers — seeded/in-memory, labelled in-app.
- **External dependency** capabilities are fully implemented but off until the operator configures the provider; NeuroPause never fabricates a connected/enabled state.
- **GUI Verified = PENDING everywhere:** the automated gate covers logic and view-models (desktop renderer tests are Node-only); on-device visual/interaction QA on macOS is the outstanding human step before any GUI-verified claim.

## Aggregate

Release gate: **5,703 tests green** across the gated packages on the certified baseline (backend suite re-verified this phase at 418 tests). Documentation: **38/38 governed docs clean**. No capability is claimed GA; the product is a **Release Candidate**.

## Related
[Release Blockers](RELEASE-BLOCKERS.md) · [Pilot Acceptance Criteria](../enterprise/PILOT-ACCEPTANCE-CRITERIA.md) · [Product Brochure](NEUROPAUSE-PRODUCT-BROCHURE.md) · [RC Release Notes](CURRENT-RC-RELEASE-NOTES.md)
