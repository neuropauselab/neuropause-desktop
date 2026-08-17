# NeuroPause OS — Wave 2 / Slice 9 — FROZEN GATE: Structured-Proposal Delivery Carrier

**STOP (Outcome B). No code, no channel added. Source proves there is NO existing non-frozen carrier that can
transport a NeuroPause-validated structured M365 proposal (`{to,subject,body}` + provenance) from the main process to
the renderer's `M365WritePanel`. Every main↔renderer carrier's payload schema lives in the frozen `packages/shared`
IPC layer, and the bridge is schema-validated at the edge — so delivery requires a new frozen IPC channel. Per Phase
23 Outcome B this is the mandated frozen-delivery-gate; it requests authorization and changes nothing.**
Status: `SOURCE-PROVEN` · `NOT-IMPLEMENTED` · `DEFERRED`.

## Baseline `SOURCE-PROVEN`
HEAD `670b52e` (unchanged), branch `cert/data-import-cst-integration`, `git diff --check` clean; prior Wave-2 +
Slice-1..8 work preserved. This slice added only this report. No commit, no push.

## What is already ready (needs only transport) `SOURCE-PROVEN`
- Slice-8 producer `capabilities/m365ActionProposal.ts` — `buildM365ActionProposal(selection, principal, params)` +
  `toWritePanelProposal(proposal) → {to,subject,body}`. Pure, validated, non-executing. **26/26 tests.**
- Slice-7 review seam `M365WritePanel.proposal?: {to?,subject?,body?}` (renderer, non-frozen) — human review →
  existing certified `M365ActionExecute`. **6/6 UI tests.**
The ONLY missing link is a main→renderer transport for the produced proposal.

## Existing carriers inspected — each insufficient `SOURCE-PROVEN`
1. **`assistant:ask` response** (`IpcChannel.AssistantAsk`; schema `packages/shared/src/ipc/contracts.ts:839+`) —
   FROZEN contract. Also a different renderer surface (assistant UI) from the Connector Center that hosts
   `M365WritePanel`; carrying a proposal here would still need a frozen field + cross-surface routing. Insufficient.
2. **`assistant:event` broadcast** (`IpcChannel.AssistantEventBroadcast`) — payload is the frozen `AssistantEvent`
   union; adding an `m365-proposal` event is a frozen `packages/shared` change. Insufficient.
3. **`connectors:m365.draft`** (`IpcChannel.M365Draft`; schema `contracts.ts:474+`) — FROZEN; returns body TEXT only
   (`{ok,text,model}`), no recipients/subject, no capability validation, no principal. Extending it to a structured
   proposal changes its frozen schema AND its handler in the frozen `connectors/index.ts`. Insufficient.
4. **`M365WritePanel.proposal` prop** (Slice 7, non-frozen) — the review SEAM, not a transport; nothing in production
   feeds it. It is the destination, not the carrier.
5. **Renderer self-assembly** from existing non-frozen renderer IPCs (`m365Actions`, `connectors.list`, `m365Draft`) —
   cannot obtain the authoritative capability validation (`resolveCapabilitySelection` is main-only, not IPC-exposed),
   cannot obtain the authoritative principal (main-only; the renderer must NOT supply it — Phase 13), and `m365Draft`
   yields no to/subject. The constitutional requirement (Phase 5: re-resolve the capability authoritatively, never
   trust an AI capabilityId) cannot be met renderer-side. Insufficient.
6. **A generic/open channel** — none exists; every IPC handler is schema-validated at the edge against a
   `packages/shared` contract, so there is no channel to carry an unschema'd payload non-frozenly. Insufficient.

## Why no non-frozen route exists `SOURCE-PROVEN`
The proposal MUST be produced in main (authoritative capability selection + principal live there), so it MUST cross
the main→renderer boundary. That boundary is IPC, and 100% of IPC channels + schemas are declared in the frozen
`packages/shared/src/ipc/{channels.ts,contracts.ts}`. Therefore any new payload = a frozen-contract change. There is
no legitimate non-frozen carrier.

