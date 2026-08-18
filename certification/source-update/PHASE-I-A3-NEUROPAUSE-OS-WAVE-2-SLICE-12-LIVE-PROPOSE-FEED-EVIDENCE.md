# SLICE 12 — Live delivery + panel feed · EVIDENCE

**Status: TEST-VERIFIED.** FROZEN SURFACE: none. CERTIFICATION IMPACT: none (the certified M365 execute path is unchanged).

## What Slice 12 delivered

1. **The first production feed of `capability:m365.propose`** (Slice-11's data-only handler). A dev-triggered renderer
   path calls the channel with manual params; the NeuroPause-VALIDATED `{to, subject, body}` proposal prefills the
   certified `M365WritePanel`. The human still reviews and confirms downstream through the **unchanged** `M365ActionExecute`
   certified path — propose never sends.
2. **Typed UI for every refusal + loading + transport error.** All four refusal reasons (`PRINCIPAL_UNRESOLVED`,
   `CAPABILITY_NOT_SELECTED`, `UNSUPPORTED_ACTION`, `INVALID_PARAMS`) render as typed, inert human text; a loading state
   during the invoke; a transport error is surfaced **distinctly** (a thrown IPC error is not one of the four semantic
   refusals — it is not misreported as one).
3. **Hostile subject/body render as inert text.** The proposal flows into React `value` props (auto-escaped); no markup is
   interpreted.
4. **Comma-in-address hardening** (the S13 prerequisite gate) — landed first, see below.

## Files (all NON-FROZEN)

- `apps/desktop/src/main/capabilities/m365ActionProposal.ts` — comma hardening in `normalizeRecipients`.
- `apps/desktop/src/main/capabilities/m365ActionProposal.test.ts` — 26 → 31 pins.
- `apps/desktop/src/renderer/src/lib/ipc.ts` — `ipc.connectors.m365Propose` helper (rawInvoke; response type imported).
- `apps/desktop/src/renderer/src/connectors/EntraConnectorPanel.tsx` — DEV-only propose trigger + typed refusal/loading UI
  + threads `proposal` into `M365WritePanel` (remounted via `key`).
- `apps/desktop/ui-tests/m365ProposeFeed.test.tsx` — 8 new composition pins.

## Frozen-boundary decision (DECISIONS D-6)

The clean typed path would add `'capability:m365.propose'` to `IpcResponseMap` in `packages/shared/src/ipc/responses.ts`.
The repo treats **all of `packages/shared` as a frozen surface** (Slice-9 gate doc: "a change to a FROZEN surface
(`packages/shared`)… requires this gate"). The S12 roadmap states "No frozen surface expected", so the feed uses the
existing `rawInvoke` escape hatch — the channel is already on the preload allowlist (landed via FG-1) — with the response
**type imported** (reading a type is not a frozen-surface change). No `packages/shared` file was modified. Adding the
typed `IpcResponseMap` entry is deferred to a future FG gate if the channel ever needs to ship beyond the dev trigger.

## Comma hardening (prerequisite gate, committed `48c2cdf`)

`normalizeRecipients` now distinguishes the two `to` shapes: in a STRING a comma is the separator between addresses
(unchanged); in an ARRAY each element is ONE address, so a comma inside an element is malformed → `INVALID_PARAMS` with a
comma-specific detail. Rationale: `toWritePanelProposal` re-serializes recipients as a comma-joined string, so a comma
buried in one address would silently split into two on any downstream re-parse. Pins: array element with comma in local
part and array element smuggling two addresses → `INVALID_PARAMS`; the legitimate string-separator path still splits
(regression guard); accepted recipients never contain a comma so the panel comma-join round-trips.

## Proofs (RUN against BASELINE-35431ae7446f)

- Producer unit: `m365ActionProposal.test.ts` — **31 passed**.
- Renderer composition: `m365ProposeFeed.test.tsx` — **8 passed**:
  - a validated proposal prefills the panel and does NOT send (propose ≠ consent; zero execute calls);
  - the confirmed action equals the proposed action, executed through the certified IPC with no renderer-supplied
    authority (no actor/tenant/principal/token in the request);
  - each of the four refusals → typed inert text, no prefill, no send;
  - transport error → distinct error, not a semantic refusal;
  - hostile subject/body → inert (no `<img>`/`<script>` element injected, no side effect ran).
- Full UI suite: **250 passed** (32 files; +8). Full main suite: **8661 passed / 3 skipped** (818 files). Typecheck clean;
  lint clean on the changed files.

## Honest scope note

This is **TEST-VERIFIED** at the composition boundary (vitest UI with routed IPC), not a real-Electron Playwright run —
that full mock e2e in the real app is **Slice 14** ("the loop closes"). No real Graph call occurs; the certified path
terminates at the mock executor exactly as in Slice 7. `import.meta.env.DEV` is falsy in packaged builds, so the dev
trigger never ships.

## Change-control trail (non-frozen slice; routine re-records)

```
5aadbb5  governance(D-5): track the four living docs + exclude from freeze source spec
48c2cdf  alive(s12): comma-in-address hardening (producer)        (non-frozen source)
014d163  freeze re-record #5 (INTACT, BASELINE-3a820f71d6d5)
e55a245  alive(s12): first production feed capability:m365.propose (non-frozen renderer + test)
f9d9ef2  freeze re-record #6 (INTACT, BASELINE-35431ae7446f, baseline commit e55a245)
```
