# ROADMAP AMENDMENT PROPOSAL — the OS tracks slotted against S18–S50

**Status: DRAFT — awaiting the operator's approval (CLAUDE.md §5 changes only with explicit approval).** This does NOT
modify §5; it proposes how. One canonical roadmap: the amendment ADDS foundational tracks the existing waves already
assume, without moving the finish line — the complete proof still lands at **S50**.

## Principle
The existing S18–S50 waves are the CERTIFICATION spine (durability → connectors → autonomy → security → observability →
hardening → backend → pilot → re-run → commercial → proof). The OS tracks are the PRODUCT substrate those waves govern.
They slot as explicit slices INSIDE the waves whose proofs depend on them — never as a parallel roadmap.

## The six OS tracks → where they slot

| OS track | What it is | Slots into | Depends on | Why there |
|---|---|---|---|---|
| **Workspace Foundation** | people · orgs · customers · projects · tasks · documents · workflows · policies · approvals · actions · evidence · operational memory | **Wave 6 (S23–27)** as the canonical domain model the connectors populate | tenancy (done) · enterprise modules (exist) | Connector certification is only meaningful against a real domain model; formalize it as the connectors land |
| **Environment Model / Graph** | the typed graph of what exists in a tenant's world | **Wave 9 (S34–36)** beside the Universal Action Trace | Workspace Foundation · connectors · action trace | S34's trace + S35's relationship metrics ARE the graph's edges; build the node/edge model with them |
| **Environment Discovery** | identity · workspace · devices · software · data · services · people · work · permissions · **gaps** | **Wave 9 (S34–36)** → new **S36-adjacent** discovery slice | Environment Model · connectors · governance coverage (S36) | Discovery = populating the graph; the S36 coverage report IS the "what's NOT discovered/governed" gap map |
| **Capability Graph** | PURPOSE → CAPABILITY → MODEL → CONNECTOR → WORKFLOW (never raw model lists) | **Wave 6–7 bridge (S23 kit → S28 policy)** | Connector Cert Kit (S23) · BRAIN-1 gateway · Policy DSL (S28) | The kit's 14 fields + BRAIN-1's lanes + the policy verbs ARE the graph's layers; assemble them into the routing model |
| **Purpose Engine** | HAVE / NEED / MISSING / SOURCE / BUILD / CONNECT / PERMISSION / VALIDATE / VERIFY | **Wave 7 (S28–30)** as the layer that turns policy + discovery into proposals | Capability Graph · Environment Discovery · Policy DSL · deny-by-default | It reasons over the graph to propose; it must sit on bounded autonomy (S29 deny-by-default) so a "BUILD/CONNECT" proposal is always governed |
| **Live Brain** | intelligence/orchestration OVER the governed runtime — never another giant model | **Wave 9–10 (S34–39)**, capstone feeding **S50** | BRAIN-1 gateway · Purpose Engine · Action Trace · Product Modes (S37) | Orchestration needs the trace to see, the purpose engine to decide, the gateway to think, and product modes to know its state — all land by S39 |

## Sequencing / dependencies (critical path)
```
BRAIN-1 (done) ─┬─→ Capability Graph (S23–S28 bridge) ─→ Purpose Engine (S28–30) ─┐
Workspace       │                                                                   ├─→ Live Brain (S34–39) ─→ S50
Foundation ─────┴─→ Environment Model (S34) ─→ Environment Discovery (S36) ─────────┘
(S23–27)             (on the Action Trace)        (on Governance Coverage)
```
- Nothing in the OS tracks precedes its governance: the Purpose Engine cannot propose SOURCE/BUILD/CONNECT until
  deny-by-default (S29) and the Policy DSL (S28) exist; the Live Brain cannot orchestrate until the Action Trace (S34)
  and Product Modes (S37) exist. This preserves "AI proposes, authority decides, human confirms, execution acts once,
  verification proves."
- The OS tracks add DEPTH to existing slices, not new wave numbers — so S50's master-assurance proof is unchanged, just
  richer (it now demonstrates the purpose engine proposing over a discovered environment graph, governed end-to-end).

## F-S17-1 folded into S39 (first-run experience)
S39's spec gains an explicit item: **reconcile the two local-first affordances** — the onboarding's "Try Free Locally"
and the in-shell `LocalModeBanner` — into ONE coherent local-first story (one-time welcome vs persistent reminder),
with a Playwright assertion that a fresh profile reaches a usable local shell through a single, non-duplicative path.

## What I am NOT proposing
- No new wave numbers, no moved finish line, no renumbering of S18–S50.
- No OS-track slice lands before the governance slice it depends on (table + critical path above).
- Live Brain is explicitly NOT "another giant model" — it is orchestration over the governed runtime on BRAIN-1's
  gateway, bound by the same constitutional powers (intelligence proposes only).

## Approval hook
On your go, I fold these as explicit slice-spec additions inside the named waves in CLAUDE.md §5 (with your token/approval
per §5), keeping one canonical roadmap. Until then, §5 is unchanged.
