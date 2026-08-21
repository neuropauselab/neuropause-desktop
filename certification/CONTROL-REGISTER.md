# THE CONTROL REGISTER
### The four-class register · 21 Aug 2026 · **Entries were MOVED, not rewritten — every one keeps its original wording**

> **MODEL (`ARCHITECTURE-MAPPING.md` §5.0c):**
> **CONSTITUTION → REQUIREMENT → IMPLEMENTATION → OBSERVATION → FINDING → CORRECTION → VERIFICATION → CLOSED**
>
> A finding is **the gap between a law and an implementation, made visible by an observation.** So every finding
> names the law it violates; one that names none is either a **missing law** or **not a finding**.

> **SEVERITY ASSIGNED BY THE OPERATOR, 21 Aug 2026.** Recorded here rather than left in conversation — *"I stated
> the totals and never wrote the mapping into the register; an unassigned column gets filled by whoever speaks
> next."*
>
> **BUCKET-1 CRITERION:** without fixing it, **(a)** an unintended external effect could occur, **OR (b)** an
> intended one could not be proven, **OR (c)** the ceremony's own evidence would be untrustworthy.
>
> **BUCKET 1 IS SIX: P1 · F-P27 · F-P8 · F-P21 · F-P24 (scoped) · F-P31.** Four more fold into two of those
> fixes — **F-P10 and F-P14 into F-P27**, **F-P11 and F-P23 into F-P24** — and are marked as folding rather than
> as separate blockers. **F-P13 is BLOCKS-MITIGATED: its gate exists in the v2 runbook and must be EXECUTED, not
> built.** Every remaining row is filled; the default is RECORD.
>
> ### **BUCKET-1 STATUS DOES NOT RELEASE A HELD ITEM.**
> **P1 is a blocker AND attempt 2 stays held.** The gate determines what RISES; **it does not consume the held
> queue.** A finding reaching Bucket 1 is a statement about priority, never an authorization.

> **P1 is not an F-numbered row** — it is tracked in §C/BLOCKERS as *AWAITING CONTROLLED REPRODUCTION*, bucket
> **BLOCKS-SEND (b)**, and **closes when attempt 2 runs**.

---

# A · FINDINGS

