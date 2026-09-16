# NeuroPause OS — Wave 2 / Slice 10 — FG-1 Gate Execution (frozen `capability:m365.propose` under change control)

**The authorized additive, read-only IPC contract `capability:m365.propose` landed under change control: an isolated
FG-1 commit bracketed by two INTACT freeze records. The frozen pair (channels.ts + contracts.ts) is exactly as
authorized; two non-frozen lines accompany it to keep the tree green. The certified M365 execute path is untouched.
No push.**
Labels: `SOURCE-PROVEN` · `TEST-VERIFIED` · `NOT LIVE-VERIFIED`.

## Authorization (on the record)
Human token, verbatim: **`AUTHORIZED: FG-1 — capability:m365.propose, additive read-only, per gate doc`** (Option A),
against the Slice-9 gate doc `PHASE-I-A3-NEUROPAUSE-OS-WAVE-2-SLICE-9-FROZEN-DELIVERY-GATE.md`. Three read-only
pre-token confirmations (A handler/authz coverage, B reason completeness, C confirm→execute integrity) were answered;
the frozen diff was unchanged by them. Micro-authorization for the second non-frozen line: **`PROCEED: option A`**.

## Procedure mapping (governance reality)
The FG-1 prompt's referenced artefacts (`NP-RAT-01`, `verify_freeze.sh`, `WAVE3_ALIVE_WIRING.md`, `OPERATION_ALIVE.md`)
are **not in this repo** — they live in a document archive. Sanctioned change control HERE = the repo's own tooling
(`certification/freeze-baseline.sh` + `verify-freeze.sh` + `baseline.json`) plus this token trail in the evidence.
No freeze procedure was improvised beyond the repo's real tooling.

## Change-control trail (commits)
```
670b52e  (prior HEAD, freeze gate lineage)
4721341  checkpoint: wave-2 slices pre-FG-1            (64 files, non-frozen only)
19e9dcd  freeze: re-record baseline at checkpoint      → BASELINE-dd8b20bce0ce · verify-freeze INTACT (#1)
7fc53e2  FG-1: capability:m365.propose                 (frozen pair + 2 non-frozen lines) — ISOLATED
8afb562  freeze: re-record baseline at FG-1            → BASELINE-2a3c45c5acef · verify-freeze INTACT (#2)
```
The two INTACT records (#1 `19e9dcd`, #2 `8afb562`) bracket the isolated FG-1 commit `7fc53e2`. The prior baseline
was stale/foreign — `e09df1e` on branch `fix/round23-flush-barrier-recorder` (an ancestor, `SOURCE FAIL`); re-recorded
onto this lineage.

## Freeze hygiene note (foreign lineage)
`verify-freeze.sh`'s commit log surfaced rows from a foreign lineage — rounds 36–40 / `rc.20` (e.g. `efe8196`,
`f121ce7`) — that are **not** in this working branch's ancestry. Surfaced, not fixed: the freeze log mixed a lineage
this branch never contained. Re-recording anchored the baseline to `cert/data-import-cst-integration`.

## The applied diff — frozen / non-frozen path split
**FROZEN (`packages/shared` — the authorized pair):**
- `packages/shared/src/ipc/channels.ts` — `+CapabilityProposeM365Action: 'capability:m365.propose'` (enum) and
  `+IpcChannel.CapabilityProposeM365Action` in `RUNTIME_INVOKABLE_CHANNELS`.
- `packages/shared/src/ipc/contracts.ts` — `+CapabilityProposeM365ActionRequest` (zod: `{capabilityId, accountId?,
  purpose?, params: z.record(z.unknown())}`) + `+CapabilityProposeM365ActionResponse` (data-only union: reviewable
  `{to,subject,body}` + provenance, or a typed refusal with the four Slice-8 reasons).

**NON-FROZEN accompaniment (two lines, to keep the tree green):**
- `apps/desktop/src/main/ipc/runtimeAuthz.ts` — `[IpcChannel.CapabilityProposeM365Action]: 'connectors:manage'`
  (gated at the same tier as the M365 write channel: no principal may stage a proposal it could not execute).
