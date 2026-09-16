# SESSION 138 — INBOUND CORRELATION DECISION & READINESS CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · POLICY GATE
### Outcome: **NO IMPLEMENTATION — STOP AFTER MEMO** (existing semantics do not support inbound correlation)

## 1 · Discovery findings (source-traced)
Three read-only discovery sweeps established, with file:line evidence (full detail in
`DECISION-MEMO-S138-INBOUND-CORRELATION.md` §1):
- **PlatformEvent** (`packages/shared/src/types/platform.ts:199-251`, FROZEN) carries `id`, `correlationId`,
  `causationId`, `tenantId`, `timestamp`, `type` — NOT `eventId`/`transactionId`/`at`. The command spine's
  `DomainEvent` (main, non-frozen) carries `eventId`, `correlationId`, `causationId`, `aggregateId`, `at`.
- **Inbound webhooks** (S114 `connectors/inbound/router.ts:169-190`) emit a `connector.online` event with fixed
  metadata `{connectorId, provider, tenantId, kind:'inbound_webhook', receivedAt}` — **no correlationId, no
  external delivery id, no raw payload, no credentials**. Tenant is authoritative (`resolveTenantId →
  workspaceId`, `index.ts:471`), never from payload.
- **Inbound lineage** (`connectors/inbound/lineage.ts`) projects rows with `correlatable:false`,
  `dedupeRef:null`; it reads the **in-memory EventBus replay ring** (`eventBus.ts:127`), which is bounded and
  **not durable across restart**.
- **Evidence Trace** (S126 `evidenceTrace.ts:151,166`) joins on `correlationId` EXACT-match; **delivery posture**
  (S127) joins on `txId` EXACT-match. The trace composer receives ONLY command-journal + delivered-event
  streams (`operationalRead.ts:174-186`) — **inbound lineage is never fed to it**.

## 2 · Current identifier semantics (not collapsed)
`eventId`/`id` = event-instance identity · `txId` (`tx_<uuid>`) = business-transaction identity (S127 join) ·
`correlationId` = related-event/chain identity, the originating assistant episode `asst_<uuid>` on the command
spine (S126 join) · `causationId` = direct parent pointer · `idempotencyKey` = tenant-scoped duplicate-command
suppression. Inbound webhook events participate in NONE of these except their own bus `eventId`.

## 3 · Policy decision
Per `DECISION-MEMO-S138`: **DO NOT IMPLEMENT.** Four independent STOP conditions met — (1) undefined business
semantics (no modeled inbound→transaction relationship), (2) unclear retry/dedup (redelivery indistinguishable;
no external delivery id; no dedup policy), (3) unclear cardinality (one Graph delivery → many syncs), (4) no
consumer + would require a frozen `PlatformEvent` change, so implementing now would create an inert,
unfalsifiable field. Implementing would require inventing correlation policy — forbidden by this gate.

## 4 · Implementation / no-implementation decision
**NO IMPLEMENTATION.** Zero source files changed. Only two documents were produced (this cert + the decision
memo).

## 5 · Exact architecture path (recorded for a future, policy-approved session)
`verified inbound webhook → authoritative tenant resolution → authenticated/verified event → (FUTURE, if a
business relationship is defined) platform-minted correlationId [+ separated externalCorrelationId only if an
external id is explicitly trusted] → existing PlatformEvent → existing EventBus → existing lineage → (missing
wiring) feed lineage into the existing EvidenceTrace composer`. The missing wiring — a consumer that joins
inbound lineage into the trace — is the real gap, ahead of any id.

## 6 · Files changed
- **new** `certification/DECISION-MEMO-S138-INBOUND-CORRELATION.md`
- **new** `certification/SESSION138-INBOUND-CORRELATION-DECISION-READINESS-CERTIFICATION.md`
No `.ts`/`.tsx` files changed. No test files added (implementation not justified).

