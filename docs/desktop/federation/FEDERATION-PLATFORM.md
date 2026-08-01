# Enterprise Federation Platform (Phase 6 · Stage 11)

The enterprise-layer JOIN over the EXISTING federation substrate, implemented as
one additive subsystem (`apps/desktop/src/main/enterpriseFederation/`) that owns
**no runtime, no store, no scheduler, no executor, and no mutation surface**.
The P9-S2 federation runtime (peers, invitations, trust, shares, the signed
exchange, cross-org governance), the P10 projection layer, and the P18
intelligence network **stay authoritative and untouched** — Stage 11 composes
their records with the Stage 7–10 platforms, computed per read (3 s TTL),
stored nowhere.

**Structural honesty, stated up front:** everything cross-organization in this
repository is a RECORD in the local, persisted federation stores. There is
no wire protocol and no live inter-company connectivity — and this platform
neither adds nor simulates any. Every view below composes records, and says so.

## Relationship to the existing federation subsystems (composition, not duplication)

- **P9-S2 runtime** (`fed:*`, ~38 channels including governed mutations):
  remains the ONLY place federation state changes. Every Stage 11
  recommendation points back at these surfaces (`fed:runtime.trust`,
  `fed:exchange.verifyVersion`, `fed:gov.resolveApproval`, …).
- **P10 Federation Platform** (`federation:*`, the Federation Center):
  untouched; Stage 11 renders as the Center's sixth tab (**Enterprise**).
- **P18 Intelligence Network** (`network:*`): composed as ONE input (its
  sanitized summary); its no-raw-records invariant is inherited unchanged.
- Stage 11 uses the DISTINCT **`efed:*`** namespace under the EXISTING
  **`federation:read`** permission — the `estrat:*`-beside-`strategy:*`
  precedent. No new permission is minted.

## The registry (typed data — every reference is REAL, locked by test)

`federationRegistryIssues()` + this document lock the registry
(`federationRegistry.stage11.test.ts`).

**Share kinds** (the P9-S2 `SharedResourceKind` union): `project`,
`workspace`, `ai_worker`, `governance_policy`, `connector` — each mapped to
Stage 10 business capabilities.

**Exchange kinds** (the P9-S2 `ExchangeKind` union) → the LOCAL record kind
each could carry (D-3; `none` is an honest declaration):

| Exchange kind | Local record kind | Capabilities |
| --- | --- | --- |
| `ai_worker` | AI workers | operations, engineering |
| `connector_pack` | configured connectors | support, engineering |
| `governance_policy` | federation governance policies | compliance, risk |
| `workflow_template` | Stage 8 playbooks | operations, engineering |
| `knowledge_package` | Stage 7 assets (topics `sop`, `policy`, `standard`) | engineering, compliance |
| `dashboard_template` | `none` — no local dashboard registry exists | operations |

**Trust levels** (the P9-S2 `TrustLevel` union): `none`, `basic`, `verified`,
`full`, each with DECLARED evidence expectations over the seven recorded
signals: `accepted-invitation`, `attested-relationship`, `signed-artifacts`,
`reciprocal-sharing`, `audit-history`, `policy-coverage`,
`delegated-approval-configured`.

**Sharing policies** — the four REAL seeded federation-governance actions:
`cross_org_run`, `share_data`, `publish_public`, `import_policy`.

**Partner-facing exposure** — the DECLARED share-kind → Stage 9 service map:
`connector` → `connector-fleet`; `ai_worker` → `workforce-jobs`,
`execution-runtime`; `project` → `assistant-experience`; `workspace` →
`notification-delivery`; `governance_policy` → (none).

## Trust model (D-4)

For every partner: the DECLARED level (authoritative, from the existing
records) beside the COMPUTED evidence — signal by signal, each a recorded
fact. The assessment is `consistent`, `declared-above-evidence`,
`evidence-above-declared`, or `unknown` (unreadable sources stay unknown,
never guessed). **Computed trust never replaces declared trust**; divergence
is reported for review through the existing `fed:*` surfaces, never resolved
here.

