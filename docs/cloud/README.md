# Cloud Platform — Architecture

> Phase 9, Stage 1 (Cloud & Federation · Cloud Platform). The layer that turns
> NeuroPause from a **local-first** enterprise platform into a **distributed**
> enterprise operating system.

## What it is

Stage 1 ships the cloud control plane: a multi-tenant runtime across regions
with storage isolation, identity federation (SAML / OIDC / SCIM / MFA),
offline-first cloud synchronization of every local-first store, the API gateway
deployed as a cloud service, and enterprise administration (tenants, users,
usage, billing, compliance).

It is real production code — persisted to disk, type-checked (`tsc` 0 errors on
both the Node and web projects), and unit-tested (full `vitest` pass, including
a new 27-test suite covering tenancy, the federation engine, the sync engine,
the API platform, and the admin rollups).

It is composed of five pieces, each with its own document:

- **[Multi-Tenant Runtime](./multi-tenant.md)** — organizations → tenants →
  regions, with projects, teams, AI worker assignments, and per-tenant storage
  isolation. The local org is the **home tenant**.
- **[Identity Federation](./identity-federation.md)** — SSO connections over
  SAML and OIDC, SCIM provisioning, and an MFA policy, with a real federation
  engine that validates assertions and maps attributes.
- **[Cloud Synchronization](./cloud-sync.md)** — offline-first, incremental
  sync of the eight syncable domains, with server-authoritative conflict
  resolution.
- **[Enterprise API Platform](./api-platform.md)** — the API gateway as a cloud
  service: HA replicas across regions, rate-limit policies, webhooks, public
  APIs, and monitoring.
- **[Enterprise Administration](./administration.md)** — the cross-tenant
  control plane: tenant admin, user management, usage, billing, and a
  compliance report (SOC 2 / GDPR / ISO 27001).

## Where it lives

- **Backend** — `apps/desktop/src/main/cloud/` with five sub-modules
  (`tenancy/`, `identity/`, `sync/`, `apiplatform/`, `admin/`) plus the
  composition root `index.ts`. Each store extends `EventEmitter`, persists
  atomically to `userData` (tmp-write + rename, mode `0600`), and emits
  `changed` so the renderer stays live via a single `cloud:event` broadcast.
- **Shared** — `packages/shared/src/types/cloud.ts` (the domain), plus the
  cloud IPC channels and zod contracts.
- **Renderer** — `apps/desktop/src/renderer/src/cloud/` (provider + five panels
  + the `CloudView` container) behind a new **Cloud** sidebar section.

## IPC surface

42 invokable channels (`cloud:*`) registered behind the secure bridge, with
`audit: true` on every mutation that changes tenancy, identity, or webhook
configuration. All reads are pure; all writes are validated by zod schemas in
the main process before they touch a store.

## Honest seams

Stage 1 is a single-node, in-process control plane that **models** a
multi-region cloud. The boundaries are deliberate and documented per area:

- The **demo tenants** (Helios, Aperture, Northwind) are seeded fixtures
  representing the wider cloud — not real remote tenants.
- **Storage isolation** is a namespace + encryption-key + region/residency
  descriptor, not a separate physical datastore.
- **Identity federation** is real protocol *modeling* (issuer/audience/domain
  validation + attribute mapping + MFA enforcement), not a network round-trip
  to a live IdP. A real SAML signature / OIDC JWKS validator drops in behind the
  same interface.
- **SCIM** records provisioning counts; there is no live SCIM server.
- **Cloud sync** runs the real engine against an **in-process simulated cloud
  mirror** that produces small, plausible deltas — demonstrating offline-first,
  incremental sync, and conflict resolution deterministically. A real backend
  drops onto the same state machine.
- **API platform** deployments and replica health are a modeled control-plane
  view; the gateway decision engine itself (Phase 8) runs in-process. Monitoring
  **request volume is sourced from the real gateway metrics**. Webhook delivery
  is simulated.
- **Billing** for demo tenants is tier-based synthetic; the **home tenant uses
  the real billing subscription**.
- GDPR right-to-erasure is surfaced as a tracked `warn` control.

Everything above is structured so the real cloud backend replaces the simulated
layer without changing the engines, the IPC surface, or the renderer.