- `apps/desktop/src/main/tenancy/channelStoreCoverageGate.test.ts` — `SENSITIVE_BASELINE` **195 → 196**.

## Miss-and-revert narrative (part of the record)
Pre-token confirmation A named two channel-classification guards (`ipc/runtimeAuthz.test.ts`,
`tenancy/round10PrincipalsChannels.test.ts`) but **missed a third**: `tenancy/channelStoreCoverageGate.test.ts` pins
the COUNT of authority-gated channels (`SENSITIVE_BASELINE`). On first apply the full suite was **8644 passed / 1
failed** — the count-pin, not a real defect. I **reverted** the working tree to the freeze-#1 INTACT state (clean,
green), surfaced the miss, and obtained a micro-authorization (Option A) before re-applying. The frozen diff never
changed; only the non-frozen accompaniment grew from one line to two.

## Gated-but-UNDECLARED for one slice (deliberate)
The channel is authority-gated but has **no `declareChannelResource(...)` declaration** at Slice 10 — by design: an
unhandled channel reaches **no store**, so declaring one would be fiction. The `SENSITIVE_BASELINE +1` is the honest
acknowledgment that a new sensitive channel exists; the declaration (naming what the handler ACTUALLY reads,
verified from code) + `DECLARED_BASELINE 3→4` land in **Slice 11 with the handler**. The coverage floor test stays
green (`covered.length 3 ≥ DECLARED_BASELINE 3`).

## Verification
- **Full main suite: 8645 passed / 3 skipped (8648 total, 817 files)** — equals the pre-FG-1 checkpoint count (FG-1
  adds no test; the `channelStoreCoverageGate` test returned to passing). Typecheck clean.
- Channel-classification guards `runtimeAuthz.test.ts` + `round10PrincipalsChannels.test.ts`: **52/52**.
- UI suite: **242/242**. AI-boundary: **5/5**.
- Working tree at FG-1 commit = exactly the 4 files; the freeze re-records touched only `certification/baseline.json`
  (excluded from source freeze).

## Classified defect note (do not fix in passing)
Changed-file lint on `packages/shared/src/ipc/contracts.ts` reports **one pre-existing error**: line 2418,
`AiPullModelRequest`'s `regex(/^[a-zA-Z0-9._:\/-]+$/)` — `no-useless-escape` on `\/`. It is **not** in the FG-1
additions (those are ~lines 484–509), it is in the frozen `packages/shared`, and per directive it is **untouched** —
logged here as a classified defect that may become its own change request. (Consistent with the documented repo-wide
lint debt, e.g. `cst/sendTransition.negative.test.ts`.)

## Certification impact — **NONE (to the certified path)**
The certified M365 effect path — `M365ActionExecute`, CST (`governedSend`/`governedAction`), durable admission,
executor, and the 29/29 coverage guard — is **untouched**. FG-1 is an additive, read-only channel with **no handler
yet** (data-only contract). The frozen-surface change is additive to `packages/shared`; it reinterprets no existing
contract. `verify-freeze` INTACT on the re-recorded baseline.

## Live status
`NOT LIVE-VERIFIED` / `NOT-OBSERVED` — the channel has no handler and was not invoked; nothing executed.

## Slice 11 requirement (next)
Implement the `capability:m365.propose` handler (edge-validate → `resolveCapabilitySelection` → `resolvePrincipal` →
`buildM365ActionProposal` → `toWritePanelProposal`, data-only) with structural no-execution pins, AND land
`declareChannelResource({ channel: IpcChannel.CapabilityProposeM365Action, store: <the store the handler ACTUALLY
reads, verified from code>, effect: 'read', reason: … })` + `DECLARED_BASELINE 3→4` in the SAME commit as the handler.

## STOP boundary
FG-1 landed under change control. No push. Continuing (report-and-continue) into Slice 11 — the data-only handler.
HEAD `8afb562`; freeze INTACT (#2, BASELINE-2a3c45c5acef).
