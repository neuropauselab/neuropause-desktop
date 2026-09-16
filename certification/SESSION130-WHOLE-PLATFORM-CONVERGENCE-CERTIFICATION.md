# SESSION 130 — WHOLE-PLATFORM CONVERGENCE CERTIFICATION
## Relevance-ranked AI evidence grounding (query-aware, non-excluding)
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · NON-FROZEN (zero frozen change, no FG token)

---

## 1 · BASELINE / SCOPE
- Baseline HEAD: **3e1a802** (S129 — live AI evidence grounding wired, FG-S128 closed).
- This session: **NON-FROZEN only**. `gate-detector.sh` reports **PROCEED** for every changed file — **zero frozen surfaces touched, no FG token consumed, none guessed**.
- No packaging / notarization / signing / updater / installer / distribution work (deferred per directive).

## 2 · DISCOVERY FINDINGS (fresh repository-wide census)
Census over the 44 `packages/*`, 4 `apps/*`, and the live main process. Key facts (source-measured):
- **Live `@neuropause/*` imports** into `apps/desktop/src/main`: `shared`, `cst`, `sdk`, `companion-protocol`, `cli`, `security`, `desktop`, `workspace`, `solution-packs`, `ckdl`, `integrations`, `industry`, `cloud-core`.
- **FRAMEWORK-ONLY (zero live imports):** `ai-runtime`, `intelligence`, `automation`, `reliability`, `operations` — and ~30 other packages. Sophisticated but unwired; NOT imported wholesale (only pure logic is ever harvested, e.g. S117 → `ai/proposalValidation.ts`).
- **AI grounding pipeline (live):** `assistant/index.ts buildContext` composes three legs — federated Context Builder (`search/enterpriseSearch.ts` over entity/graph/memory) + `projectCapabilitiesForAI` + (S129) `deps.evidenceContext()` governed operational evidence.
- **The S130 gap, measured:** S129 wired the grounding leg but called `deps.evidenceContext()` with **NO query** — so grounding always ran in browse/recency mode, ignoring the user's actual question. The plumbing already supported a query end-to-end (`buildEvidenceContext` honors `query`; the frozen `runtimeCore` dep forwards `opts` generically).
- **The landmine:** `searchOperationalEvidence` uses **AND-token** semantics — a multi-word natural-language question would drop *every* row, making naive query-passing return empty grounding (worse than browse).

Candidates weighed: (1) search ranking — already ranked in S125 (low marginal value); (2) S117 validator into the assistant — the assistant's `toolCalls` are internal retrieval traces, not external tool arguments (already wired in the brain propose lane; N/A); (3) **relevance-ranked grounding — the genuine, high-value, SAFE gap. SELECTED.**

## 3 · CAPABILITY SELECTED — why it is the highest-value SAFE next step
**Relevance-ranked (non-excluding) AI evidence grounding.** It makes the live Brain ground on the evidence *relevant to the user's question* instead of a generic recent-activity dump — directly maturing the GOVERNED AI + KNOWLEDGE pillar the whole S125→S129 arc built toward. It is the smallest valuable slice that:
- avoids the AND-semantics landmine (**non-excluding**: ranks, never filters — grounding never empties when evidence exists; degrades to recency on zero overlap);
- is **backward-compatible** (no query / no overlap ⇒ byte-identical to prior recency order);
- needs **no frozen change** (runtimeCore already forwards `opts`);
- invents **no policy**, adds **no duplicate infra**, and keeps every S128/S129 AI boundary intact.

