# DECISION MEMO — S118 · CONNECTOR READ-ONLY ACTIVATION (STOP: duplicate + contract-needed)

**Date:** 2026-09-04 · **Status:** NOT ACTIVATED (no new policy invented; no duplicate framework created)

## Summary
The S118 connector sub-objective asked to activate ONE safe read-only connector capability *only if genuinely reusable with no new policy requirement*. Source inspection shows the two preferred targets are either **already live** (activating again = duplicate infrastructure, a STOP condition) or **need a defined metadata contract** (a policy/architecture decision, not a drive-by harvest). Per the directive, this sub-objective STOPS with a memo rather than inventing policy or a second framework.

## Findings (source-verified)
- **Read-only connector capability discovery ALREADY EXISTS and is live:**
  - `connectors/index.ts:505` — `ConnectorsList` channel → `connectorService.list()` (governed, read-only, in `RUNTIME_INVOKABLE_CHANNELS`).
  - `capabilities/capabilityDiscoveryService.ts` + `capabilityDiscoveryInstance.ts` — the canonical capability catalog/discovery used by the live propose path (`resolveSelection`) and `capabilityAiContext`.
  Adding another discovery surface would duplicate this — **STOP (do not create a second connector framework / registry).**
- **Inbound-event lineage/context metadata normalization** would touch the S114-verified inbound path (`connectors/inbound/verify.ts`, `inbound/router.ts`). S118 requires preserving S114 webhook verification and event behavior exactly. Shaping "lineage metadata" (what fields, normalized how, joined to which authoritative workspace/tenant context, surfaced where) is a **metadata-contract decision** — it needs a defined schema + consumer, not an ad-hoc field. Doing it safely is its own slice.

## Recommendation (S119 candidate)
Define an **inbound-event lineage metadata contract** first (fields: connectorId, verified-source, receivedAt, tenant/workspace from authoritative context only, dedupe/idempotency ref), as a READ-ONLY projection over the existing S114 event record — reusing the existing connector framework, never creating ERP transactions, never granting AI authority, tenant-scoped from authoritative workspace context. Then implement it as an advisory read surface (its own slice) once the contract is agreed. Until then: not activated.

## What was NOT done (correctly)
No new connector framework; no second discovery surface; no change to the S114 verified webhook/event path; no consequential connector authority widened; no credential exposure; no invented business policy.
