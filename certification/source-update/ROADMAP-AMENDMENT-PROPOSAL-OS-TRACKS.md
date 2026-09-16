# ROADMAP AMENDMENT PROPOSAL — the OS tracks slotted against S18–S50 (v2, to acceptance standards)

**Status: DRAFT — awaiting layer-by-layer approval (CLAUDE.md §5 changes only with explicit approval).** Per Consolidated
Directive v3 §1, every layer below carries ALL FIVE fields — Observable Object · Collection Boundary · Capability
Contract · Verification Method · Failure/Unknown — or it stays out of §5. Shaped by v3 §2's Environment-Intelligence
rules. No new wave numbers; the finish line stays **S50**; the OS tracks add depth to existing slices.

## Canonical definitions (amendment preamble, verbatim per v3 §2)
- **NeuroPause OS** = a purpose-centric, environment-aware, governance-bound operating system that understands what a
  user is trying to accomplish, the resources available, the capability and data gaps, coordinates permitted tools and
  workflows, executes permitted actions, independently verifies their effects, and preserves evidence and operational
  memory.
- **Live Brain** = the continuously operating intelligence layer maintaining the current model of the user's declared
  environment, purposes, workflows, dependencies, gaps, and operational state — a LAYER over the governed runtime and
  the BRAIN-1 gateway, never a giant model, never an execution authority.

## Environment-Intelligence binding rules (shape every discovery layer)
1. **Purpose-bound discovery ONLY:** PURPOSE → DISCOVERY REQUEST → MINIMUM REQUIRED DATA → USER/POLICY AUTHORITY →
   COLLECTION → CLASSIFICATION → EVIDENCE. Never a silent device scan. The request states WHY ("I need to see your
   installed design applications to build your design workspace"), and collects only the minimum the purpose requires.
2. **DISCOVER ≠ RECOMMEND ≠ BUILD/IMPLEMENT** — three separate stages, governance between each, never collapsed.
3. **Four data states everywhere, evidence per state:** HAVE (observed + evidenced) · NEED (a purpose requires it, not
   yet collected) · UNKNOWN (not observed) · UNAVAILABLE (collection attempted; refused/absent). UNKNOWN never quietly
   becomes HAVE.
4. **BUILD-FROM-ZERO is first-class:** empty environment → capability requirements → data requirements →
   NeuroPause-native workspace design — always "where permitted"; governance decides what may be created/accessed/executed.

## Slotting + critical path (unchanged from v1)
```
BRAIN-1 (done) ─┬─→ Capability Graph (S23→S28) ─→ Purpose Engine (S28–30) ─┐
Workspace       │                                                           ├─→ Live Brain (S34–39) ─→ S50
Foundation ─────┴─→ Environment Model (S34) ─→ Environment Discovery (S36) ─┘
(S23–27)             (on the Action Trace)        (on Governance Coverage)
```
No OS-track layer lands before the governance slice it depends on. Each preserves "intelligence proposes · authority
decides · human confirms · execution acts once · verification proves."

---

## LAYER 1 · Workspace Foundation — Wave 6 (S23–27)
- **Observable object:** the canonical domain store (people·orgs·customers·projects·tasks·documents·workflows·policies·
  approvals·actions·evidence·operational-memory) — the existing enterprise-module stores unified under one declared schema.
- **Collection boundary:** reads ONLY the tenant's own governed records (enterprise modules + data admitted through the
  governed data plane), tenancy-scoped. Purpose: "maintain the tenant's canonical work domain." No cross-tenant read.
- **Capability contract:** in = governed records + connector sync; out = a queryable typed domain model; authority =
  READ/aggregate ONLY. It never executes or grants; writes happen only through the existing governed module stores.
- **Verification:** every record traces to its governed store (S34 provenance) + a store-scope declaration; a test
  asserts the model equals the underlying stores (no invented records).
- **Failure/unknown:** a record absent from the stores is UNAVAILABLE, never fabricated; an unresolved entity is UNKNOWN
  (raised as a question — the existing bridge identity-resolution pattern), never guessed.

## LAYER 2 · Environment Model / Graph — Wave 9 (S34, on the Action Trace)
- **Observable object:** the Environment Graph store — typed nodes (identity·workspace·devices·software·data·services·
  people·work·permissions) + edges (dependencies, provenance).
- **Collection boundary:** each node holds ONLY what a purpose-bound discovery request was authorized to collect, and
  carries the authorizing purpose. No ambient collection.
- **Capability contract:** in = purpose-bound discovery results + the action trace; out = the queryable graph; authority
  = MODEL/READ ONLY. It never acts and never recommends (recommendation is a separate stage).
- **Verification:** each node/edge references its collection evidence + the trace; a node with no evidence is not in the
  graph. A test asserts every node has an evidence ref + a purpose ref.
- **Failure/unknown:** the four data states per node (HAVE·NEED·UNKNOWN·UNAVAILABLE). A node is HAVE only with observation
  + evidence; UNKNOWN never promotes to HAVE without a fresh collection.

