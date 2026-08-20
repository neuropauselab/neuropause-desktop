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

## §0.1 · PRINCIPLES (adopted verbatim by operator ruling, 20 Aug 2026)

> **"NeuroPause OS does not merely store capability metadata; it preserves the provenance and epistemic state of
> every capability claim."**

The NP-016 record is this principle in code: every field carries KNOWN-with-its-source / CONFLICTING /
ABSENT-with-its-reason / SOURCE_REQUIRED, and `risk_class` + `lifecycle_state` are typed `never` so the compiler
refuses a value the spec has not defined.

> **THE DISCOVERY INVARIANT (F-N16-1):** *"Discovery must not claim stronger capability standing than the actual
> governance boundary can establish."*

Direction of repair is part of the invariant: when discovery and the boundary disagree, **tighten discovery —
never loosen the boundary.** F-N16-1 was closed exactly that way (advisor convergence recorded 20 Aug 2026): the
S5.1 predicate was untouched, discovery became ACTION-level, and `deriveAuthority`'s one-argument call site keeps
the authority path byte-identical.

## §0.3 · THE FIELD LIFECYCLE and THE EVIDENCE HIERARCHY (advisor review, operator-adopted 20 Aug 2026)

**THE FIELD LIFECYCLE — a field becomes a load-bearing control only at the end of this ladder:**

> **FIELD → CONSUMER → DECISION → ENFORCEMENT → ADVERSARIAL TEST → EVIDENCE**

A declared field is not a control. A consumed field is not a decision. A decision is not enforcement. Enforcement
untested adversarially is untested. **Only after the last rung is a field load-bearing** — and the reconciliation
slice is what this ladder looks like applied: `policyVersion` stops at CONSUMER (a label, never a decision);
reversibility stops at FIELD (no consumer at all, which is exactly why two live values could point in opposite
directions unnoticed).

**THE EVIDENCE HIERARCHY — the rungs a claim can stand on:**

> **DECLARED → REACHABLE → CONSUMED → ENFORCED → TESTED → ADVERSARIAL → OBSERVED → VERIFIED**

> **THE RULE, verbatim: "NeuroPause should never silently treat a lower rung as a higher one."**

**REACHABLE inserted between DECLARED and CONSUMED (operator ruling, 20 Aug 2026, P0/P1 directive):** *you cannot
consume what you cannot reach.* It is one rung of the SAME hierarchy — deliberately **not** a parallel
DECLARED ≠ REACHABLE ≠ OBSERVED ≠ VERIFIED vocabulary, under the same anti-fork discipline that governs the single
`Certainty` authority (NP-018) and the report classes. The rung earned its existence empirically: the FG-9 eight-field
review is DECLARED, has an operator-reachable surface, and on the ceremony build was **not** reachable through the
DEV-gated control the runbook named — a gap the old ladder had no rung to express, because it could only say
"declared" or "consumed" and the truth was neither.

Silently is the operative word: standing on a lower rung is honest when it is *labelled* as that rung. The whole
NP-016 record exists to keep those labels attached (KNOWN-with-source / CONFLICTING / ABSENT-with-reason /
SOURCE_REQUIRED), and the §14 temporal work is the same discipline over time (`effect_time` is OBSERVED;
`authorization_time` is not even DECLARED, and says so).

## §0.2 · STANDING RULES FROM THE RECONCILIATION SLICE (operator-ruled, 20 Aug 2026)

**THE REVERSIBILITY MOVE RULE.** `Proposal.reversibility` is caller-authored — it sits on `ProposalRequest`,
unlike `authorityRequired` and `verificationPlan`, which were deliberately given no request field so they could
not be injected. It is inert today (nothing reads it for a decision), so the exposure is zero. **The moment
reversibility gains ANY consumer that reads it for a decision, the field MUST move to the derived side like its
two neighbours — via a PRESENTED GATE, never in place.** Inert-but-injectable is a debt; the negative pins in
`vocabularyReconciliation.test.ts` hold its interest at zero and fire the requirement if a reader appears.

