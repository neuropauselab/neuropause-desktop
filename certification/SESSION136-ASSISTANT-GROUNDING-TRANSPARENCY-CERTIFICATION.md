# SESSION 136 — ASSISTANT GROUNDING TRANSPARENCY CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · Renderer-only, NON-FROZEN, no FG token

## S136 STATUS: **GREEN**

---

## 1 · Exact existing assistant surface reused
`renderer/src/assistant/AssistantView.tsx` → `AssistantReply` (the per-answer card). The transparency
control is added to the existing explainability strip beside the existing **Inspect** / **Branch** actions
(lines ~392–401), keyed off the envelope's existing `env.correlationId`. No new answer surface; no change to
the assistant answer/trace/inspector rendering.

## 2 · Exact grounding data source
The EXISTING governed read `ipc.platform.evidenceContext` → `platform:command.dispatch` `QueryEvidenceContext`
(S128 projection + S130 relevance + S133 posture + S135 connector intelligence). Server-resolved tenant, RBAC
`operations:read`, bounded, credential-free. The renderer displays ONLY the fields the read already returns
(`itemCount`, `postureIncluded`, `connectorIntelIncluded`, `relevanceRanked`, `context[].evidence[].kind`) —
it does NOT recompute grounding. No `AssistantEnvelope` (frozen shared type) change.

## 3 · Files changed (all non-frozen, renderer + renderer-lib)
- **new** `renderer/src/assistant/AssistantGroundingBadge.tsx` — lazy (fetch-on-expand) read-only badge.
- `renderer/src/assistant/AssistantView.tsx` — import + one `<AssistantGroundingBadge correlationId={env.correlationId} />` in the explainability strip.
- `renderer/src/lib/ipc.ts` — `evidenceContext` accessor param type +`includeConnectorIntel?` (renderer-local widening; the main handler already supports it — generic passthrough, no frozen contract).
- **new** `ui-tests/assistantGroundingBadge.test.tsx`.

## 4 · Frozen files
**None.** gate-detector = PROCEED ×4 on every changed file. `AssistantEnvelope` / `AssistantAskResult` (the frozen shared assistant contract) are UNTOUCHED — the smaller renderer-only seam was chosen deliberately over adding grounding fields to the envelope.

## 5 · FG token
**None required.**

## 6 · Security proof
Presentation-only: the badge issues a READ to the existing governed channel and renders the response; it performs no write/execute/approve/send/mutate/dispatch. Fail-closed proven — a governed-read error renders "Grounding transparency is unavailable" (the UNAUTHENTICATED/UNAUTHORIZED fail-closed behavior of `QueryEvidenceContext` is unchanged and proven in the S128/S133/S135 governed-read suites). No secret/token/authorization/payload reaches the UI (asserted in the test; the read is credential-free by construction). Lazy fetch (no read until the operator expands) avoids N reads per thread render.

## 7 · Tenant proof
The renderer passes NO tenant selector — tenant is resolved SERVER-SIDE by the `evidenceContextProvider` from `activeTenantScope` (S129), never a renderer claim. `correlationId` scopes to the turn but is not a tenant selector. Cross-tenant isolation is enforced by the reused governed read (proven S128/S133/S135); this session adds no new tenant surface.

## 8 · AI-authority proof
**No AI authority added.** No execute/approve/send/mutate/dispatch/tool-invocation. The Brain remains advisory; this is a read-only transparency view of grounding that already existed. No correctness/confidence/SLO/health verdict is invented — the badge shows availability + counts + provenance kinds + the honest disclaimer only.

## 9 · Focused tests (ui-tests/assistantGroundingBadge, 5)
lazy (no fetch until expanded) then renders count/posture/connector-intel/provenance + asserts payload `operation:QueryEvidenceContext`, `includePosture`, `includeConnectorIntel`, `correlationId` · honest empty state · relevance-ranked state · backward-compatible when optional fields absent (count-only, no crash) · governed-read failure → "unavailable" + no secret leaked.

## 10 · Full regression
| Check | Result |
|---|---|
| gate-detector (4 files) | **PROCEED ×4** — zero frozen |
| typecheck node / web | **0 / 0** |
| eslint (`eslint apps/desktop --max-warnings 0`) | **0** |
| Full main (8 shards) | **10,832 passed / 7 skipped** — identical to S135 (renderer-only, decision-neutral) |
| Full UI | **497 passed** (89 files) — S135 492/88 → **+5** (new badge test) |
| S104 security regression + S128–S135 grounding/evidence suites | included in full main + UI (green) |

## 11 · Electron status
OPERATOR-PENDING (Linux sandbox). Proven at the real UI→bridge layer via the driven-component test. No macOS/keychain/real-Electron click-through claimed.

## 12 · Package matrix delta
None. 13 live `@neuropause/*` in desktop main (unchanged); no package imported/retired; no AI-runtime package activated; no duplicate infrastructure (reuses the S128/S133/S135 read + existing OpsPanel primitive `StatusBadge`).

## 13 · Remaining blockers
- OPERATOR-PENDING (Linux): live-Electron assistant click-through; macOS keychain (S113/S115).
- POLICY-BLOCKED (unchanged): persistence-migration, security-authority (ABAC enforcement), SLO verdict.
- S132 supply-chain debt (truthfully recorded, NOT touched here): qs remediation (DECISION-MEMO-S132), softprops SHA-pin, signed provenance, dev-toolchain advisories, vuln-gate policy.

## 14 · Recommended S137
1. **Turn-faithful grounding** — thread the user's question text as `relevanceQuery` into the badge so it mirrors exactly what the Brain received (renderer-only; needs the preceding user message passed to `AssistantReply`).
2. **DECISION MEMO: correlation-at-ingest for inbound webhooks** (from S135) — would make inbound lineage `correlatable`; policy-open, do not invent.
3. Execute DECISION-MEMO-S132 Option A (qs remediation) in a network/multi-platform env.

**No FG token. No second evidence/provenance/AI/telemetry architecture. No AI correctness/confidence/SLO/health verdict. No secrets or raw connector/webhook data exposed. No AI authority added. Zero frozen surfaces touched. macOS/keychain NOT claimed.**
