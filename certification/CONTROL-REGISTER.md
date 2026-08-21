# THE CONTROL REGISTER
### The four-class register · 21 Aug 2026 · **Entries were MOVED, not rewritten — every one keeps its original wording**

> **MODEL (`ARCHITECTURE-MAPPING.md` §5.0c):**
> **CONSTITUTION → REQUIREMENT → IMPLEMENTATION → OBSERVATION → FINDING → CORRECTION → VERIFICATION → CLOSED**
>
> A finding is **the gap between a law and an implementation, made visible by an observation.** So every finding
> names the law it violates; one that names none is either a **missing law** or **not a finding**.

> **⚠️ SEVERITY COLUMN IS THE OPERATOR'S.** The gate's stated totals are **6 BLOCKS-SEND · 4 BLOCKS-PRODUCT ·
> 4 CANNOT-CLASSIFY**, but the **per-finding assignment was never supplied**, so every row reads **UNASSIGNED**.
> Claude does not fill this column. It is here to be filled, not inferred.

---

# A · FINDINGS

| ID | Statement | Status | Bucket | Law it violates |
|---|---|---|---|---|
| **F-P8** | Model output reaches a send-capable form with nothing between — a boundary crossed by CONTENT where the architecture only pinned CONTROL | OPEN | UNASSIGNED | *AI output is untrusted data* (§2 #6); *the validating path and the serving path are different paths* |
| **F-P9** | The record carries two clocks under one set of numbers; no run id ties a log line to a run | OPEN | UNASSIGNED | *correlation is for evidence, never for authorization*; the proof standard's one-run-id requirement |
| **F-P10** | The runbook was written against SOURCE, never against the built ARTIFACT | OPEN | UNASSIGNED | §2 #17 *pin against the real path*; *a document describing the repository is not one describing the artifact* |
| **F-P11** | A fail-closed path that leaves no evidence is indistinguishable from a path that never ran | OPEN | UNASSIGNED | *a refusal must be observable or it is not auditable* |
| **F-P12** | The handoff mailbox has no expiry while its proposal carries a 10-minute `Expires` | OPEN | UNASSIGNED | **NO RECORDED LAW** — candidate missing law: *an expiry on one side of a handoff is not an expiry* |
| **F-P13** | A per-profile safety device does not protect a multi-instance desktop | OPEN | UNASSIGNED | *a stated precondition without a check is not a precondition* |
| **F-P14** | "Open connectors" does not open the Microsoft panel | OPEN | UNASSIGNED | *a declared thing and a reachable thing were allowed to share one name* (REACHABILITY family) |
| **F-P15** | `isLoaded` monotonic ⇒ `not_loaded` excluded by direction | CLOSED (negative) | — | — |
| **F-P16** | `resolveTenantScope` branch stable; IPC handlers take `session()` | CLOSED (negative) | — | — |
| **F-P17** | Tenant-scope-null does not account for the zero counter row | CLOSED (negative) | — | — |
| **F-P19** | `capabilityProposeIpc.ts:48-52` narrows `AuthStatus` with a bare ternary swallowing `'local'` | OPEN | UNASSIGNED | §4 *AuthStatus exhaustiveness* — **PROSE, no enforcement** |
| **F-P21** | *(files against P5 and the proof standard)* | OPEN | UNASSIGNED | the proof standard |
| **F-P23** | *(files as an instance of F-P24)* | OPEN | UNASSIGNED | *a refusal must be observable or it is not auditable* |
| **F-P24** | Governance mints no record when it refuses — by design, and that is the defect | OPEN | UNASSIGNED | *a refusal must be observable…*; **and *set-level properties require set-level tests*** |
| **F-P25** | `verify-freeze.sh` conflates "a frozen surface changed" with "the baseline is behind HEAD" | OPEN | UNASSIGNED | *a safety gate must test the exact dangerous state*; *the instrument is part of the system under test* |
| **F-P26** | The credential redactor is pinned to preserve email shapes, so it is not a PII redactor | OPEN | UNASSIGNED | *citing a redactor without citing its pins is a false assurance* |
| **F-P27** | The ceremony runbook existed in no file; the "nine steps" lived only in transcript | OPEN | UNASSIGNED | *record supersedes recollection*; *a procedure existing only in transcript is not a document* |
| **F-P28** | The evidence packs inherit PII-unsafety and carry no disclosure classification | CLOSED (classified OPERATOR-PRIVATE) | — | *the packs inherit the redactor's bound* (F-P26) |
| **F-P29** | Process-identity gate ambiguity — the predicate counted helpers as well as mains | CLOSED | — | *a safety gate must test the exact dangerous state* |
| **F-P30** | Shutdown completed and the process did not exit (~6.5 min delayed exit) | CLOSED (recorded) | — | **NO RECORDED LAW** — a property of the runtime, not a violation |
| **F-P31** | The shutdown flush is spent once, invisibly; a second quit flushes nothing and the cost is data loss | OPEN | UNASSIGNED | *a refusal must be observable…* (F-P24 family); *expected ≠ correct* |
| **F-P32** | The 2026-08-07 legacy document block — 24 files, one commit, unreviewed; **MODULE-CERTIFIED ≠ CAPABILITY-CERTIFIED** | OPEN — **ESCALATED** | UNASSIGNED | the vocabulary bans (§5.0); *never silently treat a lower rung as a higher one* |
| **F-P33** | CLAUDE §1's header was stale by ~30 commits | CLOSED (repaired + recurrence rule) | — | *record supersedes recollection* |
| **F-P34** | `BLOCKERS.md` was a blind entry point | CLOSED (rewritten) | — | *an entry point that is blind is worse than no entry point* |
| **F-P35** | The probe's reason is computed, named, retained, surfaced — and logged at a level that cannot be recorded; `classifyProbeError` returns `null`, also the no-error value | **ENVIRONMENT-SPECIFIC** (cause permanently unknown, not reopened); **the unrecordable-diagnostic defect is OPEN** | UNASSIGNED | *instrumented silence is evidence only if the instrument can reach the sink*; NP-016 conflation class |
| **F-N16-1** | Discovery claimed connector-level certification for every mutating action | CLOSED | — | *the discovery invariant* (§0.1) |
| **F-N16-2** | Derived vs enforced authority disagree (`policyVersion` null vs named) | **NOT-A-DEFECT** — missing source over a contract label | — | — |
| **F-N16-3** | Two reversibility vocabularies | OPEN — value space `SOURCE_REQUIRED`; `calendar.create` values CONFLICTING | UNASSIGNED | *vocabulary earns existence when something consumes it* (§0.2) |
| **F-N16-3a** | Reversibility sub-finding | OPEN | UNASSIGNED | as F-N16-3 |
| **F-N16-4** | Two oracle identities for one oracle | **NOT-A-DEFECT** — two mechanisms at two layers, descriptive | — | — |
| **F-N16-5** | Manifest consent scopes omit action scopes (manifest over-request) | OPEN | UNASSIGNED | *requested scope is never granted scope* (AUTHORITY family) |
| **F-N17-4** | *"A declared governance capability is not the same thing as a reachable governance path"* — the CST relationship-freshness gate is unreachable | OPEN `SOURCE_REQUIRED` | UNASSIGNED | §2 #18's corollary (REACHABILITY family) |
| **F-N19-2** | `requestId` structurally null in production; a fixture more generous than reality hid it | CLOSED (FG-12) | — | §2 #17 *pin against the real path* |
| **F-N8-1** | Intent-home seeded strategy unlabelled | CLOSED | — | §4 UI truth rule |
| **F-N8-2** | Intelligence empty-graph notice absent | CLOSED | — | §4 UI truth rule |
| **F-N8-3** | Release Ops refusals shown as zeros, not named — the F-5 class | CLOSED | — | §2 #11 *governance boundary honesty* |
| **F-N8-5** | Workforce "Nine" copy-drift | CLOSED | — | §4 UI truth rule |
| **F-N8-6** | Device-local identity claimed an identity provider | CLOSED | — | §4 AuthStatus / UI truth rule |
| **F-S17-1** | Onboarding "Try Free Locally" ⇄ `LocalModeBanner` reconciliation | CLOSED (S39) | — | §4 UI truth rule |
| **F-MR-1** | Website fails §31 on 11 claims | OPEN | UNASSIGNED | *never silently treat a lower rung as a higher one* |
| **F-MR-2** | *(master readiness)* | OPEN | UNASSIGNED | UNKNOWN |
| **F-MR-5** | *(master readiness)* | OPEN | UNASSIGNED | UNKNOWN |
| **F-MR-7** | Credential boundary | CLOSED (NP-013) | — | §2 #12 *secrets* |

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
| the canonical evidence ladder (DECLARED → REACHABLE → … → VERIFIED) | F-MR-1 | **PROSE** |
| *no operator-in-the-loop step at the end of a long sitting* | — | **PROSE** (v2 runbook §0) |

> **THE ENFORCEMENT AUDIT IS NOW A QUERY, NOT A PROJECT** — *"which laws are PROSE and carry open findings?"*
> reads straight off this column. Cells marked **UNKNOWN** were never established; **nothing was verified for this
> pass.**

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
