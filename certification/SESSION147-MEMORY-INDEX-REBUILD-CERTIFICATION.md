# SESSION 147 — WHOLE-REPOSITORY SUBSTANTIVE CAPABILITY CONVERGENCE CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · from dfd5961 · NON-FROZEN, no FG token
### Selected + built: **On-demand memory-index REBUILD goes live** (`memory:rebuild`) — GREEN

---

## 1 · Fresh repository census
The renderer references 763 of 776 IPC channels in production code; a systematic `comm` of main-registered vs
renderer-referenced channels leaves exactly **13 fully-dark channels**: `EcosystemOAuthToken` /
`EcosystemOAuthRevokeToken` (machine-facing OAuth endpoints, dark by design), `MemoryBackfill`,
`SandboxArtifactGet`, and nine Sandbox authoring mutations (workspace/scenario/dataset create/update/delete/
archive/version). No channel is referenced only by renderer tests. The Sandbox READ surface is already fully
wired (dashboard/workspaces/scenarios/history/execution/timeline/queue/artifacts.list/result/report/datasets)
via `SandboxView` + `SandboxProvider` — so Sandbox is NOT dark except its policy-open authoring mutations.

**Frozen-map finding:** the two clean non-machine dark channels — `MemoryBackfill` and `SandboxArtifactGet` —
are BOTH absent from the frozen `packages/shared/src/ipc/responses.ts` IpcResponseMap while their siblings are
typed, so wiring either the canonical typed way requires a frozen additive line (an FG token). Under this
session's tightened rule ("do not use rawInvoke merely to evade a genuinely required frozen contract change"),
rawInvoke is not appropriate for them. The remaining dark capabilities are therefore all FG-gated, policy-open,
or machine-facing.

## 2 · ≥8 candidates
| # | Candidate | Impl | Tested | RBAC | Tenant | Reachable | Missing wiring | Frozen? | Policy | Value |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **memory:rebuild** (re-project memory index) | complete (`rebuild`/`runAsPrincipal`) | main | `operations:manage` | server (principal) | helper exists, no UI | UI button (read-mutation) | **non-frozen** (typed, in map) | none | **MED-HIGH** — recall/counts correctness |
| 2 | MemoryBackfill (embed memories → cloud semantic recall) | complete (pure DI core) | main | `operations:manage` | server (`activeMemoryViewer`) | none | helper + UI | **FROZEN** (map line → FG) | none | HIGH |
| 3 | SandboxArtifactGet (fetch one artifact) | complete | main | `sandbox:read` | server | none | helper + UI | **FROZEN** (map line → FG) | none | LOW-MED |
| 4 | Sandbox workspace/scenario/dataset CRUD (9) | complete | main | `sandbox:manage` | server | none | helper + UI | non-frozen | **delete/ownership OPEN** | MED (dev) |
| 5 | Ecosystem OAuth token / revoke-token | complete | main | manage | server | machine-facing | not a UI gap | non-frozen | none | low (by design) |
| 6 | Trial Balance/P&L/BS report *module* | builder exists | main | — | server | needs registration | FG (`enterprise/index.ts`) | none | MED |
| 7 | Cross-module enterprise search | partial | — | — | — | missing | ranking/authz | non-frozen | **needs policy** | MED |
| 8 | Inbound correlation (S138) / ABAC / persistence migration | — | — | — | — | — | — | — | **PERMANENT BLOCK** | — |

## 3 · Candidate ranking
Ranked by value × completeness × governance × safety × ship-without-policy × ship-without-frozen × reuse:
**#1 memory:rebuild** is the only high-completeness, governed, tenant-safe, non-frozen, non-policy candidate
that ships this session. #2 MemoryBackfill is higher raw value but needs an FG (frozen map line). #3
SandboxArtifactGet also needs an FG and is lower value. #4 Sandbox authoring mutations are policy-open
(delete/ownership) — declined per the Sandbox rule. #5–#8 are machine-facing, FG-gated, or policy-blocked.

## 4 · Selected winner
**`memory:rebuild` — on-demand memory-index rebuild, surfaced on MemoryView.**

## 5 · Selection rationale
`memory:rebuild` is fully governed (`operations:manage` via `memoryAuthzGate`), runs under the server-resolved
principal (`runAsPrincipal`), no-ops without an active org, re-projects the memory store and returns fresh
`MemoryCounts`, and its typed `ipc.memory.rebuild` helper already existed and is IN the frozen IpcResponseMap —
so surfacing it needs **no frozen change and no rawInvoke**. Yet no production surface ever called it: an
operator could search AI Memory but never rebuild a stale index (e.g. after imports, upgrades, or tombstones),
leaving recall + counts out of date. Surfacing it is a genuine operator-correctness win, not dark-count gaming.
The higher-value `MemoryBackfill` (cloud semantic embedding) was NOT selected because its canonical typed
wiring requires a frozen IpcResponseMap addition; per §7 that is a STOP + prepared FG (recommended S148), not a
rawInvoke evasion. This is a READ-mutation (re-projection), not a destructive authoring mutation, so the
Sandbox delete-appropriateness concern does not apply.