## 7 · Frozen files & FG requirement
**No frozen surface touched. No FG token requested or guessed.** Any future implementation that adds a
first-class inbound correlation field to `PlatformEvent` (frozen `packages/shared`) WOULD require an FG request;
this session raised none because it implemented nothing.

## 8 · Security proof (of the current path, unchanged)
Tenant is resolved from the authenticated workspace context, never from webhook payload (`router.ts:471`,
`lineage.ts:62` drops foreign-tenant rows). The renderer cannot supply correlation to select a tenant (no such
path exists). Hostile webhook metadata cannot forge authority — verification is fail-closed (no secret ⇒
reject, `router.ts:88-89`; HMAC/replay checks `verify.ts`). Credentials and raw payload are excluded from the
emitted event and from lineage (`router.ts:47,169-171`, `lineage.ts:39,77`). No correlation id was introduced,
so none can be forged; cross-tenant correlation remains impossible by construction.

## 9 · Tenant proof
Unchanged and authoritative — tenant comes from `deps.workspaceId()`; the correlation concept, if ever added,
is explicitly barred by the memo from being a tenant selector.

## 10 · Retry / duplicate semantics
Documented as currently undefined/absent for inbound: no external delivery id captured, no dedup, redelivery
indistinguishable; only Slack's 5-minute replay window exists. This ambiguity is a STOP reason, not something
this session resolved.

## 11 · Evidence Trace impact
**None.** No correlation id added; inbound events remain standalone (`inboundCorrelatable:false`), exactly as
S126/S135 already assert. The trace composer is unchanged and still does not ingest inbound lineage.

## 12 · AI impact
**None.** No AI authority added or changed. Had correlation been added it could only have improved
trace/grounding provenance; it may never authorize, approve, select a tenant, trigger execution, or bypass
CST/RBAC/approval. No such change was made.

## 13 · Focused tests / full regression
**Not required — no code changed.** Per the gate ("If implementation is justified, test…"), implementation was
not justified. Existing S104 security and S114–S137 suites are unaffected (docs-only change). No `requestSync`
behavior touched.

## 14 · Electron status
OPERATOR-PENDING (Linux sandbox) — not applicable this session (no runtime change).

## 15 · Package matrix
Unchanged. 13 live `@neuropause/*` in desktop main. **Not activated:** `@neuropause/connectors`,
`@neuropause/integrations`, `@neuropause/integration-platform`, `@neuropause/connectivity`. No package
imported, retired, or added. The existing canonical desktop connector infrastructure is the only one referenced.

## 16 · Remaining blockers
- **POLICY-BLOCKED (new, S138):** inbound correlation — undefined business relationship, retry/dedup identity,
  cardinality, and durable retention; plus the missing trace-consumer wiring. Do not implement without an
  operator/product policy (see memo §4).
- POLICY-BLOCKED (unchanged): persistence-migration, security-authority (ABAC enforcement), SLO verdict.
- OPERATOR-PENDING (Linux): live-Electron click-through; macOS keychain (S113/S115).
- S132 supply-chain debt (truthfully tracked, NOT touched): qs remediation (DECISION-MEMO-S132), softprops
  SHA-pin, signed provenance, dev-toolchain advisories, vuln-gate policy.

## 17 · Recommended S139
1. **Operator/product policy decision** on the inbound-correlation questions in `DECISION-MEMO-S138` §4 — the
   prerequisite before any implementation. If approved, the first implementable slice is the **trace-consumer
   wiring** (feed inbound lineage into the EvidenceTrace composer), which is the actual missing link, ahead of
   minting any id.
2. Alternatively, a fresh whole-repo capability census to select the next high-value SAFE non-duplicative
   capability (S133-style), since inbound correlation is policy-blocked.
3. Execute DECISION-MEMO-S132 Option A (qs remediation) in a network/multi-platform environment.

**STOP taken correctly: undefined business semantics → decision memo + STOP. No correlation policy invented.
No frozen surface touched. No FG token. No duplicate infrastructure. No AI authority. No secrets/raw payload
exposed. macOS/keychain NOT claimed.**
