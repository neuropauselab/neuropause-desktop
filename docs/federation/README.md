# Federation Platform — Architecture

> Phase 9, Stage 2 (Cloud & Federation · Federation Platform). The **final
> architectural phase** of NeuroPause. After this stage the core platform
> architecture is feature-complete and the next milestone is **Release 1.0**.

## What it is

The Federation Platform enables secure collaboration **across organizations**
while preserving governance, tenant isolation, and auditability. Where Stage 1
made one organization's platform distributed (multi-tenant, identity-federated,
cloud-synced), Stage 2 lets distinct organizations **federate**: invite each
other, establish trust, share resources, publish to a shared signed exchange,
and operate under federation-wide governance — without weakening the isolation
that keeps each tenant's data its own.

It is real production code — persisted to disk, type-checked (`tsc` 0 errors on
both the Node and web projects), and unit-tested (full `vitest` pass, including
a 21-test suite covering the runtime, exchange signing, governance, the
observability rollup, and disaster recovery).

It is composed of seven areas, each with its own document where the depth
warrants it:

- **[Federation Runtime](./federation-runtime.md)** — federated peers,
  organization invitations (inbound + outbound), trust relationships with
  delegated approval and share capabilities, and shared resources in both
  directions. Sharing is gated on trust.
- **[Organization Exchange](./organization-exchange.md)** — publishable,
  **Ed25519-signed**, versioned artifacts across six kinds, with ratings,
  verification, and rollback.
- Enterprise Marketplace — the four visibility scopes (private / public /
  partner / regional) layered over the exchange; see the exchange doc.
- **[Global Governance](./global-governance.md)** — federation-wide policies, a
  most-restrictive-wins evaluation engine, delegated approvals, a shared audit
  trail, and compliance rules.
- **[Enterprise Observability](./observability.md)** — a single operational view
  rolling live counts from every subsystem, plus historical usage reporting and
  a security event log.
- **[Disaster Recovery](./disaster-recovery.md)** — backups, multi-region
  replication, **sandbox** recovery validation, and the business-continuity
  posture.
- Federation Administration — the centralized control plane folding the runtime,
  governance, and DR summaries; see the architecture doc.
- **[Scalability](./scalability.md)** — validated capacity envelopes, headroom,
  named extension points, and measured engine benchmarks.

For how all nine phases fit together, see
**[Final Platform Architecture](./final-platform-architecture.md)**.

## Where it lives

```
apps/desktop/src/main/federation/
  runtime/        fedStore.ts            peers, invitations, trust, shared resources
  exchange/       signing.ts             Ed25519 sign/verify over a canonical manifest
                  exchangeStore.ts       signed, versioned artifacts + scopes
  governance/     globalGov.ts           pure evaluation engine + compliance builder
                  globalGovStore.ts      policies, approvals, shared audit trail
  observability/  observability.ts       pure subsystem rollup
                  observabilityStore.ts  historical usage + security events
  dr/             drStore.ts             backups, replicas, sandbox validation
  admin/          fedAdmin.ts            pure control-plane rollup
  scalability/    scalability.ts         pure capacity report
  index.ts        composition root + 43 IPC handlers + fed:event broadcast

apps/desktop/src/renderer/src/federation/
  FederationProvider.tsx                 loads every slice, subscribes live
  FederationView.tsx                     container (7 tabs)
  RuntimePanel / ExchangePanel / MarketplacePanel / GovernancePanel /
  ObservabilityPanel / RecoveryPanel / AdminPanel
  lib.ts                                 tab model, tone metadata, formatters
```

The shell mounts it as the **Federation** section (after Cloud). Every side
effect is a typed IPC call validated by a Zod schema in the main process; all
43 handlers register behind the same secure bridge as the rest of the app,
bringing the total to **270**.

## What is real vs. modeled (honest seams)

This is a single-node, in-process model of a cross-organization federation. To
be precise about what is genuinely implemented and what is fixture-backed:

- **Peers** (Helios Commerce, Aperture Capital, Northwind Labs, Quanta Group)
  are **seeded fixtures**, not live remote organizations. There is no network
  transport between real federation nodes in this milestone.
- **The trust model and sharing gates are real.** Sharing an AI worker requires
  `canShareWorkers`; collaborative data sharing requires `canShareData`; trust
  levels and delegated-approval flags drive evaluation. These are enforced in
  code, not decoration.
- **Exchange signatures are real Ed25519.** Artifacts are signed over a
  canonical manifest with a keypair generated on first run and persisted (PEM);
  `verifyVersion` performs a genuine cryptographic verification and a tampered
  manifest fails. This is the same primitive the Phase 8 marketplace uses.
- **Global governance evaluation and the shared audit trail are real.** Every
  federated action is evaluated against the policy set (most-restrictive-wins)
  and recorded immutably; actions requiring approval open a delegated approval.
- **Observability rolls real live counts** from the workforce registry, the
  connector service, cloud sync, the API platform, the API gateway, and the
  knowledge graph — combined with a stored 14-day usage history.
- **DR backups are metadata records**, not physical data dumps. **Restore and
  recovery validation run in a sandbox** — they verify backup integrity and
  compute RPO/RTO without ever touching production data. Replication is modeled
  per region with independent lag.
- **Scalability limits document the real in-process ceilings** of this design
  and name exactly where the architecture extends to a distributed deployment.

Everything above carries forward the Phase 1–8 and Stage-1 seams unchanged.
Nothing here fabricates data: where a number is synthetic it is labeled, and
where a guarantee is modeled it is named.
