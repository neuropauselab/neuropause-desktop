# OS-track L1 · Workspace Foundation — SLICE 1 (the domain aggregate) · EVIDENCE

**Status: L1's FIRST CLOSED SLICE — TEST-VERIFIED, non-frozen, no FG gate.** The domain aggregate (observable object +
live wiring against real stores + local-mode honesty) is complete and closed. Its renderer SURFACE hit a frozen response
type and is presented as **FG-8** (a distinct Slice-2), not worked around. This counts as L1's first closed slice for the
L6 entry condition. FREEZE INTACT.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

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

## LIVE WIRING — re-proven against REAL stores (`domainSources.ts` + `domainSources.test.ts`, 4)
`registryDomainSources(deps)` binds the aggregate's sources to the registry: `moduleCount(id) = moduleStore(id)?.count()
?? null` (null = UNAVAILABLE). `workspaceDomainSnapshot(deps)` composes over `DOMAIN_MODULES` (real ids: `hr-employees`,
`crm-customers`, `leads`, `opportunities`, `projects`, `documents`). READ-only — it only calls the store's already-SCOPED
`count()`. The five acceptance fields are RE-PROVEN against **real `EnterpriseRecordStore` instances** (not fixtures):
- VERIFICATION: each domain count === the real `store.count()` (people = 3, customers = 1) — a faithful projection.
- UNAVAILABLE: a domain with no registered store → `state: 'unavailable'`, distinct from present-but-empty.
- COLLECTION BOUNDARY: a record created under a DIFFERENT scope never counts — tenant isolation inherited from the
  store's scoped `count()` (a two-scope test).
- FAILURE/UNKNOWN: no scope → whole snapshot UNKNOWN even with a populated real store — never "all data".
- CAPABILITY CONTRACT: composing the snapshot writes NOTHING to the real store (`count()` unchanged).

## LOCAL-MODE HONESTY (pinned)
`domainSources.test.ts` → the aggregate under a local principal's tenant scope: the local tenant's records COUNT
(`state: 'present'`), and a domain with no local store is `state: 'unavailable'` with `count: 0` — **the state says
unavailable, never a fabricated "0 customers"**, never an error. No cloud/backend needed. This is the same honest
absence local mode shows everywhere (S17), carried into the domain rollup.

## The renderer SURFACE — FG-8 LANDED (L1 SLICE-2 CLOSED)
Every `enterprise:*` response is in FROZEN `packages/shared`, so surfacing the snapshot required a frozen change — presented
as **FG-8** (not worked around) and landed on the token (`AUTHORIZED: FG-8 — ExecutiveSnapshot workspaceDomain rollup, per
gate doc`; INTACT #1 `43324a2b013f` → INTACT #2 `BASELINE-be240c98d4f2`):
- FROZEN: one additive optional `ExecutiveSnapshot.workspaceDomain` field (no field removed/renamed/retyped).
- Non-frozen: the `enterprise:dashboard` handler joins `workspaceDomainSnapshot` over the REAL module registry (via a
  module-level accessor `initEnterprise` populates) under `activeTenantScope` — the production call-site, one source of
  truth. `toWorkspaceDomainField` carries states + counts VERBATIM. `WorkspaceDomainRollup` renders the STATE (present →
  count; unavailable → "unavailable", never a fake 0; absent → nothing), mounted in `ExecutiveWorkspacePanel`.
  Truthful-surface + fallback + **local-mode surface** ui-tests pin each displayed value to the snapshot.

**L1 SLICE-2 CLOSED** — the domain rollup is now displayed, truthfully. With Slice-1 (the aggregate) this gives L1 two
closed slices.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability until another earns its own governance + verification
chain. This layer READS/aggregates governed state; it executes nothing.
