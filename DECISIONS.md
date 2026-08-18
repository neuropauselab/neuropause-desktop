# DECISIONS.md — non-obvious technical decisions (living, now TRACKED)
Per CLAUDE.md §3: context → decision → consequences. Newest first.

## D-6 · Slice-12 propose feed uses `rawInvoke`, not the typed `IpcResponseMap` path (avoids a frozen touch)
- **Context:** the clean way to call `capability:m365.propose` from the renderer through the typed `ipc.invoke` wrapper is to add `'capability:m365.propose': CapabilityProposeM365ActionResponse` to `IpcResponseMap` in `packages/shared/src/ipc/responses.ts`. But the repo treats **all of `packages/shared` as a frozen surface** (Slice-9 gate doc: "a change to a FROZEN surface (`packages/shared`)… requires this gate"), and the S12 roadmap explicitly says "No frozen surface expected".
- **Decision:** feed the channel via the existing `rawInvoke` escape hatch in the renderer `lib/ipc.ts` (the channel is already on the preload allowlist from FG-1), casting the wire result to the **imported** `CapabilityProposeM365ActionResponse` type. Reading/importing a type is not a frozen-surface change; no `packages/shared` file is modified. The single `as` is the same honest wire→contract conversion `invoke` performs, minus the `IpcResponseMap` constraint.
- **Consequences:** S12 lands with zero frozen touch and no FG gate. The typed `IpcResponseMap` entry (and a fully-typed `invoke` call) is deferred to a future FG gate **if** this channel ever needs to ship beyond the DEV-only trigger (`import.meta.env.DEV` is falsy in packaged builds, so it does not ship today). Trade-off: the propose call site is typed by an explicit cast rather than by the response-map, i.e. slightly weaker than the 636 other call sites — acceptable and documented for a dev-only path.

## D-5 · Living docs now TRACKED; excluded from the freeze source spec by exact filename (supersedes D-4)
- **Context:** D-4 kept the four root docs (CLAUDE.md, NP_STATE.md, BLOCKERS.md, DECISIONS.md) untracked so per-slice edits would not drift the freeze baseline. The human chose to version-control them instead.
- **Decision (human directive):** exclude exactly those four paths — by exact root filename, never a glob — from the freeze **source** spec in all three freeze scripts, then commit the four docs. From FG-2 onward, §1/NP_STATE are committed each slice. The spec is now `(-- . ':(exclude)certification' ':(exclude)CLAUDE.md' ':(exclude)NP_STATE.md' ':(exclude)BLOCKERS.md' ':(exclude)DECISIONS.md')` in `freeze-baseline.sh` (`SRC_DIRTY_SPEC`), `verify-freeze.sh` (`SRC_SPEC`), and `record-gate.sh`.
- **Deviation recorded (honest):** the plan said "apply the spec exclusion AS its own step immediately AFTER FG-2 lands." In practice the exclusion had to be applied EARLY — before freeze re-record #3 — because the untracked root docs were tripping `freeze-baseline.sh`'s dirty check and the re-record could not otherwise run. So the scripts already carried the exclusion (uncommitted) through re-records #3 and #4; this commit merely tracks that spec change plus the four docs. No re-record is required by this commit: all four docs and all of `certification/` are outside the source spec, so `git diff BASE..HEAD SRC_SPEC` is unaffected — verify-freeze stays INTACT (confirmed).
- **Consequences:** the docs are now history; the exclusion is by exact filename so a future doc with a colliding name elsewhere is NOT silently excluded; a new root doc would need its own explicit exclusion line before it could be tracked freeze-safe. D-4 is superseded.

## D-4 · Living docs kept UNTRACKED (freeze scope) — SUPERSEDED by D-5
- **Context:** `certification/freeze-baseline.sh` hashes all source except `certification/`. CLAUDE.md/NP_STATE.md/BLOCKERS.md/DECISIONS.md at repo root are therefore in the freeze source scope; committing them, updated every slice, would drift the baseline each slice and break `verify-freeze`.
- **Decision:** keep the four living docs untracked (freeze-invisible) for now; commit only `certification/` evidence + real source. Surfaced to the human for a governance choice (untracked / gitignore / exclude-from-spec).
- **Consequences:** the docs are working state, not version-controlled history; §1/NP_STATE updates never churn the freeze. Revisit if the human wants them committed (then the freeze spec must exclude them).

## D-3 · `capability:m365.propose` gated at `connectors:manage`
- **Context:** the read-only proposal producer precedes an M365 write.
- **Decision:** gate it at the SAME tier as the M365 write channel (`connectors:manage`), per human directive — no principal may stage a proposal it could not execute; propose is not a lower-tier probe of selection state.
- **Consequences:** revisable later (non-frozen `RUNTIME_CHANNEL_PERMISSIONS`); conservative (a caller who cannot write cannot propose).

## D-2 · Channel gated-but-UNDECLARED for one slice (FG-1)
- **Context:** FG-1 gated the channel but its handler lands in Slice 11; `declareChannelResource` must name a store the handler ACTUALLY reads.
- **Decision:** bump `SENSITIVE_BASELINE 195→196` at FG-1 (honest acknowledgment of a new sensitive channel) and defer the declaration + `DECLARED_BASELINE 3→4` to Slice 11 with the handler.
- **Consequences:** one-slice window where the channel is gated but undeclared, recorded as deliberate; a declaration written before the handler would be fiction (CLAUDE.md §4).

## D-1 · Re-record the freeze baseline onto this lineage
- **Context:** the pre-existing baseline `e09df1e` (branch `fix/round23-flush-barrier-recorder`) was foreign/stale (`SOURCE FAIL`); the freeze log even mixed rounds 36–40 / rc.20 commits not in this branch's ancestry.
- **Decision:** re-record the baseline on `cert/data-import-cst-integration` (checkpoint `4721341`, then FG-1 `7fc53e2`); surface the foreign-lineage hygiene note rather than silently absorb it.
- **Consequences:** `verify-freeze` is now meaningful for this branch; two INTACT records bracket FG-1.
