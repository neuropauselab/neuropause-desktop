# ARCHITECTURE-MAPPING — Concentric spec ⇄ the proven implementation (NP-012 §2)
### 2026-08-20 · COMPLETE: the canonical spec is committed verbatim; every SOURCE_REQUIRED row is transcribed FROM it and classified. Nothing is claimed implemented because it is specified.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Source status (RESOLVED, 20 Aug 2026):** the canonical text is committed VERBATIM as
`certification/ARCHITECTURE-SPEC.md` (attribution: operator-supplied, 2026-08-20; the closing "One important
correction" section included, per the operator's instruction). Fidelity is proven, not asserted: the file body was
extracted byte-for-byte from the operator's message in the session transcript — body sha256
`c10fd5f829e233ed7b96565b49f4ae42bfd8f120f2cb36d72b0c2286ae3dd1af` (35,692 chars). Honest correction on the way
there: the first write attempt was a from-memory reconstruction; it was caught before commit and REPLACED by the
transcript-extracted original — a reconstruction can never stand in for a verbatim source. Every Part B row below
now cites its spec section (§N = ARCHITECTURE-SPEC.md numbered section). Whatever the text itself still leaves
undefined stays SOURCE_REQUIRED honestly (Part C).

## §0 · THE PRIMARY RULING — the Concentric model is a DEPENDENCY RULE, not a diagram

Adopted as NeuroPause OS's structural organization (operator, 20 Aug 2026): **outer components may consume inner
contracts; inner components never depend on outer application-specific components.** New connectors arrive as
adapters + registered capabilities against the EXISTING governance/execution/verification contracts — "new
connector → new adapter → existing governance", never "new connector → modify constitution". Authority is an
INNER property: connectivity ≠ authority · registration ≠ authorization · capability ≠ permission · proposal ≠
execution · execution ≠ external effect · external effect ≠ verified outcome · observation ≠ cause · inference ≠
evidence · learning ≠ authority · PAYMENT ≠ AUTHORITY (§2 #16). The Live Brain and every AI provider (Claude
included) remain structurally OUTSIDE the authority boundary, adapter-replaceable; the masterConnector is a
RESOLUTION mechanism, never an authority mechanism (spec §27 says exactly this — "It should not independently
authorize execution"). Four states never blur: **STRUCTURAL ARCHITECTURE ≠ SPECIFICATION CONTENT ≠
IMPLEMENTATION ≠ CERTIFICATION** — nothing is certified by being documented.
*Existing evidence already consistent with the rule:* zero Brain→governance runtime imports (6 pins); the only
inner→outer-adjacent crossing is the authorized FG-10 direction (execution consults the gate); M365 specifics
live in `connectors/m365/`, not the kernel; the §50 second-connector test exists precisely to falsify this rule.
Spec §67 names the same property as "progressive restriction of authority"; spec §69's closing principle
("capability may increase without increasing execution authority") is the §0 rule stated as an invariant.

## §1 · THE FIFTEEN-LINE TABLE ⇄ CLAUDE.md §2 (complete — spec §0 lists all fifteen + PAYMENT ≠ AUTHORITY verbatim)

| # | Non-equivalence | Verdict | Cross-reference / pin |
|---|---|---|---|
| 1 | INTELLIGENCE ≠ AUTHORITY | ALREADY LAW | §2 #6 + #13; zero-runtime-import pins ×6 (liveBrain suite) |
| 2 | CONFIDENCE ≠ PERMISSION | ALREADY LAW | AUTONOMY.md authority wall; §2 #9 |
| 3 | CONNECTIVITY ≠ AUTHORITY | LAW IN BEHAVIOR (spec §24 verbatim: connector id ≠ authorized/connected/consented/paid/certified) | §2 #7/#8; S5.1 structural-ASK pin; the renderer's missing SAY-so is F-MR-5, open |
| 4 | REGISTRATION ≠ AUTHORIZATION | LAW IN BEHAVIOR | §2 #8 deny-by-default; capability discovery projects descriptions only — no callable/token crosses (`liveCapabilitySources.ts`) |
| 5 | CERTIFICATION ≠ UNIVERSAL PERMISSION | ALREADY LAW (spec §56 verbatim: "It does not mean: The entire system is universally safe") | §2 #11; the calendar dry-run pin ("connector certified ≠ action certified"); ladder standing rules (§49) |
| 6 | EXECUTION ≠ SUCCESS | ALREADY LAW (verbatim) | §2 #14; spec §38 "The executor's acknowledgement is not equivalent to the external outcome" |
| 7 | UNKNOWN ≠ SUCCESS | ALREADY LAW (verbatim) | §2 #9; spec §42 |
| 8 | MEMORY ≠ AUTHORITY | ALREADY LAW (verbatim) | §2 #15; spec §46 |
| 9 | LEARNING ≠ AUTHORITY | ALREADY LAW | §2 #15's scope; spec §47 "learning → proposal, not learning → permission" |
| 10 | INTENT ≠ PURPOSE | RECORDED (modeling) | master directive §11; spec §17–20 now defines the four-stage chain (Part B row 7) |
| 11 | PURPOSE ≠ CAPABILITY | RECORDED (modeling) | L4/L5 constraints; `capabilityGraph` routes purposes→capabilities without granting (pinned) |
| 12 | CAPABILITY ≠ AUTHORITY | ALREADY LAW | L4 constraint verbatim + §2 #8; capabilityGraph pins |
| 13 | PROPOSAL ≠ EXECUTION | ALREADY LAW | §2 #7 + #13; ASK-only structural (proposalExecutionBoundary); spec §5's `authority:"true"` example is our S4.2 attack class, already pinned |
| 14 | EXECUTION ≠ EXTERNAL EFFECT | ALREADY LAW | §2 #14 ("a 2xx/ack/executor return is submission") |
| 15 | EXTERNAL EFFECT ≠ VERIFIED OUTCOME | ALREADY LAW (verbatim) | §2 #14, D-16 terminals |
| 16 | **PAYMENT ≠ AUTHORITY** | **CANONIZED → §2 #16** (spec §60 verbatim: "A larger payment plan may increase resource limits. It cannot bypass authorization.") | Recorded BEFORE any Razorpay capability work exists |

## §2 · THE TWO BINDING VOCABULARY RULINGS (recorded; spec text confirms both are safe)

**Ruling 1 — verification vs state assessment, never merged.** D-16 terminals remain the ONLY verification
vocabulary: `VERIFIED_SUCCESS / VERIFIED_FAILURE / UNKNOWN → HOLD → reconciliation → UNRESOLVED`, plus the
first-class non-execution outcomes `DENIED / CANCELLED / EXPIRED`. The spec ITSELF keeps the two vocabularies
apart: §13's five-value set (VERIFIED/CONFLICT/UNOBSERVED/STALE/UNKNOWN) is computed from DECLARED_STATE vs
OBSERVED_STATE — a state assessment; §39–42's verification terminals are VERIFIED_SUCCESS / VERIFIED_FAILURE /
UNKNOWN — exactly D-16. No second verification state machine exists in the source either. State-assessment map:

| Spec §13 (state assessment) | Ours today | Note |
|---|---|---|
| VERIFIED | `VERIFIED` | corroborated only — same discipline |
| CONFLICT | `CONFLICTING` | naming DIVERGENT, semantics same; spec: "Do not overwrite the declaration merely to eliminate the conflict" — our F-MR-2 lesson, verbatim |
| UNKNOWN | `UNKNOWN` | identical |
| UNOBSERVED | ≈ `UNAVAILABLE` | ours means "source unreadable"; spec's "never probed" nuance PARTIAL |
| STALE | **absent** | candidate field, ranked (§3 #6); staleness window semantics undefined by the spec (Part C) |

**Ruling 2 — ID schemes.** `NP-CON-/NP-CAP-/NP-CONNECTION-` (spec §24–26 examples) apply to NEW connectors and
capabilities from the ladder onward; existing identifiers (`microsoft-entra`, `mail.send`, `acct_*`) stay and are
ALIASED in the registry when it lands (M-008+). No mass rename, ever. Spec §64's registry fields fold into the
same landing.

## PART A · Elements auditable before the spec arrived (re-checked; two rows upgraded with the real text)

| Element | Verdict | Evidence |
|---|---|---|
| Tenant isolation default (cross-tenant → DENY) (spec §3) | **CONFIRMED (2 of 4 ids)** | unbound scope DENIES (`tenantOwnedStore.ts`); `crossTenant.test.ts` (1,119 lines); `storeScopeGate.test.ts`; boot-time `assertEveryModuleScoped()`. Spec wants resolution to tenant_id+workspace_id+system_id+installation_id: ours stamps tenant+workspace; system/installation ids exist only as uncoordinated fragments (ecosystem/catalogClient/supervisor/packageService) — the DENY default is CONFIRMED, the four-id tuple is PARTIAL |
| Authentication ≠ authorization (spec §4) | **CONFIRMED** | auth status (auth.ts) vs RBAC (`authzGate`, `runtimeAuthz` 1,108 lines); local principal = authenticated-nothing yet locally authorized; org channels still refuse |
| Credential boundary (spec §6: Connection → CredentialReference → SecureCredentialStore) | **CONFIRMED, naming DIVERGENT + one gap** | ours: store/vault split, ciphertext-only, refuse-plaintext, zero token IPC exposure (master-recon §C); spec's never-store list (tokens/passwords/keys in connector/capability/proposal/system/experience ids) holds by construction; GAP: desktop log redaction convention-only (F-MR-7) |
| Connector → capability → connection separation (spec §7, §24–26) | **CONFIRMED (M365 vertical)** | manifests / action ids / `ConnectedAccount` — three real object kinds (CONNECTOR-REALITY.md); capability ids coarse outside M365 (PARTIAL breadth) |
| Declared-vs-observed assessments (spec §13) | **PARTIAL** | declared manifests vs observed connection/health exists per-connector; ONE systematic drift instance already caught (F-MR-2); no unified assessment vocabulary in code; STALE absent |
| Initiative → intention → purpose → need (spec §17–20) | **PARTIAL (upgraded from RECORDED-ONLY)** | the spec defines all four stages; ours: `purpose` is real on every proposal + `purposeBridge.ts` (purpose→capability candidates); initiative/intention/need do not exist as objects — 1 of 4 stages modeled |
| Typed relationships w/ evidence + confidence (spec §21: 7 fields) | **PARTIAL** | source/relationship_type/target real (36 typed keys + 3 chains, dataPlane); valid_from/valid_to ABSENT; source_evidence ≈ provenance-adjacent; confidence at classification, not per-link — 3 of 7 fields |
| Live Brain scope (spec §22) | **CONFIRMED (mock)** | spec's permitted list (aggregation…proposal generation) and its prohibition ("must not become the final authorization mechanism") match §2 #13 exactly; LIVE_BRAIN_READINESS.json; propose-only + zero-runtime-import pinned; 4 PARTIAL stages recorded there |
| Capability record (spec §23: 16 fields) | **PARTIAL (~11 of 16, now counted against the real list)** | present: capability_id, connector_id, version(display), input_schema (zod), side_effects (mutates flag), authority_requirements (1-bit predicate), executor, verification_method (plan), oracle_id (on VerificationPlan — null-honest), lifecycle_state (derived), certification_state (predicate). Absent/weak: output_schema, preconditions, risk_class (taxonomy undefined, Part C), scope_requirements per-capability, reversibility on the RECORD (exists on proposals). No unified registry record — S23 kit artifacts stand in |
| Observation type ladder (spec §8–12: event/observation/measurement/state/inference/claim) | **ABSENT as a unified ladder** | fragments exist (platform events, ActionRecords, understanding attributes with stated/inferred status, health snapshots, AI usage measurements with §11-shaped fields); no typed ladder unifies them; spec §12's "derivation rule must be explicit" is our UI-truth rule (§4) in behavior |
| Nine-timestamp temporal model (spec §14) | **PARTIAL (upgraded from ABSENT — scattered ~6 of 9, no unified model)** | proposal carries builtAtMs (proposal_time) + expiresAtMs + evidenceAsOfMs (observation_time); ActionRecord carries at (record_time) + verification.at (verification_time); CST/admission stamps ≈ authorization/execution times. ABSENT as fields: event_time, effect_time (provider receivedDateTime is read during verify but not recorded), request_time as a distinct stamp. No object carries the nine; "temporal precedence is not causal evidence" is honored by the corroboration oracle (never id-alone, never time-alone) |

## PART B · Formerly SOURCE_REQUIRED — transcribed FROM the committed spec and classified

| # | Element (spec §) | Spec definition (transcribed) | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Ring geometry (§1) | Rings 0–6 = boundaries, not sequential steps: 0 boundary/identity/security · 1 observation/state/context · 2 semantic/relationship · 3 capability/proposal · 4 governance/authorization · 5 execution/effect · 6 verification/evidence → experience state → constitutional invariant set; rings are crossed by 10 cross-cutting controls | **ADOPTED as the §0 dependency rule** — per-ring verdicts rows 2–9 | The ring picture maps onto the existing kernel with no contradiction found: nothing in the repo places authority further out than Ring 4 |
| 2 | Ring 0 — identity object set (§2.1: 10 objects × 8 fields id/type/issuer/status/created_at/updated_at/scope/version) | Ten identities: User, System, Installation, Device, Application, Service, AIProvider, Connector, Tenant, Workspace | **PARTIAL (~5 of 10 as real objects)** | Real: Tenant, Workspace, User (auth principal incl. `local:` D-12), Device (companion + trusted devices), Connector (manifests). Fragmentary: System/Installation (ids exist uncoordinated in ecosystem/catalog/supervisor/packageService — no identity objects); AIProvider is provider config, not an identity object; Application/Service identities ABSENT. The 8-field shape is not uniform on any of them |
| 3 | Ring 1 — observation/state/context (§8–15) | Typed ladder + declared-vs-observed + nine timestamps + 15-branch context model (identity/tenant/system/device/application/workflow/environment/time/state/dependencies/resources/policies/capabilities/evidence/uncertainty) | **PARTIAL** | Part A rows: ladder ABSENT-unified, timestamps PARTIAL-scattered, declared-vs-observed PARTIAL. Context model: `assembleBrainContext` (S2) covers state/capabilities/evidence/uncertainty branches over the real substrate — BUILT-UNWIRED (F-MR-2/M-002a); the 15-branch shape does not exist as one structure |
| 4 | Ring 2 — semantic/relationship (§16–22) | Representation between observation and inference; inference never rewrites observation; initiative→intention→purpose→need; typed relationship graph; Live Brain reasons + proposes only | **PARTIAL** | dataPlane ontology (15 canonical entities) + typed relationships (Part A); `brainReasoning` (S3) BUILT-UNWIRED (M-002b); Live Brain scope CONFIRMED-mock; the four-stage chain 1-of-4 (Part A) |
| 5 | Ring 3 — capability/proposal (§23–28) | 16-field capability record; connector≠capability≠connection ids; Master Connector = resolution only; 21-field immutable proposal with fingerprint binding ("If parameters change: fingerprint changes and the original authorization must not silently apply") | **CONFIRMED (M365 vertical) / PARTIAL (breadth + field completeness)** | Proposal model counted against the real 21: **~15 of 21 present** on `BrainProposal` (proposalId, tenantId, purpose(prose not id), capability_id, connector(target), account≈connection, target, scope, params, expected_effect, risk, reversibility, authority_requirement, evidence_refs, verification_plan incl. oracleId, expires/built stamps). ABSENT: operation_id, initiative_id, intention_id, proposer, fingerprint ON the object (binding lives at the CST/stash gate instead — the PROPERTY is pinned: edit→SKIP e2e + lane test, spec's exact demand honored by different placement). Master Connector ABSENT (M-013, resolution-only constraint already ruled). Immutability: proposals are readonly + single-consume (pinned) |
| 6 | Ring 4 — governance (§29–34) | PROPOSED→VALIDATED→GOVERNANCE→{ALLOW, ASK, DENY}; ASK surface shows 10 fields; DENY is first-class (8-field record); ALLOW bound to operation+proposal+scope+identity+policy version+capability+time; runtime independently calculates authorization; expiry mandatory | **CONFIRMED core; ALLOW deliberately ABSENT (stricter than spec); ASK surface 8 of 10 fields** | ASK + DENY real (CST admission, typed refusals, expiry→DENIED pinned; DENIED/CANCELLED/EXPIRED first-class in D-16). ALLOW for consequential actions is structurally ABSENT until S28 Policy DSL — a DELIBERATE stricter subset, not a gap to close early. §33's "LLM `approved:true` never treated as authorization" = S4.2 attack class, pinned. ASK surface (`toBrainReview`, FG-9 frozen type): purpose/target/action/risk/evidence/expectedEffect/verificationPlan/expiry — spec's SCOPE + REVERSIBILITY exist on the proposal but are NOT projected to the review surface (completing them = an FG gate). DENY records: reasons + refusal logging real; policy_id absent (no Policy DSL yet) — record completeness PARTIAL |
| 7 | Ring 5 — execution (§35–38) | Executor accepts only a validated execution context (10 fields incl. idempotency_key + verification_plan); idempotency strategy per consequential operation; ack ≠ outcome | **CONFIRMED core; idempotency + context fields PARTIAL** | Certified executor + FG-10 gate order in frozen `connectors/index.ts`; context today: requestId/transitionId/connector/account/action/params/admissionRef — no idempotency_key or verification_plan IN the context. At-most-once achieved differently today (single-use CST + S15 latch); imports carry importKey; the general idempotency_key flow is S21 (roadmap) |
| 8 | Ring 6 — verification/evidence (§39–43) | EXECUTION→EFFECT→INDEPENDENT OBSERVATION→READ-BACK→ORACLE→VERIFICATION; oracle = corroborated match rule; VERIFIED_FAILURE on evidence-of-absence; UNKNOWN never SUCCESS; 13-field evidence model | **CONFIRMED functions / PARTIAL wiring + evidence fields** | `verifyEffect` IS §40's oracle rule (corroborated match — never id alone; 17 pins incl. fault injection); all three terminals proven in-app over the real oracle (mock Graph, 3 launches); LIVE once (S16 VERIFIED_SUCCESS). PARTIAL: S22 reconciler absent (UNKNOWN→HOLD queue not operational, M-002c); evidence model counted against the real 13: **~7 of 13** on ActionRecord+provenance (id, source≈connector/account, observed/recorded collapsed to one `at`, producer≈actor, content_hash=fingerprints ✓, schema_version ✓, provenance≈admissionRef chain + importSourceTrust, status≈verdict/outcome/terminal). ABSENT: source_type, method, confidence, uncertainty as fields |
| 9 | Experience state + reproduction (§44–45: 17-ref immutable record; historical ≠ current ≠ reconstructed) | Completed operations → immutable experience records; reproduction distinguishes historical/current/reconstructed/new | **ABSENT (deliberately)** | LB-6 recorded design, ENTRY DEFERRED by rule (L6 note, §5 OS-tracks); spec Stage 11 places it late too — no divergence |
| 10 | E01 constitutional invariant engine (§53: RULE-001..012, machine-testable) | Twelve rules, "These should become automated tests" | **CONFIRMED as distributed tests (10 of 12) · 1 vacuous · 1 PARTIAL; ABSENT as a central named engine** | RULE-001 (S4.2 fleet + boundary re-derivation ✓) · 002 (calendar dry-run pin: connector-certified ≠ action-certified ✓) · 003 (deny-by-default + capabilityGraph pins ✓) · 004 (expiry→DENIED pinned ✓) · 005 (edit→SKIP fingerprint pin ✓) · 006 (UNRESOLVED never auto-promotes, 17 pins ✓) · 007 (§2 #15; no memory subsystem exists to attack — law + construction ✓) · 008 (VACUOUS — no learning code exists; law recorded) · 009 (vault split + zero token IPC ✓; F-MR-7 adjacent) · 010 (crossTenant DENY ✓) · 011 (FG-10 gate order + main-derived confirm, S33-class pins ✓) · 012 (PARTIAL — recordVerification chains to admissionRef, but provenance/method/confidence fields absent, row 8). No single named suite asserts all twelve — §3 #2 |
| 11 | 43-domain map (§48–52, A01–E01) | Engineering INDEXING SCHEME (the correction section: not a geometric claim) | **ADOPTED as an index** | Domains cross-referenced from existing evidence where real (A12=capabilityGraph, C04=CST/admission, D03=verifyEffect, D08=ActionRecord…); per-domain classification intentionally NOT duplicated — the rows above already classify every domain that exists; a 43-row appendix would restate them |
| 12 | Cross-cutting security plane (§54: 16 items) | authn…supply-chain controls | **PARTIAL (majority present)** | Present: authn, authz, least-priv, tenant isolation, secret mgmt, input validation (edge zod), audit (ActionRecord+admission), replay protection (CST nonce + companion), revocation (manual, S15 containment). Weak/partial: rate limiting (sync only), credential rotation (companion keys yes; connector token rotation provider-driven), output validation (per-surface), dependency/supply-chain (CI W-checks partial) |
| 13 | Cross-cutting measurement plane (§55) | Governance/execution/verification/AI/connector metric sets | **PARTIAL (AI only)** | AI metrics real (usageTracker/routingUsageStore: tokens, model, provider, latency); governance/execution/verification metric sets ABSENT — S35 (RO/OG/VC…) is their planned home; spec metric names fold into S35's set |
| 14 | Cross-cutting certification plane (§56) | CLAIM/SCOPE/BASELINE/TESTS/ADVERSARIAL/RESULT/LIMITATIONS | **CONFIRMED (shape)** | The S23 kit's seven ruled artifacts ARE this shape; mail.send back-filled as reference; §66's CLAIM→…→CERTIFICATION loop = §2 #5 evidence law + the kit, already practiced |
| 15 | Economic subsystem + three ledgers (§60–63: evidence/governance/economic ledgers, common key operation_id; resource normalization) | Measurement→usage event→normalized units→economic event→ledger→pricing; PAYMENT ≠ AUTHORITY | **ABSENT as a model; law CONFIRMED; fragments exist** | §2 #16 canonized BEFORE any code (the invariant, verbatim). Fragments: AI usageTracker (resource measurement for one resource class), billing store + backend Razorpay scaffolding (not wired to governed operations). No operation_id common key, no normalized resource unit, no ledger separation. S49 is the planned home |
| 16 | Connector registry (§64: 12 fields) | connector_id…supported_environments; grow by REFERENCE connectors, not catalogs | **PARTIAL** | Manifests carry a subset; oracle_ids/certification_state/lifecycle_state/regions absent from any registry; "reference connectors first" = exactly the operator's ladder ruling + the 41-package lesson, already law |
| 17 | Implementation sequence (§65: Stages 1–12) | Live Brain → real proof → Master Connector → M365 reference → structurally-different connector → surfaces → measurement → economics → experience → learning | **CONSISTENT with the ruled ladder; ONE deliberate inversion** | Stage 4 (M365 reference) DONE; Stage 5 = Razorpay rung 3 (ruled); Stage 3 = M-013; Stages 9–12 match S49/LB-6 deferrals. Inversion: NP-000 (Stage 2) runs BEFORE Stage 1 completes (S2/S3 built-unwired) — operator-ruled priority, recorded, not silent drift |

## PART C · Still SOURCE_REQUIRED (the spec names these but does not define them — never guessed)

risk_class taxonomy (§23 names the field; no values given) · policy model/DSL semantics (§29 evaluates "policy";
no policy language defined — S28 designs it) · oracle REGISTRY shape beyond oracle_id (§40 defines one oracle's
rule) · STALE staleness-window semantics (§13 names the state; no threshold rule) · normalized resource unit
formula (§62 names it; no normalization defined) · measurement uncertainty method (§11 lists the field) ·
issuer semantics for AIProviderIdentity/ServiceIdentity (§2.1) · the shape of an "explicitly registered
cross-tenant relationship" (§3 names the exception; no object defined) · experience-record immutability
mechanism (§44). Each stays **STATUS = SOURCE_REQUIRED**; when its slice arrives, the definition is designed in
a gate/decision doc and recorded in DECISIONS.md — never back-written into the spec.

## §3 · FINALIZED ranking (for the operator's ruling — ZERO code from this audit without it)

Ranked by risk-reduction per effort, each a bounded slice, none touching NP-000's surfaces:

1. **Credential-boundary completion** — mechanical desktop log redaction (closes F-MR-7) + an adversarial
   RULE-009 pin (credential material in connector metadata → refused). High risk-reduction, low effort,
   zero frozen touch.
2. **Constitutional invariant suite (E01 as tests, not an engine)** — ONE named suite
   (`constitutionalInvariants.test.ts`) asserting RULE-001..012, mostly by exercising the EXISTING distributed
   pins' seams, plus the two real gaps: RULE-012 provenance fields on `recordVerification`, RULE-008 honestly
   marked vacuous-until-learning-exists. High legibility (the spec's own "should become automated tests"),
   low effort, zero frozen touch.
3. **Nine-timestamp completion on evidence records** — additive fields on ActionRecord (+verification):
   split observed/recorded, record effect_time from the provider read-back, carry request/proposal stamps
   through. High temporal-honesty value, medium effort, non-frozen (actionRecord.ts).
4. **Capability-record completion in the S23 kit** — extend the kit artifact to the 16-field record
   (risk_class + preconditions + output_schema + reversibility-on-record) + registry aliases per Ruling 2.
   Medium value, low effort; the natural companion to ladder rung 2 (calendar.create).
5. **Typed-relationship field completion** — valid_from/valid_to/source_evidence/confidence per link in
   dataPlane relationships. Medium/medium.
6. **STALE as a first-class state assessment** — `Certainty` extension + a declared-vs-observed assessment
   helper (its window semantics designed in the slice, Part C). Medium value, low effort; touches Brain
   substrate — its own bounded slice.
7. **ASK-surface completion to the spec's ten fields** — project SCOPE + REVERSIBILITY into `brainReview`.
   Low effort but **FG gate required** (FG-9 frozen type) — deliberately ranked last; waits for a natural
   frozen-touch companion or the operator's explicit call.

## §4 · STATUS LANGUAGE (recorded verbatim, corrections folded)

NP-000's recorded status = **HOLD**; the pre-execution divergence is **FIXED** (NP-007 closed with evidence — the
advisor doc's §9 predates that and is superseded); the current hold reason is **TENANT AVAILABILITY only**.
**"NP-011 progress is never evidence of NP-000 readiness — the real external-effect proof passes independently."**
IMPORT ≠ APPROVAL ≠ POSTING is tested explicitly in slice B (`aggregatedImports.test.ts`: `approvedAt` empty +
draft pins), never inferred from code structure.
