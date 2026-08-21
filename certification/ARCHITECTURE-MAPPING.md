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

> **THE REGISTER IN GATE-READY FORM IS `certification/CONTROL-REGISTER.md`.** §5–§13 below are the NARRATIVE
> record — how each finding was established. The register is the four-class sort, the finding↔law linkage and the
> enforcement column. Entries were moved, not rewritten.

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

> **THE PREFIX `D-` IS RESERVED FOR DECISIONS, AND DIMENSIONS ARE `DIM-`.** `DECISIONS.md` carries **D-1…D-16**
> as decisions. Any dimensional axis is named **DIM-1…DIM-n**, never `D-anything` — "D-9 the decision" and
> "D9 Governance the dimension" would collide inside the register that is being made load-bearing.
> **SEVENTH COLLISION.** The collision list is the most reliable predictor of error this programme has:
> GRANTED/TENANT scope · GOVERNED/PRODUCT draft · MODULE/CAPABILITY certified · declared-vs-reachable ·
> source-vs-build · "Open connectors" · and now DECISION/DIMENSION.

> **THE BARE WORD "DRAFT" IS BANNED** alongside "scope". Two paths share it — **GOVERNED DRAFT**
> (`referenceDrafter` → Proposal/BrainReview → governance) and **PRODUCT DRAFT** (`aiEngine`/Ollama → editable
> draft → human composition) — and one closed claim already straddled the collision. That is F-P8. Always
> GOVERNED DRAFT or PRODUCT DRAFT.

> **THE BARE WORD "SCOPE" IS BANNED** in reports, rulings, log lines, pin names and commit messages. Always
> GRANTED SCOPE or TENANT SCOPE. This is the REACHABILITY family's own lesson — *a declared thing and a reachable
> thing were allowed to share one name* — turned back on our own vocabulary. **No renames in source were made when
> this rule was adopted;** it governs documents and new code first, and any source rename is its own presented slice.

> **THE BARE WORD "FINGERPRINT" IS BANNED — EIGHTH COLLISION.** (Operator ruling D2, 21 Aug 2026.) Two functions
> named `fingerprint` exist, **with different codomains and different jobs**, and the collision is what made F-P39
> look like a one-line fix for a day:
>
> | Term | Is | Lives in | Job |
> |---|---|---|---|
> | **RECORD-FINGERPRINT** | `sha256(normalized).slice(0,16)` — **one-way hex** | `connectors/actionRecord.ts:186-189` | **TAMPER-EVIDENCE.** Proves a stored row was not altered, while guaranteeing the evidence file holds **no subject or body text** (pinned: `actionRecord.test.ts:86-87,92-94`) |
> | **MATCH-KEY** | `lowercase → collapse whitespace → trim` — **comparable plaintext** | `verification/verifyEffect.ts:80-82` | **COMPARISON.** Lets an observed provider row be tested against a target |
>
> **THE CLASSIFICATION, RULED: this is NOT a divergence and must NOT be normalized.** Two different jobs wearing
> one word. **The record's one-wayness is evidence FOR that reading, not a defect to fix** — it is deliberate,
> pinned, and load-bearing for the privacy property of the evidence store. Neither side is weakened to make a
> match possible. *Consistent with F-N16-4's disposition: two mechanisms at two layers are DESCRIPTIVE, not
> CONFLICTING.*
>
> **The consequence, stated plainly rather than engineered around:** a comparison driven from the evidence store
> must be performed **in the RECORD-FINGERPRINT codomain** (hash the observation, compare hashes) — never by
> teaching the record to store comparable plaintext. **Where that is not available, SUBJECT IS NOT A LIMB, and
> the corroboration is honestly weaker rather than falsely complete.**
>
> Collision list, now eight: GRANTED/TENANT scope · GOVERNED/PRODUCT draft · MODULE/CAPABILITY certified ·
> declared-vs-reachable · source-vs-build · "Open connectors" · DECISION/DIMENSION · **RECORD-FINGERPRINT/MATCH-KEY**.

> **THE `D-` PREFIX, RE-COLLIDED — NINTH COLLISION (operator, 21 Aug 2026).** A directive labelled its five
> rulings **D1…D5** while `DECISIONS.md` already held **D-1…D-16**, tracked and cited, on entirely unrelated
> subjects (D-1 freeze baseline · D-9 Slice-15 pre-flight · D-16 verification-terminal vocabulary). Renamed at
> source to **F-P39-R1 … F-P39-R5**.
>
> **The provenance is the point, and the operator recorded it against himself:** the collision was made *in the
> directive that banned the bare word "fingerprint" for being the eighth.* §5.0 already carried the reserved-`D-`
> rule (DECISION/DIMENSION, seventh collision) and it did not prevent this. **The programme's most reliable
> source of error is its own vocabulary, and it re-proved that while ruling about it.**
>
> Rule restated with teeth: **`D-` is reserved for `DECISIONS.md` entries. A new ruling set takes a namespaced
> prefix tied to its finding (`F-P39-R1`), never a bare `D-N`.** Dimensions remain `DIM-*`.

> **A GOVERNANCE APPARATUS CAN BE CONJURED ENTIRELY IN CONVERSATION AND THEN CITED AS THOUGH IT CONSTRAINS.**
> (Operator, 21 Aug 2026.) **THREE** such registers were cited as binding within one session and **none existed
> in the repository**: `D-ART-01…20` (0 hits before a packet created that day), `PHASE 1D / PHASE 1E` (0 hits,
> ever), and a `D-1…D-9` set whose subjects — `command-center.html`, `approval-guard`, `observations.source`,
> `evidence.verdict`, `AssuranceVerdict` — resolve to **0 files each**.
>
> The failure mode is not that a register is *wrong*; it is that **a register with no repository referent cannot
> be falsified**, so citing it feels like constraint while imposing none. Sibling of §2 #17 (*pin against the
> real path*) at the governance layer: **cite against the real corpus, not a convenient one.**
> **TEST:** before a register constrains anything, `grep` it. Zero hits ⇒ it is a proposal, not a constraint.
>
> **PERG corpus (`docs/governance/`, 14 files, 24 Jul, all TRACKED):** referenced by **zero** of the five control
> documents. **TRACKED ≠ REFERENCED ≠ AUTHORITATIVE.** `EXECUTIVE-GOVERNANCE.md §4` defines a real ADR structure
> (`PERG-ADR-NNN`; immutable once Accepted; *"an ADR with no cited evidence is not accepted"*; owner is a role,
> never a person) that **has never been used** — its three rules independently restate §2 #5 and the `f309451`
> ruling. **OPERATOR RULING: ADOPT THE ADR DISCIPLINE, NOT NECESSARILY THE CORPUS.** The home question stays open.
> **`RELEASE-GOVERNANCE.md` carries two findings in one document:** its scope section claims *"only `1.0.0-rc.1`
> has shipped"* while tags `v1.0.0-rc.2…rc.20` exist (**F-P33's shape** — a stale anchor read as current), and it
> "elevates" `RELEASE-CHECKLIST.md`, which is **ABSENT** (**F-P27's shape** — a procedure that exists only by
> reference). **F-P39's relation to artifact provenance is UNREGISTERED, not parallel** — "parallel" was a word
> the source did not support, and the correction is the operator's, accepted.

### §5.0b · SET-LEVEL PROPERTIES REQUIRE SET-LEVEL TESTS

> **A PROPERTY THAT HOLDS OF EVERY MEMBER NEED NOT HOLD OF THE SET. INDIVIDUALLY-GREEN PINS ARE NOT EVIDENCE
> ABOUT THE COLLECTION THEY BELONG TO.**

**THE WORKED EXAMPLE IS F-P24**, and it is worth stating in full because every part of it was working as designed:

- the FG-4 guard **correctly** refused the 18:19 send;
- it refuses **before** the executor, so the S34a observer **correctly** never ran;
- the observer is fed by one gated line in `connectors/index.ts` that **correctly** only fires on the send path;
- `capabilityProposeCore` emits nothing, **correctly**, because it is a pure data-in/data-out core;
- the renderer's typed refusal surface sits inside the DEV block, **as its authors placed it**;
- `runtimeTelemetry` logs its probe reason at `debug`, **a defensible level for a per-15s poll**.

**Six mechanisms. Not one of them is defective on its own terms.** Every per-mechanism review passes. And the
aggregate is a governance system that **cannot prove it refused** — no evidence row, no log line, no on-screen
explanation, for a refusal that genuinely happened.

**No per-mechanism test could ever have found it**, because each mechanism satisfies its own contract. The
question that finds it is asked of the *set*: *given a governed refusal, what does this system retain?* That query
has no owner in a per-change discipline, and it is exactly the shape the read-only IPC class's review trigger is
built to force (§ the proposal's review trigger: the two pins must be green **as a set**, because a set-level
query can fail while every individual pin passes).