**WHY THE DIVERGENCE SURVIVED (recorded as the general lesson):** *nothing could fail because nothing consumes
it.* Two live values for `calendar.create` pointed in opposite directions for as long as they did precisely
because no code path read either one. An unconsumed field is not a safe field — it is an unfalsifiable one.

**VOCABULARY EARNS EXISTENCE WHEN SOMETHING CONSUMES IT.** Both SOURCE_REQUIRED questions from the slice have
their source NAMED rather than left floating: the reversibility **value space**, and oracle-id **ownership +
identifier grammar**, are both authored at **ladder rung 2 (the calendar.create kit run)** — the first place
reversibility-on-record gains a real consumer and the calendar read-back oracle forces the naming question
honestly — and presented there for the operator's approval. Nothing is invented before then.

## §0.4 · NP-012 PROGRAM COMPLETE (20 Aug 2026) — the closing achievement, recorded verbatim

Ten items closed, zero freeze breaks: NP-013 · NP-014 · NP-015 · F-N16-1 · NP-016 · NP-019 (stopped and mapped)
· NP-020 reconciliation (F-N16-2/3/4) · FG-12 · NP-017 (determined) · NP-018.

> **"NeuroPause now distinguishes the existence of evidence, the semantic state of evidence, the freshness of
> evidence, and the governance consequences of that evidence — without allowing an unconsumed field or
> unreachable mechanism to masquerade as an operational control."**
> — advisor review, adopted verbatim by operator ruling, 20 Aug 2026

