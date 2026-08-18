# OS-track L1 · Workspace Foundation — SLICE 1 (the OBSERVABLE OBJECT) · EVIDENCE

**Status: OBSERVABLE OBJECT LANDED — TEST-VERIFIED, non-frozen, no FG gate.** The first approved OS-track slice. FREEZE INTACT.

## The observable object
`enterprise/workspaceFoundation/domainAggregate.ts` — `composeWorkspaceDomain(specs, sources)` → a `WorkspaceDomainSnapshot`:
a queryable, tenant-scoped DOMAIN AGGREGATE over the governed enterprise-module stores (people · organizations ·
customers · projects · tasks · documents · workflows · policies · approvals · actions · evidence · memory). It is NOT a
new persistence store — the data already lives in ~106 tenant-scoped `EnterpriseRecordStore`s behind the registry. This
is a READ/aggregate-ONLY façade (pure over injected sources), reading only through the stores' already-scoped counts.

## The five acceptance fields — each to a named test (`domainAggregate.test.ts`, 5)
| field | how it's honored | test |
|---|---|---|
| **Observable object** | a `WorkspaceDomainSnapshot` (slices with scoped counts + state) evidence can point at | the module + all 5 tests |
| **Collection boundary** | reads ONLY scoped module counts under the active tenant scope; never merges across tenants | `COLLECTION BOUNDARY` (A's snapshot never shows B's rows) |
| **Capability contract** | READ/aggregate ONLY — `in` = scoped stores, `out` = a snapshot; mutates neither specs nor sources; never writes/executes/grants | `CAPABILITY CONTRACT` (no in-place mutation) |
| **Verification** | each slice count is a FAITHFUL projection of a scoped store read — computes no new number | `VERIFICATION` (slice.count === the injected store count) |
| **Failure/UNKNOWN** | no scope → the whole snapshot is UNKNOWN (empty), never "all data"; an absent store → UNAVAILABLE, DISTINCT from present-but-empty (0) | `FAILURE/UNKNOWN` ×2 |

## Constraint (L1, binding) — honored
Tenant-scoped (reads inherit isolation from each store's scoped `count` under `activeTenantScope`) and READ/aggregate-only
(it never writes/executes/grants — writes stay in the governed module stores). Proven by the collection-boundary +
capability-contract tests.

## Non-frozen — no FG gate
The façade is a new `main` module reading existing stores + importing canonical shared types (reading a type is not a
frozen touch, D-6/D-7/D-13). Proofs: `domainAggregate.test.ts` (5) + full main + typecheck node + lint clean.

## Remaining (next increment, non-frozen)
The LIVE wiring — bind the sources to the real `EnterpriseModuleRegistry` (`registry.get(id)?.store.count()`) under
`activeTenantScope`, with the verified real `moduleId` strings, and surface the snapshot via an EXISTING `enterprise:*`
channel (e.g. `enterprise:modules`/`enterprise:context`, non-frozen handlers) — reuse, not a new channel. A brand-new IPC
channel would be the only thing forcing an FG gate; the scout confirmed the whole façade path is otherwise non-frozen.
The observable object + its acceptance proofs land first (this slice); the live registry/channel wiring follows.
