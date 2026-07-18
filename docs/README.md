# NeuroPause Documentation

The documentation index for NeuroPause **1.0.0-rc.1 (Enterprise Release
Candidate)**. Everything linked here describes shipped, real behaviour; anything
modeled, partial, or absent is labelled as such in the relevant document. The
single source of truth for the production-readiness classification is the
[Enterprise GA Assessment](../ENTERPRISE-GA-REPORT.md).

---

## Start here

| I want to… | Read |
|---|---|
| Understand the project and architecture | [root `README.md`](../README.md) |
| Install and run the app | [Installation](guides/INSTALLATION.md) · [Quick Start](guides/QUICK-START.md) |
| Understand how sign-in works | [Authentication](AUTHENTICATION.md) |
| Deploy the backend | [Deployment](DEPLOYMENT.md) · [`deploy/README.md`](../deploy/README.md) |
| Fix something that broke | [Troubleshooting](guides/TROUBLESHOOTING.md) |
| See the honest GA readiness verdict | [Enterprise GA Assessment](../ENTERPRISE-GA-REPORT.md) |

---

## Operator guides

The enterprise operator set — written for the people who run NeuroPause in
production. Each guide separates **verified** behaviour from **honest gaps**.

| Guide | Covers |
|---|---|
| [Administrator Guide](guides/ADMINISTRATOR-GUIDE.md) | Organizations, RBAC, identity, governance surfaces |
| [Security Guide](guides/SECURITY-GUIDE.md) | Verified controls, hardening backlog, vulnerability reporting |
| [Operations Guide](guides/OPERATIONS-GUIDE.md) | Day-2 operations, health, metrics, known operational gaps |
| [Disaster Recovery Guide](guides/DISASTER-RECOVERY-GUIDE.md) | Backup / restore, recovery objectives, what is modeled |
| [Release Checklist](guides/RELEASE-CHECKLIST.md) | The gate every release passes before it ships |

---

## Getting started guides

| Guide | Covers |
|---|---|
| [Installation](guides/INSTALLATION.md) | Prerequisites, install, first run |
| [Quick Start](guides/QUICK-START.md) | The fastest path to a working dev environment |
| [Troubleshooting](guides/TROUBLESHOOTING.md) | Common failures and their fixes |

---

## Platform & architecture

| Area | Docs |
|---|---|
| Authentication (PKCE / RFC 8252) | [AUTHENTICATION.md](AUTHENTICATION.md) |
| Deployment (Docker, Kubernetes, Helm, air-gapped) | [DEPLOYMENT.md](DEPLOYMENT.md), [`deploy/README.md`](../deploy/README.md) |
| Enterprise platform | [`enterprise/README.md`](enterprise/README.md) |
| Ecosystem & extensibility | [`ecosystem/README.md`](ecosystem/README.md) |
| Federation | [`federation/README.md`](federation/README.md) |
| Cloud & multi-tenant | [`cloud/README.md`](cloud/README.md) |
| Workforce (workers) | [`workforce/README.md`](workforce/README.md) |
| Intelligence surfaces | [`intelligence/`](intelligence/) |
| Runtime & plugin SDK | [`runtime/PLUGIN-SDK.md`](runtime/PLUGIN-SDK.md) |
| Connectors | [`connectors/connector-lifecycle.md`](connectors/connector-lifecycle.md), [`connectors/connector-sdk.md`](connectors/connector-sdk.md) |
| Design system (NPDS) | [`design/NPDS-FOUNDATION.md`](design/NPDS-FOUNDATION.md) |
| Platform internals (events, timeline, diagnostics) | [`platform/`](platform/) |

---

## Release history

The per-phase engineering reports that document how the platform was built, in
order. Kept for provenance; the current state is always the root
[`README.md`](../README.md) plus the [Enterprise GA Assessment](../ENTERPRISE-GA-REPORT.md).

| Report | Scope |
|---|---|
| [`PHASE-3-REPORT.md`](../PHASE-3-REPORT.md) | Enterprise AI Operating Platform |
| [`PHASE-4-REPORT.md`](../PHASE-4-REPORT.md) | Enterprise Runtime, Cloud & Deployment |
| [`PHASE-5-REPORT.md`](../PHASE-5-REPORT.md) | Platform Ecosystem (Extensibility) |
| [`ENTERPRISE-GA-REPORT.md`](../ENTERPRISE-GA-REPORT.md) | **Enterprise GA readiness assessment (this RC)** |
| [`CHANGELOG.md`](../CHANGELOG.md) | Human-readable change log |

---

## Reading the honesty labels

Throughout the docs, capabilities are tagged so operators can trust the
distinction between what runs and what does not:

- **Verified / Shipped** — implemented, exercised by the test suite, and safe to
  rely on in production.
- **Modeled** — the data model, schema, and surfaces exist and are tested, but
  the capability is not wired to a live external system. Treated as
  demonstration, not production behaviour.
- **Advisory** — the platform surfaces guidance or a plan, but the corrective
  action is executed by a human, not automatically.
- **Absent** — not implemented. Named explicitly rather than implied.

If a document and this index ever disagree, the document wins; please open a
correction.
