# SESSION 148 — MEMORY BACKFILL GOES LIVE (FG-S148-MEMORY-BACKFILL) CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · from 2d524b2 · FROZEN (1 authorized additive line) + NON-FROZEN
### Selected + built: **Governed semantic-index BACKFILL goes live** (`memory:backfill`) — GREEN

---

## 1 · Exact frozen line added (FG-S148-MEMORY-BACKFILL)
Token honored verbatim: `AUTHORIZED: FG-S148-MEMORY-BACKFILL`. One additive entry in the sole authorized
frozen file `packages/shared/src/ipc/responses.ts` (git diff: **1 file changed, 13 insertions(+)**, purely
additive — no line removed or altered):

```ts
  'memory:backfill': {
    orgId: string | null;
    total: number;
    processed: number;
    embedded: number;
    skipped: number;
    failed: number;
    batches: number;
    skippedReason?: 'no_active_org';
  };
```

**Why an inline literal, not `MemoryBackfillSummary` by name (honest deviation, recorded):** the named type
`MemoryBackfillSummary` is defined ONLY in `apps/desktop/src/main/memory/memoryBackfill.ts`. `responses.ts`
(shared) cannot import from `apps/desktop/src/main`, so referencing the name would require a SECOND additive
frozen change (`packages/shared/src/types/memory.ts`) — which the FG forbids ("Do NOT modify any other frozen
surface"). The response map's own established convention already uses inline object literals
(`'memory:forget': { forgotten: number }`, `'auth:providers': { providers: … }`). The inline literal of the
exact `MemoryBackfillSummary` shape is therefore the ONLY realization consistent with the FG's two hard
constraints (exactly one additive entry in responses.ts; no other frozen surface). Structural equivalence to
the producer type is pinned at compile time (see §6/§12) so the two can never silently diverge.

No other frozen surface touched. gate-detector: `responses.ts` = FROZEN (authorized); the four non-frozen
files = PROCEED ×4.

## 2 · Exact non-frozen files changed
- `apps/desktop/src/renderer/src/lib/ipc.ts` — one typed helper `ipc.memory.backfill()` = `invoke(IpcChannel.MemoryBackfill)` (typed via the new frozen map entry; **no rawInvoke**).
- `apps/desktop/src/renderer/src/views/MemoryView.tsx` — `backfilling`/`backfillMsg` state; a `doBackfill`
  handler that reads the summary back truthfully (local vs embedded-count vs failure); a "Rebuild semantic
  index" action in the header + its outcome banner.
- **new** `apps/desktop/src/main/memory/memoryBackfillContract.test.ts` (1) — the compile-time bidirectional
  structural-equivalence pin between the frozen response type and main's `MemoryBackfillSummary`.
- **new** `apps/desktop/ui-tests/session148MemoryBackfill.test.tsx` (3) — renderer reachability + truthful
  state, rendering the real MemoryView.

## 3 · Complete runtime path
`MemoryView "Rebuild semantic index" → ipc.memory.backfill() → typed invoke → IPC memory:backfill →
memoryAuthzGate RBAC operations:manage → main handler (memory/index.ts) → runMemoryBackfill({ listItems:
memoryStore.allItems().filter(memoryMaySync), getOrgId: activeMemoryViewer()?.tenantId, backfill:
backendBackfill }) → batches embeddable memories → backend /backfill endpoint → org-scoped cloud vector
namespace (Qdrant) → MemoryBackfillSummary → truthful UI banner`. Reuses the existing channel, handler,
governance gate, memory store, backend backfill client and vector namespace — no new store/vector db/embedding
service/IPC.

## 4 · Tenant / security proof
Org identity is resolved SERVER-SIDE by the existing handler via `activeMemoryViewer()?.tenantId` — an
AUTHORIZATION (not mere identity), the same predicate the live-sync bridge uses. The renderer sends an EMPTY
payload (proven: `sawPayload` `toEqual({})`, no `tenantId`/`orgId`). `runMemoryBackfill` no-ops with
`skippedReason: 'no_active_org'` when no org resolves. No credentials, provider secrets, embedding vectors, or
raw memory contents cross into the renderer — only the numeric `MemoryBackfillSummary` is returned, and the UI
renders only counts + a status sentence.

## 5 · Egress / RBAC proof
RBAC `operations:manage` (memoryAuthzGate + runtimeAuthz), enforced main-side (Manager+; Member denied). Egress
is gated by the existing `memoryMaySync(it.owner)` predicate applied to `listItems` in the handler — personal
and system memories NEVER leave the device; only tenant + workspace memories are embedded into the org-wide
namespace (the exact predicate that governs the live-sync bridge in both directions). A permission or egress
denial (thrown IPC error) renders a truthful "couldn't build the semantic index — you may not have permission"
message; a governed refusal is never converted into a fabricated success. Fail-closed throughout.

## 6 · Idempotency / re-run behavior
Re-running is safe per the existing backfill semantics: `runMemoryBackfill` re-enumerates current embeddable
memories and re-posts them; the backend `/backfill` endpoint embeds by `memoryId` into the org vector namespace
(upsert-shaped — re-embedding the same memory replaces its vector, not duplicates it). No local durable write
occurs. A no-active-org run is a pure no-op. The contract pin round-trips both the success and the
`no_active_org` shapes.

## 7 · Focused test results
- `memoryBackfillContract.test.ts` (1): the frozen `IpcResponseMap['memory:backfill']` and main's
  `MemoryBackfillSummary` are mutually assignable (compile-time, both directions) + a live round-trip of the
  success and no-active-org shapes.
- `session148MemoryBackfill.test.tsx` (3), rendering the real MemoryView: (1) the button dispatches
  `memory:backfill` with an EMPTY payload (no tenant/org) and reports embedded/total truthfully; (2) a
  no-active-org run reads as LOCAL, not a failure; (3) a governed refusal (thrown `UNAUTHORIZED`) renders a
  truthful message and no fake-success line. All green.

## 8 · Full regression
| Check | Result |
|---|---|
| gate-detector (5 files) | **FROZEN ×1 (responses.ts, FG-authorized) + PROCEED ×4** |
| frozen diff | **1 file changed, 13 insertions(+)** — purely additive, only the authorized entry |
| typecheck node / web | **0 / 0** (node validates the contract pin + handler→frozen assignability) |
| eslint (4 files) | **0** |
| Full main (8 shards) | **10,845 passed / 7 skipped** — S147 10,844 → **+1** (the contract pin) |
| Full UI | **535 passed** (97 files) — S147 532 → **+3** |

## 9 · Package activation status
Unchanged. No package activated/imported/retired/deleted; no duplicate memory store, vector database, or
embedding service. Reuses the live `main/memory` subsystem, its backend backfill client, and the existing
MemoryView + typed `ipc.memory` cluster.

## 10 · Remaining dark capabilities
- `SandboxArtifactGet` — a read, but its response type is absent from the frozen IpcResponseMap (needs an FG
  map line like this one).
- Sandbox authoring mutations (workspace/scenario/dataset create/update/delete/archive/version) — policy-open
  (delete/ownership semantics), deliberately not activated.
- `EcosystemOAuthToken` / `EcosystemOAuthRevokeToken` — machine-facing OAuth endpoints, dark by design (not a
  UI gap).

## 11 · Blockers (unchanged, not pretended solved)
- S138 inbound correlation policy; persistence-migration policy; ABAC/delegation/JIT authority policy; SLO
  verdict; macOS/keychain/live-Electron OPERATOR-PENDING (Linux CI); S132 qs/supply-chain remediation.
- Sandbox authoring delete/ownership semantics (policy-open).

## 12 · Commit hash
`<see commit below>` (single commit; the one authorized frozen line + its coupled non-frozen wiring, evidence,
and tests — bracketed and gate-detected).

**FG-S148-MEMORY-BACKFILL honored: exactly one additive entry in `packages/shared/src/ipc/responses.ts`, no
other frozen surface, no rawInvoke. No duplicate infrastructure. No AI authority. No invented retention/
ownership/approval/threshold policy. No Sandbox authoring mutation activated. No secrets/vectors/raw memory
exposed. Egress stays governed by `memoryMaySync`; org stays server-authoritative. An operator whose existing
memories were never embedded for semantic recall can now backfill them on the real governed product path.
macOS/keychain NOT claimed (Linux CI).**
