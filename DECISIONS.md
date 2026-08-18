# DECISIONS.md — non-obvious technical decisions (living, now TRACKED)
Per CLAUDE.md §3: context → decision → consequences. Newest first.

## D-9 · Slice-15 pre-flight — run mode A + FG-4 first-real-send guard (compile-stripped)
- **Run mode A (app-principal-only):** the app's own login hits the dead backend (local-first is S17), so the first real send seeds ONLY the app principal (disclosed, `-e2e` stamped) while the Microsoft identity/consent/token/send/admission are ALL real. A distinct flag `NEUROPAUSE_S15_APPPRINCIPAL=1` (never `NEUROPAUSE_E2E=1`); same `__NP_E2E__` compile gate + strip proof. Chosen over "do S17 first" because the first real send's value (real external effect + consent + admission) is achievable now with only the dead login seeded.
- **FG-4 (frozen `connectors/index.ts`, landed `b0ac3c5`):** the recipient allowlist + single-send latch must fire BEFORE the executor, and the human can edit the panel's To field after propose — so a propose-layer guard can't cover a real send, and there is no non-frozen trusted seam between the IPC and `governedSend`. The frozen change is a 12-line compile-stripped, dynamically-imported gated hook that calls the NON-frozen `firstRealSendGuard`; it never weakens the certified path (only refuses).
- **Conditions (7):** mode coupling HARD-FAILs (`resolveE2eMode` throws → `app.exit`); allowlist covers all recipient fields parsed as the executor sees them (cc/bcc/unparseable → DENIED, fail closed); structural absence (dynamic import, lazy latch, verify-e2e-strip extended, PASS); latch-before-send = at-most-once (a failed attempt consumes it); human evidence (screen-record + UTC + inbox screenshot); evidence vocabulary AUTHORIZED/SUBMITTED/EXTERNALLY-OBSERVED (never "SUCCESS", a single ATTEMPT); S16 matches on internetMessageId + recipient + subject/body fingerprint + timestamp window (never id alone).
- **Consequences:** no real send performed — that is the human keyboard gate (S15 runbook + go/no-go). The guard is S15-milestone safety (S21 idempotency + S28 policy DSL supersede it later); compile-stripped from release so the shipped product is unaffected.

## D-8 · Slice-14 e2e seed seam — global-fetch mock (not the frozen makeHttp), double-gated, structurally absent
- **Context:** the real-Electron e2e needs the certified executor to reach a MOCK Graph. The designed test seam is
  `makeHttp` at `connectors/index.ts:609` — but `connectors/index.ts` is a FROZEN surface; dev-gating it would need an FG gate.
- **Decision:** mock Graph by intercepting `globalThis.fetch` (only `graph.microsoft.com …/sendMail`) in a compile-gated
  e2e-only main module (`src/main/e2e/e2eSeed.ts`). This touches NO frozen surface and weakens NO validation —
  governedSend, the CST kernel, `scopesOk`, the actor check and admission all run unchanged; only the external HTTP
  endpoint is redirected (exactly what `makeHttp` does in unit tests). Also seed a fake authenticated principal
  (`authService.setStatus` — no offline login exists) + a fake governed account + vault token.
- **Structural absence (the seeding-seam rule):** double gate — compile-time `__NP_E2E__` define (electron.vite.config.ts;
  false unless `NP_E2E_BUILD=1`, which dead-code-eliminates the branch + drops the chunk) AND runtime `NEUROPAUSE_E2E=1`.
  `scripts/verify-e2e-strip.sh` proves a release build contains none of it (PASS). Anti-masquerade: `-e2e` version +
  window-title stamp. The fake-principal seam is treated as the identity-forging security surface it is.
- **Consequences:** S14 lands with zero frozen touch. If S15's compiled-in recipient allowlist must sit inside a frozen
  send path, THAT is gated separately (never smuggled). Evidence: SLICE-14 real-electron e2e doc.

## D-7 · Slice-13 surface = the ONE M365WritePanel via the S12 feed; the assistant→panel carrier is FG-3 (frozen)
- **Context (rule 4 — ONE SURFACE):** the assistant-initiated mail flow must render its proposal ONLY in the Slice-7 `M365WritePanel`, through the Slice-12 propose feed — no new review surface, no second confirmation architecture. The trusted intent generator runs in MAIN; the panel renders in the RENDERER. So a structured `{to, subject, body}` must cross main→renderer.
- **Problem:** `AssistantEnvelope` (in FROZEN `packages/shared`) has no structured mail field. `draft` is `{kind,text,note}` and `navigation.query` is a bare string — carrying `{to,subject,body}` through either would SMUGGLE structured, authority-relevant data through a string field. That is exactly "routing around a frozen boundary by weakening validation," which the Slice-13 rules forbid.
- **Decision:** gate an additive, OPTIONAL `AssistantEnvelope.mailIntent?: { to: string[]; subject: string; body: string } | null` field as **FG-3**, rather than route around it. The renderer reads the field, stores it in a NEW renderer-only handoff mailbox (the proven `assistantHandoff`/`searchHandoff` pattern), navigates to the Connector Center, and `EntraConnectorPanel` consumes it on mount and feeds `M365WritePanel` **via the Slice-12 `ipc.connectors.m365Propose` feed** — so the proposal is (re)produced and validated through the certified propose path, not carried pre-made. One surface, one confirmation; the human still confirms through the unchanged certified path.
- **Why frozen at all:** the repo treats all of `packages/shared` as a frozen surface (D-6; Slice-9 gate doc). The envelope has NO wire zod-schema and is built via a `baseEnvelope` helper, so the field is additive-optional: `null`/absent on every non-mail turn and on envelopes predating it — no constructor breaks, no schema change. Verified before proposing the gate.
- **Consequences:** the safety-critical generator + its proof land non-frozen (committed `c15bec2`); the assistant→panel wiring is COUPLED to the field (it references `mailIntent`) and lands only after the FG-3 token, per the change-control choreography. Recipient safety is unaffected by the carrier: recipients are literal-from-turn (rule 1), re-validated by the producer, human-reviewed.

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