## 4 · EXACT FILES / PACKAGES INVOLVED (all non-frozen)
- `operationsPlatform/evidenceContext.ts` — `EvidenceGroundingInput.query?`; pure `relevanceScore()` (lexical OVERLAP count, non-excluding); `projectEvidenceForAI` stable-ranks deduped items by overlap BEFORE the bound (ties + zero-overlap keep recency order).
- `platform/command/operationalRead.ts` — `buildEvidenceContext` gains optional `relevanceQuery`; when present and no explicit AND-`query`, it browses a bounded candidate POOL (`MAX_EVIDENCE_RESULTS`) and ranks it down to the grounding bound; adds honest `relevanceRanked` flag. The existing `QueryEvidenceContext` read (never sets `relevanceQuery`) keeps EXACT prior semantics.
- `platform/evidenceContextProvider.ts` — bridge opts type extended with `relevanceQuery?`.
- `assistant/index.ts` — dep type + `buildContext` now grounds with `{ relevanceQuery: req.query }` (the user's turn).
- Tests: `operationsPlatform/evidenceContext.test.ts` (+7 pure), `ipc/handlers/session130RelevanceGroundingRead.test.ts` (+8 governed), `assistant/session129EvidenceGroundingWiring.test.ts` (+1 forward).

## 5 · DUPLICATE INFRASTRUCTURE EXPLICITLY AVOIDED
No second search engine / ranker service / vector DB / memory store / AI runtime / command bus / event bus / outbox / audit store / connector runtime / authorization engine. The ranker is a pure fold over evidence the governed reads already return; grounding rides the SAME `buildEvidenceContext` on the SAME `platform:command.dispatch` read branch. `AiContextItem` / `AiContextSource` untouched (no frozen contract change).

## 6 · AI GOVERNANCE (all boundaries preserved)
Read-only; tenant **server-resolved** (the `relevanceQuery` is a relevance signal, **not** a tenant selector — proven); credential-free; bounded; provenance-preserving (`evidence:[{kind,id}]`); evidence ≠ interpretation (overlap count is the same lexical class as S125's `score`, never a business judgement); no store/ERP/db access; no command execution; no approval bypass; no autonomous action.

## 7 · TESTS & REGRESSION (nothing hidden)
| Check | Result |
|---|---|
| gate-detector (7 changed files) | **PROCEED ×7** — zero FROZEN, no FG needed |
| typecheck node / web | **0 / 0** |
| eslint (changed files) | **0** |
| Focused (S130 pure + governed + S128 + S129 wiring) | **37 passed** |
| Sibling suites (operationsPlatform + S125/S126) | **175 passed** |
| Full main suite (8 shards) | **10,783 passed / 7 skipped** (1032 files) |
| Full UI suite | **486 passed** (87 files) |

**Decision-neutrality:** main went 10,767 → **10,783** (+16 = 8 governed + 7 pure + 1 wiring); **zero existing tests changed**. UI unchanged (no renderer change). Adversarial coverage: hostile/injection-shaped question cannot throw, cannot exclude, cannot leak credentials; non-matching question never empties grounding; `relevanceQuery` proven NOT a tenant selector (tenant B gets nothing when the query matches tenant A); claimed-tenant mismatch still `TENANT_SCOPE_VIOLATION`; unauth/unauthorized still fail closed.

## 8 · REMAINING BLOCKERS
- **OPERATOR-PENDING (Linux sandbox):** real-Electron live click-through (assistant answering with relevance-ranked grounding) + S113/S115 macOS keychain proof. Proven here at the pure + governed-read + wiring layers; nothing fabricated.
- **POLICY-BLOCKED (unchanged):** persistence-migration semantics, security-authority (ABAC enforcement) — prior decision memos stand.

## 9 · UPDATED WHOLE-REPOSITORY MATURITY (delta)
- **Governed AI grounding:** S128 substrate → S129 live wiring → **S130 query-relevant** = the Brain now grounds on the evidence relevant to the question, tenant-safe and non-excluding. Pillar advanced from "grounded on recent activity" to "grounded on relevant activity."
- Operational-read surface (S32→S130): history · delivery-ops · inbound-lineage(+trend) · reliability(+trend) · overview · evidence-search · evidence-trace(+delivery) · evidence-context(+relevance). One governed branch, no new channel/bus/store.
- Framework-only packages unchanged (not imported); no package deleted/archived/retired.

## 10 · RECOMMENDED S131 TARGET
Self-selected candidates (highest-value SAFE, non-duplicative):
1. **CI supply-chain hardening** from the SLSA audit — SBOM generation + provenance attestation + dependency vuln scan + a packaged-content strip assertion in CI. No product-runtime change, no policy, high trust-maturity value.
2. **Evidence-grounding relevance surfacing** — expose the S130 `relevanceRanked` posture on the operator Evidence panel (renderer-only, read-only) so operators see which grounding was question-relevant.
3. **AI tool-definition validation coverage** — extend the S117 `validateToolArguments` corpus/consumers where a real governed tool schema exists.
Persistence-migration + security-authority remain POLICY-BLOCKED. None require packaging.

**No FG token consumed or guessed. No policy invented. No duplicate infrastructure. No second AI runtime. AI gained no execution authority. Zero frozen surfaces touched.**
