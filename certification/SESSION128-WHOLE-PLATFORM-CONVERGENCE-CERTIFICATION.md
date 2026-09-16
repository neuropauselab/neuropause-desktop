# SESSION 128 — WHOLE-PLATFORM CONVERGENCE CERTIFICATION
## Governed AI evidence-grounding read (substrate) + FG request for live-assistant wiring
### Date: 2026-09-05 · Branch: cert/data-import-cst-integration · Non-frozen session (no FG token consumed)

---

## 1 · BASELINE / FINAL COMMIT
- Baseline HEAD: **fe42158** (S127).
- Final HEAD: **this commit** (S128).
- Frozen surfaces: **UNTOUCHED** (gate-detector PROCEED ×6; no FG token consumed).

## 2 · DISCOVERY REPORT (whole-repository maturity)
- **Mature/live:** platform command spine (bus/authz/policy/approval/CST/durable journal/outbox/audit);
  ERP/P2P/O2C/Mfg/Maintenance/Projects control planes; operational-intelligence stack (health, delivery
  ops, reliability+trend, connector lineage+trend, overview, evidence search→trace→delivery posture);
  the assistant Context Builder (grounds on capabilities/timeline/memory, never reasons without context).
- **Gap chosen:** operational evidence (S125–S127) was **not** an AI grounding source. Priority-1.
- **Selected (this session):** AI read-only grounding over the governed evidence path — a pure
  `projectEvidenceForAI → AiContextItem[]` + governed `QueryEvidenceContext` read.
- **FG determination:** the read + projector are fully NON-frozen (reuse the frozen `AiContextItem` type +
  an existing `AiContextSource` value by *producing*, never modifying). **Live wiring into the assistant**
  needs the journal passed into `initAssistant` at **frozen `runtimeCore.ts:2731`** → FG required for that
  hop only → substrate delivered now, FG requested + STOPPED (below).
- **Must NOT import:** second AI runtime (`packages/ai-runtime`), second command/event bus, persistence,
  connector, authz, or memory store; no modification of `AiContextItem`/`AiContextSource`.

## 3 · CAPABILITY IMPLEMENTED (non-frozen, live)
Governed **AI evidence grounding**: `QueryEvidenceContext` composes the SAME governed evidence (S125
search hits + optional S126/S127 correlation trace with delivery posture) into `AiContextItem[]` grounding
context — the exact shape the assistant Context Builder consumes — so the Brain can be grounded on real
operational evidence with explicit per-item provenance.

## 4 · CANONICAL INFRASTRUCTURE REUSED
- The ONE `platform:command.dispatch` governed READ branch; new sibling `QueryEvidenceContext` →
  `buildEvidenceContext`.
- S125 `searchOperationalEvidence`, S126 `composeEvidenceTrace`, S127 `deriveState` delivery map,
  S119 `readInboundLineage`, the ONE `DurableCommandJournal` + EventBus ring.
- The frozen `AiContextItem` type + existing `AiContextSource` value `'timeline'` (coarse channel) with
  exact provenance per item in `evidence:[{kind,id}]` — mirrors `projectCapabilitiesForAI`. No new
  runtime/store/engine/channel.

## 5 · GROUNDING / PROVENANCE SEMANTICS
- **Evidence ≠ interpretation:** each item's `text` is a sanitized FACT ("Operational evidence — …" /
  "Correlated evidence — …"); the AI's conclusions are not part of grounding.
- **Explicit provenance:** every item carries `evidence:[{kind,id}]` (kind = canonical source
  `command-journal`/`delivered-events`/`connector-inbound`; id = record id). Coarse `source:'timeline'`,
  exact provenance per item.
- **Trace leads, hits follow, deduped by provenance (kind:id), bounded.** Empty ⇒ empty (honest).
- **No AI execution:** pure projection; the read produces grounding candidates only.

## 6 · SECURITY / TENANT PROOF
- Read-only; server-resolved tenant; renderer `claimedTenantId` mismatch → `TENANT_SCOPE_VIOLATION`
  (tenant B gets no grounding from tenant A); `UNAUTHENTICATED`/`UNAUTHORIZED` fail-closed; bounded
  (`MAX_GROUNDING_ITEMS`=50, default 20); credential-free (no payloads/secrets/error text); no DB/ERP
  store access, no command execution, no approval bypass, no autonomous action.

## 7 · FILES CHANGED (all non-frozen)
- **new** `operationsPlatform/evidenceContext.ts` (+`evidenceContext.test.ts`).
- `platform/command/operationalRead.ts` — `QueryEvidenceContext` + `buildEvidenceContext`.
- `ipc/handlers/platformCommandIpc.ts` — route.
- `renderer/src/lib/ipc.ts` — `ipc.platform.evidenceContext` accessor.
- **new** `ipc/handlers/session128EvidenceContextRead.test.ts`.
- **new** `certification/FG-REQUEST-S128-ASSISTANT-EVIDENCE-CONTEXT.md` + this cert.

