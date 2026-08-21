# THE CONTROL REGISTER
### The four-class register · 21 Aug 2026 · **Entries were MOVED, not rewritten — every one keeps its original wording**

> # ⚠ THIS DOCUMENT IS **DESCRIPTIVE**. IT IS NOT NORMATIVE FOR GATE STATE.
> **Ruled by the operator, 21 Aug 2026.** Recorded in the register's own header so it can never again claim
> standing it was never granted.
>
> **GATE STATE IS NORMATIVE ONLY IN `CLAUDE.md` §1.** This register and `BLOCKERS.md` are **INDEXES**.
> - Where an index disagrees with §1 → **§1 WINS**, and the index is corrected.
> - Where **§1 is SILENT** → the state is **`NOT_ESTABLISHED`** until the operator rules and it is **entered in §1**.
>   Silence is not an implicit OPEN and not an implicit CLOSED. An index may not fill a gap in §1 by writing one.
>
> **WHY THIS WAS NEEDED (the establishing negative, 21 Aug 2026):** `AUTONOMY.md:14` states the only hierarchy in
> the repository — `CLAUDE.md > AUTONOMY.md > WORK_QUEUE.md > TASK PLAN > WORKER INTERPRETATION` — and **the
> certification corpus is on none of its five rungs.** This file is referenced by **zero** of CLAUDE.md,
> AUTONOMY.md, WORK_QUEUE.md, NP_STATE.md (each proven present before the grep was read as absence; the `register`
> hits in CLAUDE.md are `## 6 · GATE REGISTRY`, a **naming collision, not a reference**). The only path here is
> transitive and one link deep: `CLAUDE.md:73` ritual → `BLOCKERS.md:4-5` → this file. **A document nothing
> authoritative names cannot adjudicate anything**, and for two days it was treated as if it could.
>
> **THE RULE THAT SETTLES RECENCY:** this register was 2h05m newer than `BLOCKERS.md` when they disagreed, and
> that fact is **worth nothing**. **RECENCY IS NOT AUTHORITY.** Newer prose describing an unchanged defect is
> still prose. Compare against **§1 and the source**, never against a timestamp.

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
> ~~**BUCKET 1 IS SIX: P1 · F-P27 · F-P8 · F-P21 · F-P24 (scoped) · F-P31.**~~ **← STALE. SUPERSEDED 21 Aug 2026.**
> The six-list is struck rather than deleted, because the *drift* is itself evidence: it named F-P21 as a blocker
> while this register's own row bucketed it BLOCKS-MITIGATED, and it omitted two live BLOCKS-SEND rows. **A summary
> that disagrees with the rows it summarizes is a defect in the summary.**
>
> > ### **BUCKET 1 = P1 · F-P8 · F-P45 · F-P39** *(F-P39 GATED BEHIND F-P45)*
> > *(operator, 21 Aug 2026 — normative in `CLAUDE.md` §1. The directive named the new parent "F-P42"; that
> > number was already taken, so it is recorded as **F-P45** — see the row. A record finding that blocks a
> > BLOCKS-SEND finding is itself BLOCKS-SEND.)*
>
> **The arithmetic, ruled item by item:**
> - **F-P21 → BLOCKS-MITIGATED.** The row at `:46` was right; the six-list was stale. Execute the capture spec.
> - **F-P31 → REOPENED, correctly.** **A PROCEDURAL MITIGATION IS NEVER A CLOSURE.** `index.ts` still latches
>   `shutdownFlushed = true`; a runbook paragraph telling a human to work around a defect leaves the defect
>   untouched. **CLOSED means the correction was VERIFIED** — nothing less closes a row.
> - **F-P10 → CLOSED.** It was a defect **IN the document**, and the document was corrected. When the artifact of
>   the finding *is* the document, correcting the document *is* the fix. (This is the exception that proves the
>   next line's rule, and the two must never be confused.)
> - **F-P14 → REOPENED as BLOCKS-PRODUCT.** A defect in the **PRODUCT** that the document merely describes.
>   **DOCUMENTING A DEFECT DOES NOT FIX IT.** Naming the broken navigation in a runbook does not repair the
>   navigation semantics. Now `CLAUDE.md` §2 #20's closing clause.
> - **F-P27, F-P24 (scoped), F-P13** — no longer Bucket 1 under the ruled membership above. **F-P13 remains
>   BLOCKS-MITIGATED**: its gate exists in the v2 runbook and must be **EXECUTED, not built.**
>
> **Bucket membership is PRIORITY, never STATUS.** A row leaving Bucket 1 is not a row that closed. Every remaining
> row is filled; the default is RECORD.
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
| **F-P10** | The runbook was written against SOURCE, never against the built ARTIFACT | **CLOSED 21 Aug (operator ruling).** The finding's artifact **WAS the document**, and the document was corrected — one runbook now written against the artifact. Where the defect *is* the document, correcting the document *is* the fix. ⟵ *My 21 Aug REOPEN was over-correction: having just been wrong the other way on F-P14, I applied "documentation cannot close a code question" to a finding that was never a code question.* **The systemic gap it gestured at — no source→build→artifact→runtime→run identity chain in certification — is REAL but is NOT this row**; it is recorded separately rather than kept alive under a closed finding's number. | CLOSED | §2 #17 *pin against the real path*; *a document describing the repository is not one describing the artifact* |
| **F-P11** | A fail-closed path that leaves no evidence is indistinguishable from a path that never ran | OPEN | **BLOCKS-SEND** — folds into F-P24 | *a refusal must be observable or it is not auditable* |
| **F-P12** | The handoff mailbox has no expiry while its proposal carries a 10-minute `Expires` | OPEN | RECORD | **NO RECORDED LAW** — candidate missing law: *an expiry on one side of a handoff is not an expiry* |
| **F-P13** | A per-profile safety device does not protect a multi-instance desktop | OPEN | **BLOCKS-MITIGATED** — gate exists; EXECUTE, do not build | *a stated precondition without a check is not a precondition* |
| **F-P14** | "Open connectors" does not open the Microsoft panel | **REOPENED 21 Aug — stands (operator ruling).** Naming the behaviour in a runbook documents it; it does not repair the navigation semantics. **DOCUMENTING A DEFECT DOES NOT FIX IT** (now `CLAUDE.md` §2 #20). The defect is in the **PRODUCT**; the document merely describes it. | **BLOCKS-PRODUCT** — *re-bucketed 21 Aug; no longer "folds into F-P27", because F-P27 is a documentation finding and this is not* | *a declared thing and a reachable thing were allowed to share one name* (REACHABILITY family) |
| **F-P15** | `isLoaded` monotonic ⇒ `not_loaded` excluded by direction | CLOSED (negative) | RECORD | — |
| **F-P16** | `resolveTenantScope` branch stable; IPC handlers take `session()` | CLOSED (negative) | RECORD | — |
| **F-P17** | Tenant-scope-null does not account for the zero counter row | CLOSED (negative) | RECORD | — |
| **F-P19** | `capabilityProposeIpc.ts:48-52` narrows `AuthStatus` with a bare ternary swallowing `'local'` | OPEN | BLOCKS-PRODUCT | §4 *AuthStatus exhaustiveness* — **PROSE, no enforcement** |
| **F-P21** | *(files against P5 and the proof standard)* — the eight-field review leaves no durable trace | OPEN — **capture specified**, code fix queued | **BLOCKS-MITIGATED** — execute the capture spec, do not rebuild it | the proof standard |
| **F-P23** | *(files as an instance of F-P24)* | OPEN | **BLOCKS-SEND** — folds into F-P24 | *a refusal must be observable or it is not auditable* |
| **F-P24** | **RE-MEASURED 21 Aug 2026 at `09759f4` under §2 #21 (nine commits had landed against it — the most of any OPEN row). VERDICT: PARTLY STALE AS A UNIVERSAL, EXACTLY TRUE WHERE IT MATTERS MOST.** Every claim below is tagged by origin (§28 method); **a prior report is an entering finding and cannot strengthen itself.** **REFUSALS THAT NOW MINT DURABLE EVIDENCE** — *(a)* enterprise permission refusals: `enterprise/index.ts:781` writes a durable `holdStore.open(...)` **and** a `decisionRecordStore.record(...)` — two stores, not a log **[CURRENT SOURCE]**; *(b)* CST verdict DENY/HOLD on `mail.send`: `connectors/index.ts:641`'s `actionRecord.observe(r, g, …)` sits **after** `governedSend` returns and **outside any success branch**, and `sendTransition.ts:312-313` maps DENY/HOLD to a returned verdict rather than a throw — so the refusal is recorded with its verdict **[CURRENT SOURCE — the operator's conversational claim, verified, with one refinement: "all branches" holds only for branches that REACH the line]**. **REFUSALS THAT STILL MINT NOTHING** — *(c)* **THE L6 EXECUTION GATE'S REFUSE**, `connectors/index.ts:606-607` `if (!l6.ok) return l6.refusal;` — **it returns BEFORE `governedSend` and therefore before the observer at `:641`**; its only trace is `log.warn('L6-GATE REFUSE …')` **[CURRENT SOURCE]**. This is §2 #19's own worked example, still live, **on the governed-send critical path** — which is why the status does not move; *(d)* the FG-4 guard refusal, same early-return shape (and compile-stripped besides) **[CURRENT SOURCE]**; *(e)* **F-P48's SKIP — worse than a silent refusal, because the gate does not refuse at all**: no ADMIT, no REFUSE, and the send proceeds and is recorded as an ordinary send, so the ActionRecord shows a governed send whose gate decision never existed **[CURRENT SOURCE, via F-P48]**. **THE SHARPEST RESULT — P4-MIN SATISFIES THE OLD FORMULATION AND NOT THE CURRENT ONE.** `capabilityProposeIpc.ts:81` is `if (!response.ok) log.warn(...)` — **a log line, not an evidence-store write [CURRENT SOURCE]**; its own docstring says *"it changes what is RECORDED"*, but **§2 #19 later ruled that observable is not recorded and named F-P24's artifact as the ActionRecord, not `app.log`.** When P4-MIN landed, the bar was *a refusal must be observable*, and it cleared that bar honestly. **The law tightened underneath the work.** So §2 #21 applies here on the LAW side rather than the code side: **a slice can close a finding as written and be reopened by the finding's own requirement moving** — recorded, not held against the slice. **SUPERSEDED STATEMENT, kept visible:** *"Governance mints no record when it refuses — by design, and that is the defect."* **STATUS DELIBERATELY UNCHANGED, and the reason is stated rather than assumed:** three of the five refusal classes still mint nothing, and the one on the certified `mail.send` path — the L6 gate — is among them. **Nothing fixed in this pass by ruling.** | OPEN | **BLOCKS-SEND** (c) — SCOPED | *a refusal must be observable…*; **and *set-level properties require set-level tests*** |
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
| **F-P44** | **`typecheck:test` carries 63 pre-existing errors and is NOT in the repo's standard gate set** (`test` = vitest ×2; `typecheck` = node+web). Measured identical at HEAD and with FG-14 applied, so a test-only type regression is invisible to every gate that actually runs. | OPEN | RECORD | *the instrument is part of the system under test* |
| **F-P40** | **The governed lineage is CONTENT-ADDRESSED, not request-addressed.** `sendTransition.ts:165` mints `idem = sha256(tenantId\|connectorId\|accountId\|actionId\|JSON(params))`, and **every id that survives to `ActionRecord` derives from it** — so two identical assistant turns produce indistinguishable `requestId`/`transitionId` stems. `admissionRef` is literally assigned `transitionId` (`actionRecord.ts:294`): three columns, one value. **RUN A ≠ RUN B fails at the identity layer by construction**, which means P2 is not a plumbing job. | **VERIFIED — CLOSED** 21 Aug via **FG-14**. Correction: the existing `asst_*` identity is propagated verbatim from `AssistantView.tsx` to `ActionRecord`. Verification: runtime value-equality at three segments (renderer→execute payload · real zod parse · observe→disk→read), three adversarial mutations that each fail the suite, and closed-input-list proofs that no authority, governance, execution or verification predicate can read it. **`idem`, `transitionId`, `requestId` and the kernel are untouched** — the field never enters `cst/`. | **BLOCKS-SEND** — *was* | law 3 *RUN A ≠ RUN B*; *correlation is for evidence, never for authorization* |
| **F-P41** | **CURRENT CAUSE (CORR-2, re-measured 21 Aug 2026): the binding defect was THE ORG-KEYED QUERY, not the absent terminal — and PRODUCING TERMINALS ALONE WOULD NOT HAVE MOVED THE COUNTER.** `unified/sync/index.ts:191` (live broadcast) and `:232` (the on-demand IPC read the panel calls) both supplied `activeTenantScope()?.tenantId` — the ORGANIZATION id — to a store keyed by the WORKSPACE id. The query matched no row, so all five counters read 0 **independent of any terminal**; a terminal recorded by the reconciler would have attached to a row this query never returned. **FIXED at `68e3349`** (F-P45's second instance; both callers moved together as minimum accompaniment, disclosed): the counters now read the key the writer wrote, proven by a pin that derives each side independently and reproduces the old key finding zero. **EXTERNALLY_OBSERVED is now PRODUCIBLE — which is not PRODUCED, and F-P41 does NOT close on that distinction.** The terminal has still never been written by production: the reconciler is reachable but has never completed a pass against a real Graph read, and `makeM365GraphReader` has never executed. **SUPERSEDED STATEMENT, kept visible:** *"Stage 13 measures a state stage 12 can never produce. `m365WriteStates` derives `EXTERNALLY_OBSERVED` from verification terminals that no production caller can write (F-P39). The measurement layer is structurally pinned to 0."* **Half right, and the wrong half was load-bearing** — it named the terminal as the cause and would have sent the fix to the wrong layer. | OPEN | **BLOCKS-SEND** — rides with F-P39 | §2 #14 *universal read-back*; *set-level properties require set-level tests* |
| **F-P42** | **`AuthStatus` collapse is 23 sites, not one.** 23 non-test consumers collapse `'local'` into the non-authenticated fallback against **7** that handle it explicitly; **none of the 23 carries the deliberate label §4 requires**. Two are governance-consequential: `runtimeCore.ts:807/888/1120` and `enterprise/index.ts:1809/1817` stamp a device-local principal into the governance audit trail as the literal `'owner'`/`'system'` — **an identity that does not self-disclose as local**, the exact property `governedActor.ts` exists to guarantee. | OPEN | **BLOCKS-PRODUCT** — supersedes F-P19's scale | §4 AuthStatus exhaustiveness; D-12 actor-namespace (`local:` never stripped) |
| **F-P46** *(next free; assigned by the worker and reported back, per the standing rule that the operator never assigns an F-number in a directive)* | **ONE AUTHORIZATION RULE, THREE COPIES, TWO OF THEM FROZEN.** The granted-scope predicate *"a `.Read` requirement is satisfied by the matching `.ReadWrite` grant"* exists three times, each documented as mirroring another: `cst/sendTransition.ts:140-144` (*"mirrors the executor's rule"*), `cst/governedAction.ts:232-236` (*"mirrors the executor"*), `connectors/m365/executor.ts:57-61`. **MEASURED: the three predicates AGREE TODAY — byte-identical bodies**, compared as code, not as comments. So this is RECORD, not BLOCKS-SEND. **But it sits on the granted-scope authorization path P0 just repaired for fail-open, and two of the three copies are inside the FROZEN CST**, so a future divergence could not be corrected symmetrically. **THE TRIGGER, SHARPENED (operator, 21 Aug 2026) — AND IT IS NOT "WHEN THEY DIVERGE".** The predicate models exactly ONE subsumption: `.Read` ← `.ReadWrite`. There is **nothing for `.Send`, nothing for `.Basic`, nothing for `ReadBasic`-vs-`Read`** — and Graph's real scope lattice contains all of them. The first person to add a subsumption case will add it to **one** copy, because nothing tells them the other two exist except a prose comment. Two of the three are frozen, so **by the time the copies disagree, the correction can no longer be made symmetrically** — the divergence and the inability to repair it arrive in the same commit. Waiting for divergence is waiting for the moment past which the fix is gated. **THE TRIGGER IS THE FIRST SUBSUMPTION CASE, NOT THE FIRST DISAGREEMENT.** **NAMED CONSOLIDATION OWED — to ONE AUTHORITY, per F-N16-1's precedent** (*"a third copy was refused → ONE named authority"*); the frozen copies mean it needs a gate. **Found by the accommodation sweep** (164 hits, 20 reported): *a local accommodation is a finding that was not filed.* | OPEN | **RECORD** — not Bucket 1; **escalates to BLOCKS-SEND on the first added subsumption case, not on the first disagreement** | F-N16-1 *one named authority, a third copy refused*; §2 #8 *deny-by-default* |
| **F-P47** *(next free; assigned by the worker and reported back)* | **THE COMPOSITION LAYER HAS NEVER BEEN EXECUTED BY A TEST — NOT ONCE, EVER.** The enterprise store singletons are constructed at **MODULE SCOPE** against `app.getPath('userData')` (`org/orgInstance.ts:10`, `workspace/workspaceInstance.ts:10`, `governance/governanceInstance.ts:10`, `personalization/personalizationInstance.ts:9`), where `app` is undefined outside Electron. Importing them throws `TypeError: Cannot read properties of undefined (reading 'getPath')` **at collection, before any test body runs**. They are reached through **FROZEN `enterprise/index.ts`**. **MEASURED, not inferred: 26 non-test modules import `enterprise/index` directly and are untestable at composition level; ZERO test files in the repository import it — not one, ever** (the 11 apparent hits were comment mentions; a direct probe confirmed `enterprise/org/orgInstance`, `enterprise/index` and `services/executiveDelivery` all throw). **WHY THIS IS PRODUCT-CLASS AND NOT MERELY INCONVENIENT:** it is not one untested module, it is **the absence of a verification capability**. Every wiring claim about those 26 modules — *does the real composition root construct? does it resolve identity? does it reach the store it names?* — rests on **reading the code, not running it**, and the suite cannot falsify a single one. That is a systematic false-green generator, and it is exactly what let F-P39's reconciler match **zero rows on every tick for weeks** while its own suite stayed green. **Not BLOCKS-SEND** (the governed send path is independently drivable and is driven), **BLOCKS-PRODUCT** — the worker's bucketing agrees with the operator's read, and the reason is stated rather than deferred to. **WHAT CLEARS IT:** lazy construction of the enterprise singletons (a getter, or construction at `initRuntimeCore` time) so importing `enterprise/index` no longer touches `app.getPath` — a broad behavioural change, its own slice, its own gate; a frozen surface sits in the path. **NOT ROUTED AROUND:** the standing rule is to stop at the freeze, not to tunnel under it for a green criterion. | OPEN | **BLOCKS-PRODUCT** — an entire evidence class is unproducible, not one test missing | **§19-6's two `it.skip`s are this same blocker** (`reconciliation/compositionRoot.test.ts`); its third test — **the pin-the-blocker pattern** — is F-P47's **SELF-CLEARING MARKER**: it asserts the import still throws, so the day the singletons go lazy it goes red and announces that the skips can be un-skipped. §2 #17 *pin against the real path*; *a skipped test is a recorded gap, a deleted one is forgotten* |
| **F-P48** | **THE L6 GATE SKIPS ON A KEY MISS AND THE SEND PROCEEDS.** `deps.workspaceId()` is **TOTAL** — `runtimeCore.ts:474-478` coalesces twice internally, so the gate's own `?? ''` never fires in production and the empty string arrives as a **real, reachable value**, for the case its own docstring names: *a tenant-level or SYSTEM principal reports no workspace.* The proposal was stashed under a real workspace id (`brainProposeLane.ts:83`); the lookup at `proposalStore.ts:60` misses; `gateL6Execution` returns `{gate:'skip'}`; **`executionGate.ts:104` maps skip → `ok:true`.** Neither `L6-GATE ADMIT` nor `L6-GATE REFUSE` is logged, and per §2 #19 the REFUSE path mints nothing in the ActionRecord — so **AN AUDIT SEES A SEND THAT WAS NEVER GATED AND NEVER REFUSED.** **THE LAW: A GATE THAT SKIPS ON A KEY MISS IS NOT A GATE — IT IS A LOOKUP WITH A PERMISSIVE DEFAULT.** **THE CORRELATION THAT MAKES IT SEVERE: the miss happens exactly when identity is unresolved, which is exactly when the gate matters most.** **MITIGATIONS, RECORDED AND EXPLICITLY NOT CREDITED TO THE GATE:** the CST still runs, `sendTransition.ts:181` denies an empty actor, and no vault token is stored under `''` — **but §2 #19 forbids collapsing three evidence classes into one, and none of those is the L6 gate doing its job. THE L6 GATE ITSELF FAILS OPEN.** **THE PRECEDENT IT DOES NOT FOLLOW:** `connectorVault.clear()`'s docstring already ruled this exact question — *"`''` and `undefined` are treated identically, because AN EMPTY ID IS AN UNRESOLVED ID WEARING A STRING"* — after a missing workspace once wiped every workspace's credentials. The vault learned it; the gate did not. **MIRROR OF F-P46:** there, one rule in three copies; here, **a MISSING copy** — the empty-id refusal exists at `boundDecisionClaimMint.ts:73` (`NO_TENANT`) and at the vault, but **not on the mail.send path**. Also recorded: `cst/sendTransition.ts` accepts `tenantId: ''` with **no emptiness check**, carrying it into `actor.tenantId`, the idempotency hash (`:167`) and `scope.tenantId` (`:201`). **NOT FIXED — the `??` is untouched by ruling.** | OPEN | **BLOCKS-SEND** | F-P46 *its mirror*; §2 #19 *evidence classes never collapse*; §2 #8 *deny-by-default*; P0's fail-open class |
| **F-P49** | **THE MOCK IS A HAND-COPY OF THE THING IT IS SUPPOSED TO CHECK.** `e2e/mockGraph.test.ts:34` describes itself as a *"faithful mirror of `makeM365GraphReader`'s Graph→SentItem/InboxItem mapping"* — a second, independently-maintained implementation of the production mapping. **If the real mapping changes, the mirror stays green**, because nothing compares them; the test would go on passing while describing code that no longer exists. **F-P46's class living inside a test** — and worse-placed than F-P46, because a divergent *test* reports success rather than merely disagreeing. Compounding it: `makeM365GraphReader` has **never been executed by anything** (its only two test mentions are this mirror and a source-text string assertion at `vocabularyReconciliation.test.ts:252`), and `mockGraph.ts:127,130` dispatches on a **folder-path regex** that parses no `$select`/`$top`/`$orderby` — so the mock **cannot falsify the adapter's query shape** and would keep returning a field the adapter had stopped requesting. **NOT FIXED; mockGraph untouched by ruling.** | OPEN | **RECORD** | F-P46 *one rule, several copies*; §2 #17 *pin against the real path*; the adapter-seam envelope |
| **F-P45** *(the operator's directive said "F-P42"; **that number is TAKEN** by the `AuthStatus`-collapse row at `:122`, as are F-P43 and F-P44 — assigning it would have been the ELEVENTH collision, created in the register while recording the tenth. Next free number used; the id is the operator's to re-rule, and it is a one-line change)* | **THE EVIDENCE STORE'S SCOPE KEY IS WRITTEN AS A WORKSPACE ID AND READ AS AN ORGANIZATION ID BY EVERY PRODUCTION CONSUMER.** Writer `connectors/index.ts:641` → `deps.workspaceId()` (`runtimeCore.ts:474-478`). Readers: the reconciler and `m365WriteStates` both key on `organization.id`. Two separately-seeded namespaces (`workspace-default` / `org-default`), **no mapping at the query boundary**. **CONSEQUENCE, verbatim: THE ONE READER THAT AGREES WITH THE WRITER IS THE COMPILE-STRIPPED e2e RUNNER — WHICH IS PRECISELY WHY S15/S16 APPEARED TO WORK WHILE THE SHIPPED PRODUCT CANNOT.** **FRAMING CORRECTED (operator, in this row): THE READER CONFORMS TO A DEVIATING WRITER** — not "the reader invented a key". The convention is unanimous (~25 tenancy files + canonical `testScope.ts`); `connectors/index.ts:641` is the outlier. **INSTANCES, not siblings** (F-P24's shape — one root, several symptoms, each individually defensible): the dead counter row (`m365WriteStates`, five counters at zero) and **F-P39's inertness**. **A FOURTH POSITION EXISTS AND WAS ALREADY KNOWN:** `liveBrain/brainProposeLane.ts:82-83` conforms to the writer *with an explicit "ALIGNMENT 1" comment* — the deviation was locally accommodated twice and never registered. **⚠ THIRD REFRAMING (operator, 21 Aug 2026) — RULING B HOLDS, AND IT INVERTS THE PREVIOUS TWO. All three are recorded so the drift is visible:** **(1)** *"the reader invented its own key"* — refuted by measurement. **(2)** *"the reader conforms to a deviating writer"* — accommodation framing; superseded. **(3) THE EVIDENCE STORE IS WORKSPACE-SCOPED. THE VALUE IS CORRECT; THE COLUMN NAME IS WRONG.** **CONFIRMED FROM SOURCE, not from the lane's comment:** `liveBrain/executionGate.ts:82` `const tenantId = deps.workspaceId() ?? '';` — the L6 gate derives its key as the **workspace id** and feeds it to `:96` `gateL6Execution({ tenantId, … })`, **the authorization decision itself**, plus its ADMIT/REFUSE log lines. Same `deps.workspaceId()` the writer uses. **LAW: EVIDENCE MUST BE KEYED THE WAY THE GOVERNANCE DECISION THAT PRODUCED IT IS KEYED — otherwise a record is readable by principals who could not have authorized it.** The store has no `workspaceId` column and uses `tenantId` for a workspace-scoped value. **THE MIGRATION OWED IS A RENAME, NOT A RE-KEYING — it changes no record's meaning.** **THE RECONCILER IS CORRECT, NOT ACCOMMODATING. THE COUNTER ROW IS THE BUG.** **TENTH NAMING COLLISION, and the first in a persisted schema: `ActionRecord.tenantId` HOLDS A WORKSPACE ID.** Documented; column untouched; nothing renamed. **LESSON: we classified this identity defect as non-blocking, and it has now blocked the thing we most wanted — same root as the dead counter row.** | OPEN — reconciler unblocked 21 Aug (two lines, accommodation); **migration still owed** | **BLOCKS-SEND** — *a record finding that blocks a BLOCKS-SEND finding is itself BLOCKS-SEND*; **F-P39 is gated behind it** | §2 #17 *pin against the real path*; *an undefined key that two subsystems interpret differently is the finding* |
| **F-P39** | **CURRENT STATEMENT (CORR-1, re-measured 21 Aug 2026 at `2ffeefa`): the caller EXISTS; THE UNMET CONDITION IS THE NEVER-PRODUCED TERMINAL.** `readBackReconciler.ts:33` statically imports `verifyGovernedSend` from a module that is **neither a test nor compile-stripped**, and it is reached from **`runtimeCore.ts:4072` → `serviceManager.startAll` → `serviceManager.ts:141`** (registered, not in the skip set). Nothing in that chain is `__NP_E2E__`-gated, env-gated or stripped — `verify-e2e-strip.sh` targets `e2eSeed`/`firstRealSendGuard`/`e2eMode`/`s16VerifyRun`/`mockGraph`/`e2eVerifyRun`, and names neither `verification/` nor `reconciliation/`. So §21's conditions read: production caller ✓ · production path ✓ · production dependencies ✓ · no test-only substitution ✓ · no compile-stripped substitution ✓ · **ACTUAL READ-BACK TERMINAL ✗ — never once produced.** One condition unmet ⇒ **OPEN**. The adapter it depends on (`makeM365GraphReader`) has **never been executed by anything**, and its query shape is unfalsifiable by the current mock (F-P49's neighbourhood). **SUPERSEDED STATEMENT, kept visible the way F-P45 keeps its three framings — never deleted, because a register that erases its own errors cannot be audited:** *"The read-back has NO PRODUCTION CALLER — step 6 of the ceremony does not exist in production. `verifyGovernedSend`'s only non-test importers are two `__NP_E2E__`-gated, compile-stripped e2e modules; the recorded S22 production caller is not built."* **That was TRUE when written and became FALSE when the reconciler landed against it** — the finding's statement expired and nobody re-measured (§2 #21). **What did NOT change: the ceremony as built still ends at PROVIDER_ACKNOWLEDGED.** | OPEN | **BLOCKS-SEND** — supersedes the read-back-terminal item | §2 #14 *universal read-back*; F-N17-4's *declared ≠ reachable*, at the worst site in the chain |
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