**Corollary for how findings are counted:** an aggregate defect has no single site, so it will not appear in any
file's review and cannot be assigned to any one commit. It is found only by asking a question no component owns.

### §5.0c · THE REGISTER'S MODEL — WHAT A FINDING *IS*

Nothing in the repo has ever stated this, and the register cannot be load-bearing without it:

> **CONSTITUTION → REQUIREMENT → IMPLEMENTATION → OBSERVATION → FINDING → CORRECTION → VERIFICATION → CLOSED**

**A FINDING IS THE GAP BETWEEN A LAW AND AN IMPLEMENTATION, MADE VISIBLE BY AN OBSERVATION.** It is not a bug
report and not an opinion: it is the named distance between what the constitution requires and what the code does,
evidenced. Which is why every finding must name the law it violates — a finding that names none is either a
**missing law** or **not a finding at all**.

**WORKED EXAMPLE — F-P9:**

| stage | value |
|---|---|
| CONSTITUTION | *correlation is for evidence, never for authorization* — and the proof standard's one-run-id requirement |
| REQUIREMENT | one identity correlates a log line to the run that produced it |
| IMPLEMENTATION | the assistant mints `correlationId`; **the handoff carries `{to, subject, body}` and drops it** |
| OBSERVATION | the 20 Aug sitting could not tie the 12:44:16 stash to any particular mount |
| FINDING | **F-P9** — the record carries two clocks under one set of numbers and no run id |
| CORRECTION | *not taken* — propagation candidate, never a minted id |
| VERIFICATION | *pending* |
| STATUS | **OPEN** |

The chain also says what CLOSED means: **a correction that has been verified**, not a correction that has been
applied. F-P33 is closed because the header was repaired *and* the recurrence rule pins it; F-P35 is closed as
ENVIRONMENT-SPECIFIC because four reproductions failed, which is a verification of a negative rather than of a fix.

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

## §7 · P0 AND P4-MIN LANDED · P1 AWAITING CONTROLLED REPRODUCTION (20 Aug 2026)

### §7.1 · P0 — THE CLOSING STATEMENT (adopted verbatim; supersedes any r3-incident framing)

> **"The latent fail-open scope fallback has been removed from the connection path. The r3 ceremony did not
> demonstrate that this defect was exercised. The current implementation fails closed when the provider supplies
> no usable scope list, while the distinction between UNKNOWN and genuinely empty grant remains unresolved under
> FG-13."**

Bracket: INTACT #1 (`b0d8b55`) → checkpoint `0879b7a` → **isolated P0 `8076598`** → re-record → INTACT #2
(`BASELINE-e92649b5fa1f`) → `43874e3`. Adversarial mutation PROVEN: fallback restored → 2 failed; reverted → 6
passed.

### §7.2 · P4-MIN — ADMITTED ON MERIT, NOT ON ROI

**THE ADMISSION REASON IS F-P24:** a governance system that cannot prove its refusals is unauditable **as
governance**. The investigative benefit is a **CONSEQUENCE, not a REASON**.

> **SCOPE OF THE PRINCIPLE (operator clarification, so it does not become a blanket brake):** an instrumental
> justification is disqualifying for **BEHAVIOUR CHANGES**. **Characterization pins are exempt — they change
> nothing.**

Landed as `log.warn(\`propose refused — ${response.reason}\`)`, **REASON ONLY**. The `detail` enumeration ordered
before the change is why:

| Reason | `detail` source | Untrusted content? |
|---|---|---|
| `PRINCIPAL_UNRESOLVED` | `principal.reason` — `'NOT_AUTHENTICATED' \| 'NO_TENANT'` | No — closed literal |
| `CAPABILITY_NOT_SELECTED` | `binding.status` — selection-outcome literal | No — closed literal |
| `UNSUPPORTED_ACTION` | `` `${binding.executor}:${binding.actionId}` `` — registry-derived | No |
| **`INVALID_PARAMS`** | `review.detail` — 8 variants | **YES — two interpolate a RECIPIENT ADDRESS** (`m365ActionProposal.ts:99,101`, `addr.slice(0,60)`); a third carries an untrusted parameter key |

And `redactCredentialText` would **not** protect it: NP-013 scoped it to credentials and **pinned that an email
shape survives** (round-31 W-7). So the requirement became a finding, and the emitter logs no `detail` at all.

Bracket kept **separate from P0's** — forensically, so the record preserves the distinction between **the
authority-integrity correction** and **the diagnostic instrumentation introduced to localize P1**.

### §7.3 · THE BUILD BOUNDARY (Pin D, 5 → 6)

**The preserved 20 Aug log was produced by a FIVE-emitter build.** Historical negatives about the 12:44–12:49Z
window stand under the **old** map and are NOT re-derived by the flip; only **forward** negatives use the new one.
From this build on, silence at the propose boundary means "no refusal occurred" — which it did **not** mean on 20
August. **Comment-blindness retro-check, run before the flip: raw 5, code-only 5 — UNCHANGED.**

### §7.4 · ADDED TO THE NON-EQUIVALENCE FAMILY

> **REFUSAL OBSERVED ≠ GOVERNANCE CORRECTNESS ≠ EXECUTION ≠ EXTERNAL EFFECT ≠ VERIFICATION**

The P4 emitter can establish that a refusal **occurred**. It cannot establish that the refusal was **correct**, and
it certainly cannot establish that the external world **changed**.

> **MODEL OUTPUT ≠ BRAIN PROPOSAL ≠ BRAIN REVIEW ≠ AUTHORIZATION** — filed here too, as non-equivalences, never
> staged as a pipeline. **A NON-EQUIVALENCE IS NOT A PIPELINE**: staging it invites "we are at stage 3, nearly
> there" reasoning about authority, which is the exact failure the family exists to prevent. **Family A is held as
> non-equivalences until its vocabulary stops moving.**

### §7.5 · P1 IS NOT AN INVESTIGATION

> **P1 = AWAITING CONTROLLED REPRODUCTION.**

The historical A/B event is **CLOSED AS UNKNOWN and is not reopened**; only the **mechanism** question is
scheduled. The word "investigation" invites more archaeology, which is exactly what was capped.

**Required phrasing, verbatim, in every report:** *"A silent unresolved-TENANT-SCOPE branch EXISTS and is CAPABLE
of producing the observed result, but the ceremony evidence does not establish that it occurred."*

### §7.6 · THE REPRODUCTION — PRE-REGISTERED NOW, RUN LATER, **NOT AUTHORIZED**

**Decision tree, declared before the run:**
```
DID A PROPOSAL ATTEMPT OCCUR?
  ├── NO  → investigate handoff / navigation
  └── YES
       ├── refusal emitted → record the exact reason
       └── success emitted → follow the artifact / review path
```
**Fifth row, which has paid off every time:** anything bearing on something else is recorded as **its own finding**,
never forced into the tree.

**SAFETY CONFIGURATION — the gap F-P13 names, closed before the run rather than after.** A reproduction plan with
no device-level protection is protected by discipline, and **discipline failed on 20 August**:

1. **Quit r2 AND r3, VERIFIED BY PROCESS LIST** — F-P13's gate, applied for the first time rather than recorded.
2. **PRE-ARM THE LATCH** — create `first-real-send.latch` in the new profile **before launching**. FG-4 checks
   `existsSync` and returns *before* the `writeFileSync`, so a pre-placed latch makes any send refuse and is not
   rewritten by the attempt.
3. **REBUILD FIRST** — r3 runs the 16:12 build and P4-MIN's emitter does not exist in it.
4. **HARD STOP before Send.**

### §7.7 · F-P25 — RECORDED, NOT FIXED

`verify-freeze.sh` **conflates "a frozen surface changed" with "the baseline is behind HEAD."** `ANCESTRY OK` is
computed, named, and then **flattened at the message** — the same **COMPUTED-NAMED-DISCARDED** shape as
`resolveFull`. **An alarm that fires identically for a violation and for a routine step is not an alarm.** It fired
`FREEZE BROKEN` during the P0 bracket for the routine reason. Fix direction noted, not taken.

## §8 · F-P26, F-P27, AND THE 22:18 REBUILD (20 Aug 2026, unattended)

### §8.1 · F-P26 — A REDACTOR'S GUARANTEE IS BOUNDED BY WHAT ITS PINS PRESERVE

> **THE CREDENTIAL REDACTOR IS PINNED TO PRESERVE EMAIL SHAPES, SO IT IS NOT A PII REDACTOR AND MUST NEVER BE
> CITED AS ONE.**
>
> **CITING A REDACTOR WITHOUT CITING ITS PINS IS A FALSE ASSURANCE.** Relying on `redactCredentialText` for the
> P4-MIN emitter would have leaked recipient addresses **while looking protected** — worse than no redactor,
> because it buys a false sense of coverage.

**THE AUDIT (read-only, ordered by the operator). The result is not a list of sites — it is a choke point:**

