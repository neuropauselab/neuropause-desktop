# F-N16-1 · ACTION-LEVEL CERTIFICATION AT DISCOVERY — CLOSING EVIDENCE
## Operator-ruled queue jump (20 Aug 2026): ahead of NP-019, because this is the F-5 truth-order class in the one place it must never live — discovery claiming a standing the boundary denies.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: TEST-VERIFIED.** PROCEED-class (gate-detector run BEFORE every edit); zero frozen touch; zero
sensitive touch; the boundary's deny-by-default byte-untouched. NP-000 = HOLD unchanged.

## The operator's ruling, quoted

> F-N16-1 JUMPS THE QUEUE — it runs ahead of NP-019, because it is the F-5 truth-order class in the one place it
> must never live: discovery claiming a standing the boundary denies. Bounded slice: the discovery layer's
> certification/selectability answers become ACTION-level — mutationAssuranceFor (or its consumer) consults the
> per-action certification predicate, so calendar.create reads NOT-CERTIFIED and not-aiSelectable at discovery
> exactly as the S5.1 boundary rules. The existing divergence pin flipping RED→GREEN is the acceptance test; the
> boundary's deny-by-default stays byte-untouched; full main suite.

## The defect, precisely

`mutationAssuranceFor` answered a CONNECTOR-level question (`microsoft-entra` → `governed-certified`), and the
discovery service projected that answer onto every mutating ACTION on that connector. Because `mail.send` is
certified, its 28 uncertified siblings inherited its standing: `calendar.create` read `governed-certified` AND
`aiSelectable: true` at discovery, while `isCertifiedConsequential('calendar.create')` was false and the S5.1
boundary refused it. Deny-by-default held where it counts — nothing could execute — but **the layer that tells
the AI and the user what is governed was claiming a standing the boundary denies.** One certified action was
vouching for its siblings.

## The fix, and why it is shaped this way

The per-action predicate already existed — as an INLINE LAMBDA inside the L6 execution gate, plus a verbatim
copy in a test. Adding a third copy in discovery would have been the same two-vocabularies disease the operator
ruled against in the very next paragraph. So the fix **names it once**:

1. **`liveCapabilitySources.ts`** gains the single named authority —
   `CERTIFIED_CONSEQUENTIAL_CAPABILITIES = ['mail.send']` + `isCertifiedConsequentialCapability(id)` — with the
   entry rule stated: a capability enters ONLY with a live certified chain behind it; kit-complete is not
   certified, a governed executor is not certified, a certified CONNECTOR is not certified (§24).
2. **`mutationAssuranceFor(connectorId, capabilityId?)`** — ONE function, one optional argument, and the
   argument list says which question is being asked. WITH a capability id it answers the ACTION-level question
   (the only one that can honestly justify showing a capability as governed); WITHOUT one it answers the
   connector-level question, documented as NOT meaning any action is certified. **This is why the boundary is
   byte-untouched:** `deriveAuthority` calls `mutationAssuranceFor(target.connector)` with one argument, so its
   `governanceStatus` output is unchanged, the proposal's canon comparison is unchanged, and the CST path never
   sees a different value. Same for `brainProposeLane` and the L4 `capabilityGraph`.
3. **`capabilityDiscoveryService.ts`** — `CapabilitySources.mutationAssurance(connectorId, capabilityId)` and
   the one call site now passes `cap.capabilityId`. The doc states why: certification is per-ACTION, never
   per-connector — a source that answers from the connector alone lets one certified action vouch for its
   uncertified siblings.

No third copy was created, and the gate's inline lambda is now **pinned against** the named set so the two
cannot drift apart unnoticed. Collapsing the gate onto the shared export belongs to the ruled F-N16-2/3/4
reconciliation slice — `liveBrain/executionGate.ts` is a GATE-class surface and its diff will be presented, not
slipped in under this fix.

## Acceptance (the ruled test) + the pins

**The ruled acceptance:** the F-N16-1 divergence pin flipped. It previously asserted
`certificationState.state === 'CONFLICTING'` with the record's finding `ok:false`; it now asserts
`{ state: 'KNOWN', value: 'not-certified' }`, `conflictingFields(record) === []`, and the finding `ok:true` —
with **both predicates driven live**, so the agreement is code, not fixture.

Four further pins drive the **REAL discovery service** over the **REAL** `ALL_M365_ACTIONS` through the real
`buildCapabilitySources`:
- `calendar.create` → `executionAssurance: 'governance-not-proven'`, `aiSelectable: false`, with the honest
  `unavailableReason`.
- `mail.send` → unchanged: `governed-certified`, selectable.
- **EVERY uncertified mutating action** now reads `governance-not-proven`: the certified set across the whole
  live catalog is exactly `['mail.send']`, and so is the aiSelectable set — asserted over the real catalog
  (guarded `length > 5` so it cannot pass against a one-item fixture).
- `resolveSelection('calendar.create')` → `GOVERNANCE_NOT_PROVEN`, capability null — discovery and the boundary
  now refuse in the same words.
- **ANTI-FORK pin:** the gate's inline lambda source and the named set must change together or the pin fails.

## Honest bounds

- The L6 gate still carries its own inline copy (agreement pinned); the collapse is the ruled next slice.
- `calendarCreateDryRun.test.ts` builds its own `AssistantCapability` fixture asserting
  `executionAssurance: 'governed-certified'` to prove the propose edge refuses ANYWAY. That fixture now
  describes a state the real service would no longer produce — which makes it a STRONGER negative test (refusal
  even when the assurance claims certified), not a stale one. Recorded, deliberately unchanged.
- This changes what discovery SAYS, not what execution DOES: no authority, admission, or execution path was
  touched, and `deriveAuthority`'s output is provably identical (one-argument call site).

## Verification (all RUN)

`capabilityRecord.test.ts` 22/22 (17 + 5 new) · the full `capabilities/` suite **208/208 across 14 files** —
including `capabilityDiscoveryService.test.ts`, `capabilitySelection.test.ts` and `calendarCreateDryRun.test.ts`
unmodified and green · **UI suite 42 files / 279 passed** (the renderer surfaces that read assurance) ·
typecheck node clean · lint clean · honesty scan 0 findings · gate-detector PROCEED on all four paths, run
BEFORE the first edit · **full main suite 869 files / 9096 passed / 3 skipped** (was 869/9091/3 — the delta is
exactly the five new pins; every other suite unchanged and green, which is the byte-untouched-boundary proof).
