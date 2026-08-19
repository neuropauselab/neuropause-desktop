# OS-track L4 · Capability Graph — SLICE 1 (the OBSERVABLE OBJECT) · EVIDENCE

**Status: OBSERVABLE OBJECT LANDED — TEST-VERIFIED, non-frozen, no FG gate.** L4 needs neither S23 (Cert Kit) nor S28
(Policy DSL) — it reads the REAL substrate that exists today. FREEZE INTACT.

## Dependency finding (honest)
The scout confirmed: the S23 Connector Certification Kit and the S28 Policy DSL are **roadmap only — not built**. But L4
Slice 1 does NOT need them: the REAL certification predicate already exists — `mutationAssuranceFor(connectorId) ===
'governed-certified'` (the M365 `mail.send` vertical: governed CST + FG-4 guard + S16 oracle + S34a evidence) — and the
BRAIN-1 lanes are real. S23 would later enrich the 1-bit assurance to a 14-field record; S28 would enrich policy edge
labels. L4 routes over what is genuinely certified now and reports the rest as gaps.

## The observable object
`capabilityGraph/capabilityGraph.ts` — `composeCapabilityGraph(sources)` → a `CapabilityGraphSnapshot` (routes + gaps):
a pure, READ/PROPOSE-only read-model joining the existing registries (capability discovery + assurance · connector
manifests · BRAIN-1 lanes) into PURPOSE → CAPABILITY → MODEL/LANE → CONNECTOR → WORKFLOW routes over CERTIFIED SUBSTRATE
ONLY. It proposes routes; it cannot execute or grant.

## The five acceptance fields — each to a test (`capabilityGraph.test.ts`, 5)
| field | how it's honored | test |
|---|---|---|
| **Observable object** | a `CapabilityGraphSnapshot` (routes + gaps) evidence can point at | all 5 |
| **Collection boundary** | reads the discovery/manifest/lane registries (types only); unresolved tenant → EMPTY graph, never "all capabilities" | `COLLECTION BOUNDARY` |
| **Capability contract** | PROPOSE-only routes — the certified `mail.send` routes PURPOSE→CAPABILITY→LANE(draft, serving referenceDrafter)→CONNECTOR(microsoft-entra)→WORKFLOW(propose→governedSend); never executes/grants | `CONTRACT` |
| **Verification** | every route/gap names a capability the sources reported — **no invention**; the routable set is EXACTLY the governed-certified capabilities that resolve | `VERIFICATION` |
| **Failure/UNKNOWN** | an uncertified mutation → **NOT_GOVERNED gap** (excluded, never routed); a certified capability with no lane/workflow → **MISSING gap** (not a fabricated route) | `FAILURE/UNKNOWN` ×2 |

## Constraints (L4, binding) — honored
Certified-only routing (only `governed-certified` capabilities route; uncertified → NOT_GOVERNED gap, never routed
around) · proposal-only authority (proposes routes; cannot execute or grant) · gap-honest (missing/uncertified reported,
never invented). Certified M365 `mail.send` is the single routable consequential capability today — the breadth fence.

## Non-frozen — no FG gate
Pure main module reading the existing registries + importing types; no new IPC channel (a channel would touch frozen
`channels.ts` → an FG gate, deliberately avoided in Slice 1, exactly like L1). Proofs: `capabilityGraph.test.ts` (5) +
full main + typecheck node + lint clean.

## Remaining (next increment, non-frozen)
Live-wire the sources to the real `capabilityDiscoveryService.catalog()` (+ `mutationAssuranceFor`), `MANIFEST_BY_ID`,
and the BRAIN-1 lane registry under `activeWorkspaceId`; re-prove the five fields against the real registries (as L1's
live wiring did); surface via an existing `capability:*`/`enterprise:*` handler (reuse, not a new channel).