| Site | Reach | Guarantee |
|---|---|---|
| `logger.ts:147-148` (`emit`) | **EVERY log call in the main process**, message *and* payload, before **both** console and file sink | credentials only |
| `connectors/metadataCredentialGuard.ts:41,43` | connector metadata at **both `connectorStore` doors — persisted to `connectors.json` on disk** | credentials only |

**So the guarantee is UNIVERSAL IN REACH AND NARROW IN KIND**: every logged string and every persisted connector
metadata string is credential-safe and **PII-unsafe**, and nothing in the codebase distinguishes those two claims.
The bound is explicit and deliberate — `logger.redaction.test.ts` pins that `12@example.com` **must SURVIVE** (the
round-31 W-7 predicate), and NP-013's record notes the account **email label survives, pinned**. Recorded; nothing
fixed.

**DESIGN DIRECTION, so nobody later "fixes" this by adding `detail` back:**

> **PREFER A CLOSED-SET DISCRIMINANT OVER A REDACTED FREE-TEXT FIELD.** Emit *which* `INVALID_PARAMS` variant
> fired — never the interpolated value. Redacting free text is fragile, as F-P26 proves; a closed set is
> structurally safe. **That is P4-FULL, not now.**

**AND IT RE-PRICES OPTION A.** The recipient-carrying `detail` **already crosses IPC and sits in renderer state**;
it renders nowhere *only* because the refusal surface is inside the DEV gate. **Moving that closing tag would put
recipient addresses on a production screen.** Option A is not "zero new code, zero risk" — it inherits the exact
PII question the emitter just failed, and now needs the same enumeration plus a ruling on what the surface may
display, **on top of** its §4 UI-truth tests. Its envelope is updated accordingly and it stays deferred.

### §8.2 · THE WORKED EXAMPLE — ASSERTION IS NOT ESTABLISHMENT

The advisory **asserted** "no sensitive payload" as a requirement. The first P4-MIN envelope **asserted** `detail`
was safe because it already crossed IPC. **Both assertions were wrong. Only the enumeration found the leak.**
Cite this whenever the enumerate-before-asserting rule needs defending.

### §8.3 · F-P27 — THE CEREMONY RUNBOOK EXISTS IN NO FILE

The "nine steps" referenced across several directives were **presented in-session and never committed**. A
repo-wide search finds **no runbook file and no `OPERATOR-ACTION` marker anywhere in `certification/`**. So the
ceremony's own procedure lives only in transcript — unversioned, unreviewable, and impossible to pin against the
artifact. **This is the F-P10 family with the document missing entirely rather than merely describing the wrong
thing.** `P1-REPRODUCTION-RUNBOOK.md` is the first ceremony-class procedure committed as a file. No nine-check
list was invented to fill the gap.

### §8.4 · THE 22:18 REBUILD — VERIFIED BY CONTENT

`NP_E2E_BUILD=1 npx electron-vite build`. INTACT before and after; git tree clean throughout (a build is not a
source change).

**CUSTODY FIRST, unprompted and worth stating:** the 16:12 build **is the artifact that produced the preserved
20 Aug log**, and rebuilding overwrites it. It was snapshotted before the rebuild —
`~/NeuroPause-S54-r3-evidence/artifact-1612/`, **87 files**, manifest sha256 `d6e3a948…0fcae96`. The provenance
chain from log to binary survives.

| | 16:12 | 22:18 |
|---|---|---|
| `main/index.js` sha256 | `5c79aac8…3b1ffda` (6,581,330 b) | `ee5e8e99…0e138c0` (6,583,130 b) |
| P4-MIN emitter (`propose refused`) | **absent (0)** | **present (1)** |
| seed sentinel (`installE2eSeedPrincipal`) | 2 | 2 |
| seed chunk | `e2eSeed-NKS_iH8j.js` | `e2eSeed-NKS_iH8j.js` |
| seed chunk sha256 | `a54bc5b2…daf29` | **`a54bc5b2…daf29` — IDENTICAL** |

> **THE SEED CHUNK DID NOT CHANGE, AND §1 NEEDS NO CORRECTION THIS TIME.** The prediction was that it would change
> again; the artifact says otherwise, because a content-hashed chunk name is a hash of **that chunk's** content and
> the seed module did not change. This is verification-by-content producing the *opposite* of the expected answer —
> which is the whole reason the rule exists. Recorded rather than assumed in either direction.

## §9 · F-P27 REACHES BACKWARDS · F-P28 · AND TWO WORKED EXAMPLES (20 Aug 2026)

### §9.1 · F-P27's DEEPER FORM — AND WHAT IT INVALIDATES RETROSPECTIVELY

> **A document that describes the repository is not a document that describes the artifact — and A PROCEDURE THAT
> EXISTS ONLY IN TRANSCRIPT IS NOT A DOCUMENT AT ALL.** It cannot be versioned, diffed, pinned or reviewed.

**IT REACHES BACKWARDS.** Every ruling made during the 20 Aug sitting about *"the runbook says X"* — **R3 ruled
twice**, the DEV-gate contradiction, *"corrected post-ceremony only"* — was a ruling about **a recollection of a
conversation, not a document.** The "nine steps" never existed as a file.

**The governing law was already on the books: RECORD SUPERSEDES RECOLLECTION.** It was applied to a
`bodyFingerprint` (R5) and **never once to the procedure itself.** The strictness was aimed at the evidence and
not at the instrument used to gather it.

`certification/P1-REPRODUCTION-RUNBOOK.md` is the **first ceremony-class procedure ever committed as a file** in
this programme. No nine-check list was fabricated to fill the gap — a plausible invented list would have looked
authoritative and been fiction.

### §9.2 · F-P28 — THE EVIDENCE PACKS HAVE NO DISCLOSURE CLASSIFICATION

F-P26 established that the single redactor is **universal in reach and narrow in kind**. The step the audit did
not take:

> **THE EVIDENCE PACKS INHERIT THAT PII-UNSAFETY AND CARRY NO DISCLOSURE CLASSIFICATION.**

| Pack | Files | Contains, at minimum |
|---|---|---|
| `snapshot-r3/` | 95 | account email (connector label), connector state, granted scopes, action records, assistant conversation text incl. **recipient addresses** in stored `mailIntent` |
| `snapshot-r2/` | 96 | same classes, pre-16:12 binary's profile |
| `artifact-1612/` | 87 | compiled binary; no user data, but it is the **provenance anchor** for the above |

They have been handled all evening as **neutral, shareable artifacts** — quoted from, hashed, and discussed as if
disclosure-free. **Any future decision to attach one to a report or hand one to an advisor discloses whatever is
in it**, and the stored `mailIntent` objects are known to carry `to: ['neuropause033@gmail.com']` verbatim.

**Classification recorded, nothing fixed:** these are **OPERATOR-PRIVATE**. They may be hashed, cited by manifest,
and reasoned about; **they are not attachable without a disclosure decision by the operator.** This is a custody
question, not a code one.

### §9.3 · WORKED EXAMPLE — ASSERTION IS NOT ESTABLISHMENT *(see also §8.2)*

The advisory **asserted** "no sensitive payload." The first P4-MIN envelope **asserted** `detail` was safe because
it already crossed IPC. **Both were wrong; only the enumeration found the leak.**

### §9.4 · WORKED EXAMPLE — A PRE-REGISTERED INSTRUCTION MUST NOT ASSUME ITS OWN RESULT

The rebuild instruction read: *"report the seed-chunk hash — **it will change again**, and §1 must be corrected in
the same pass."*

> **THAT IS AN INSTRUCTION WITH THE ANSWER BAKED IN.** The correct form is *"verify the hash and correct §1 **IF**
> it changed."*

The hash did **not** change (`a54bc5b2…daf29`, identical across both builds) because a content-hashed chunk name
hashes *that chunk's* content and the seed module was untouched. **§1 was left uncorrected because it was still
accurate.** Recorded by the operator as their own error, and as a small instance of the failure the whole sitting
fought: *a pre-registration that assumes its result is not a pre-registration.*

### §9.5 · P4-MIN-b — QUEUED, WITH ITS SCOPE FAULT NAMED

An emitter at `brainProposeLane:81` is admissible on **exactly** the same F-P24 merit as P4-MIN: a refusal must be
observable, `:81` **is** a refusal, and a warn changes what is RECORDED not what is DECIDED — so it is **not** the
lane repair the failure-first rule forbids.

> **Which means P4-MIN's scope was drawn at "one emitter" rather than at "no refusal on this path is silent" —
> and that is A SCOPE DRAWN BY CONVENIENCE**, the same fault correctly named in the admission reasoning,
> reappearing in the scoping. Recorded by the operator as theirs.

