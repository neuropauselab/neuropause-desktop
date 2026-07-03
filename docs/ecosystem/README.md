# Ecosystem Platform — Architecture

> Phase 8, Stage 1 (Developer & Marketplace Platform). The layer that turns
> NeuroPause from an enterprise **product** into an enterprise **platform** that
> third-party developers and partners build on.

## What it is

Stage 1 ships the platform plumbing: a developer portal, a publishing
marketplace with a real security + signing pipeline, a versioned API gateway,
public SDKs + a CLI, and usage-based billing with licensing. It is real
production code — persisted to disk, type-checked (`tsc` 0 errors on both the
Node and web projects), and unit-tested (full `vitest` pass, including new
suites for the scan/sign pipeline, gateway decisions, billing math, and every
store).

It is composed of five pieces, each with its own document:

- **[Developer Portal](./developer-portal.md)** — developer accounts, API keys
  (scoped, hashed, shown once), OAuth applications, usage analytics, the SDK
  catalog, and the dashboard that rolls it all up.
- **[Marketplace](./marketplace.md)** — listings and versions with a full
  lifecycle: submit → **security scan** → **Ed25519 signing** → review →
  publish → rollback, plus install and rating.
- **[Public SDK & CLI](./sdk.md)** — `@neuropause/sdk` (a transport-agnostic
  typed client, webhook signing/verification, and worker/connector/plugin
  builders) and `@neuropause/cli` (built on the SDK).
- **[API Gateway](./api-gateway.md)** — the request decision engine:
  authentication, scope authorization, rate limiting, quotas, API versioning,
  audit, and monitoring.
- **[Billing & Licensing](./billing.md)** — Free / Pro / Enterprise plans,
  usage-based overage, seat assignment, organization & seat licensing, and
  marketplace purchases.

## Stage 2 — the Enterprise Ecosystem

Stage 2 adds the **org-facing** side of the platform on top of the Stage 1
marketplace: consuming, sharing, and measuring across the network.

- **[AI Worker Marketplace](./worker-marketplace.md)** — install/update/rate
  worker listings, and share a live workforce worker (it runs the real
  scan → sign → submit pipeline).
- **[Connector Marketplace](./connector-marketplace.md)** — connector listings
  by certification tier (community / enterprise / certified).
- **[Enterprise Template Marketplace](./template-marketplace.md)** — workflows,
  governance policies, approval chains, dashboards, and industry templates.
- **[Organization Exchange](./organization-exchange.md)** — share and adopt
  packs (knowledge / worker / automation / connector bundles) across orgs.
- **[Partner Platform](./partner-platform.md)** — a directory of technology,
  consulting, system-integrator, and MSP partners.
- **[Ecosystem Analytics](./ecosystem-analytics.md)** — growth, downloads,
  revenue, active developers/organizations, usage, and a health score.

Stage 2 adds a per-org **installs** store, an **exchange packs** store, a
**partners** directory, and a pure **ecosystem analytics** rollup, surfaced
under a new **Ecosystem** section in the app. Its honest seams: the exchange
network's external organizations and the partner directory are seeded fixtures
(single-tenant app); template "apply" records adoption rather than mutating the
live enterprise governance runtime; and the analytics growth series is
synthesized from listing + install dates rather than a separate time-series
table.

## Where it lives

```
packages/shared/src/types/ecosystem.ts      domain types
packages/shared/src/ipc/{channels,contracts} 38 IPC channels + zod contracts
apps/desktop/src/main/ecosystem/             the four engines + stores + composition root
  developer/   marketplace/   gateway/   billing/
apps/desktop/src/renderer/src/developer/     the Developer Portal surface (6 panels)
packages/sdk/                                @neuropause/sdk
packages/cli/                                @neuropause/cli
docs/ecosystem/                              this documentation
```

The four engines load at boot in `main/ecosystem/index.ts`, bind the seeded
developer/owner to the signed-in account, keep the developer plan and billing
subscription in lock-step, and register every `ecosystem:*` IPC channel behind
the secure bridge (the only path the renderer may use). Each store change emits
a single `ecosystem:event` broadcast that the renderer debounces to stay live.

## Honest seams

This stage is deliberately precise about what is real and what is a seam ready
to be extended:

- The **API gateway** is a real in-process policy / rate-limit / quota / audit
  engine. It is not yet deployed as a standalone edge service — the same pure
  decision engine is designed to be fronted by the existing Express backend or
  an edge runtime without change.
- **Security scanning** is a real, deterministic static analysis of a package
  manifest (dangerous permissions, undeclared network, suspicious dependencies,
  missing entry, least-privilege advisories). It is not a sandboxed dynamic
  scanner or a third-party cloud service.
- **Digital signing** is real **Ed25519** signing over the manifest digest,
  using a keypair generated and persisted locally on first run. Verification is
  real. In production the private key would live in an HSM / KMS.
- **Billing** computes real, deterministic invoices and a usage summary, and
  tracks seats, licenses, and purchases. It does **not** charge a card — there
  is no payment processor integration in this stage.
- The **TypeScript SDK + CLI** are fully implemented and tested. The **Python
  SDK** is described as a real published-shape package; it is not part of the
  npm workspace typecheck. **REST + Webhooks** are specified by the gateway
  contract; the SDK ships the webhook signing/verification helpers.

Nothing is faked or stubbed: where a capability is in-process rather than
deployed, that is stated, and the code is structured so the deployed form is a
drop-in.
