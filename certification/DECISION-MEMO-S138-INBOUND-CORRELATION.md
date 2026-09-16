# DECISION-MEMO-S138 — INBOUND EVENT CORRELATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · POLICY GATE — DISCOVERY ONLY
### Verdict: **DO NOT IMPLEMENT (STOP AFTER MEMO)** — existing product semantics do not support giving verified inbound connector events a canonical correlation identifier at ingest.

---

## 0 · Question
Should verified inbound connector events receive a canonical correlation identifier at ingest so they can
participate in the existing Evidence Trace / operational evidence chain (S126/S127/S128–S137)?

## 1 · Discovery findings (source-traced; A–H)

**A. Which events already have correlationId.**
- `PlatformEvent` (bus) — YES, always minted at materialization: `correlationId: input.correlationId ?? id`
  (`platform/eventBus.ts:365`). A root event correlates to its own `id`; a caused event inherits the parent's.
- `DomainEvent` (command spine) — YES, from the command: `correlationId: cmd.correlationId`
  (`platform/command/durableCommandJournal.ts:226` ← `commandBus.ts:557`). The command's own value is
  renderer-supplied when present, else server-minted `requestId` (`platform/adapter/clientAdapter.ts:114-115`).
- **Inbound `connector.online` webhook events — NO.** `emitVerified` (`connectors/inbound/router.ts:169-190`)
  emits a fixed metadata shape `{connectorId, provider, tenantId, kind:'inbound_webhook', receivedAt}` — no
  correlationId, no txId, no aggregate/command reference. The inbound lineage row pins `correlatable: false`
  by construction (`connectors/inbound/lineage.ts:241`).

**B. Which identifiers represent transaction identity vs event identity.**
- `txId` = `tx_<uuid>`, the DurableCommandJournal record id (`durableCommandJournal.ts:234`) — **business
  transaction identity** (one committed command attempt). It is the S127 delivery-posture join key
  (`operationalRead.ts:178-185`, `evidenceTrace.ts:161`).
- `correlationId` = **chain / "connecting related events" identity**; on the command spine it is the
  ORIGINATING assistant episode `asst_<uuid>` (`connectors/fg14CausalIdentity.test.ts:6-14`). It is the S126
  Evidence-Trace join key, EXACT match only (`evidenceTrace.ts:151,166`).
- `eventId` / `PlatformEvent.id` = **event-instance identity** (per delivery; bus-minted `randomUUID`).
- `causationId` = **direct parent pointer** (the command/event that caused this one).
- `idempotencyKey` = **duplicate-command suppression identity**, tenant-scoped `${tenantId}::${key}`
  (`commandBus.ts:83`, `commandIdempotency.ts:22-23`), fail-closed when missing.
- These are NOT collapsed today, and this memo does not collapse them.

**C. Can inbound connector events legitimately correlate to an existing command/transaction?**
**No business path exists.** A verified webhook is only a low-latency trigger for the same delta sync the
scheduler already runs (`router.ts:8-10,109-110`); it is not modeled as a confirmation of a governed send.
Nothing stamps an inbound event with a transaction or command reference, and the correlationId concept flows
the OTHER direction (outbound assistant episode → command → ActionRecord → delivered event). There is no
inbound→transaction relationship defined anywhere in source. **(STOP: undefined business semantics.)**

**D. Ingress-generated vs authenticated-external-supplied.**
External provider delivery ids (`X-GitHub-Delivery`, Slack `client_msg_id`/retry headers, Graph notification
id) are currently **read-then-dropped inside verification or never read at all** (`router.ts:134-159`); only
signature/replay headers are consumed. An external id is not trusted as authoritative anywhere. If correlation
were ever added, the only defensible producer is the platform at ingress (post-verification), never the raw
external header — but there is nothing internal to correlate it to (see C).

**E. Can one inbound event legitimately map to multiple transactions?**
Potentially **yes and it is unresolved**: a Microsoft Graph webhook delivery can carry multiple notifications
and fan out to multiple targeted syncs (`router.ts:192-203`). A single correlation id per delivery would be
ambiguous (one-to-many), and no policy defines how to model that. **(STOP: unclear cardinality semantics.)**

**F. Do retries / re-deliveries preserve the same identity?**
**No.** The inbound path captures no external delivery id, performs no dedup (`router.ts:82-112`;
`lineage.test.ts:85` — "duplicate deliveries remain DISTINCT rows"), and mints a fresh bus `eventId` per
delivery that is NOT derived from the delivery. Redelivery is therefore indistinguishable from a new event.
The only replay defense is Slack's 5-minute timestamp window (`verify.ts:26,86`) — a time bound, not an
identity. **(STOP: unclear retry/dedup semantics.)**

