# OS-track L4 · Capability Graph — LIVE WIRING · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: LIVE WIRING LANDED — TEST-VERIFIED, non-frozen, no FG gate.** The graph's sources are bound to the REAL
assurance predicate; the five fields re-proven against it. FREEZE INTACT. This closes the "Remaining" item of L4 Slice 1.

## What was wired
`capabilityGraph/liveSources.ts` — `capabilityGraphSources(deps)` binds `composeCapabilityGraph`'s sources to the real
substrate:
- **assurance** ← the REAL `mutationAssuranceFor(connectorId)` (`liveCapabilitySources.ts`) — not a fixture.
- **lane** ← the BRAIN-1 `draft` lane serving the deterministic `referenceDrafter` (D-13), for `mail.send`.
- **workflow** ← the one certified governed workflow that resolves today: `capability:m365.propose → governedSend`.
- **scope** ← fail-closed on the resolved tenant (`activeWorkspaceId !== null` → the caller's `scope()`).
The wiring takes the discovery catalog's mutations as its input (`CatalogMutation[]`) and maps each to the graph's
`DiscoveredCapabilityLite` through that real predicate — READ-only, no executor imported.

## HONEST FINDING — live wiring corrected a Slice-1 assumption
Slice 1's substrate report (from the scout) stated the M365 write cohorts are `governance-not-proven` and would therefore
land as **NOT_GOVERNED**. Wiring to the real code surfaced that `mutationAssuranceFor` is a **PER-CONNECTOR** predicate:
**every** `microsoft-entra` mutation reads `governed-certified`. So a cohort mutation (e.g. `calendar.create`) on that
connector is `governed-certified` per the real predicate and lands as **MISSING** (it resolves no lane/workflow yet) — NOT
`NOT_GOVERNED`. The `NOT_GOVERNED` path is therefore proven with a genuinely **non-certified connector** (`slack`), which
is what the real predicate actually excludes. The per-CAPABILITY distinction that would let the graph mark M365 cohorts
`NOT_GOVERNED` (mail.send's full chain vs a cohort's absent S16 oracle/FG-4/evidence) is exactly **S23's 14-field
record** — recorded as MISSING, never invented here. This is the value of live wiring: reality replaced an assumption.

## The five acceptance fields — re-proven against the REAL predicate (`liveSources.test.ts`, 5)
| field | how it's honored (LIVE) | test |
|---|---|---|
| **Observable object** | a `CapabilityGraphSnapshot` composed over the real `mutationAssuranceFor` | all 5 |
| **Collection boundary** | unresolved tenant → EMPTY graph (no routes, no gaps), never "all capabilities" | `no invention … empty graph` |
| **Capability contract** | `mail.send` is the ONE fully-routable capability: PURPOSE→CAPABILITY→LANE(draft, serving referenceDrafter)→CONNECTOR(microsoft-entra)→WORKFLOW(propose→governedSend); proposes, never executes | `mail.send is the ONE fully-routable capability` |
| **Verification** | every route/gap names a real catalog mutation — no invention; the routable set is exactly the certified capability that resolves | `no invention …` |
| **Failure/UNKNOWN** | non-certified connector → **NOT_GOVERNED** (never routed around); certified-connector mutation with no lane/workflow → **MISSING** (not a fabricated route) | `NON-certified connector → NOT_GOVERNED` · `no resolved lane/workflow → MISSING` |

## Proposal-only invariant — EXTENDED to the wiring module (pinned)
`liveSources.test.ts` reads `liveSources.ts` and asserts no value-import matches
`executor|governedSend|governedAction|cst/|connectors/index|CstKernel` — the wiring reads registries/predicates and has
NO import path into execution, exactly as the graph model and the S34a ActionRecord observer do. Its only value import is
the READ-only `mutationAssuranceFor`.

## Non-frozen — no FG gate
New `main` module + test importing an existing predicate; no new IPC channel, no frozen touch. Proofs:
`liveSources.test.ts` (5) + full main (**837 files, 8826 passed / 3 skipped**) + typecheck node + lint clean.

## Remaining (next increment, non-frozen)
Feed the wiring from the live `capabilityDiscoveryService.catalog()` instance (an active workspace + accounts) rather than
the caller-supplied `CatalogMutation[]`, and surface the snapshot via an existing `capability:*`/`enterprise:*` handler
(reuse, not a new channel). S23 would upgrade the per-connector assurance tag to the per-capability 14-field record that
distinguishes mail.send from the cohorts.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability until another earns its own governance +
verification chain. This layer READS the assurance predicate and PROPOSES routes; it executes nothing.