## LAYER 3 · Environment Discovery — Wave 9 (S36, on Governance Coverage)
- **Observable object:** the discovery report + the **gap map** (HAVE/NEED/UNKNOWN/UNAVAILABLE across the nine domains),
  populating the Environment Graph.
- **Collection boundary:** the full purpose-bound pipeline (rule 1). Never inspects a device silently; the request names
  the purpose and collects only the minimum required, with a user/policy authority grant recorded.
- **Capability contract:** in = a purpose + an authority grant; out = classified, evidenced discovery results + the gap
  map; authority = COLLECT (within the granted minimum) ONLY. Never recommends, never builds (rule 2).
- **Verification:** each item carries collection evidence + the authorizing purpose + grant; the S36 coverage report
  cross-checks discovered-vs-governed; a collection without a grant is refused (fail closed) and logged as UNAVAILABLE.
- **Failure/unknown:** refused/ungranted → UNAVAILABLE; needed-not-collected → NEED; not-observed → UNKNOWN. The gap map
  IS the honest "what we do not know" — it never reads as coverage.

## LAYER 4 · Capability Graph — S23 kit → S28 policy
- **Observable object:** the Capability Graph store — PURPOSE → CAPABILITY → MODEL → CONNECTOR → WORKFLOW edges (never
  raw model lists).
- **Collection boundary:** reads the Connector Certification Kit's 14 fields + BRAIN-1's lane registry + the compiled
  Policy DSL. Purpose: "map how a purpose is served, governed." No external read.
- **Capability contract:** in = certified connectors + BRAIN-1 lanes + policies; out = a route-planning model; authority
  = READ/route-PROPOSE ONLY. It proposes a route; it never executes or grants (execution stays in the certified path).
- **Verification:** every capability node references a CERTIFIED connector (all 14 kit fields proven) + a real BRAIN-1
  lane; a test asserts every edge resolves to a certified artifact; uncertified capabilities are excluded.
- **Failure/unknown:** a purpose with no certified capability → MISSING (a NEED for a new connector/lane, surfaced); a
  capability whose connector is uncertified → NOT GOVERNED (excluded from routing).

## LAYER 5 · Purpose Engine — Wave 7 (S28–30)
- **Observable object:** the purpose-evaluation record — for a declared purpose, the HAVE/NEED/MISSING/SOURCE/BUILD/
  CONNECT/PERMISSION/VALIDATE/VERIFY assessment + the resulting PROPOSALS (never actions).
- **Collection boundary:** reads the Capability Graph + Environment Graph + policies. No new collection — it reasons over
  existing evidenced graphs. If it needs more, it PROPOSES a discovery request (it does not collect).
- **Capability contract:** in = a declared purpose + the graphs; out = a governed PROPOSAL (source/build/connect/permission
  requests), each a candidate for the existing proposal→consent→admission→execution→verification path; authority =
  PROPOSE ONLY. It never sources/builds/connects/executes (rule 2; governance between each stage).
- **Verification:** every proposal traces to graph evidence (HAVE vs NEED) + a policy; a proposal with no evidence basis
  is refused; the proposal carries NO authority fields (S33-aligned — a hostile renderer cannot forge one).
- **Failure/unknown:** a purpose it cannot assess (missing graph data) → NEEDS_DISCOVERY (a discovery-request proposal)
  or UNKNOWN; it never proposes a BUILD/CONNECT it cannot ground in evidence + policy.

## LAYER 6 · Live Brain — Wave 9–10 (S34–39) → capstone at S50
- **Observable object:** the Live Brain state model — the current, evidenced snapshot of the user's declared environment,
  purposes, workflows, dependencies, gaps, and operational state (a queryable model, NOT model weights).
- **Collection boundary:** reads ONLY the evidenced artifacts of the layers beneath (Environment/Capability graphs,
  purpose records, action trace, product mode). No direct device/data inspection — that is Discovery's purpose-bound job.
- **Capability contract:** in = the layers beneath; out = orchestration PROPOSALS + the live state model; authority =
  ORCHESTRATE-BY-PROPOSAL ONLY — it coordinates permitted tools/workflows through the governed runtime + the BRAIN-1
  gateway. NEVER an execution authority; NEVER a giant model.
- **Verification:** every state-model element references the evidenced layer beneath (the UI-truth rule extended to the
  orchestration model); a claim with no underlying evidence is not shown; independent oracles (S16-style) verify effects
  it proposed.
- **Failure/unknown:** DEGRADED/UNKNOWN operational state is shown as such (S37 product modes); a stale or unverified
  element is never presented as current; UNKNOWN stays UNKNOWN until re-observed.

---

## F-S17-1 → S39 (first-run experience)
S39 gains an explicit item: reconcile the two local-first affordances (onboarding "Try Free Locally" ⇄ in-shell
`LocalModeBanner`) into ONE coherent path, with a Playwright assertion that a fresh profile reaches a usable local shell
through a single, non-duplicative route.

## Build sequence (v3 §3) + approval hook
Close BRAIN-1 (done) → **S34a** (queryable action record + decision logging) → **S19** (five-state counter truth) → then
these layers in the order above, each carrying its five fields with dependencies stated, each approved before it enters
§5. Until your go, §5 is unchanged and one canonical roadmap stands.