**G. Must correlation survive restart? Does it today?**
It would need to, and it **does not**. Inbound lineage is a pure projection over the in-memory `EventBus`
replay ring — a bounded (≈500/tenant) `Map`, no disk persistence (`eventBus.ts:127,144`; lineage reads
`source.replay(...)`, `lineage.ts:284-296`). Inbound identity is volatile and silently aged out; it is never
written to any durable store (unlike the command journal / delivered-event log).

**H. Where would correlation belong?**
`PlatformEvent.correlationId` already exists but is a **FROZEN shared type** (`packages/shared/src/types/
platform.ts:199-251`). Inbound metadata is open (non-frozen) and could hold an id, but the Evidence-Trace
composer **never receives inbound lineage rows at all** (`buildEvidenceTrace` passes only journal + delivered
streams, `operationalRead.ts:174-186`) — so there is no consumer to make correlation meaningful without new
plumbing. Adding a first-class inbound correlation field to `PlatformEvent` would be a frozen change (FG).

## 2 · Policy points (explicit)
- **Purpose of correlation:** connect related events/transactions into one evidence chain. For inbound events
  there is currently **no related transaction to connect to** (C) — so the purpose is unsatisfiable today.
- **Identity semantics:** event ≠ transaction ≠ correlation ≠ dedup (B). Not collapsed.
- **Producer of the identifier:** would have to be the platform at ingress; external ids are untrusted (D).
- **Retry behavior:** undefined — no identity distinguishes redelivery (F).
- **Duplicate delivery behavior:** no dedup exists; policy has not defined one (F). Do not invent one.
- **Cross-tenant isolation:** tenant is authoritative (`resolveTenantId → workspaceId`, `router.ts:471`),
  never from payload; lineage drops foreign-tenant rows (`lineage.ts:62`). A correlation id must never become
  a tenant selector.
- **External-provider correlation headers/IDs:** present at the wire but deliberately dropped; retaining them
  would require an explicit `externalCorrelationId` distinct from platform correlation, and a trust decision
  that does not exist.
- **Internal generated correlation:** the only defensible option, but pointless without a consumer/relationship.
- **Relationship to transactionId (`txId`):** none defined for inbound (C).
- **Relationship to eventId:** inbound already has a per-delivery `eventId`; it is not delivery-derived (F).
- **Relationship to idempotencyKey:** none; inbound has no idempotency key and no dedup requirement stated.
- **Relationship to evidence trace:** inbound lineage is not fed to the trace composer (H); correlation would
  be inert.
- **Mandatory vs optional:** cannot be decided — the relationship it would encode is undefined.
- **Retention requirements:** undefined; inbound is in-memory only today (G).
- **Privacy/security:** raw payload and credentials are excluded and must stay excluded; a correlation id must
  be bounded/sanitized and must never carry payload-derived authority.
- **Failure behavior:** undefined.

## 3 · Decision
**DO NOT IMPLEMENT.** Four independent STOP conditions from the session mandate are met:
1. **Undefined business semantics** — no modeled relationship between an inbound event and a governed
   transaction (C).
2. **Unclear retry/dedup semantics** — redelivery is indistinguishable; no dedup policy (F).
3. **Unclear cardinality** — one delivery may fan out to many syncs (E).
4. **No consumer + would require frozen change** — the trace composer does not ingest inbound lineage (H),
   and a first-class field is frozen (FG) — implementing now would create an inert, unfalsifiable field
   (violates the standing "an unconsumed field is unfalsifiable, not safe" rule).

Implementing correlation now would mean inventing correlation policy — expressly forbidden by this gate.

## 4 · What would unblock a future implementation (recorded, not decided)
A future session could proceed ONLY after the operator/product defines:
- a concrete business relationship where an inbound event corresponds to a governed transaction (e.g. a
  provider delivery that confirms a specific outbound send), including how the inbound event carries that
  transaction reference;
- retry/duplicate identity (which external id, if any, is trusted, and the dedup rule);
- one-to-many handling for multi-notification deliveries;
- durable retention for inbound identity (today it is in-memory only);
- the consumer path (feeding inbound lineage into the trace composer), which is the actual missing wiring.

Only with those defined would the smallest additive mechanism (platform-minted `correlationId` +, if trusted,
a clearly-separated `externalCorrelationId`; never collapsing event/transaction/dedup ids; never an authority
or tenant selector) be justified — and any `PlatformEvent` shared-type change would go through an FG request.

## 5 · Non-goals honored
No code changed. No frozen surface touched. No FG token requested or guessed. No dedup mechanism introduced.
No external id trusted. S132 qs supply-chain debt untouched. No parallel connector/event package activated.