**Held anyway, for a defensible reason: the reproduction's observation surface must not change again before the
run**, and the resolver already covers that branch (uncorrelated — §9's Amendment 2). **P4-MIN-b lands AFTER the
reproduction.**

**NO FURTHER CODE CHANGE BEFORE THE RUN** — not the `:81` emitter, not Option A, not F-P25's exit states, not the
closed-set discriminant.

## §10 · ATTEMPT 1 — A CLOSED RECORD AGAINST `f309451` (20 Aug 2026)

**`f309451` IS NOT EDITED.** The corrected procedure is a **new file**, `P1-REPRODUCTION-RUNBOOK-v2.md`.

```
f309451 → attempt 1 → §1.1 FAILED → F-P29 → STOP
        → AMENDMENT → NEW COMMITTED RUNBOOK (v2) → attempt 2
```

> **A RECORD OF WHAT WAS DONE MUST POINT AT THE DOCUMENT AS IT WAS, NOT AS IT BECAME.** F-P27's lesson applied to
> ourselves: editing the procedure after its gate failed would contaminate the record of the attempt that failed.

### §10.1 · ATTEMPT 1 — WHAT HAPPENED

Executed §1.1 verbatim. `ps aux | grep -c` printed **5**, then 4. **STOPPED, as instructed** — no latch pre-arm,
no content verification, no launch, no navigation. **The decision tree was never reached.**

Enumeration showed **r2's main killed successfully**, **r3's main (PID 92727, started 17:38:36) surviving**, and
**three helpers respawned at 22:32:26 — after the kill.**

### §10.2 · F-P29 — PROCESS-IDENTITY GATE AMBIGUITY

The §1.1 assertion counts Electron **helper** processes as well as the NeuroPause-S54 **main**, so a non-zero
result does not establish that a main survives, while a transient helper population makes the gate unstable. **The
gate must identify and count ONLY mains, excluding `--type=` helpers, and require an exact zero.**

**THE PRECISION THAT TRAVELS WITH IT:** F-P29 does **not** say the runbook was unsafe in outcome. It says the
**predicate was insufficiently discriminating**. The gate **failed safely** — a main was in fact still alive.
**IMPRECISE AND CORRECT.**

**The sharpening (operator):** the predicate **cannot produce a false negative** — a main is always counted — so
it produces **only false positives**, and **FALSE POSITIVES ON A SAFETY GATE ARE DANGEROUS THROUGH HABITUATION,
NOT THROUGH LOGIC.**

> **LAW: A SAFETY GATE MUST TEST THE EXACT DANGEROUS STATE, NOT MERELY A CORRELATED PROCESS SIGNATURE.**
> Filed with **THE INSTRUMENT IS PART OF THE SYSTEM UNDER TEST** — the specific form and the general form together.

### §10.3 · F-P30 — THE SHUTDOWN COMPLETED AND THE PROCESS DID NOT EXIT

Established **from the log, not from a second attempt** — the pre-registration (item 1) was answered by an
observation that already existed. `logs/app.log`, r3:

```
17:02:26.841Z ERROR (crash-reporter) Crash captured {"category":"plugin","kind":"child-process-gone","message":"killed"}
17:02:26.846Z ERROR (crash-reporter) Crash captured {"category":"renderer","kind":"render-process-gone","message":"killed"}
17:02:27.341Z INFO  (main) Shutdown flush complete {"ran":7,"failed":[],"timedOut":[],"durationMs":2}
17:02:58.994Z INFO  (runtime-supervisor) recovery attempt …          ← 31s later, normal operation resumes
…continues to 17:08:59.333Z, then silence
```

**SIGTERM killed the helpers; the main entered `will-quit`, ran all seven flushes cleanly in 2ms, logged the
summary, called `app.quit()` — and kept running supervisor timers for ~6.5 minutes before exiting.** It left
orphaned helpers that outlived it briefly. No second `Shutdown flush` line exists.

**PRE-REGISTERED OBSERVABLE, now confirmed:** the artifact that shows the barrier ran is
`INFO (main) Shutdown flush complete {ran, failed, timedOut, durationMs}` in `logs/app.log`, emitted on the clean
path and as `WARN … completed with losses` on the lossy one (`index.ts:286-290`). Seven flushes are registered:
`app-log`, `org-store`, `workspace-store`, `governance-store`, `enterprise-module-stores`, `platform-timeline`,
`workspace-contexts`.

**THE LATCHED-BARRIER DEFECT that rides with F-P30:** `index.ts:280-282` sets `shutdownFlushed = true` after the
first pass and `will-quit` early-returns thereafter — **so a second quit issued in that window flushes nothing.**
Snapshot *before* any further quit, not after.

**OUTCOME NOT IN THE PRE-REGISTERED SET, recorded under the fifth row rather than forced into a branch:** the
result was neither `MAIN_COUNT = 0` (clean exit) nor a persistent `MAIN_COUNT = 1` requiring escalation. It was a
**DELAYED EXIT** — ~6.5 minutes, unattended, with no operator close and no SIGKILL. **The operator's step 3 became
moot: there was nothing left to close.**

### §10.4 · A LABEL OF MINE, CORRECTED BY EVIDENCE

The 22:40:47 profile capture was recorded as a **LIVE-MUTATING CAPTURE**, conservatively, on the assumption the
main was still alive. A post-exit snapshot taken afterwards produced a **byte-identical manifest**
(`52f64db2…5bfe5f1`, 101 files both times), so **the process had already exited and the capture was clean, not
live-mutating.** The label is corrected rather than left standing — a conservative label that the evidence
contradicts is still a wrong label.

### §10.5 · STATE AT CLOSE

`MAIN_COUNT = 0`, independently observed with the **corrected mains-only assertion**. All NeuroPause-S54
processes, mains and helpers, have exited. Evidence preserved: `final-logs-before-quit/` (r3 159,218 b / 1,326
lines, sha `a67817ba…adfa56c`; r2 byte-identical to the 18:55 copy), `snapshot-r3-postexit/` + manifest, and the
earlier `snapshot-r3`, `snapshot-r2`, `artifact-1612` packs — all **OPERATOR-PRIVATE** per F-P28.

**Nothing proceeds to latch pre-arm, launch, navigation or reproduction.** Attempt 2 runs against **v2**, on the
operator's word, at a fresh sitting.

## §11 · F-P31 … F-P34, THE UNIFORMITY RULE, AND TWO UNRULED QUESTIONS (20 Aug 2026)

### §11.1 · F-P31 — THE SHUTDOWN FLUSH IS SPENT ONCE, INVISIBLY, AND THE COST IS DATA LOSS

**Distinct from F-P30** (which is the delayed exit) and recorded separately because its consequence differs.
`index.ts:280-282` latches `shutdownFlushed = true` after the first `will-quit` pass and early-returns
thereafter — **so a second quit flushes nothing, and says nothing.**

> **Same SPENT-ONCE shape as the FG-4 latch — but the FG-4 latch's spend is VISIBLE (a file on disk) and its
> consequence is a REFUSAL. This latch's spend is INVISIBLE and its consequence is DATA LOSS.**

Seven stores drain at that barrier (`app-log`, `org-store`, `workspace-store`, `governance-store`,
`enterprise-module-stores`, `platform-timeline`, `workspace-contexts`). Losing them silently is precisely the
defect P13C Round 37 Gate 16 built the barrier to fix. **Filed in the F-P24 family** — a governance system that
cannot prove what it did. Recorded, not fixed.

### §11.2 · HONEST LABELS, NOT SAFE LABELS

The 22:40:47 capture was labelled **LIVE-MUTATING** conservatively, on the assumption the main was still alive. A
post-exit snapshot produced a **byte-identical manifest**, so the capture was clean.

> **THE RULE IS SYMMETRIC.** This programme has guarded against optimistic claims from its first line — and this
> is **the first pessimistic one to be wrong.** A cautious label the evidence contradicts is still a wrong label,
> and it corrupts a record exactly as an optimistic one does. **Label what is established, in the direction the
> evidence points.**

### §11.3 · UNIFORMITY IS NOT CORROBORATION — the seventh instrument-defect instance

The FG-gate-doc sweep printed `*** NO FILE ***` for **all nine rows**. A zsh regex error had killed the loop body,
so every row failed identically. It nearly became the headline finding *"twelve gates closed, not one gate doc
exists"* — **which is false: gate docs exist** for FG-5/6/7/8/11/12 as named files plus FG-1/2/3/4/9/10 inside
their evidence docs.

> **WHEN EVERY ROW OF A SWEEP RETURNS THE SAME ANSWER, THAT IS AS LIKELY TO MEAN THE SWEEP IS BROKEN AS THAT THE
> ANSWER IS UNIFORM.**

Filed with **THE INSTRUMENT IS PART OF THE SYSTEM UNDER TEST** — seventh instance, joining `grep -c` returning 0
for a nonexistent path (Pin D), the comment-blind adversarial pin, the over-broad refresh-path regex, F-P29's
helper-counting gate, F-P25's flattened `ANCESTRY OK`, and `redactCredentialText` cited beyond its pins (F-P26).

### §11.4 · THE RECON FINDINGS *(numbering assigned by me — correct it if it diverges from your intent)*

**F-P32 — THE LEGACY DOCUMENT BLOCK. ESCALATED.** 24 `.md` files landed in ONE commit on 2026-08-07
(`feat(rc): Phase 8 Wave 5`), never touched since, predating the entire certification programme. The bounded
sweep of `NeuroPause_DueDiligence_Report.md` (203,080 b / 1,710 lines) returns **106 claim-verb hits — one per 16
lines** — with `certified` ×25, `proven` ×24, `complete` ×32, `verified` ×45, and language like *"Implemented,
uniformly real"*, *"Production readiness: High"*.

> **AND IT CARRIES A SIXTH NAMING COLLISION, on this programme's most load-bearing word.** It claims **"104
> certified modules"**, **"95 certified modules"**, **"20 certified modules"** — where *certified* means passing
> `moduleCertification.test.ts`, a registry-shape gate. The programme's own position is **ONE certified
> capability**. Both use the word. **MODULE-CERTIFIED ≠ CAPABILITY-CERTIFIED**, and a due-diligence reader has no
> way to tell them apart.
>
> Decisive corroboration that the two vocabularies never met: **`mail.send` appears 0 times and `read-back` 0
> times** in 203 KB. The document does not mention the one thing that is certified in this programme's sense.

**It reads as a capability brochure and gets its own slice.** Joins GRANTED/TENANT scope and GOVERNED/PRODUCT
draft in the REACHABILITY family's naming-collision set.

**F-P33 — CLAUDE §1's HEADER WAS STALE BY ~30 COMMITS.** It read HEAD `96609d4` / `BASELINE-43dfbe3ff6f7` while
actual HEAD was `db7caf3` and the baseline `6ae9696`. **The document that opens every session misstated where the
session starts.** REPAIRED, with the recurrence rule written into §1: the header is re-written in the same edit as
the narrative, and **`verify-freeze.sh` SUPERSEDES it** — if the two disagree, the script wins.

**F-P34 — `BLOCKERS.md` WAS A BLIND ENTRY POINT.** 1,430 bytes, two days stale, against ~34 findings — and the
session ritual reads it every time. **An entry point that is blind is worse than no entry point, because it is
trusted.** REPAIRED as an entry point that names the four ship-blocking items, the holds, and where the full
register lives.

### §11.5 · RECORDED, DELIBERATELY NOT RESOLVED

**TWO RULE SYSTEMS EXIST, AND WHICH IS AUTHORITATIVE ON DIVERGENCE IS UNRULED.** ARCHITECTURE-SPEC §53's
`RULE-001..012` carries **26 real pins** (`constitutionalInvariants.test.ts`); CLAUDE §2 carries **eighteen
non-negotiables**. They overlap without being congruent — RULE-007 ≈ §2 #15, RULE-003 ≈ §2 #8, RULE-006 ≈ §2
#9/#14, RULE-011 ≈ §2 #7. **The question is noted; it is not answered here.**

**THE ENFORCEMENT SHAPE (§2, eighteen rules):** ~**10 PINNED** (#6 #8 #9 #11 #12 #13 #14 #15 #17 #18) ·
**1 SCRIPT-enforced** (#1, via `gate-detector.sh` + `verify-freeze.sh` + `frozen-surfaces.json`) · ~**7 PROSE**
(#2 #3 #4 #5 #7* #10 #16). **§4's AuthStatus exhaustiveness is PROSE — proven so by F-P19**, and by our own ladder
sits at **DECLARED**, two rungs below where it has been treated. *Caveat: the sweep produced keyword CANDIDATES,
not verdicts; #7 is unverified and several hits were plainly false positives. Resolving each is severity-gate
work, not recon.*

**§2 #16 (PAYMENT ≠ AUTHORITY) IS PROSE, AND RAZORPAY IS LADDER RUNG 3.** Recorded as a **rung-3 precondition**:
the rule must gain enforcement before, not after, the first payment capability exists. It was canonized before any
Razorpay work deliberately — that foresight is wasted if the rule is still prose when the work arrives.

### §11.6 · THE MISSING-PROCEDURE SWEEP (F-P27 reciprocal)

| Referenced | File? |
|---|---|
| FG gate docs (§2 #1) | **EXIST** — see §11.3's correction |
| `ROADMAP-HORIZON`, `WORK_QUEUE`, `AUTONOMY`, OS-tracks amendment | **EXIST** |
| The ceremony runbook / "nine steps" | **NO FILE** — F-P27 |
| The ceremony launch sequence | **NO FILE** — its missing verification step *is* F-P13 |
| **Containment** | **NOW EXISTS** — `certification/CONTAINMENT-PROCEDURE.md`, predictive, with UNKNOWN steps named rather than invented |

**Two of the three missing procedures had already bitten us. The third was written before it could.**

## §12 · F-P35, THE LEVEL RE-DERIVATION, AND THE LIVE PROBE (21 Aug 2026)

### §12.1 · F-P35 — UNRECORDABLE, NOT DISCARDED. The fifth variant, and the worst.

The probe's catch does **not** collapse the reason. It computes it (`classifyProbeError`), stores it
(`lastProbeError`) and surfaces it (`reachability().lastError`). **It is the *log* that cannot survive:**

```js
this.lastProbeError = classifyProbeError(err);
log.debug('backend probe failed', { err: String(err) });   // the only log of the reason
```

`logger.ts:73` raises the console threshold to `info` under `NODE_ENV=production`, and `:156` gates the **file
sink at `>= info` UNCONDITIONALLY**. The r3 ceremony ran production. **The line reached neither sink.**

> **COMPUTED · NAMED · RETAINED · SURFACED — AND LOGGED AT A LEVEL THAT CANNOT BE RECORDED.** It is worse than
> the `resolveFull`/`scope()` shape precisely because **it looks instrumented.** A reader auditing the source
> finds a diagnostic and moves on.

**And a genuine discard rides inside it:** `classifyProbeError` returns **`null`** for anything unrecognised — a
`TypeError`, an absent `fetch`, a malformed URL — and **`null` is also the value the field holds when there was no
error at all.** The most interesting failure class is stored as indistinguishable from health. **Same conflation
shape as P0's `[]` (told-nothing vs granted-nothing) — NP-016's defect class, third instance.**

### §12.2 · PIN D RE-DERIVED BY LEVEL — **NO NEGATIVE IS VOID**

F-P35 voided an *assumption* Pin D rested on without asserting: it counted emitters without distinguishing
`debug` from `warn`/`info`. **An emitter at `debug` is not an emitter in the ceremony build.**

Re-derived: `capabilityProposeIpc` **warn, warn** · `brainProposeLane` **warn, warn, warn, info** · the other four
files **zero**. **Total 6, at debug: 0.**

> **Every negative resting on the emitter map HOLDS** — including the load-bearing one: the lane's success emitter
> `:166` is at **`info`**, reaches the file sink, and no second stash line exists anywhere in the preserved
> 470-line log.

Pin D now **asserts LEVEL, not presence**, plus a pin that the sink gate itself is still `>= info`, with the rule
in its docstring: **INSTRUMENTED SILENCE IS EVIDENCE ONLY IF THE INSTRUMENT CAN REACH THE SINK.** 17/17 green.

### §12.3 · THE LIVE PROBE — **ok:true. The failure was specific to r3.**

Observed rather than reconstructed, on throwaway profiles, mains-only gate zero before each launch, pointed at the
dev stack, artifact never rebuilt. **Three variants, ~100 s each:**

| Variant | Seed | Backend URL | Recovery attempts | Catalog |
|---|---|---|---|---|
| A | off | :4010 (dev) | **zero** | reachable, 20 apps |
| B | **on** (3 seed lines) | :4010 (dev) | **zero** | reachable |
| C — **the exact r3 configuration** | **on** | **default :4000 (prod)** | **zero** | reachable, **0 apps** |

The supervisor only logs when a subsystem is failing, so **zero lines = nothing failing.** **The r3 configuration
reproduced exactly does not reproduce the failure.** r3 logged 43 backend `ok:false` and zero `ok:true`; the same
build, same URL, same seed, same `NODE_ENV` now produces none. **Cause remains unestablished and is now known to
be environment-specific rather than structural.** Not fixed, as ruled.

*Incidental but decision-relevant: against **:4000 the catalog returns 0 apps**, against :4010 it returns 20 — the
prod database has no catalog data. That is a fact for the prod/dev ruling, not a defect.*

*Boundary note: `electron-vite` declares no `outDir`, so `npm run dev:desktop` would have written to `out/` and
overwritten the 22:18 ceremony artifact. **Dev-from-source was therefore substituted** with a run of the existing
artifact — which is the source built, carries P4-MIN, and is what attempt 2 will run. Artifact mtime and seed-chunk
sha256 verified byte-identical afterwards.*

### §12.4 · ADDED TO THE NON-EQUIVALENCE FAMILY

> **EVIDENCE IS NOT AUTHORITY.** From `draftOverdueReminder`'s own docstring: `mandate.to` is the operator's word,
> and the builder never derives a recipient from the fact, the party, or any record content. **A record showing an
> overdue invoice for customer X does not authorize emailing X.** It sits beside *memory is not permission*
> (§2 #15) and *payment is not authority* (§2 #16) as the same law over a third input.

### §12.5 · THE DECLARED-VS-BOUND TEMPLATE

The backend printed `${env.PUBLIC_BACKEND_URL} (port ${env.PORT})` — a **configured** value presented as an
observed fact, so a run on 4010 announced itself on 4000. **Correction to the earlier record: it was never
hardcoded**, and that distinction is the finding — a hardcoded string is a typo; a configured value presented as
an observation is the claim-language family.

> **TEMPLATE, for any process announcing itself: distinguish what it BOUND from what it was told to DECLARE**, and
> print the declaration only when the two disagree.

### §12.6 · ERP CLASSIFICATION (tier-2 vs ladder)

- **`draftOverdueReminder` — LADDER.** Returns a candidate carrying **`capabilityId: 'mail.send'`**. Governed
  action. Stays unwired. Not tier-2 and not touched.
- **`composeBusinessFacts` — TIER-2.** Pure, read-only, `UNAVAILABLE`-honest. **But wiring it to a view is blocked
  by the FROZEN IPC contract, not by tier** — hence the proposal in
  `PROPOSAL-READ-ONLY-IPC-GATE-CLASS.md`. Nothing was wired.

## §13 · F-P35 CLOSED · THE ARTIFACT BRACKET · AND FOUR RECORDS (21 Aug 2026)

### §13.1 · F-P35 — **CLOSED. ENVIRONMENT-SPECIFIC, CAUSE PERMANENTLY UNKNOWN, NOT REOPENED.**

The fourth and last variant tested the only untested input: **the r3 profile itself**, from a working copy, exact
r3 configuration (22:18 artifact · `NODE_ENV=production` · `NP_E2E_BUILD=1` · `NEUROPAUSE_E2E=1` · default
`:4000`).

| # | profile | seed | URL | recovery attempts |
|---|---|---|---|---|
| A | throwaway | off | :4010 | **zero** |
| B | throwaway | on | :4010 | **zero** |
| C | throwaway | on | **:4000 (r3 config)** | **zero** |
| **D** | **r3 COPY** | on | **:4000** | **zero** — 165 new log lines, none a failure |

r3 logged **43 `ok:false` and zero `ok:true`**. Four variants, including its own profile, produce **none**.

> **F-P35 CLOSES as environment-specific — machine state at the time — and is NOT REOPENED.** The probe's
> unrecordable-diagnostic defect (§12.1) stands on its own and is unfixed by ruling.

**Custody proven, not asserted:** the original r3 profile hashed **`52f64db2…5bfe5f1` before and after**,
byte-identical; latch intact; `snapshot-r3-postexit` untouched; artifact mtime `22:18:45` unchanged; working copy
removed.

### §13.2 · THE ARTIFACT BRACKET — BOTH BUILDS IN CUSTODY

| build | location | `main/index.js` sha256 | `propose refused` |
|---|---|---|---|
| 16:12 | `artifact-1612/` (manifest `d6e3a948…0fcae96`) | `5c79aac8…3b1ffda` | **0** |
| **22:18** | **`artifact-2218/`** (manifest `b3c7a899…5e79fad`) | `ee5e8e99…0e138c0` | **1** |

87 files each; seed chunk `e2eSeed-NKS_iH8j.js` (`a54bc5b2…daf29`) identical across both. **Attempt 2's artifact
now exists in two places.** Recorded in the v2 runbook and BLOCKERS.

### §13.3 · FOUR RECORDS

**AN UNVERIFIED BACKUP IS NOT A BACKUP.** The prod dump's rows were read back **out of the archive** — users 3,
orgs 1, memberships 1, sessions 194 — rather than trusting `pg_dump`'s exit code. **Same shape as *an unobserved
render is not a demonstration*.** Into the standing rules.

**`npm run dev:desktop` OVERWRITES `out/`.** `electron-vite` declares no `outDir`. The 22:18 artifact was
protected until 21 Aug **only by nobody typing that command** — a stated precondition with no check, F-P13's shape
on a build artifact. Now a named hazard in BLOCKERS and the v2 runbook, with the custody copy as the remedy.

**THE DEFAULT CONFIGURATION SHOWS AN EMPTY MARKETPLACE.** `:4000` (prod) returns **0 apps**; `:4010` (dev) returns
**20**. Observed in three separate launches. **A product consequence of the port collision, not a bug** — it
belongs to the operator's prod/dev ruling, and it means the desktop's out-of-the-box default currently presents an
empty catalog.

**THE TWO-PHENOMENA TEMPTATION, AND WHY IT WAS KILLED.** It is tempting to join F-P35 and the A/B question into
one story — both are unexplained, both concern the same r3 session, both closed as unknown. **They are different
classes and must not be joined:**

> **The probe is an IRREPRODUCIBLE PHENOMENON — it can be attempted again, and was, four times.
> A/B is an UNOBSERVED HISTORICAL FACT — it happened once and no instrument recorded it.**

One closed by *failing to reproduce*; the other closed because *nothing can reproduce a past click*. Recorded so
nobody later treats a single explanation as covering both.

## §14 · F-P24 RECORDEDNESS — THE SCOPE IS SMALLER THAN THE SILENCE (21 Aug 2026)

**The requirement is DURABLE EVIDENCE, not a log line.** Read-only pass over the four silent sites plus the
operator's confirm, against the frozen send path's actual ordering:

```
l6ExecutionGate(deps, r);   if (!l6.ok)    return l6.refusal;     ← BEFORE governedSend AND observe
if (__NP_E2E__) { guard = firstRealSendGuard(r.params);
                            if (!guard.ok) return guard.refusal; } ← BEFORE governedSend AND observe
const g = await governedSend({ … confirmed: r.confirmed … });
void actionRecord.observe(r, g, …);                                ← UNCONDITIONAL, after governedSend
```

| Site | Verdict values | Recorded? | Where | All branches? |
|---|---|---|---|---|
| **CST `governedSend` verdict** | ALLOW / HOLD / DENY | **YES** | `ActionRecord.verdict` — `observe` reads `outcomeString(outcome,'verdict')` at `actionRecord.ts:291` with **no branch filter**, and the call is unconditional after `governedSend` | **ALL** |
| **Executor scope check** | DENY (missing permission) | **YES, partially** | the refusal is an executor-port result inside `governedSend`, classified into `semanticOutcome` and stored as `ActionRecord.outcome` + `executed` | **ALL — but the REASON is not recorded**, only the classified outcome. *Which* scope was missing is lost |
| **FG-4 guard** | DENY | **NO — and the trace that exists is dishonest** | `audit.log` only: `{"channel":"connectors:m365.execute","ok":true,"durationMs":1}` — **`ok:true` for a refusal.** The denial is recoverable **only by inferring it from a 1 ms duration** against the 557 ms real send | **none** |
| **Read-back terminal** | VERIFIED / HOLD / FAILED | **NO — not in production** | `recordVerification` has exactly one caller, `e2e/s16VerifyRun.ts`, which is **compile-stripped from release**. The store treats all terminals identically; **nothing calls it** | **none — not even success** |
| **OPERATOR CONFIRM** | given / not given | **NO — inferable only** | there is **no `confirmed` field** on `ActionRecord`. Consent is inferable from `verdict: ALLOW`, because RULE-011 pins unconfirmed → HOLD | **inference, not record.** It cannot say *who* confirmed or *when* |

### §14.1 · THE VERDICTS, BY THE RULE

- **CST verdict — RECORDED ON ALL BRANCHES ⇒ NO WORK.** **The CST is NOT an FG gate; it is a note.** A log line
  beside a record that already exists would open a frozen file for nothing.
- **Executor scope check — RECORDED ⇒ NO NEW EMITTER.** The residue is that the *reason* is dropped: a
  **record-content** question, not an instrumentation one.
- **FG-4 guard — RECORDED BUT DISHONEST ⇒ F-P23's class.** *The fix is the record's wording, not a new emitter.*
- **Read-back terminal — NOT RECORDED AT ALL ⇒ REAL GAP.** Gate class **GATE** (`verification/`).
- **Operator confirm — NOT RECORDED ⇒ REAL GAP**, and its own finding: **the only human authority in the system
  leaves no direct trace.**

### §14.2 · A FIFTH SITE, NOT ON THE OPERATOR'S LIST

**The FG-10 L6 gate's REFUSE returns before `governedSend` and before `observe`** — identical shape to FG-4. A
refused Brain proposal mints **no ActionRecord**. It at least *emits* (`executionGate.ts:98`, `warn`), so it is
observable in the log while absent from the evidence store. **Recorded; it belongs to whatever envelope covers
FG-4.**

### §14.3 · F-P37 — INSTRUMENTATION DENSITY IS INVERSELY CORRELATED WITH PROXIMITY TO EXTERNAL EFFECT

**The four silent sites are the four closest to the world.** The well-instrumented middle — the propose path, the
Brain lane, the L6 gate — is the **newest** code.

> **PROBABLE MECHANISM: instrumentation correlates with WHEN THE CODE WAS WRITTEN, not with WHAT IT CAN DO.**
> The observability discipline this programme developed arrived *after* the send path was built, and was applied
> going forward rather than backward. The result is an inverse gradient: the nearer a site is to a real external
> effect, the older it is, and the quieter.

**TESTABLE PREDICTION, not tested here:** the same pattern should appear anywhere else old frozen code sits near a
consequence — the `governedAction` path for the 28 non-`mail.send` write actions is the obvious place to look.
**Do not test it now.**

## §15 · F-P39 — **THE READ-BACK HAS NO PRODUCTION CALLER. STEP 6 DOES NOT EXIST IN PRODUCTION.** (21 Aug 2026)

The contingent read came back **NO**, and the envelope was **not drafted**. Adding a recorder to a function
nobody calls is vacuous-green — the defect Pin C nearly was.

**ESTABLISHED FROM SOURCE:**

- `verifyGovernedSend`'s **only** non-test importers are **`src/main/e2e/s16VerifyRun.ts`** and
  **`src/main/e2e/e2eVerifyRun.ts`**. Both are `__NP_E2E__`-gated and live under `src/main/e2e/`, **compile-stripped
  from every release build**. Every other reference is a test.
- **The code declares it about itself.** `executionGate.ts:67`, a static literal in `deriveOracle`:
  ```js
  { verifiable: 'send-corroboration', oracleId: 'verifyEffect', note: 'send-corroboration, not delivery',
    needs: null, productionWired: false }
  ```
- CLAUDE §1 recorded *"the S22 reconciler is its production caller"* as an explicit **no-orphan gate** — a
  forward-looking claim about a caller that would exist. **S22 (Wave 5) is not built.** The gate pointed at a
  future and has been read since as if it pointed at a present.

*Honest bound on one check: `grep 'verifyGovernedSend'` returns 0 in the 22:18 bundle, but that build is minified
and internal names are manglable, so **the bundle grep is NOT probative** and the conclusion rests on the source
facts above, not on it.*

### §15.1 · WHAT THIS IS — F-N17-4's FAMILY AT THE WORST SITE IN THE CHAIN

> **A DECLARED GOVERNANCE CAPABILITY IS NOT THE SAME THING AS A REACHABLE GOVERNANCE PATH** — and here the
> unreachable path is **INDEPENDENT VERIFICATION**, the last link of §2 #14's universal read-back and the step
> that separates *submitted* from *verified*.

**It is a much larger finding than F-P24-scoped**, and it changes what the ceremony can claim: **the ceremony as
built ends at PROVIDER_ACKNOWLEDGED.** Step 6 is not a step that runs and forgets — **it is a step that does not
run.**

### §15.2 · S16's VERIFIED_SUCCESS — RECLASSIFIED, NOT WITHDRAWN

**The provider-side observation stands.** A real message reached Sent Items with a captured
`internetMessageId`; that was observed and is not in question.

> **THE CORRECTION IS TO WHAT THE VERIFICATION RECORD PROVES.** The terminal was produced by
> `e2e/s16VerifyRun.ts` — a **compile-gated harness runner**. So S16's VERIFIED_SUCCESS is
> **HARNESS-PRODUCED, NOT PRODUCT-PRODUCED.** It demonstrates that the *oracle works*; it does **not**
> demonstrate that *the product verifies*.

**This is not a withdrawal of S16.** It is the same distinction the programme has enforced everywhere else:
*an unobserved render is not a demonstration*, and a harness result is not a product capability.

### §15.3 · OBSERVABLE IS NOT RECORDED — into §2, with F-P24 amended

> **OBSERVABLE IS NOT RECORDED.** The log is **diagnostic**; the **evidence store is the record**. A requirement
> for durable evidence is not satisfied by an emitter, and F-P24 is amended to name **which artifact** it means:
> **the ActionRecord**, not `app.log`.

**WORKED EXAMPLE — the FG-10 gate's REFUSE:** it emits at `warn` (`executionGate.ts:98`) and **mints nothing**.
So it is fully observable in the log and **entirely absent from the evidence store** — *an ActionRecord audit sees
a ceremony that never refused.*

### §15.4 · F-P38 — THE CONSENT TRACE, AND WHAT MITIGATES IT TODAY

**The only human authority in the system leaves no direct durable trace.** No `confirmed` field on
`ActionRecord`; consent is inferable from `verdict: ALLOW` via RULE-011's unconfirmed→HOLD pin, and **cannot say
WHO confirmed or WHEN**. **BLOCKS-PRODUCT** — deliberately not mixed into a send-blocking envelope, so the
ceremony does not wait on a product fix.

**NP-000's mitigation is F-P21's screen recording plus the RULE-011 inference.** Recorded plainly: **that is
adequate for one supervised operator at a keyboard, and for nothing beyond that.** It does not scale to a second
operator, an unsupervised run, or any audit that must attribute consent to a person.

## §16 · BOUNDARY-REPAIR RECONNAISSANCE (21 Aug 2026) — read-only, 6 agents, every claim cited

**Build health:** vitest **877 files / 9197 passed / 3 skipped** · typecheck node+web **CLEAN** · honesty scanner
**0** · tree **clean** at `fad19d2` on `cert/data-import-cst-integration` · artifact `out/main/index.js` 22:18:45,
6,583,130 b, `propose refused` ×1.

**`verify-freeze.sh` reports FREEZE BROKEN — and it is a LIVE F-P25 INSTANCE.** `ANCESTRY OK`; `SOURCE FAIL` lists
four files changed since baseline `6ae9696`: `.gitignore`, `apps/backend/src/index.ts`,
`proposeBoundaryCharacterization.test.ts`, `np-local-up.sh`. **None is a frozen surface.** The condition is
*baseline behind HEAD*, not *frozen surface changed* — the two states the script flattens into one message. The
underlying omission is mine: source landed across the local-first sittings and the baseline was never re-recorded.

### §16.1 · THREE REGISTER ROWS WERE WRONG — MINE

**F-P10, F-P14 and F-P31 were marked CLOSED on 21 Aug. All three are REOPENED.** In each case I closed the
**documentation** instance and marked the **finding** closed:

- **F-P31** — `index.ts` still latches `shutdownFlushed = true`. **A PROCEDURAL MITIGATION IS NOT A CODE FIX.**
  The runbook paragraph tells a human to work around the defect; the defect is untouched.
- **F-P10** — one runbook is now written against the artifact. Certification still records no
  source→build→artifact→runtime→run identity chain.
- **F-P14** — naming the behaviour documents it. **Documentation cannot close a code question.**

This is the *characterization ≠ localization* discipline failing on the register itself, and it would have silently
removed three items from the repair programme.

### §16.2 · THE CONTROL MODEL — 15 STAGES, THREE GAPS

Thirteen stages are production-live with durable records where claimed. The gaps:

- **GAP A — stages 11 (read-back) + 12 (verification) have no production caller.** Double-gated at
  `index.ts:214-218` on `__NP_E2E__` **and** `NEUROPAUSE_VERIFY_S15==='1'`. **The cycle does not close in a
  release build.** (= F-P39, now with its gating site named.)
- **GAP B — stage 14 (correction) is RAISE-ONLY.** `HoldStore.resolve` is reached in production solely through
  the operator IPC `decisions/index.ts:88`. **UNKNOWN→HOLD is real and durable; HOLD→terminal is not automated.**
- **GAP C — stage 15 (automation) does not exist for the governed path.** `automationEngine.ts` is a pure
  evaluator/planner with no executor; the sole `governedSend` production call site is the human-confirm handler.

**F-P41 — and this is the sharp one: stage 13 measures a state stage 12 can never produce.** `m365WriteStates`
is live and derives `EXTERNALLY_OBSERVED` from terminals nothing in production can write.

**Correction to a standing assumption:** the propose stage is **NOT** dev-only. `runPropose` has two callers —
the DEV-gated button *and* the assistant-handoff `useEffect` at `EntraConnectorPanel.tsx:152-160`, which ships.

### §16.3 · P2 — THE DISCARD POINT, AND WHY IT IS NOT PLUMBING

**`AssistantView.tsx:368`** forwards `env.mailIntent` while **`env.correlationId` sits on the same object and is
dropped**. Four downstream types then have no slot: `PendingMailIntent`, the propose request, the execute request,
`ActionRecord` (`grep -in correlation actionRecord.ts` → **0**, file present, 343 lines).

**F-P40 — the deeper obstacle.** `sendTransition.ts:165` mints `idem = sha256(tenant|connector|account|action|
JSON(params))`, and **every id reaching `ActionRecord` derives from it**. The governed lineage is
**content-addressed, not request-addressed**: two identical turns yield indistinguishable `requestId`/
`transitionId` stems, and `admissionRef` is literally assigned `transitionId` — **three columns, one value.**
So **RUN A ≠ RUN B fails at the identity layer by construction**, and P2 cannot be discharged by threading a field
through; it needs an operator ruling on whether a request-addressed identity may exist alongside the
content-addressed one.

### §16.4 · CONFIRMED WITHOUT CHANGE

**P0** (`connectorService.ts:655`, pinned by the enumerating adversarial test) · **FG-13** (`connectors.ts:198-199`
non-optional, non-nullable) · **P4-MIN** (`capabilityProposeIpc.ts:82`, `warn`, `detail` absent from the file) ·
**P4-MIN-b** (`brainProposeLane.ts:80-81` silent early return; 4 log sites in the file, **zero at debug**) ·
**F-P23** (`secureBridge.ts:187` writes `ok: true` on the try-path — `ok` reflects *handler completion*, never
governance outcome; refusals `return` rather than throw).

**Two corrections to my own prior records:**
1. **P0's "refresh-path carry-forward" is MISLABELLED — including in the comment I wrote.** `connectorService.ts:359`
   sits in **`reconnect()`**, not `refresh()`; `doRefreshTokens` never touches `grantedScopes` at all. The
   carry-forward lives on the **re-authorization** path.
2. **FG-13 has a SECOND conflation at the same field:** `connectors/index.ts:396` `?? []` means an **absent
   account** also collapses to `[]` — indistinguishable from both "granted nothing" and "told nothing".

### §16.5 · DOCUMENT-SET DEFECTS

**`CLAUDE.md` — the constitution — references neither `CONTROL-REGISTER.md` nor either runbook** (grep: 0 hits;
control greps sane). The session ritual is CLAUDE→NP_STATE→BLOCKERS→verify-freeze, so the register is reachable
only one hop further. **`NP_STATE.md` — the ritual's SECOND read — stops at NP-010** while §1 runs to NP-020, and
contains **0** occurrences of `F-P*`. F-P34's own rule applies: *an entry point that is blind is worse than no
entry point, because it is trusted.* **§2 now holds NINETEEN rules; the mapping and register both still say
"eighteen"**, so the enforcement-shape audit was computed over a stale rule set.

## §17 · RECON PART 2 — D1–D12, MEASUREMENT, QUESTION AUDIT, AND THE DO-NOT-TOUCH LIST (21 Aug 2026)

Read-only. Extends §16 to cover §36's A–Z. **No code modified.**

### §17.1 · F-P43 — THE MEASUREMENT MODEL DOES NOT EXIST ON THE GOVERNED PATH

§27's vocabulary, searched across `apps/desktop/src` + `packages` (non-test):

`baselineTime` **0** · `neuroPauseTime` **0** · `humanInterventionTime` **0** · `waitTime` **0** ·
`verificationTime` **0** · `correctionTime` **0** · `repeatCount` **0**.
`computeTime` and `automationRate` exist in **six files, ALL preview packages** —
`manufacturingDigitalTwin.ts`, `capacityScheduler.ts`, `routing.ts`, `timePhasedMrp.ts`,
`automation/analytics.ts`, `automation/dashboards.ts` — i.e. the 41 NOT-CERTIFIED / NOT-LIVE set.

**On the governed path the only timing captured is `durationMs` at `secureBridge.ts:187/196`, and it measures
IPC HANDLER COMPLETION, not work.** It is the same field that made a 1 ms FG-4 refusal distinguishable from a
557 ms send only by coincidence (F-P23).

> **LAW** §37 / §27 — the claim must emerge from measured runs.
> **REQUIREMENT** per repeated work item: baseline, elapsed, human-intervention, compute, wait, verification,
> correction, repeat count, automation rate.
> **IMPLEMENTATION** none on the governed path; the vocabulary lives only in uncertified preview packages.
> **OBSERVATION** the greps above, with the preview-package locus named.
> **FINDING F-P43 — there is no measurement substrate, so no time-saving claim can be computed from records.**
> **REQUIRED CORRECTION** a measurement record class, sequenced AFTER the evidence classes exist (a meter over a
> chain that cannot prove its own outcome measures nothing).
> **VERIFICATION** two runs of one work item producing two comparable measured records.

### §17.2 · F-P25 IS SHARPER THAN STATED — verify-freeze.sh NEVER TESTS FROZEN SURFACES

`grep -c "frozen-surfaces" certification/verify-freeze.sh` → **0**. The script compares **all** source to the
baseline; the frozen-list test lives in a *different* script (`gate-detector.sh`).

> **So it does not CONFLATE the two conditions — it only ever tests ONE of them.** It cannot emit
> `FROZEN_CHANGED` because it never computes it. What it does compute — `ANCESTRY OK/FAIL` and `SOURCE OK/FAIL`
> — it prints in the body and then **flattens into two terminal verdicts** (`FREEZE INTACT` / `FREEZE BROKEN`).
> The current live state proves it: `ANCESTRY OK` + four **non-frozen** files changed → `FREEZE BROKEN`.

§20's five machine-readable states therefore require **adding** a frozen-surface test, not merely splitting an
existing one.

### §17.3 · THE QUESTION AUDIT PARTLY EXISTS — DO NOT REBUILD IT

`assistantMailSendIntent.ts` already implements §5's question-audit boundary for one capability:
**`NEEDS_CLARIFICATION`** on ambiguity (`:54`), **`UNSUPPORTED`** on out-of-scope action verbs (`:55`, `:125`,
`:161`), deny-by-default scope, with recipient literalism and trigger discipline. **It is a real question audit,
narrow in scope.** The gap is that it is per-capability and produces no durable record — not that it is absent.

### §17.4 · D1–D12 COVERAGE ON THE ONE GOVERNED RECORD (`ActionRecord`)

| | Dimension | Coverage | Evidence |
|---|---|---|---|
| **D1** | Subject/entity | **✓** | `connectorId`, `accountId`, `actionId`, `recipients` |
| **D2** | Purpose | **✗** | `purpose` exists on the *proposal*, never reaches the record |
| **D3** | Context | **✗** | no environment/state capture |
| **D4** | Identity/correlation | **✗** | 0 occurrences of `correlation`; ids are content-derived (**F-P40**) |
| **D5** | Intent | **partial** | subject/body **fingerprints** only — a digest, not intent |
| **D6** | Evidence | **partial** | `verification.provenance{source,method,oracle}` exists but is never written in production |
| **D7** | Authority | **✓** | `verdict`, `actor` |
| **D8** | Capability/action | **✓** | `actionId` |
| **D9** | State/result | **partial** | `verdict` + `executed` + `outcome` present but **not separated into three classes** (F-P24) |
| **D10** | Verification | **structural only** | field exists; **no production writer** (F-P39) |
| **D11** | Time/resource | **partial** | `requestTime`/`eventTime`/`effectTime`/`at`; `authorization_time` and `execution_time` **ABSENT** by NP-019 ruling; **no resource or cost dimension at all** |
| **D12** | Correction/learning | **✗** | nothing |

**Four of twelve fully covered.** The absent ones cluster exactly where the programme's open findings already sit
— D4 (P2/F-P40), D9 (F-P24), D10 (F-P39), D11-resource (F-P43), D12 (Gap B/C).

### §17.5 · Z — ALREADY SOLVED. DO NOT TOUCH.

| Item | Why it must not be reopened |
|---|---|
| **P0** connect-path fail-open | corrected + pinned by an **enumerating adversarial** test that whitelists both assignment lines |
| **P4-MIN** refusal emitter | landed, `warn`, `detail` deliberately absent — re-adding detail would leak recipients (F-P26) |
| **The question audit** (`assistantMailSendIntent`) | real, narrow, working — §17.3 |
| **`actionRecord.observe` branch coverage** | already fires on **all** `governedSend` verdicts; the gap is upstream returns, not the observer |
| **CST verdict durability** | `verdict` recorded on all branches — **not an FG gate; a note** (§14) |
| **D-16 / NP-018 `Certainty` incl. STALE** | the single verification vocabulary — **never mint alongside** |
| **The FG-4 latch** | preserved; §12 explicitly forbids disturbing it |
| **P4-MIN-b** (`:81`) | HELD until the controlled reproduction |
| **`brainProposeLane` emitters** | 4 sites, **zero at debug** — already sink-reachable |
| **The 22:18 artifact** | custody copy `artifact-2218/`; `npm run dev:desktop` would destroy it |