| ID | Statement | Status | Bucket | Law it violates |
|---|---|---|---|---|
| **F-P8** | Model output reaches a send-capable form with nothing between — a boundary crossed by CONTENT where the architecture only pinned CONTROL | OPEN | **BLOCKS-SEND** (a) | *AI output is untrusted data* (§2 #6); *the validating path and the serving path are different paths* |
| **F-P9** | The record carries two clocks under one set of numbers; no run id ties a log line to a run | OPEN | RECORD | *correlation is for evidence, never for authorization*; the proof standard's one-run-id requirement |
| **F-P10** | The runbook was written against SOURCE, never against the built ARTIFACT | **REOPENED 21 Aug.** The *documentation* instance closed (one runbook now written against the artifact); the **systemic** instance did not — certification still records no source→build→artifact→runtime→run identity chain. **I closed a finding on the strength of closing one document.** | **BLOCKS-SEND** — folds into F-P27 | §2 #17 *pin against the real path*; *a document describing the repository is not one describing the artifact* |
| **F-P11** | A fail-closed path that leaves no evidence is indistinguishable from a path that never ran | OPEN | **BLOCKS-SEND** — folds into F-P24 | *a refusal must be observable or it is not auditable* |
| **F-P12** | The handoff mailbox has no expiry while its proposal carries a 10-minute `Expires` | OPEN | RECORD | **NO RECORDED LAW** — candidate missing law: *an expiry on one side of a handoff is not an expiry* |
| **F-P13** | A per-profile safety device does not protect a multi-instance desktop | OPEN | **BLOCKS-MITIGATED** — gate exists; EXECUTE, do not build | *a stated precondition without a check is not a precondition* |
| **F-P14** | "Open connectors" does not open the Microsoft panel | **REOPENED 21 Aug.** Naming the behaviour in a runbook documents it; it does not repair the navigation semantics. Documentation cannot close a code question. | **BLOCKS-SEND** — folds into F-P27 | *a declared thing and a reachable thing were allowed to share one name* (REACHABILITY family) |
| **F-P15** | `isLoaded` monotonic ⇒ `not_loaded` excluded by direction | CLOSED (negative) | RECORD | — |
| **F-P16** | `resolveTenantScope` branch stable; IPC handlers take `session()` | CLOSED (negative) | RECORD | — |
| **F-P17** | Tenant-scope-null does not account for the zero counter row | CLOSED (negative) | RECORD | — |
| **F-P19** | `capabilityProposeIpc.ts:48-52` narrows `AuthStatus` with a bare ternary swallowing `'local'` | OPEN | BLOCKS-PRODUCT | §4 *AuthStatus exhaustiveness* — **PROSE, no enforcement** |
| **F-P21** | *(files against P5 and the proof standard)* — the eight-field review leaves no durable trace | OPEN — **capture specified**, code fix queued | **BLOCKS-MITIGATED** — execute the capture spec, do not rebuild it | the proof standard |
| **F-P23** | *(files as an instance of F-P24)* | OPEN | **BLOCKS-SEND** — folds into F-P24 | *a refusal must be observable or it is not auditable* |
| **F-P24** | Governance mints no record when it refuses — by design, and that is the defect | OPEN | **BLOCKS-SEND** (c) — SCOPED | *a refusal must be observable…*; **and *set-level properties require set-level tests*** |
| **F-P25** | `verify-freeze.sh` conflates "a frozen surface changed" with "the baseline is behind HEAD" | OPEN | RECORD | *a safety gate must test the exact dangerous state*; *the instrument is part of the system under test* |
| **F-P26** | The credential redactor is pinned to preserve email shapes, so it is not a PII redactor | OPEN | RECORD | *citing a redactor without citing its pins is a false assurance* |
| **F-P27** | The ceremony runbook existed in no file; the "nine steps" lived only in transcript | **CLOSED** 21 Aug — `NP-000-CEREMONY-RUNBOOK.md`; written against the artifact, preconditions checkable | **BLOCKS-SEND** (c) — *was* | *record supersedes recollection*; *a procedure existing only in transcript is not a document* |
| **F-P28** | The evidence packs inherit PII-unsafety and carry no disclosure classification | CLOSED (classified OPERATOR-PRIVATE) | RECORD | *the packs inherit the redactor's bound* (F-P26) |
| **F-P29** | Process-identity gate ambiguity — the predicate counted helpers as well as mains | CLOSED | RECORD | *a safety gate must test the exact dangerous state* |
| **F-P30** | Shutdown completed and the process did not exit (~6.5 min delayed exit) | CLOSED (recorded) | RECORD | **NO RECORDED LAW** — a property of the runtime, not a violation |
| **F-P31** | The shutdown flush is spent once, invisibly; a second quit flushes nothing and the cost is data loss | **REOPENED 21 Aug.** `index.ts` still latches `shutdownFlushed = true`. **A PROCEDURAL MITIGATION IS NOT A CODE FIX** — the runbook paragraph tells a human to work around the defect; the defect is untouched. | **BLOCKS-SEND** (c) — *was* | *a refusal must be observable…* (F-P24 family); *expected ≠ correct* |
| **F-P32** | The 2026-08-07 legacy document block — 24 files, one commit, unreviewed; **MODULE-CERTIFIED ≠ CAPABILITY-CERTIFIED** | OPEN — **ESCALATED** | BLOCKS-PRODUCT | the vocabulary bans (§5.0); *never silently treat a lower rung as a higher one* |
| **F-P33** | CLAUDE §1's header was stale by ~30 commits | CLOSED (repaired + recurrence rule) | RECORD | *record supersedes recollection* |
| **F-P34** | `BLOCKERS.md` was a blind entry point | CLOSED (rewritten) | RECORD | *an entry point that is blind is worse than no entry point* |
| **F-P35** | The probe's reason is computed, named, retained, surfaced — and logged at a level that cannot be recorded; `classifyProbeError` returns `null`, also the no-error value | **ENVIRONMENT-SPECIFIC** (cause permanently unknown, not reopened); **the unrecordable-diagnostic defect is OPEN** | RECORD (residual) | *instrumented silence is evidence only if the instrument can reach the sink*; NP-016 conflation class |
| **F-N16-1** | Discovery claimed connector-level certification for every mutating action | CLOSED | RECORD | *the discovery invariant* (§0.1) |
| **F-N16-2** | Derived vs enforced authority disagree (`policyVersion` null vs named) | **NOT-A-DEFECT** — missing source over a contract label | RECORD | — |
| **F-N16-3** | Two reversibility vocabularies | OPEN — value space `SOURCE_REQUIRED`; `calendar.create` values CONFLICTING | RECORD for rung 1 · **BLOCKS rung 2** | *vocabulary earns existence when something consumes it* (§0.2) |
| **F-N16-3a** | Reversibility sub-finding | OPEN | RECORD for rung 1 · **BLOCKS rung 2** | as F-N16-3 |
| **F-N16-4** | Two oracle identities for one oracle | **NOT-A-DEFECT** — two mechanisms at two layers, descriptive | RECORD | — |
| **F-N16-5** | Manifest consent scopes omit action scopes (manifest over-request) | OPEN | RECORD | *requested scope is never granted scope* (AUTHORITY family) |
| **F-N17-4** | *moved to §E — SOURCE_REQUIRED is an unknown, not a defect* | → **§E** | → §E | §2 #18's corollary (REACHABILITY family) |
| **F-N19-2** | `requestId` structurally null in production; a fixture more generous than reality hid it | CLOSED (FG-12) | RECORD | §2 #17 *pin against the real path* |
| **F-N8-1** | Intent-home seeded strategy unlabelled | CLOSED | RECORD | §4 UI truth rule |
| **F-N8-2** | Intelligence empty-graph notice absent | CLOSED | RECORD | §4 UI truth rule |
| **F-N8-3** | Release Ops refusals shown as zeros, not named — the F-5 class | CLOSED | RECORD | §2 #11 *governance boundary honesty* |
| **F-N8-5** | Workforce "Nine" copy-drift | CLOSED | RECORD | §4 UI truth rule |
| **F-N8-6** | Device-local identity claimed an identity provider | CLOSED | RECORD | §4 AuthStatus / UI truth rule |
| **F-S17-1** | Onboarding "Try Free Locally" ⇄ `LocalModeBanner` reconciliation | CLOSED (S39) | RECORD | §4 UI truth rule |
| **F-MR-1** | Website fails §31 on 11 claims | OPEN | BLOCKS-PRODUCT | *never silently treat a lower rung as a higher one* |
| **F-MR-2** | *(master readiness)* | OPEN | **CANNOT-CLASSIFY** | UNKNOWN |
| **F-MR-5** | *(master readiness)* | OPEN | **CANNOT-CLASSIFY** | UNKNOWN |
| **F-MR-7** | Credential boundary | CLOSED (NP-013) | RECORD | §2 #12 *secrets* |
| **F-P43** | **The measurement model does not exist on the governed path.** §27's vocabulary is 0 files for 7 of 9 terms; `computeTime`/`automationRate` exist only in six NOT-CERTIFIED preview packages. The sole governed timing is `secureBridge.ts:187` `durationMs`, which measures IPC handler completion, not work. **No time-saving claim can be computed from records.** | OPEN | **CANNOT-CLASSIFY** — sequenced after the evidence classes | §37 / §27: the claim must emerge from measured runs |
| **F-P40** | **The governed lineage is CONTENT-ADDRESSED, not request-addressed.** `sendTransition.ts:165` mints `idem = sha256(tenantId\|connectorId\|accountId\|actionId\|JSON(params))`, and **every id that survives to `ActionRecord` derives from it** — so two identical assistant turns produce indistinguishable `requestId`/`transitionId` stems. `admissionRef` is literally assigned `transitionId` (`actionRecord.ts:294`): three columns, one value. **RUN A ≠ RUN B fails at the identity layer by construction**, which means P2 is not a plumbing job. | OPEN | **CANNOT-CLASSIFY** pending operator ruling | law 3 *RUN A ≠ RUN B*; *correlation is for evidence, never for authorization* |
| **F-P41** | **Stage 13 measures a state stage 12 can never produce.** `m365WriteStates` (measurement) is production-live and derives `EXTERNALLY_OBSERVED` from verification terminals that **no production caller can write** (F-P39). The measurement layer is structurally pinned to 0 and is honest only because `m365WriteStates.ts:13` says so in a comment. | OPEN | **BLOCKS-SEND** — rides with F-P39 | §2 #14 *universal read-back*; *set-level properties require set-level tests* |
| **F-P42** | **`AuthStatus` collapse is 23 sites, not one.** 23 non-test consumers collapse `'local'` into the non-authenticated fallback against **7** that handle it explicitly; **none of the 23 carries the deliberate label §4 requires**. Two are governance-consequential: `runtimeCore.ts:807/888/1120` and `enterprise/index.ts:1809/1817` stamp a device-local principal into the governance audit trail as the literal `'owner'`/`'system'` — **an identity that does not self-disclose as local**, the exact property `governedActor.ts` exists to guarantee. | OPEN | **BLOCKS-PRODUCT** — supersedes F-P19's scale | §4 AuthStatus exhaustiveness; D-12 actor-namespace (`local:` never stripped) |
| **F-P39** | **The read-back has NO PRODUCTION CALLER — step 6 of the ceremony does not exist in production.** `verifyGovernedSend`'s only non-test importers are two `__NP_E2E__`-gated, compile-stripped e2e modules; `deriveOracle` declares `productionWired: false`; the recorded S22 production caller is not built. **The ceremony as built ends at PROVIDER_ACKNOWLEDGED.** | OPEN | **BLOCKS-SEND** — supersedes the read-back-terminal item | §2 #14 *universal read-back*; F-N17-4's *declared ≠ reachable*, at the worst site in the chain |
| **F-P37** | Instrumentation density is inversely correlated with proximity to external effect — the four silent sites are the four closest to the world, and the well-instrumented middle is the newest code. Mechanism: instrumentation correlates with **when the code was written**, not with what it can do. | OPEN — prediction untested | RECORD | *set-level properties require set-level tests* (it is a property of the corpus, not of any file) |
| **F-P38** | **The operator's confirm — the only human authority in the system — leaves no direct durable trace.** No `confirmed` field on `ActionRecord`; consent is inferable only from `verdict: ALLOW` via RULE-011's unconfirmed→HOLD pin, and cannot say who confirmed or when. **NP-000 MITIGATION:** F-P21's screen-recording capture spec + the RULE-011 `verdict:ALLOW` inference — **adequate for ONE SUPERVISED OPERATOR at a keyboard and for nothing beyond that.** | OPEN | **BLOCKS-PRODUCT** — operator-ruled 21 Aug; deliberately NOT Bucket 1, so the ceremony does not wait on a product fix | *a refusal must be observable…* extended: **an authorization must be observable** |
| **F-P36** | Real account data — 3 users, 1 org, 194 sessions — lives in a local container with **no restore drill and no landed backup path**. A verified dump is in custody (`e5c36a1e…86feb5c`); **that is a snapshot, not a backup system.** **S18** is the unlanded slice that would provide both. | OPEN | BLOCKS-PRODUCT | *an unverified backup is not a backup* — and its unmet half: a backup with no restore drill is unproven |

**Also closed, not F-numbered:** **P0** granted-scope fail-open (latent, never exercised) · **P4-MIN** propose-refusal emitter.

**Findings naming no law — the operator's call whether each is a missing law or not a finding:** **F-P12**
(one-sided expiry) · **F-P30** (delayed exit — reads as a runtime property) · **F-MR-2**, **F-MR-5** (statements
not carried into the register).

---

# B · CONSTITUTION

**A constitutional law is not a defect and must never compete for severity with one.**

| Law | Open findings | Enforcement |
|---|---|---|
| §2 #1 frozen surfaces change only through an FG gate | — | **SCRIPT** — `gate-detector.sh`, `verify-freeze.sh`, `frozen-surfaces.json` |
| §2 #2 change-control choreography | — | **PROSE** |
| §2 #3 micro-authorization | — | **PROSE** |
| §2 #4 never fake green | — | **PROSE** |
| §2 #5 evidence or it didn't happen | — | **PROSE** |
| §2 #6 AI output is untrusted data | F-P8 | **PINNED** — `constitutionalInvariants.test.ts`, hostile corpus |
| §2 #7 one confirmation architecture | — | **UNKNOWN** (candidate `m365Write.test.ts`, unverified) |
| §2 #8 deny-by-default | — | **PINNED** — `constitutionalInvariants` RULE-003 |
| §2 #9 uncertainty is never success | — | **PINNED** — RULE-006 |
| §2 #10 offline ≠ execution authority | — | **PROSE** |
| §2 #11 governance boundary honesty | F-N8-3 *(closed)* | **PINNED** — `capabilityGraph.test.ts` |
| §2 #12 secrets never invented or committed | — | **PINNED** — `logger.redaction.test.ts`, `rule009CredentialBoundary.test.ts` |
| §2 #13 the Brain proposes; it never reaches | — | **PINNED** — RULE-007 import-graph pin |
| §2 #14 executor-success is never the claim | — | **PINNED** — RULE-006, `verifyEffect` |
| §2 #15 memory informs governance; never becomes it | — | **PINNED** — RULE-007 |
| §2 #16 payment is never authority | — | **PROSE** — **rung-3 precondition** |
| §2 #17 claims pinned against the real production path | F-P10 | **PINNED** — `temporalModel.test.ts` REALITY pin |
| §2 #18 a data-model change that alters permissions is a governance change | F-N17-4 | **PINNED** — `staleCertainty.test.ts` |
| §4 AuthStatus exhaustiveness | **F-P19** | **PROSE — nothing** |
| §4 no orphan modules | — | **PROSE** |
| §4 a layer touched without its test is not done | — | **PROSE** |
| §4 declarations describe reality | — | **PINNED** — `channelStoreCoverageGate`, `round13ChannelStoreInvariant` |
| §4 UI truth rule | F-N8-1/2/5/6, F-S17-1 *(all closed)* | **PINNED** per-surface |
| *a refusal must be observable or it is not auditable* | **F-P11, F-P23, F-P24, F-P31** | **PROSE** — pending operator go |
| *set-level properties require set-level tests* | **F-P24** | **PROSE** — the review trigger would be its first enforcement |
| *correlation is for evidence, never for authorization* | **F-P9** | **PROSE** |
| *instrumented silence is evidence only if the instrument can reach the sink* | F-P35 | **PINNED** — Pin D level assertion |
| *a safety gate must test the exact dangerous state* | **F-P25** | **PROSE** (F-P29 corrected in the v2 runbook) |
| *the instrument is part of the system under test* — 7 instances | F-P25 | **PROSE** |
| *record supersedes recollection* | **F-P27** | **PROSE** |
| *uniformity is not corroboration* | — | **PROSE** |
| *honest labels, not safe labels* | — | **PROSE** |
| *evidence is not authority* | — | **PROSE** |
| *an unverified backup is not a backup* | — | **PROSE** |
| *unlocated absence is not evidence* | — | **PROSE** |
| *an unresolved contradiction is a finding* | — | **PROSE** |
| *expected ≠ correct* | F-P31 | **PROSE** |
| *a stated precondition without a check is not a precondition* | **F-P13** | **PROSE** |
| *never promote a plausible explanation into a localized failure* · *run A ≠ run B* | — | **PROSE** |
| *citing a redactor without citing its pins is a false assurance* | **F-P26** | **PROSE** |
| the vocabulary bans — GRANTED/TENANT, GOVERNED/PRODUCT, MODULE/CAPABILITY, **DECISION/DIMENSION** | **F-P32** | **PROSE** |
| **CANNOT-CLASSIFY IS A BUCKET, NOT A CLASS** — a row unclassifiable *because nobody has established the fact* belongs in **§E**, not in §A | — | **PROSE** (structural: §E exists) |
| **OBSERVABLE IS NOT RECORDED** — the log is diagnostic, the evidence store is the record; F-P24's requirement means the **ActionRecord** | **F-P24, F-P39** | **PROSE** |
| *containment can only be validated by performing it, and performing it requires having sent* | — | **PROSE** — recorded in §E and in `CONTAINMENT-PROCEDURE.md` |
| the canonical evidence ladder (DECLARED → REACHABLE → … → VERIFIED) | F-MR-1 | **PROSE** |
| *no operator-in-the-loop step at the end of a long sitting* | — | **PROSE** (v2 runbook §0) |

> **THE ENFORCEMENT AUDIT IS NOW A QUERY, NOT A PROJECT** — *"which laws are PROSE and carry open findings?"*
> reads straight off this column. Cells marked **UNKNOWN** were never established; **nothing was verified for this
> pass.**

---

# E · OPEN QUESTIONS / PENDING DETERMINATIONS

> **A DEFECT IS SOMETHING WRONG. AN OPEN QUESTION IS SOMETHING UNKNOWN.** The register cannot reach zero while
> unknowns sit among defects looking like unfixed ones.
>
> **THE RULE (also stated in §B): CANNOT-CLASSIFY IS A BUCKET, NOT A CLASS.** A row that cannot be classified
> *because nobody has established the fact* belongs **here**, not in §A with a CANNOT-CLASSIFY bucket.

| Question | Bucket if answered adversely | What would settle it |
|---|---|---|
| **P1** — does a second handoff consumption produce a proposal attempt? | **BLOCKS-SEND (b)** | **Attempt 2.** *(Previously mis-filed in §C, which conflated the BLOCKER with the HELD ITEM that closes it — those are different things and are now separated: the question lives here, the held authorization lives in §C.)* |
| **F-N17-4** — is the CST relationship-freshness gate's unreachability an ungoverned path? | **BLOCKS-SEND** if yes | source establishing whether any adapter can feed `relationships`; today none does |
| **F-N16-3's value space** — what is the reversibility vocabulary? | RECORD for rung 1 · BLOCKS rung 2 | **SOURCE_REQUIRED** — authored at ladder rung 2, where reversibility gains its first consumer |
| **CONTAINMENT — THE REVOCATION PARADOX** | — | **Nothing, before the first ceremony.** **CONTAINMENT CAN ONLY BE VALIDATED BY PERFORMING IT, AND PERFORMING IT REQUIRES HAVING SENT.** That is why `CONTAINMENT-PROCEDURE.md` is labelled **PREDICTIVE, NOT VALIDATED**, and why it cannot be otherwise. Not a defect and not fixable in advance. |

**F-MR-2 and F-MR-5 stay in §A.** Their *statements* are lost, which is a different problem from an unknown
answer — **a register entry with no recoverable statement is its own small finding**, and it is recorded as such
rather than moved here.

---

# C · HELD ITEMS

| Item | Held because |
|---|---|
| **P4-MIN-b** (`:81` emitter) | the reproduction's observation surface must not change before the run |
| **Option A** (un-gate the refusal surface) | re-priced by F-P26 — would put recipient addresses on a production screen |
| **FG-13** (`grantedScopes` nullable) | closes P0's honesty half; sequenced after |
| **The read-only IPC gate class** | drafted, awaiting operator ruling |
| **P1 attempt 2** | unauthorized; fresh sitting, rested operator, v2 runbook |
| **P4-FULL** (three-record model) | design slice with its own gate |
| **`draftOverdueReminder` wiring** | ladder work — carries `capabilityId: 'mail.send'` |

---

# D · OPERATOR DECISIONS

1. **The bundling fork** — bundle Postgres/Redis, or embed SQLite + KV
2. **Prod vs dev stack** — two stacks run; prod holds :4000 and the real users; the default shows an empty marketplace
3. **The CRM design note** — build on the ERP spine, or not at all
4. **Two rule systems** — spec `RULE-001..012` (26 pins) vs CLAUDE §2's eighteen; **authority on divergence UNRULED**
5. **Adoption of the read-only IPC gate class**
6. **§2 #16 as a rung-3 precondition**
7. **F-P32's own slice** — the legacy document block

---

## A NOTE FOR THE FUTURE — RECORDED, NOT BUILT

**If this register becomes the OS's empirical feedback layer, it needs the OS's discipline — a schema, versioning
and pins, not a markdown section that grows.** A register that is load-bearing and unversioned is the same class
of artifact as a procedure that lives only in transcript (F-P27) and a document block nobody reviews (F-P32).
**Requirement recorded. Schema not built.**
