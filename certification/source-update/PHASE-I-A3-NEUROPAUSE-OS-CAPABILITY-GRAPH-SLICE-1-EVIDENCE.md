# OS-track L4 · Capability Graph — SLICE 1 (the OBSERVABLE OBJECT) · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: OBSERVABLE OBJECT LANDED — TEST-VERIFIED, non-frozen, no FG gate.** L4 needs neither S23 (Cert Kit) nor S28
(Policy DSL) — it reads the REAL substrate that exists today. FREEZE INTACT.

## SUBSTRATE REPORT — what is CERTIFIED today (from the scout; recorded first, per the directive)
The graph derives its fields from what EXISTS; it records what is missing as MISSING with a pointer to the future slice.
It NEVER invents kit fields or policy hooks that aren't built.
- **EXISTS (real, read by the graph):**
  - **M365 certification facts** — `mail.send` on `microsoft-entra` is the ONE `governed-certified` mutation: a governed
    CST path (`governedSend`, `policyVersion:'m365-send-policy-1'`), the FG-4 first-real-send guard, the S16 read-back
    oracle (`verifyEffect`), and S34a evidence (`actionRecord.observe`). Assurance predicate in code:
    `mutationAssuranceFor(connectorId) === 'governed-certified'` (`liveCapabilitySources.ts`), the `CapabilityAssurance`
    type (`capabilityDiscoveryService.ts`). Other write actions (calendar/drive/… cohorts) are `governance-not-proven`
    and deliberately NOT AI-selectable.
  - **BRAIN-1 lanes** — `draft` (serving the deterministic `referenceDrafter`; the model path is eval-gated, D-13),
    `reason` (`aiEngine.run`), `embed` (reserved). Real lane registry + `modelRouter`/`providerManager` (today every
    tier resolves to Claude; draft serves no live model yet).
  - **Policy machinery that is LIVE** — channel-level RBAC (`RUNTIME_CHANNEL_PERMISSIONS`, deny-by-default, startup
    fails if a consequential channel is unclassified), the CST decision inside `governedSend`, the `policyVersion` tag,
    and `approvalRequired`.
- **MISSING (roadmap, pointed at, never invented):**
  - **S23 Connector Certification Kit** — no 14-field record type exists; "certified" today = a 1-bit assurance tag. The
    graph records this as a MISSING enrichment → S23 (which would upgrade the tag to a 14-field record).
  - **S28 Policy DSL** — no typed verbs / compiled-hashed policies. The graph reads the real RBAC/CST facts and records
    the DSL as MISSING → S28 (which would enrich policy edge labels with `ALLOW`/`REQUIRE_*`/`LIMIT_*`).

## Dependency finding (honest)
L4 Slice 1 does NOT need S23 or S28: the REAL certification predicate (`governed-certified`) already gates `mail.send` as
the one routable mutation, and the RBAC/CST facts label policy honestly. S23/S28 would ENRICH (14-field records, policy
verbs), not unblock. L4 routes over what is genuinely certified now and reports the rest as gaps.

## Proposal-only invariant (pinned like the observer invariant)
The graph PROPOSES routes; it cannot execute or grant. Structurally, `capabilityGraph.ts` imports NO execution/governance
value (only its own types) — there is no import path from the graph into execution, exactly as the S34a ActionRecord is
an observer with no path back into governance. (Slice-1 is a pure model; the live wiring will keep the same invariant,
reading registries, never calling an executor.)

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