## The shared enterprise layers

- **Knowledge (S7):** `knowledge_package` artifacts + knowledge-class shares +
  the Stage 7 assets topic-matched as backing candidates.
- **Automation (S8):** `workflow_template` artifacts + the REAL playbooks as
  shareable candidates (+ platform-wide monitor counts — no per-share
  attribution exists, and the view says so).
- **Operations (S9):** per-partner exposure through the DECLARED map × live
  service states + SLA statuses, with readiness and capacity context.
- **Strategy (S10):** joint initiatives = initiatives whose capabilities
  intersect recorded partner shares; the capability-federation view threads
  shares/artifacts through the twelve capabilities beside their Stage 10
  conditions.

## IPC surface (read-only; fail-closed)

Six channels, each `requireAuth: true` + RBAC `federation:read`:

| Channel | Payload |
| --- | --- |
| `efed:partners` | `EfedPartnersReport` |
| `efed:trust` | `EfedTrustReport` (declared beside computed, per partner) |
| `efed:exchange` | `EfedExchangeReport` (artifact × local-record linkage states) |
| `efed:sharing` | `EfedSharingReport` (the four shared layers) |
| `efed:dashboard` | `EfedDashboard` (totals, governance, network, recommendations, disclosures) |
| `efed:report` | `EfedBoardReport` (sectioned federation board brief) |

Zero mutation channels. The `efed:` prefix is registered in the runtime-authz
completeness lock; the cluster is locked by `index.stage11.test.ts`.

## Assistant (10 questions, in-process port)

`resolveFederationQuestion` matches (keys): `federation-status`,
`partner-trust`, `exchange-catalog`, `shared-knowledge`, `shared-automation`,
`partner-exposure`, `joint-initiatives`, `federation-governance`,
`federation-network`, `federation-report` — e.g. “Which partners do we
trust?”, “What is in the exchange?”, “Which playbooks could we share?”,
“Which joint initiatives do we run with partners?”, “Prepare the federation
report.” Answers ride the existing `intelligence` structured-report kind. The
matcher is SEVEN-WAY disjoint from the Stage 5–10 resolvers — enabled by two
narrow Stage 10 exclusions added this stage (bare-`initiatives` questions
qualified `joint/federated/partner/shared`, and `board brief` questions
qualified `federation`, both route here), test-locked in both directions.

## Monitoring (one governed source)

`federation-watch` (daily 09:15 via the EXISTING delivery engine): NEW
critical/high recommendations — trust divergence, unsigned artifact versions,
pending delegated approvals, unhealthy partner-facing services — become
governed intelligence ITEMS (deduped per session). Items recommend; they never
act. Muteable per source like every other watch.

## Renderer

The **Enterprise** tab inside the EXISTING P10 Federation Center
(`federationCenter/FederationCenterView.tsx` →
`enterpriseFederation/EfedPlatformTab.tsx` + pure `efedPlatformModel.ts`):
header stats, partners, trust evidence, the exchange, the shared layers, the
recommendations, the board report, and the declared-unavailability strip. The
tab mutates nothing.

## Honesty rules (structural, tested)

- Records, not networking: the disclosure rides every dashboard.
- Declared trust is authoritative; computed evidence sits beside it; unknown
  stays unknown.
- No artifact↔local-record link exists in the platform; name equality is a
  stated heuristic, never a verified linkage.
- Exposure is a DECLARED registry map over live states — not measured traffic.
- A failing source becomes an explicit `unavailable` entry — never a
  fabricated value, never a silent zero.
- Registry integrity and this document are test-locked; the Principle-C guard
  throws on any incomplete recommendation.

## Performance (composition budgets, bench-tested)

Partners / trust / exchange / sharing builds ≤ 100 ms each; the full dashboard
and federation report ≤ 500 ms — measured over the seeded composition in
`federationBench.stage11.test.ts` (after a warmup pass; the 3 s TTL amortizes
per-read cost in production).