Each clause has its slice: **existence** (NP-016's KNOWN-with-source / ABSENT-with-reason / SOURCE_REQUIRED
record) · **semantic state** (CONFLICTING surfaced, never resolved by preference) · **freshness** (NP-015's
temporal model, NP-019's refusal to invent phase instants, NP-018's STALE-vs-UNKNOWN) · **governance
consequences** (§2 #18, F-N16-1's discovery invariant, NP-017's validity guard). And the negative half is the
harder half: the FIELD LIFECYCLE ladder (§0.3), the reversibility MOVE RULE (§0.2), the VALIDITY GUARD, and
F-N17-4's *"a declared governance capability is not the same thing as a reachable governance path"* exist
precisely so nothing unconsumed or unreachable can pass itself off as a control.

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
| Typed relationships w/ evidence + confidence (spec §21: 7 fields) | **PARTIAL — 4 of 7 real, 1 partial, 2 absent (CORRECTED by NP-017)** | source/relationship_type/target real and at the **ENFORCEMENT + ADVERSARIAL TEST** rung (a governed delete is REFUSED while an incoming link exists) · **confidence IS per-link** — `confidence: number` on every row; the earlier row here said "at classification, not per-LINK" and was WRONG, corrected against the declaration and now pinned · source_evidence PARTIAL (a de-normalized cluster: sourceField/sourceValue/method/decidedBy/correlationId/reason; no provenance-record id, no sourceTrust) · **valid_from/valid_to BELOW FIELD** and **BLOCKED, not merely missing**: the one enforcement consumes link EXISTENCE, so an expiring link is a lapsing refusal — adding validity is a GOVERNANCE change needing its own ruling. `at` is last-resolved-at (overwritten every re-resolution), so no honest valid_from derives from it. VALIDITY GUARD pinned (`relationshipFieldDetermination.test.ts`) |
| Live Brain scope (spec §22) | **CONFIRMED (mock)** | spec's permitted list (aggregation…proposal generation) and its prohibition ("must not become the final authorization mechanism") match §2 #13 exactly; LIVE_BRAIN_READINESS.json; propose-only + zero-runtime-import pinned; 4 PARTIAL stages recorded there |
| Capability record (spec §23: 16 fields) | **PARTIAL (~11 of 16, now counted against the real list)** | present: capability_id, connector_id, version(display), input_schema (zod), side_effects (mutates flag), authority_requirements (1-bit predicate), executor, verification_method (plan), oracle_id (on VerificationPlan — null-honest), lifecycle_state (derived), certification_state (predicate). Absent/weak: output_schema, preconditions, risk_class (taxonomy undefined, Part C), scope_requirements per-capability, reversibility on the RECORD (exists on proposals). No unified registry record — S23 kit artifacts stand in |
| Observation type ladder (spec §8–12: event/observation/measurement/state/inference/claim) | **ABSENT as a unified ladder** | fragments exist (platform events, ActionRecords, understanding attributes with stated/inferred status, health snapshots, AI usage measurements with §11-shaped fields); no typed ladder unifies them; spec §12's "derivation rule must be explicit" is our UI-truth rule (§4) in behavior |
| Nine-timestamp temporal model (spec §14) | **PARTIAL — better-founded after NP-015 (5 of 9 now ON the evidence record, as named fields)** | ON the ActionRecord: `requestTime` (read from the kernel-minted requestId, null when unstamped), `eventTime` (caller-supplied; honestly NULL on the governed send path — no upstream event stamp exists), `at` = record_time; on its verification: `at` = verification_time, `effectTime` = the provider's own instant carried verbatim from the corroborated read-back (null on bounce/HOLD). Proposal-side: builtAtMs (proposal_time) + evidenceAsOfMs (observation_time). STILL ABSENT as record fields: authorization_time, execution_time — and **NP-019 proved they cannot be honestly sourced from the CST timeline**: `SystemTime.now()` returns a base frozen at construction, so all six stamps (requested/decided/claimed/executionStarted/executionCompleted/verified) carry ONE identical value (empirically: 1 distinct value of 6, spread 0ms). The timeline is a PHASE-REACHED LEDGER under a logical clock, not phase instants; mapping it would stamp the request-construction moment onto phases never measured. Two further non-equivalences found: `decided` is stamped on paths that then HOLD/DENY (so it is not an authorization time at all), and the kernel's `verified` is its own post-state check, NOT the independent read-back oracle. **F-N19-2 (self-caught):** `requestTime` is structurally NULL in production too — `TransitionOutcome` carries no `requestId`, so the observer stores `''`; the field is honest, the earlier DESCRIPTION was not, and a REALITY pin now asserts the true shape. Surfacing the requestId needs a FROZEN `cst/` change → FG gate, presented not applied. Discipline pinned: a time we were not told is ABSENT, never approximated; §14's "precedence is not causation" is why event_time stays structurally distinct from request_time rather than being back-filled from it |

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
3. ~~**Nine-timestamp completion on evidence records**~~ — **DONE (NP-015)** for the ruled three
   (request_time · event_time · effect_time). authorization_time/execution_time stay open with their source
   now identified and unbuilt (CST kernel `TransitionOutcome.timeline`) — outside the ruled envelope.
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
advisor doc's §9 predates that and is superseded). **HOLD REASON UPDATED 20 Aug 2026 (operator): no longer tenant
availability — an EXECUTED-AND-EMPTY propose lane (P1). The sitting converted from a ceremony sitting to a findings
sitting.**
**"NP-011 progress is never evidence of NP-000 readiness — the real external-effect proof passes independently."**
IMPORT ≠ APPROVAL ≠ POSTING is tested explicitly in slice B (`aggregatedImports.test.ts`: `approvedAt` empty +
draft pins), never inferred from code structure.

## §5 · THE FINDINGS SITTING (20 Aug 2026) — F-P8…F-P17, and the vocabulary rule they forced

### §5.0 · MAPPING PRINCIPLE — THE GRANTED/TENANT DISAMBIGUATION (operator ruling, binding)

Two unrelated authorities shared the bare word **"scope"**, and that single collision produced **five
mislocalizations in one sitting** — every one of them a fault placed downstream of where it actually was.

| Term | Means | Lives in | Programme item |
|---|---|---|---|
| **GRANTED SCOPE** | OAuth permissions actually conferred by the provider | `connectorService.ts:632` · `grantedScopes` · `m365/executor.ts:33` · `cst/sendTransition.ts:113` | **P0** |
| **TENANT SCOPE** | Tenancy identity `{tenantId, workspaceId}` | `TenantScope` · `activeTenantScope` · `brainProposeLane.ts:81` | **P1** |

> **THE CANONICAL EVIDENCE LADDER IS §0.3's AND ONLY §0.3's** — DECLARED → REACHABLE → CONSUMED → ENFORCED →
> TESTED → ADVERSARIAL → OBSERVED → VERIFIED. **Any advisory diagram that differs is a PROPOSAL, not a
> correction, and is reconciled against this document before anything acts on it.** (Operator ruling, 20 Aug 2026,
> after the ladder took four shapes in four consecutive documents — dropping TESTED and ADVERSARIAL twice, which
> are the red-first rungs the programme rests on. A vocabulary that has taken four shapes in four documents is not
> a vocabulary, it is a draft.)

> **THE BARE WORD "DRAFT" IS BANNED** alongside "scope". Two paths share it — **GOVERNED DRAFT**
> (`referenceDrafter` → Proposal/BrainReview → governance) and **PRODUCT DRAFT** (`aiEngine`/Ollama → editable
> draft → human composition) — and one closed claim already straddled the collision. That is F-P8. Always
> GOVERNED DRAFT or PRODUCT DRAFT.

> **THE BARE WORD "SCOPE" IS BANNED** in reports, rulings, log lines, pin names and commit messages. Always
> GRANTED SCOPE or TENANT SCOPE. This is the REACHABILITY family's own lesson — *a declared thing and a reachable
> thing were allowed to share one name* — turned back on our own vocabulary. **No renames in source were made when
> this rule was adopted;** it governs documents and new code first, and any source rename is its own presented slice.

### §5.1 · THE TWO LAW FAMILIES — kept separate, deliberately

They are not one law. Conflating them is what let an authority defect and a reachability defect be discussed in the
same breath as though one analysis served both.

**AUTHORITY family** — *what the system may be permitted to do.*
§2 #16 (payment is never authority) · connection is never permission · **requested GRANTED SCOPE is never granted
GRANTED SCOPE**.
> **Proposed general law (operator's go pending before §2 entry): PRESENCE IN THE SYSTEM IS NEVER AUTHORITY.**
> §2 #16 becomes a corollary of it, as does the requested-vs-granted pair below.

**REACHABILITY family** — *what the system can actually get to.*
§2 #18's corollary (a declared governance capability is not a reachable governance path) · F-N17-4 · the DEV gate ·
source-vs-build.
> **Its statement: A DECLARED THING AND A REACHABLE THING WERE ALLOWED TO SHARE ONE NAME.**

### §5.2 · THE ROWS

| ID | Finding | Family | Rung reached | Status |
|---|---|---|---|---|
| **F-P8** | The P2.4 AI-draft path is structurally OUTSIDE the authority boundary and functionally UPSTREAM of it. Model output reaches a send-capable form with nothing between. Item 3 alone is a wording defect; item 4 alone is a validation gap; **composed, they are a boundary crossed by CONTENT where the architecture only ever pinned CONTROL.** | AUTHORITY (adjacent) | OBSERVED | **OPEN** — own row, own remedy |
| **F-P9** | The record carries two clocks under one set of numbers. Log stamps are UTC; the sitting reported them as wall-clock (IST, +5:30). Artifacts are fine; the record's legibility is not. **No single clock, no run id tying a log line to a run.** | — (P2) | OBSERVED | **OPEN — this IS P2** |
| **F-P10** | The runbook violated §2 #17: written against SOURCE, never against the built ARTIFACT, which is why its step 2 names a DEV-gated control. | REACHABILITY | OBSERVED | **OPEN**; corollary pending go: *a document that describes the repository is not a document that describes the artifact* |
| **F-P11** | A fail-closed path that leaves no evidence is indistinguishable from a path that never ran. `brainProposeLane.ts:81` has SOURCE, CONSUMER, INVARIANT and **no EVIDENCE**. "Silent-honest" conflates two virtues: honest about authority, silent about occurrence. | — (P1) | SOURCE-PROVEN | **OPEN**; elevation pending go: *a refusal must be observable or it is not auditable* |
| **F-P12** | The handoff mailbox has NO expiry and is never cleared on navigation, while the proposal it produces carries a 10-minute `Expires`. A fresh proposal can always be minted from a stale intent — **the expiry discipline exists on one side of the handoff only, which makes `Expires` partly decorative.** | REACHABILITY | SOURCE-PROVEN | **OPEN** |
| **F-P13** | **A PER-PROFILE SAFETY DEVICE DOES NOT PROTECT A MULTI-INSTANCE DESKTOP.** The FG-4 latch is per-profile; a second instance on a different profile carries its own absent one. Two instances ran for 20 hours. Had the 18:19 Confirm landed in the r2 window there would have been **no latch and a real send would have gone out.** Root cause: the launch sequence said "quit old app instances" and gave it no verification step. **A STATED PRECONDITION WITHOUT A CHECK IS NOT A PRECONDITION.** | AUTHORITY | OBSERVED (near-miss) | **OPEN — the sitting's most serious.** Protocol change: a process-list check becomes a step-1 gate equal in standing to the seed line; the ceremony cannot begin with a second instance live |
| **F-P14** | Fourth REACHABILITY instance: the button labelled **"Open connectors"** does not open the Microsoft panel — it lands on the connector list and the Microsoft card must additionally be clicked. **A control named for a destination it does not reach.** | REACHABILITY | SOURCE-PROVEN | **OPEN** |
| **F-P15** | `workspaceStore.isLoaded()` is **MONOTONIC** — `loaded` is assigned `true` at exactly one site and never back to `false`; `load()` early-returns once loaded. The observed order was SUCCEED (18:14) → FAIL (18:17), so **`not_loaded` is EXCLUDED BY DIRECTION** and the load-race hypothesis is dead. **Something genuinely changed in the window.** | — (P1) | SOURCE-PROVEN | **ANSWERED — negative** |
| **F-P16** | `resolveTenantScope` branches on ambient async context (`storage.getStore() ? principalScope() : session()`). The only producer is `runWithPrincipal` (`backgroundPrincipal.ts:109`), used by background fan-out callers; **IPC handlers are not among them.** Both panel mounts took the `session()` branch. **EXCLUDED.** | — (P1) | SOURCE-PROVEN | **ANSWERED — negative** |
| **F-P17** | TENANT-SCOPE-null does **not** account for the zero counter row. `unified/sync/index.ts:163` returns snapshots unchanged on a null tenant scope, so `writeStates` would be **absent** and `M365WritePanel.tsx:135,151` would render **"No governed writes yet."** Zeros were observed instead ⇒ `writeStates` was present ⇒ the tenant scope resolved on that read. **P2's `workspaceId`-vs-`tenantId` diagnosis is NOT downgraded.** | — (P2) | SOURCE-PROVEN (display law); discrimination rests on the operator's observation of zeros rather than the sentence | **ANSWERED — P2 stands** |

### §5.3 · P1 LOCALIZED — INTERMITTENT SILENT TENANT-SCOPE DENIAL

**The renderer is innocent.** `setBrainReview` was called with `null` and `BrainReviewCard.tsx:24` did exactly what
it is specified to do. The break is `brainProposeLane.ts:81`, in the main process.

**The defect is LOSS OF DIAGNOSTIC STATE.** `resolveFull()` computes a typed refusal drawn from an authoritative
**EIGHT**-member union (`packages/shared/src/types/tenancy.ts:98`) — `not_signed_in · not_loaded · no_workspace ·
workspace_orphaned · not_a_member · not_in_workspace · member_inactive · tenant_not_operable` — and
`tenantContext.ts:497`'s `scope()` flattens **every one of them to `null`**; `:81` then discards that null again.
Two lossy hops, and the answer P1 needs existed at the first one.

**PRECEDENT — the same defect was already repaired once, elsewhere.** P13C Round 26 **W-5**: *"`resolveFull()`
already decided this and its answer was being discarded, so eight distinct conditions reached the renderer as one
sentence"* (`enterprise/index.ts:830`). The repair shipped as the optional `tenantRefusal?: () => TenantRefusal |
null` accessor on the authz-gate deps (`authzGate.ts:127`), implemented as a single `resolveFull()` consultation on
the refusal path only.

**ANTI-PATTERN — established by P13C Round 31 W-10, and binding on the P1 envelope.** The Round 28 diagnostic that
re-read `authService.getStatus()`, the org store and the workspace store *after* `resolveFull()` had returned was
**removed, and its removal is the point**: a second sample of four mutable singletons *"described a state that had
not produced the refusal it claimed to explain, and there would have been no way to tell from the output."*
**The P1 repair must report from the values the resolver actually used — never re-sample.**

### §5.4 · CORRELATION IDENTITY — WHAT EXISTS, AND WHAT DOES NOT (P1-B / the P2 spine question)

| Boundary | Identity field | Source | Consumer | Semantic meaning |
|---|---|---|---|---|
| **Request** | `requestId` = `req:<idem>:<epochMs>` | CST kernel mint; surfaced by **FG-12** on `GovernedSendResult.requestId` | `actionRecord` observer → `ActionRecord.requestId` + `requestTime` | The kernel's request-construction instant, embedded at mint, read verbatim. **Never** a proxy for authorization or execution time |
| **Tenant** | `TenantScope.tenantId` | `tenantContext.resolveFull()` → `context.tenantId` | scoped stores; `unified/sync/index.ts:191,232` (counter READ) | Organization/tenant identity |
| **Workspace** | `TenantScope.workspaceId` | the SAME `resolveFull()` call | `brainProposeLane.ts:83` tenant key; the ActionRecord's `tenantId` column (**written as workspaceId**) | Active workspace identity |
| **Tenant scope** | `TenantScope {tenantId, workspaceId}` | `activeTenantScope()` → `resolveTenantScope(() => tenantContext.scope())` | lane `:81`, the sync join, every scoped store | The two-field tenancy identity. **A null erases both fields AND the reason** |
| **Proposal** | `proposalId` = `prop:<tenantId>:<purpose>:<bodyFingerprint>:<evidenceAsOfMs>` (`proposal.ts:199`) | `buildProposal` — **derived and deterministic, not minted** | stashed in `proposalStore` under a **different** key: `tenantId::capabilityId::account::canon(params)` | Content-derived proposal identity |
| **Action record** | `ActionRecord.id` = `act_<uuid>`; also `transitionId`, `admissionRef` | `actionRecord.observe` | `actionRecord.query`, `m365WriteStates` | Durable evidence-row identity |

> **AMENDED 20 Aug 2026 — the earlier "none exists" is WITHDRAWN.** An authoritative correlation identity **DOES**
> exist at the assistant boundary: every envelope carries a `correlationId` (`asst_…`, minted by `baseEnvelope`),
> observed in both stored ceremony turns. **It is DISCARDED at the handoff boundary** — `PendingMailIntent` is
> `{to, subject, body}` only. So this is a **PROPAGATION candidate, never a MINTING one**, exactly as the rule
> demands. The cost is measured, not hypothetical: had it been carried, the six-mislocalization spiral of 20 Aug
> would have been a single lookup.
>
> **AND THE LAW THAT CONSTRAINS ITS PROPAGATION — CORRELATION IS FOR EVIDENCE, NEVER FOR AUTHORIZATION.** The
> content-derived match is what makes edit→SKIP work, and it **fired live in production on 20 Aug**, refusing to
> attribute the 18:19 send to the stashed proposal because the params differed. A `correlationId` match would have
> said "same run" where the operator had edited the body — precisely what edit→SKIP exists to catch. The id may
> travel alongside; **the content-derived match remains the SOLE basis for attributing an execution to a
> proposal.** If anything ever branches on `correlationId` for the gate, that is a governance change under §2 #18
> and it takes a presented envelope. (This is NP-017's lesson verbatim: completing a spec must not weaken a
> governed refusal as a side effect.)

> **The rest of the chain remains a negative: NO SINGLE IDENTIFIER SPANS IT.** `ActionRecord` carries **no**
> `proposalId` (verified: the field does not exist in the store or the written record), the proposal→execution link
> is re-derived from content rather than carried by identity (which is precisely what makes edit→SKIP work), the IPC
> layer mints **no** correlation id at all, and **FG-12's `requestId` begins at `governedSend`** — it does not reach
> back to PROPOSE, BRAIN REVIEW or HUMAN DECISION.
>
> Per the standing rule — *EXISTING AUTHORITATIVE ID → PROPAGATE, never NEED CORRELATION → MINT ONE* — **this is
> reported and STOPPED, not solved.** `requestId` is a candidate spine for execution→evidence only; the earlier
> boundaries have no identity to propagate and none was invented to complete the shape.

### §5.5 · THE CONSTRAINING PRINCIPLE ON ANY P1 REMEDY (operator ruling, standing law)

> **A REMEDY THAT WORKS UNDER EVERY HYPOTHESIS IS NOT EVIDENCE FOR ANY OF THEM.**

A readiness gate would make the symptom disappear whether the cause is a load race or a non-monotonic `isLoaded` —
and under the second it would **MASK a worse defect**. **No readiness gate.** Establish the cause first. This is the
inverse of red-first, and F-P15 is why it earned its place: the load-race hypothesis was the intuitive one and the
source killed it.

## §6 · THE INVESTIGATION CLOSES (20 Aug 2026) — locked state, closed questions, corrected order

### §6.1 · THE A/B QUESTION IS CLOSED AS UNKNOWN, AND IT IS NOT REOPENED

> **THE HISTORICAL EVENT OF 18:16:59 IS PERMANENTLY UNKNOWN.** It is recorded as UNKNOWN, it is an **honest
> terminal state**, and it is not reopened.

The operator pre-ruled that if the artifacts did not settle whether the 18:16:59 navigation used the assistant's
"Open connectors" button or the sidebar, it closes. The LevelDB `np.activeSection` trace was the last cheap
immutable evidence and returned **row 3 of the pre-registered table — insufficient to distinguish** — exactly as
declared *before* the file was opened. No handoff key can exist (the mailbox is a renderer module variable, never
persisted) and no record names a navigation mechanism.

**P1 therefore stops being an investigation.** The **EVENT** question is closed. The **MECHANISM** question — does
a second consumption work — moves to a **diagnostic re-run** under instrumentation. Nobody restarts the
archaeology.

**THE REQUIRED P1 PHRASING, to be used verbatim in every report from here:**

> *"A silent unresolved-TENANT-SCOPE branch EXISTS and is CAPABLE of producing the observed result, but the
> ceremony evidence does not establish that it occurred."*

### §6.2 · LOCKED STATE

| Item | State |
|---|---|
| **P0** | **LATENT defect — NOT observed in r3** |
| r3 granted scopes | **OBSERVED** (real token response) |
| **P1** | **UNLOCALIZED** |
| **P2** correlation | **ESTABLISHED** |
| **P3** | OPEN |
| **F-P24** | **OBSERVED** |
| External effect | **PROHIBITED** |
| Frozen kernel | **UNCHANGED** |
| Complete NP-000 chain | **NOT ESTABLISHED — no retrospective upgrade** |

### §6.3 · THE P0 CORRECTION — THE FALLBACK NEVER FIRED

The claim that `connectorService.ts:632` fabricated a grant from the manifest is **corrected**. The signature does
not match: `manifest.oauth.scopes` is **22** entries; r3 stored **21** — *the same list minus `offline_access`*.
Microsoft consumes `offline_access` to mint a refresh token and does not echo it in the granted `scope` claim, so
**the stored set is the fingerprint of a real token response.** Had the fallback fired, the stored set would equal
the manifest exactly, `offline_access` included.

**So `tokens.scopes` was non-empty, the fallback did not fire, and the panel displays genuinely granted scopes.**
The 21-vs-7 discrepancy is **manifest over-request** — the already-recorded F-1 / F-N16-5 minimization item — not
storage fabrication. The fail-open branch is real and **latent**, one provider behaviour away from firing.

*Method note, recorded as the night's own lesson: a discrepancy was observed and the code path capable of
producing it was reached for, without first checking whether that path's SIGNATURE matched. The `offline_access`
delta is the signature, and it exonerated the code.*

### §6.4 · CORRECTED PROGRAMME ORDER — P4 IS A PRECONDITION FOR P1, NOT ITS SUCCESSOR

> **P0 → P4-MIN → DIAGNOSTIC RE-RUN → P1 → P2 → P3 → P4-FULL → P5 ceremony → read-back → verification**

**P1 cannot be localized without the evidence P4 produces.** The A/B question was unanswerable *precisely because
refusals leave no trace*. P1-before-P4 buys another archaeology round; P4-before-P1 lets a diagnostic re-run answer
P1 in ninety seconds. The split mirrors P0's:

- **P4-MIN** — the propose path emits on refusal. One emitter, or un-gate the existing DEV refusal surface.
  Decision-neutral, no type change.
- **P4-FULL** — the three-record model, a design slice with its own gate.

**F-P24's future model (adopted):** GOVERNANCE (`ALLOW/ASK/DENY/HOLD`) separate from EXECUTION
(`NOT_STARTED/STARTED/COMPLETED/FAILED`) separate from VERIFICATION. A DENY becomes fully auditable as
`governance=DENY, execution=NOT_STARTED, verification=NOT_APPLICABLE`, and **must never be converted into
`execution_failed`.** **BINDING CAVEAT:** the VERIFICATION third is **RECONCILED against D-16's
`verificationTerminals.ts` single authority and NP-018's `Certainty` set (which includes `STALE`, absent from the
advisory's three values) — never minted alongside.**

### §6.5 · STANDING LAWS ADDED BY THIS INVESTIGATION

- **Never promote a plausible explanation into a localized failure** until the causal episode and evidence
  identity establish the connection.
- **RUN A ≠ RUN B UNLESS THE EVIDENCE CHAIN ESTABLISHES THEIR RELATIONSHIP.** No longer theoretical — this
  investigation is the proof.
- **INSTRUMENTED SILENCE IS EVIDENCE; UNINSTRUMENTED SILENCE IS NOT.** Before reasoning about silence on any path,
  establish whether that path is instrumented.
- **UNLOCATED ABSENCE IS NOT EVIDENCE.** Absence of a key proves nothing unless the store is known to write it.
- **AN UNRESOLVED CONTRADICTION IS A FINDING, NOT A DEFECT TO BE SMOOTHED.** Do not repair either side to make them
  agree. Pairs with the vacuous-green rule: one forbids a test that cannot fail, the other a story that cannot be
  wrong.
- **EXPECTED ≠ CORRECT.** A governance system that mints no record when it refuses is behaving as built, not
  behaving correctly.
- **A STATED PRECONDITION WITHOUT A CHECK IS NOT A PRECONDITION.** (F-P13.)
- **I READ A PARTIAL ENUMERATION AS AN EXHAUSTIVE ONE** — recorded by the operator as their own, alongside
  premise-dropping in transit, as the failure family behind six mislocalizations in one sitting.
- **Do not make NeuroPause appear more complete.** Make each boundary truthful, causally attributable,
  independently testable, and explicit about what remains unknown.

### §6.6 · FINDINGS-WITHOUT-A-LANE REGISTER (standing — these evaporate between rounds otherwise)

| ID | Finding | Why it has no lane |
|---|---|---|
| **F-P13** | The FG-4 latch is **per-profile**; a second instance on another profile carries its own absent one. Two instances ran 20 hours; an 18:19 Confirm in the r2 window would have sent for real. **The process-list check becomes a step-1 VERIFIED ceremony gate, equal in standing to the seed line.** | Ceremony protocol, not a P-slot |
| **F-P19** | `capabilityProposeIpc.ts:48-52` narrows `AuthStatus` with a bare ternary whose else-branch swallows `'local'` — a **CLAUDE §4 standing-rule violation**, an unlabelled deny. **Triggers a §2/§4/§5 ENFORCEMENT AUDIT: which rules have enforcement and which are prose.** | Cross-cutting; the audit has no owner |
| **FULL-LOCAL DIRECTIVE** | Local-first means the whole stack, not only the desktop. **Recorded, not designed.** | No slice exists |
| **TWO READS NEVER RUN** | (a) what the runtime supervisor's `subsystem:"backend"` probe actually CHECKS; (b) what **S18** is in §5. **Until both land, nobody says anything further about the backend's state.** | Blocking a claim, not a defect |

**F-P23** files as an instance of **F-P24**. **F-P21** files against **P5** and the proof standard.