## Exact frozen contract required (minimum change — for authorization, NOT implemented)
A single ADDITIVE, read-only channel:
- **`packages/shared/src/ipc/channels.ts`** — one new enum value, e.g. `CapabilityProposeM365Action:
  'capability:m365.propose'`.
- **`packages/shared/src/ipc/contracts.ts`** — a request schema (e.g. `{ capabilityId: string, accountId?: string,
  purpose?: string, params: { to?, subject?, body? } }` — the UNTRUSTED AI candidate) and a response schema (a
  discriminated union: `{ ok:true, proposal:{to,subject,body}, provenance:{capabilityId,accountId} }` |
  `{ ok:false, reason }`).
- **Main handler** (non-frozen, `apps/desktop/src/main/capabilities/*` + wiring): resolve `resolveCapabilitySelection`
  → `resolvePrincipal` → `buildM365ActionProposal` (Slice 8) → `toWritePanelProposal`. Returns DATA only.
- **Renderer** (non-frozen): call the channel, feed the response into `M365WritePanel.proposal`.
The AI candidate (natural-language → `{to,subject,body}`) is generated in main (via the existing AI engine) or passed
in; either way it is UNTRUSTED and re-validated by the Slice-8 producer.

## Certification impact `SOURCE-PROVEN`
- The certified M365 effect path is **UNTOUCHED**: `M365ActionExecute`, CST, `governedSend`/`governedAction`, durable
  admission, executor, HoldStore, outcome semantics — none change. The new channel is a READ-ONLY proposal producer;
  it performs no effect and never sets `confirmed`.
- **Frozen-contract impact:** additive only — one new channel enum + one new schema pair in `packages/shared`. It does
  not modify or reinterpret any existing contract. M365 29/29 certification is unaffected (the certified actions and
  the coverage guard operate on the executor/action catalog, not on this channel).
- This is nonetheless a change to a FROZEN surface (`packages/shared`), so it requires this gate + explicit
  authorization + the certification-freeze check.

## Security implications `SOURCE-PROVEN`
- The request carries an UNTRUSTED AI candidate; the response is re-validated authoritatively (Slice 8) — a hostile
  capabilityId/params cannot produce a proposal for another action/account/tenant (fails closed).
- Actor/tenant remain server-resolved at the later `M365ActionExecute` call; this channel never carries them and the
  renderer never supplies them.
- The channel is read-only (produces DATA); it cannot execute, confirm, approve, or mint admission. The AI stays
  permanently outside the effect boundary. Human review + confirmation in `M365WritePanel` remain the sole consent.

## Required tests (when authorized)
Channel schema round-trip; handler returns a validated proposal for a SELECTED mail.send; every fail-closed reason
(NOT_SELECTED / PRINCIPAL_UNRESOLVED / UNSUPPORTED_ACTION / INVALID_PARAMS); no actor/tenant in the request; response
carries no credential/callable/`confirmed`; renderer feeds `M365WritePanel.proposal` and the reviewed action equals
the executed action (Slice-7 TOCTOU); AI-boundary suite stays green.

## Rollback
Report only — nothing to roll back. If authorized, the additive channel + schema are independently removable and
default to today's behavior (no proposal delivered).

## STOP conditions triggered (Phase 26)
"frozen IPC/shared contract is required." Per Phase 23 Outcome B: STOP, do NOT add the channel, write this gate.

## Recommendation
Authorize the single additive read-only channel `capability:m365.propose` (channels.ts + contracts.ts) as its own
certification-reviewed slice. It is the minimum, and it keeps the AI a proposer: `AI candidate → authoritative
validation → data → M365WritePanel → human review → human confirm → existing certified path`. Do NOT overload the
assistant response or `m365Draft`; do NOT touch the certified M365 effect path.

## STOP
Traced, not built. No existing non-frozen carrier can deliver a validated structured proposal to the renderer; the
minimum route is one additive frozen IPC channel, deferred to an authorized slice. No frozen surface modified, no
code, no live claim, certification impact to the certified path NONE. HEAD `670b52e`; changes unstaged. No commit.
No push. STOP.