## 6 · Exact architecture path
`MemoryView "Rebuild index" (operations:manage) → ipc.memory.rebuild() → typed invoke → IPC memory:rebuild →
memoryAuthzGate RBAC operations:manage → handler runAsPrincipal(activePrincipal) → rebuildUnderPrincipal
(re-project store; no-op without an active org) → memoryStore.counts() → MemoryCounts → header updates + recall
re-run`. Reuses the existing channel, handler, RBAC gate, typed helper, and the existing MemoryView — no new
store/channel/provider/authz.

## 7 · Files changed (all non-frozen)
- `apps/desktop/src/renderer/src/views/MemoryView.tsx` — `Button` import; `rebuilding`/`rebuildMsg` state; a
  `doRebuild` handler (updates counts from the result, re-runs recall, truthful outcome message, catches
  refusals honestly); a "Rebuild index" action in the header + the outcome banner.
- **new** `apps/desktop/ui-tests/session147MemoryRebuild.test.tsx` (2).

## 8 · Frozen / FG status
**No frozen surface touched. No FG token.** gate-detector = PROCEED ×2. `memory:rebuild` and its response type
(`'memory:rebuild': MemoryCounts`) already exist in the frozen contract; only the renderer was added. The
higher-value `MemoryBackfill` is explicitly deferred BECAUSE it would require a frozen `responses.ts` addition
(prepared as the S148 FG recommendation), honoring §7 rather than bypassing it with rawInvoke.

## 9 · Security proof
`memory:rebuild` keeps its existing governance: RBAC `operations:manage` (Manager+; Member is denied), enforced
main-side via `memoryAuthzGate`. The renderer sends an EMPTY payload (proven: `sawPayload` `toEqual({})`, no
`tenantId`/`orgId`) — the acting principal/org is resolved SERVER-SIDE (`runAsPrincipal` / runtime identity),
never renderer-supplied. The handler no-ops without an active org. Rebuild re-projects from the source store
(idempotent; it removes only tombstoned projections, never source memories). A permission denial (or any IPC
failure) renders a truthful "couldn't rebuild… you may not have permission" message — never a fabricated
success. No secret/credential/raw-payload surface; only `MemoryCounts` (totals) is returned. AI is not involved.

## 10 · Tenant proof
Principal/org identity is server-resolved; the renderer supplies nothing. The focused test asserts the payload
is exactly `{}` with no tenant/org key. `memoryStore.counts()` and the projection are already scoped to the
resolved viewer/org.

## 11 · Policy analysis
**No undefined policy invented.** Rebuild semantics (re-project the memory set) are fully defined and tested in
main. No approval/SoD/threshold/retention/ownership/ranking decision is required. (Sandbox authoring mutations
were declined precisely because their delete/ownership semantics are policy-open.)

## 12 · Focused test results
`session147MemoryRebuild.test.tsx` (2), rendering the real MemoryView through the route harness: (1) the
"Rebuild index" button dispatches `memory:rebuild` with an EMPTY payload (no tenant/org) and the header reflects
the fresh counts (3 → 5 memories); (2) a governed refusal (thrown `UNAUTHORIZED:operations:manage`) renders a
truthful message and no fake-success line. Both green.

## 13 · Full regression
| Check | Result |
|---|---|
| gate-detector (2 files) | **PROCEED ×2** — zero frozen |
| typecheck web | **0** (exit 0) |
| eslint (2 files) | **0** |
| Full main (8 shards) | **10,844 passed / 7 skipped** (1038 files) — unchanged vs S146 (renderer-only, decision-neutral) |
| Full UI | **532 passed** (96 files) — S146 530 → **+2** |

(typecheck:node unchanged — no main/node source touched this session.)

## 14 · Package activation status
Unchanged. No package activated/imported/retired/deleted; no duplicate infrastructure. Reuses the live
`main/memory` subsystem + the existing MemoryView + the existing typed `ipc.memory` cluster.

## 15 · Remaining blockers (unchanged, not pretended solved)
- S138 inbound correlation policy; persistence-migration policy; ABAC/delegation/JIT authority policy; SLO
  verdict; macOS/keychain/live-Electron OPERATOR-PENDING (Linux CI); S132 qs/supply-chain remediation.
- Sandbox authoring-mutation delete/ownership semantics (policy-open).
- **New (frozen-gated):** `MemoryBackfill` and `SandboxArtifactGet` each need an additive `responses.ts`
  IpcResponseMap line (FG) to wire the canonical typed way — see recommended S148.

## 16 · Commit hash
`<see commit below>` (single non-frozen commit).

## 17 · Recommended S148
Present the precise **FG-S148-MEMORY-BACKFILL** request: one additive line
`'memory:backfill': MemoryBackfillSummary` in the frozen `packages/shared/src/ipc/responses.ts`, then the
non-frozen `ipc.memory.backfill` helper + a "Rebuild semantic index" operator action (embeds this tenant's
memories into its cloud vector namespace so semantic recall covers existing memories) — the highest-value
remaining memory capability. Its governance already exists (RBAC `operations:manage`, `memoryMaySync` egress
gate, server-resolved org). Alternatively bundle `SandboxArtifactGet` into the same FG. Respect the S138 block,
the parallel-runtime no-activate list, and the S132 debt.

**No FG token. No duplicate infrastructure. No AI authority. No invented policy. No rawInvoke evasion of a
frozen contract. No secrets/raw payload exposed. Zero frozen surfaces touched. An operator who could search AI
Memory but never rebuild a stale index can now rebuild it on the real governed product path. macOS/keychain NOT
claimed (Linux CI).**
