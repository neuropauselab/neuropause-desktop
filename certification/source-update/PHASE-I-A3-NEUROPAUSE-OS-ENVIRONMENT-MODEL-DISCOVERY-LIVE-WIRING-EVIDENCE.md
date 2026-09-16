# OS-track L2 + L3 · Environment Model & Discovery — LIVE WIRING · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: LIVE WIRING LANDED — TEST-VERIFIED, non-frozen, no FG gate.** L2's `probe` and L3's `authorize`/`collect` are
bound to the REAL upstream read-models and PROVEN against them (not fixtures). FREEZE INTACT. This closes the "Remaining"
item of both L2 Slice-1 and L3 Slice-1.

## L2 · Environment Model — `probe` wired to real evidence (`environmentModel/liveSources.ts`)
`liveEnvironmentSources(evidence)` builds the model's `probe` from two REAL read-models:
- **L4 `CapabilityGraphSnapshot`** — "does the environment have a GOVERNED path for this capability?"
  - a route → `present` → **HAVE**; a `not-governed` gap → `absent` → **NEED** (exists but not governed); a `missing`
    gap or an unknown capability → `unknown` → **UNKNOWN**; **`!scopeResolved` → `null` → UNAVAILABLE** (never "all capabilities").
- **L1 `workspaceDomain` rollup** — "does the environment have DATA in this domain?"
  - present + records → **HAVE**; present-but-empty (count 0) → **NEED**; an `unavailable` slice, or an absent rollup
    (local mode) → `null` → **UNAVAILABLE** (never a fabricated 0).

**Proven against REAL upstream** (`liveSources.test.ts`, 5): the L4 graph is composed through the real
`composeCapabilityGraph(capabilityGraphSources(…))` (so `mail.send`/`microsoft-entra` really routes and
`chat.post`/`slack` is really a `not-governed` gap, via the real `mutationAssuranceFor`), and the L1 rollup through the
real `toWorkspaceDomainField(composeWorkspaceDomain(DOMAIN_MODULES, …))`. The environment model's HAVE/NEED/UNKNOWN/
UNAVAILABLE derive from those real outputs — a genuine L4→L2 and L1→L2 chain. Local-mode honesty pinned (absent rollup →
UNAVAILABLE, never an empty-domain claim).

## L3 · Environment Discovery — `authorize`/`collect` wired to real consent + the real catalog (`environmentDiscovery/liveSources.ts`)
`liveDiscoverySources(deps)`:
- **AUTHORITY from CONSENT facts that require NO collection** — a resolved workspace scope + at least one connected
  account (consent already given to that connector). Deny-by-default: no workspace → `unknown`; no account → `denied`.
  Authority is decided **without reading the catalog**, so the catalog probe cannot run before authority.
- **COLLECTION is the REAL catalog probe** — `CapabilityDiscoveryService.catalog()` (tenant-scoped, fail-closed),
  invoked ONLY inside `collect` (which the core pipeline calls only when authority is `granted`). Available capability →
  **HAVE**; needs reconnect (`reauth_required`) → **NEED**; not in catalog → collector yields nothing → **UNAVAILABLE**.

**NEVER A SILENT SCAN — proven with real authority** (`liveSources.test.ts`, 5): a `catalog` call-spy is asserted
**never invoked** when the workspace is unresolved (`AUTHORITY_UNKNOWN`) or no account is connected (`DENIED`), and
invoked only once authority is `granted`. Because authority reads only cheap consent facts, the catalog scan is
structurally unreachable without authority. **Bound to the REAL service**: a real `CapabilityDiscoveryService` with no
resolved workspace returns its fail-closed empty catalog → the collector honestly yields UNAVAILABLE (never a fabricated
result).

## The honest boundary (recorded, not worked around)
Today's discovery authority is the EXISTING consent gate — a connected account in a resolved workspace. A dedicated
**per-capability discovery-consent surface** (using each capability's `requiredScopes`) is a future increment, explicitly
NOT invented here. The current wiring is deny-by-default and never scans without the existing consent; it simply does not
yet offer finer-grained per-element consent. `connector`-kind elements have no live evidence source yet → UNKNOWN (honest).

## Invariant (pinned, both modules)
**READ-ONLY ADAPTER** — each `liveSources.test.ts` reads its source and asserts the value-import set is EMPTY (types
only): every fact arrives through injected real snapshots / producers; no import path into a collection back-end,
governance, or execution. The core L2/L3 modules keep their zero-runtime-import invariant unchanged.

## Non-frozen — no FG gate
New `main` adapter modules + tests; type-only imports of the L4/L1/discovery-service shapes; no shared-type change, no IPC
channel, no frozen touch. Proofs: `environmentModel/liveSources.test.ts` (5) + `environmentDiscovery/liveSources.test.ts`
(5) + full main (**842 files, 8868 passed / 3 skipped**) + typecheck node + lint clean.

## Remaining (next increment, non-frozen / possible FG for a surface)
Production call-site: compose the real L4 graph + L1 rollup + `capabilityDiscoveryService.catalog()` under the active
scope and feed `liveEnvironmentSources` / `liveDiscoverySources`, then close the loop — an L3 `COLLECTED` result resolves
an L2 `UNKNOWN` to HAVE/NEED, and an L2 `NEED` becomes an L5 purpose gap. Surfacing to the renderer would touch frozen
`packages/shared` → an FG gate (as L1's rollup did with FG-8), presented when its turn comes.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. These layers READ real evidence and CLASSIFY /
collect-under-authority; they recommend nothing, build nothing, execute nothing. A HAVE means real evidence reported the
element present — not that anything was acted upon.