## 8 · FOCUSED TESTS
- `evidenceContext.test.ts` — **6** pure (provenance, trace-leads+dedup, bounding, empty, credential-free,
  limit clamp).
- `session128EvidenceContextRead.test.ts` — **9** governed-read (real evidence→grounding, correlation
  leg, tenant isolation, claimed-tenant rejected, unauthenticated, unauthorized, bounded, credential-free,
  honest empty; no AI execution — pure read).

## 9 · FULL REGRESSION (nothing hidden)
| Check | Result |
|---|---|
| gate-detector (6 changed/new files) | **PROCEED ×6** |
| typecheck node / web | **0 / 0** |
| eslint (changed files) | **0** |
| Full main suite (8 shards) | **10,761 passed / 7 skipped** (skips pre-existing) |
| Full UI suite | **486 passed** |

All prior surfaces (evidence search/trace, overview, reliability, connector, audit) + ERP/HR/Finance/
Operations/Security suites unchanged and green.

## 10 · ELECTRON / MAC RESULT — OPERATOR-PENDING (not simulated)
Linux aarch64 sandbox, no runnable macOS Electron. Proven at governed-read + provider layers; real
click-through and S113/S115 keychain proof remain OPERATOR-PENDING. Nothing fabricated.

## 11 · AI INTEGRATION STATUS
The grounding substrate is LIVE as a governed read; the live-assistant Context Builder wiring is the
remaining hop and is **FG-gated** (`FG-REQUEST-S128-ASSISTANT-EVIDENCE-CONTEXT.md`) because it touches
frozen `runtimeCore.ts:2731`. STOPPED there — no token guessed. AI has no execution authority from this
capability.

## 12 · PACKAGE CONVERGENCE MATRIX (delta, S128)
| Capability / package | Status | Notes |
|---|---|---|
| AI evidence grounding read (`QueryEvidenceContext`) | **LIVE (this session)** | governed substrate for Brain grounding; assistant wiring FG-gated. |
| Evidence search/trace + delivery posture | LIVE (S125–S127) | grounding sources. |
| Assistant Context Builder | LIVE | consumes `AiContextItem[]`; evidence source pending FG. |
| `packages/ai-runtime` | FRAMEWORK-ONLY / POLICY-BLOCKED | no second runtime; only pure utils harvested (S117). |
| `packages/persistence` upcaster/migration | SAFE HARVEST CANDIDATE — POLICY-BLOCKED | DECISION-MEMO-S124. |
| `packages/security` delegation/JIT/impersonation | POLICY-BLOCKED | authority policy undefined. |
| ~39/46 packages | DUPLICATIVE / RETIREMENT CANDIDATE / unwired | none deleted/archived/retired. |

## 13 · POLICY BLOCKERS
None newly hit. No AI-authority/severity/SLO/migration/correlation policy invented.

## 14 · FROZEN BOUNDARIES / FG REQUESTS
**One FG requested (STOP):** `runtimeCore.ts:2731 initAssistant` additive `evidenceContext` dep — see the
FG-request doc. The S128 substrate itself touched no frozen surface.

## 15 · REMAINING OPERATIONAL BLOCKERS
- Assistant evidence-grounding wiring — awaiting FG token.
- Mac keychain + real-Electron click-throughs — OPERATOR-PENDING.
- Distribution E0 + supply-chain gaps (SBOM/SLSA provenance/vuln scan) — see SLSA audit.
- Persistence-migration + security-authority policies — POLICY-BLOCKED (prior memos).

## 16 · NEXT STRONGEST CONVERGENCE TARGET
Apply **FG-S128-ASSISTANT-EVIDENCE-CONTEXT** (operator token) to make the Brain ground on operational
evidence live; alternatively begin the **CI supply-chain hardening** (SBOM + SLSA provenance + vuln scan
+ packaged-strip assertion) from the SLSA audit — CI-only, no product source, raises release posture
toward Build L2.

## 17 · COMMIT SCOPE
Committed (all non-frozen): `evidenceContext.ts` (+test), `operationalRead.ts`, `platformCommandIpc.ts`,
`ipc.ts`, `session128EvidenceContextRead.test.ts`, `FG-REQUEST-S128-…md`, and this cert.

**Deliberately EXCLUDED** (not this session's work): custody-protected `certification/baseline.json`, the
stray `.claude/` directory, unrelated `NP-FG-001`/`NP-IPC-ENV-001` docs, and the earlier
`SLSA-STYLE-SUPPLY-CHAIN-AUDIT-2026-09-05.md`.

**No FG token consumed. No frozen surface touched. No release/notarization. No package deleted. No policy
invented. No second AI runtime. AI gained no execution authority.**
