# F-P39 — PRODUCTION READ-BACK · IMPLEMENTATION ENVELOPE

**Drawn 21 Aug 2026 · against `CERT-c563cdd` / `BASELINE-7e65fe38ccc8` · FREEZE INTACT (ANCESTRY OK · SOURCE OK)**
**Status: DRAWN, NOT APPROVED. Nothing in this document has been implemented.**

> **THE HEADLINE, STATED FIRST BECAUSE IT CHANGES THE SHAPE OF THE WORK:**
> F-P39 was scoped as *"`verifyGovernedSend` has no production caller — give it one."* **That scoping is wrong, and
> the recon that drew this envelope is what proved it.** The orchestration seam is genuinely ready (§8) and the
> wiring is genuinely free (§6). But **the evidence store cannot supply the inputs a `VerificationTarget`
> requires** (§9): the send time does not exist in any honest form, and the record's fingerprints are SHA-256
> hashes while the oracle compares normalized plaintext. **A reconciler wired today would compile, run, query,
> find its rows — and be unable to construct a single well-formed verification target.**
>
> **F-P39 is not one missing caller. It is a missing caller plus four substrate decisions, at least two of which
> are GOVERNANCE-class under §2 #18.** Those decisions are §21, and they are why this envelope stops at the
> approval boundary rather than proposing a diff.

---

## §1 · IDENTITY & SCOPE

| | |
|---|---|
| **Finding** | F-P39 — the read-back has no production caller; ceremony step 6 does not exist in the shipped product |
| **Bucket** | **BLOCKS-SEND** · **BUCKET 1** (`P1 · F-P8 · F-P39`, operator-ruled 21 Aug) |
| **Evidence rung** | **ESTABLISHED-NEGATIVE** (import-graph fact, four independent corroborations) |
| **Baseline** | `CERT-c563cdd` · `BASELINE-7e65fe38ccc8` · branch `cert/data-import-cst-integration` |
| **Frozen touches proposed** | **ZERO** (§6, §7) |
| **External effects proposed** | **ZERO** — the reconciler is READ-ONLY against the provider |
| **Ceremony relationship** | **NP-000 is untouched.** This envelope neither advances nor releases the ceremony hold. |

**IN SCOPE:** a production read-back reconciler; its host, wiring, single-flight, durability, evidence class, and
tests. **OUT OF SCOPE, explicitly:** resolving HOLDs (§12) · any resend (§13) · the mock-reader divergence
(recorded separately, §18) · the body limb (recorded, §9.4) · F-P8 content validation · P1 attempt 2.

---

## §2 · THE FINDING, RESTATED FROM SOURCE

`verifyGovernedSend` (`verification/verifyGovernedSend.ts:73`) has **zero non-test importers outside `src/main/e2e/`**:

- `e2e/s16VerifyRun.ts:17,53` — double-gated at `index.ts:215` (`__NP_E2E__ && NEUROPAUSE_VERIFY_S15==='1'`)
- `e2e/e2eVerifyRun.ts:15,38` — sentinel-gated

Both are compile-stripped, asserted by `apps/desktop/scripts/verify-e2e-strip.sh:32,33,38`. Same for
`actionRecord.recordVerification` — sole non-test caller is `e2e/s16VerifyRun.ts:71`.

**Four independent corroborations:** the import graph · `liveBrain/executionGate.ts:67-68` hardcodes
`productionWired: false` on **both** `VerificationPlan` branches · `m365WriteStates` `EXTERNALLY_OBSERVED` is
structurally pinned to 0 (F-P41, §18) · the strip script itself anticipates the absence at `:36-37`
(*"it ships when a production caller, e.g. the S22 reconciler, imports it"*).

**Consequence, in the §2 #19 vocabulary:** *a verification class with no production caller is not a separate
evidence class — it is an absent one.* **The ceremony as built ends at PROVIDER_ACKNOWLEDGED.**

---

## §3 · THE EIGHT RULINGS, AND WHERE EACH LANDED

| | Ruling | Disposition in this envelope |
|---|---|---|
| **A** | Source wins; correct §1 | **APPLIED** — `CLAUDE.md:25` corrected; **§2 #20 canonized** |
| **B** | S16 = E2E-VERIFIED, not PRODUCT-VERIFIED | **APPLIED** — precision recorded at `CLAUDE.md:18`; not a withdrawal |
| **C** | Register is DESCRIPTIVE; §1 normative | **APPLIED** — register header + `BLOCKERS.md`; arithmetic re-ruled |
| **D** | The two pins are FALSE GREEN | **§17** — relabels specified verbatim; **6 read-sites found, not 2** |
| **G** | HOLD is terminal for the reconciler | **§12** — designed in as a stop, not a step |
| **H** | Resend dissolves | **§13** — absence recorded; nothing invented |
| **I** | Baseline re-record authorized | **DONE** — `BASELINE-7e65fe38ccc8`, INTACT both limbs |
| **J** | Wire like `executiveDelivery`, zero frozen | **§6** — **SATISFIABLE**, with a precision the ruling did not have |

---

## §4 · WHAT IS BEING BUILT

**ONE new non-frozen module** — a tenant-scoped, read-only reconciler that:

1. runs per tenant on the existing 60 s background cadence;
2. finds ACKNOWLEDGED-but-unverified action records for that tenant;
3. builds a `VerificationTarget` **(§9 — this is the blocked step)**;
4. drives the existing pure oracle over an **injected** `ReadBackReader`;
5. records the terminal via `recordVerification`, HOLD included;
6. **stops.**

**WHAT IT IS NOT, and must never become:** not an executor · not a resender · not a HOLD resolver · not an
authority source. It reads, classifies, records, stops.

---

## §5 · THE HOST — `forEachTenantBackground`

`enterprise/index.ts:514-520`, a 6-line binding; semantics in **non-frozen** `tenancy/backgroundFanOut.ts:203-230`.

**What it supplies, and why each matters here:**

- **Cadence** — 60 s, three existing drivers (`unified/sync` · `deliveryEngine` · `automationPlatform`).
- **Tenant isolation** — `runAsPrincipal` at `:213` (`AsyncLocalStorage`), carried across every await; the
  strongest-pinned property in the tenancy program (`backgroundFanOut.test.ts:125-133`, `:163-186`).
- **Failure isolation** — `:211-228` wraps the body *inside* the loop; tenant A's expired token cannot silence
  tenant B's reconciliation. This is §2 #9's requirement structurally provided.
- **It grants NOTHING.** `permissions` defaults `[]`, **no production call site supplies any, and no
  authorization code anywhere reads a `BackgroundPrincipal`**. The governed-send actor comes from the session
  (`runtimeCore.ts:485`, "tenant ≠ actor"), `null` when unauthenticated ⇒ the CST boundary **denies**.
  **A fan-out run cannot manufacture an actor for a consequential action** — see §15.
- **Read-only provider HTTP is precedented and tenant-credentialed** — `unified/sync` → `orchestrator.ts:373`
  `resource.pull` → real `fetch` to real provider hosts, token per run, owning tenant resolved before any call
  and **refused if absent** (`orchestrator.ts:302-326`).

---

## §6 · THE WIRING ROUTE — RULING J, WITH ONE PRECISION

**Ruling J is SATISFIABLE. Zero frozen touches. But the ruling's own phrasing needs a correction, and the
correction matters.**

**The precision:** *"wire like `executiveDelivery`"* is **not literally reproducible.** `executiveDelivery`'s own
boot is **four frozen lines** in `runtimeCore.ts` (`:145` import, `:239` import, `:747` `initExecutiveDelivery()`,
`:968` `bindDeliveryViewer`). Every module that touches the fan-out today has its name in a frozen file. Strictly,
"non-frozen module that imports the fan-out AND boots with no frozen line" is **the empty set.**

**Why ruling J still holds:** the operative distinction is **NEW frozen line vs EXISTING generic frozen line**, and
the precedent for zero *new* frozen lines is exact and committed.

> **PRECEDENT — commit `9cb933c` "V2.3: Organization Intelligence."** Added a brand-new per-tenant fanned-out
> background module. Files changed: `enterprise/orgIntelligence.ts` (new, 291 lines) + its test + docs +
> **`services/executiveDelivery.ts` +4 lines** (one import, one `deliveryEngine.register(...)`).
> **`runtimeCore.ts` was NOT touched.** Same shape for `founderProactive.ts`.

**THE ROUTE (recommended): register a source on the already-booted `deliveryEngine`.**

| Step | Site | Frozen? |
|---|---|---|
| New module `verification/readBackReconciler.ts` | new file | non-frozen |
| `deliveryEngine.register(readBackReconcilerSource)` | `services/executiveDelivery.ts:283-293` | **non-frozen** (`gate-detector` → PROCEED) |
| Boot | `runtimeCore.ts:747` `initExecutiveDelivery()` — **already exists** | frozen, **unmodified** |

Tenant fan-out arrives free: `deliveryEngine.start()` → `taskScheduler.every('delivery-engine:tick', 60_000)`
→ `tick()` → `forEachTenant('delivery-engine', …)` (`deliveryEngine.ts:142`) → per-tenant `produce()` under that
tenant's principal.

**ALTERNATE (equally zero-frozen):** append to the **non-frozen** `serviceManager.ts:124-135` services list;
`startAll` at `runtimeCore.ts:4072` already exists. Precedent: `crashReporter`, `taskScheduler`,
`notificationScheduler`, `appUpdater`, `pluginLoader`, `companionGatewayService` all live only in that list.
Rejected as primary only because it gives no tenant fan-out — the reconciler would have to call the fan-out itself.

**Ruling J's stop condition is NOT triggered. FG-15 is NOT required and is NOT requested.**

---

## §7 · FROZEN-SURFACE ANALYSIS

`gate-detector.sh` run against every path this envelope would touch:

| Path | Class | Verdict |
|---|---|---|
| `verification/readBackReconciler.ts` (new) | — | PROCEED |
| `services/executiveDelivery.ts` | non-frozen | **PROCEED** |
| `connectors/actionRecord.ts` | absent from all three lists | **PROCEED** — *but see §21, §2 #18 applies* |
| `verification/verifyGovernedSend.ts` | **sensitive** (`verification/`) | **GATE-class — diff presented, never slipped in** |
| `runtimeCore.ts` · `enterprise/index.ts` · `connectors/index.ts` · `cst/` · `packages/shared` | **frozen** | **NOT TOUCHED** |
| `src/main/e2e/` | **sensitive** | §17 relabels are **test-file only**, presented |

**The standing lesson from NP-014 is honored: the detector runs on EVERY path BEFORE it is edited**, including
operator-mandated in-slice work.

---

## §8 · THE SEAM — ALREADY READY

```ts
// verification/verifyGovernedSend.ts:41-45
export interface ReadBackReader {
  readSentItems: () => Promise<readonly SentItem[]>;
  readInbox: () => Promise<readonly InboxItem[]>;
}
```

`reader` is a **parameter** (`:75`); `verifyGovernedSend.ts` imports nothing from `m365ReadBack` (`:19-26`); the
module says so at `:16-17` — *"The reader is injected so the caller owns all I/O and identity."* The pattern is
already green: `verifyGovernedSend.test.ts:25-29` drives all three terminals through a `vi.fn` reader.

**BINDING CONSTRAINT:** both existing callers **hard-wire** reader construction inside themselves
(`s16VerifyRun.ts:50`, `e2eVerifyRun.ts:34`) and are therefore untestable. **The reconciler MUST accept the reader
as a dependency**, with `makeM365GraphReader` supplied by its composition root. Copying the existing shape
inherits the defect.

---

## §9 · ⛔ THE BLOCKING SUBSTRATE GAPS

**This is the section that stops the envelope.** The store cannot supply a `VerificationTarget`:

```ts
// verifyEffect.ts:25-31
interface VerificationTarget {
  internetMessageId: string | null;
  recipient: string;
  subjectFingerprint: string;
  bodyFingerprint: string;
  sentAtWindow: { fromMs: number; toMs: number };
}
```

### 9.1 · TWO FUNCTIONS NAMED `fingerprint`, DIFFERENT CODOMAINS — **HARD BLOCKER**

```ts
actionRecord.ts:186-189   → sha256(normalized).slice(0,16)   // one-way hex
verifyEffect.ts:80-82     → normalized plaintext             // comparable text
```

The oracle compares them as plaintext (`:91`, `:96`). **Feeding the record's SHA into `matchesTuple` yields
`subjectOk === false` always**, and `startsWith` over a hash is meaningless. The record's one-wayness is
*deliberate and pinned* (`actionRecord.test.ts:86-87,92-94` — the persisted file must contain no subject/body
text). **`matchesTuple` cannot be reused unmodified.** This is the F-N16-4 shape — two identities for one concept —
and must be **classified before it is normalized.**

### 9.2 · NO SEND TIME EXISTS — **HARD BLOCKER**

`sentAtWindow` has no honest source. `at` = record-write time (`:108`, `:300`) · `requestTime` = request
*construction*, nullable, and FG-12 recorded verbatim *"never a proxy for authorization time or execution time"* ·
`eventTime` = **null on the only production path** (`connectors/index.ts:641` supplies none, and that call site is
frozen). Using any of them as `sentAtMs` is precisely the **nearest-timestamp-fills-empty-field** move NP-019
refused. **And NP-015 established the property that makes this fatal rather than cosmetic: an untimeable row
CANNOT corroborate — the window is part of the tuple.**

### 9.3 · EIGHT FURTHER GAPS

| # | Gap | Source |
|---|---|---|
| 3 | **Cannot find work.** `ActionRecordQuery` has no verification predicate; filter has no verification term | `:149-155`, `:357-367` |
| 4 | **Cannot enumerate tenants.** `tenantId` mandatory, `records` private, no `tenants()` | `:150`, `:247` |
| 5 | **`internetMessageId` is an OUTPUT, never an input** — exists only on `ActionRecordVerification` | `:72` |
| 6 | **Multi-recipient sends are unrepresentable** — record holds arrays; matcher requires exactly one | `:137` vs `verifyEffect.ts:90` |
| 7 | **`transitionId` COLLIDES BY CONSTRUCTION** — content-addressed; two identical sends share it, `.find()` takes the first | `sendTransition.ts:165-169,212`; `actionRecord.ts:97-99,342` |
| 8 | **`recordVerification` OVERWRITES UNCONDITIONALLY** — `:347`, no read, no class check, no history. **A re-run silently downgrades a VERIFIED_SUCCESS to HOLD on a transient reader failure** | `:339-352` |
| 9 | **No attempt/backoff/hold-age state** — `VerifyResult.attempts` never persisted; a reconciler restarts from zero every launch, and S22's "holds with age + next probe" has no backing data | `verifyEffect.ts:63` vs `:70-85` |
| 10 | **Cannot pass `prior`** for oracle idempotency — `ActionRecordVerification` lacks `attempts`/`detail`/`bounceReason`, so a `VerifyResult` cannot be reconstituted | `verifyEffect.ts:120-127` |

### 9.4 · RECORDED, NOT BLOCKING

**The body limb is vacuous in both directions** and the only real-Graph caller passes `body:''`. The live tuple is
**three-limbed: recipient + subject + time** — the oracle says so about itself (`verifyEffect.ts:142`).
**`DECISIONS.md:44,50` contradicts this**, asserting body *is* in the tuple. **Zero negative pin exists; no test
ever varies `bodyPreview`.** F-P39 is INDEPENDENT of the limb: it cannot rescue it and cannot aggravate it.

---

## §10 · MANDATORY BUILD 1 — SINGLE-FLIGHT, KEYED ON THE HOLD

**The host provides no lock at any layer.** All three drivers are `void`-ed fire-and-forget
(`deliveryEngine.ts:107`, `automationPlatform/index.ts:488`, `scheduler.ts:19`), so **a pass exceeding 60 s
overlaps itself.** Every consumer that needed protection built its own, at a different grain: sync = per-**account**
mutex (`orchestrator.ts:185,273-276`); deliveryEngine = per-`(tenant,source)`-per-**minute** stamp
(`:127,147-150`); automationPlatform = none at tick level.

**S22's "no hold is lost or double-resolved" IS NOT INHERITED.** Build it: coalesce-onto-in-flight following
`orchestrator.ts:273-276`, **keyed on the hold, not the tenant** — a tenant-grain lock would serialize unrelated
holds and still permit double-resolution of one hold across ticks.

**This is not optional given §9.8:** an unconditional overwrite plus an overlapping pass is a mechanism for
silently destroying a settled terminal.

---

## §11 · MANDATORY BUILD 2 — DURABILITY ACROSS AN UNDRAINED SHUTDOWN

**The fan-out is absent from all seven flush-barrier registrations** (`index.ts:250` app-log ·
`enterprise/index.ts:607,608,609` · `:1208` · `platform/index.ts:332` · `workspaceContextsInstance.ts:21`), and
**no scheduler is stopped at quit** — `serviceManager.stopAll()`, `TaskScheduler.stop()`, `sync.dispose()`,
`deliveryEngine.stop()` all have **zero production callers**. A pass in flight at `will-quit` is torn down mid-probe.

**And the stores it would rebuild from are themselves not shutdown-safe:**

| store | path | write timing | in barrier | boot-loaded |
|---|---|---|---|---|
| `HoldStore` | `<userData>/holds.json` | **BUFFERED** — unawaited `drain()`; raiser returns synchronously | **NO** | YES |
| `DecisionRecordStore` | `<userData>/decision-records.json` | BUFFERED | **NO** | YES |
| `ActionRecordStore` | `<userData>/action-records.json` | write-through, **but the call is `void`-detached** at frozen `connectors/index.ts:641` | **NO** | **NO** — lazy |

**None is fsync'd.** `AppendOnlyJsonStore.flush()` exists (`appendOnlyStore.ts:386-389`, docstring: *"Tests and
shutdown use this"*) and **nothing registers it.** Registering a reconciler flush at `shutdownFlush.ts:36` is
available and would be **the barrier's first non-store entry**.

**Honest bound to state in the evidence doc:** the reconciler's durability can be no better than the stores
beneath it, and those are S20 territory. **Do not claim crash-safety this envelope cannot deliver.**

---

## §12 · HOLD IS TERMINAL FOR THE RECONCILER (RULING G)

**Read → classify → record HOLD → stop.** Resolving a HOLD is a separate slice.

This is designed in structurally, not by convention: the reconciler has no promotion path, no retry-to-success
loop, and no branch that converts HOLD into any other terminal. §2 #9 stands — **UNKNOWN → HOLD →
RECONCILIATION**, and *UNRESOLVED remains unresolved*. **Evidence, never time** (NP-014's RULE pin).

**Existing HOLD substrate, for the record:** `raiseM365UnknownHold` (`connectors/index.ts:424-452`, frozen) is a
**null-by-default late-bound sink**; the sole production binding is `runtimeCore.ts:1229` → `createHoldRaiser`
(`decisions/raiseHold.ts:71-116`) → `holdStore.open` + `decisions.record` + `audit('hold.raised')`.
`HoldStore` (`<userData>/holds.json`) is **the only durable hold structure in the repo** —
`holdQueue` and `pendingVerification` return **0 hits** against a 35-hit control. **No production caller iterates
open holds to drive verification.**

---

## §13 · RESEND — THE ABSENCE, RECORDED (RULING H)

**Ruling H dissolves this, and the reasoning generalizes:** *a missing policy only blocks if the thing being built
needs it.* **The reconciler never executes.** It has no send path, no retry-with-effect, no queue drain.

**Recorded for whatever does need it, so the gap is not rediscovered:** there is no resend policy anywhere in this
product. No component defines when a send may be retried, under what authority, with what idempotency, or how a
retried send relates to its predecessor's ActionRecord. **The first component that proposes to re-execute a
consequential action needs this ruled first — and per §2 #18 it is a governance question, not a design one.**
**Nothing was invented here.**

---

## §14 · EVIDENCE CLASSES (§2 #19)

The reconciler produces **VERIFICATION-class evidence only**, and must never write the other two:

```
GOVERNANCE  (ALLOW/ASK/DENY/HOLD)    ← not written by the reconciler
EXECUTION   (NOT_STARTED/…/FAILED)   ← not written by the reconciler
VERIFICATION (VERIFIED_SUCCESS / VERIFIED_FAILURE / UNKNOWN / HOLD)  ← the reconciler's ONLY output
```

Reconciled against **D-16's `verificationTerminals.ts`** and **NP-018's `Certainty` (including `STALE`)**, never
minted alongside. **A reader failure is `UNKNOWN`, never `execution_failed`** — the conversion §2 #19 explicitly
forbids. Provenance (RULE-012) is mandatory on every terminal the reconciler writes: `{source, method, oracle}`,
with `source` naming the reconciler — **not** `'s16VerifyRun'`.

**Note the store's own gap:** `ActionRecordVerification.terminal` is typed **bare `string`** (`:71`), not the D-16
union. The reconciler must not rely on the type system here.

---

## §15 · AUTHORITY ANALYSIS — GRANTS NOTHING

Three independent structural facts, each verifiable without trusting this document:

1. `resolveTenantScope` **selects** a scope, it does not grant (`backgroundPrincipal.ts:166-168`). A tenant-level
   principal's empty `workspaceId` makes it see **fewer** records, and `requireWorkspace()` refuses it.
2. `permissions` is **inert** — default `[]`, never supplied by any production call site, and **read by no
   authorization code anywhere** (`platformAuthority.ts:14-17` states it; independently confirmed by grep).
3. The governed-send actor is **not derived from the principal** (`runtimeCore.ts:485`) — session-derived,
   `null` when unauthenticated ⇒ **the CST boundary denies.**

**CORRELATION IS FOR EVIDENCE, NEVER FOR AUTHORIZATION** — the reconciler reads `correlationId` to link episodes
and must never let it influence a decision. **EVIDENCE IS NOT AUTHORITY** (§2 #15): a recorded VERIFIED_SUCCESS is
evidence for a future proposal and **never permission**.

---

## §16 · TENANT ISOLATION

Per-iteration `runAsPrincipal` (`backgroundFanOut.ts:213`) + mandatory `tenantId` on every query (`:150`,
enforced at `:359`; cross-tenant isolation pinned `actionRecord.test.ts:113-114`).

**⚠ ONE REAL HOLE:** `recordVerification` (`:339`) is **the one method on the singleton with no tenant argument** —
`this.records.find(...)` scans **all tenants' rows.** Isolation there rests entirely on `tenantId` being inside the
`idem` hash input (`sendTransition.ts:167`), not on any code in the store. Combined with §9.7's collision-by-
construction, this is a **confused-deputy surface (S32 class)** and must be closed by the envelope, not inherited.

---

## §17 · THE FALSE-GREEN PINS (RULING D)

**Ruling D named two. The sweep found SIX read-sites across three files** — and the grep that would have missed
them is worth recording: **a literal grep for `src/main/e2e` in tests returns 0 hits**, because every site builds
its path via `join(__dirname, 'e2e', …)`. *Absence by that grep would have been false.*

**Mechanism:** `readFileSync` reads the **source tree** at test time. The `.ts` file exists on disk unconditionally.
**These pins pass identically whether or not the code ships — they cannot fail for the reason their titles imply.**

### TIER 1 — ruling D's two, titles say literally "the PRODUCTION caller"

| Pin | Title (verbatim) | Relabel |
|---|---|---|
| `constitutionalInvariants.test.ts:485` | `'the PRODUCTION caller supplies provenance at its recordVerification call site (source-pinned)'` | `'the only recordVerification call site — compile-stripped e2e/s16VerifyRun.ts — supplies provenance (source-pinned; NO production caller exists, F-P39)'` |
| `temporalModel.test.ts:188` | `'the PRODUCTION caller passes the oracle\'s instant through untouched (source-pinned)'` | `'the compile-stripped e2e caller passes the oracle\'s instant through untouched (source-pinned; not a production path, F-P39)'` |

Pin 1's own docstring (`:479-484`) calls the file **"GATE-class SENSITIVE"** while its title calls it production.

### TIER 2 — production-flavoured, operator's call

| Pin | Title | Proposed |
|---|---|---|
| `vocabularyReconciliation.test.ts:204` | `'the ORCHESTRATOR that is actually called is named by NEITHER identifier'` | `'the ORCHESTRATOR the e2e runner delegates to is named by NEITHER identifier'` |
| `vocabularyReconciliation.test.ts:210` | `'the registry names the RULE, and the record names the READER…'` | `'…and the e2e recording site names the READER…'` |

### LEAVE ALONE — honest negatives
`vocabularyReconciliation.test.ts:193` and `:218` claim nothing about production; `:218` is an **absence** pin over
a named file list, where reading stripped files is legitimate.

**Relabel, not removal:** assertions preserved verbatim, and genuine drift detection over a GATE-class file is kept.
**These are `sensitive`-class files — the diff is presented, never slipped in.**

---

## §18 · F-P41 — STATEMENT AND BUCKET (STATED, NOT HELD)

**Statement:** `m365WriteStates`'s `EXTERNALLY_OBSERVED` counter is production-live but derives from verification
terminals that no production code path can write, so it is **structurally pinned to 0 by construction rather than
by observation** — and its honesty rests entirely on a **comment** (`m365WriteStates.ts:13`).

**Classification: (iii) — a measurement claiming a state its source cannot produce.** Not a defect in
`m365WriteStates`: `:47` `if (isSuccessTerminal(r.verification?.terminal)) externallyObserved += 1;` is *correct
code* using the D-16 authority. **The input can never arrive.**

**Bucket: `BLOCKS-CLAIM` — rides with F-P39, does not gate independently.** Fixing F-P41 in isolation would be
normalizing a red verifier (**§2 #4**). **It closes when F-P39 closes, and not before.**

**Total mentions repo-wide: 2** (`CONTROL-REGISTER.md:81`, `ARCHITECTURE-MAPPING.md:1285`).

**The tie to §17:** the two Tier-1 false-green pins are *what let F-P41 stay invisible* — they assert the
provenance/effect-time plumbing works "at the PRODUCTION caller" while reading the one compile-stripped file that
contains it. §2 #17 exactly.

---

## §19 · ACCEPTANCE — WHAT WOULD PROVE IT

**Every criterion is a test, and every test drives a real seam (§2 #17).**

1. **The negative that must flip:** a pin asserting `verifyGovernedSend` has ≥1 importer outside `e2e/` and tests —
   **red today, green after.** This is F-P39's closure condition and nothing else is.
2. `executionGate.ts:67-68` `productionWired: false` → re-derived, not hand-flipped.
3. **Single-flight:** two overlapping passes over one hold ⇒ exactly one probe (§10).
4. **HOLD is terminal:** a HOLD input never yields a non-HOLD output; **no promotion path exists** (§12).
5. **No overwrite:** a settled terminal survives a subsequent transient reader failure (§9.8).
6. **Tenant isolation:** tenant A's reconciler cannot read or write tenant B's record — driven through the **real**
   fan-out, not a fixture (§16).
7. **Zero authority:** the reconciler cannot cause an external effect; no import path reconciler → executor/CST.
8. **Observer invariant preserved:** `actionRecord.test.ts:204-213` still green.
9. **Strip script:** `m365ReadBack.ts` **ships** (it gains its first production importer — anticipated at
   `verify-e2e-strip.sh:36-37`) while the e2e seams stay absent.
10. **Suites:** full main + UI + typecheck + lint + honesty scan, per §3's full-suite discipline.

**HONEST BOUND, to be stated in the evidence doc and not softened:** a reconciler proven through an injected reader
is **TEST-VERIFIED at the orchestration layer**, while `makeM365GraphReader` — which has **never been executed by
any test, ever** — remains unexercised. **A reader more generous than the real adapter is a false green with extra
steps.** Recommend a distinct row (**F-P44 class, BLOCKS-CLAIM**): the mock is structurally incapable of falsifying
the production query shape, because `mockGraph.ts:84-109` **ignores `$select` entirely** — invisible in *both* the
unit and real-Electron paths.

---

## §20 · THREAT ANALYSIS, BOTH DIRECTIONS

**If we build it:** a new background job doing provider I/O per tenant on a 60 s cadence. Mitigations: read-only
(no write scope exercised) · precedented (`unified/sync` already does exactly this) · zero authority (§15) · single-
flight (§10) · failure-isolated by the host. **Residual:** additional Graph read volume; an undrained shutdown can
lose an in-flight pass (§11) — **acceptable only because the pass is idempotent and re-derivable, never because it
is unlikely.**

**If we don't:** the product ships a verification layer that **cannot run**. `EXTERNALLY_OBSERVED` stays pinned at 0
(§18); the ceremony's step 6 remains a step no user's installed copy can perform; **and every claim about
"independent verification" in the product is, at the artifact level, false.** §2 #14 is unmet for the one certified
capability. **This is the larger risk, and it is not close.**

---

## §21 · ⛔ UNRESOLVED — THE APPROVAL BOUNDARY

**Four decisions are required before a single line is written. Each is a DESIGN or GOVERNANCE decision, not a
patch, and I am not making any of them.**

**D1 · THE SEND-TIME QUESTION (§9.2) — GOVERNANCE-CLASS.**
`sentAtWindow` has no honest source. Two readings, and they diverge:
- **(a) REFUSE** — no measured send instant exists, so no window may be built; NP-019's precedent applies directly
  and F-P39 cannot close without a new honest time source.
- **(b) DERIVE AN EXPLICIT UNCERTAINTY INTERVAL** — `at` (record-write) is an *observed* instant within seconds of
  the send; a deliberately wide window centered on it is an **interval of uncertainty**, not a claimed instant, and
  is a different epistemic act from stamping a phase that was never measured.
**I lean (b) but will not act on a lean.** §2 #18's test applies: a temporal attribute that changes what
corroborates **is** a governance change. **The operator rules this.**

**D2 · THE FINGERPRINT RECONCILIATION (§9.1).** Two functions, one name, different codomains. Options: a shared
authority · a matcher variant taking the hash form · storing a comparable form (**rejected on sight** — it would
undo the pinned one-wayness). **F-N16-4 shape: CLASSIFY BEFORE NORMALIZING.**

**D3 · `recordVerification` SAFETY (§9.8, §16).** Needs a tenant argument and a non-destructive write rule
(minimum: a terminal-class check so a settled terminal is never silently replaced). **§2 #18 applies — this changes
what the system may do to existing evidence.**

**D4 · QUERY EXTENSION (§9.3).** A verification-absence predicate plus non-tenant narrowing. `actionRecord.ts` is
non-frozen (no FG token), **but §2 #18's test still applies.**

**Additionally NOT decided here:** whether attempt/backoff state (§9.9) is in scope or deferred with S22's operator
surface.

---

## VERDICT

**ENVELOPE DRAWN. NOT APPROVED. NOT IMPLEMENTED.**

The wiring is free (§6), the host is suitable (§5), the seam is ready (§8) — **and the substrate cannot yet feed
them (§9).** F-P39 is a bigger finding than its own statement, and the honest thing to report is that discovering
this **was** the value of the reconciliation: an envelope written a day ago would have specified a reconciler that
compiles, runs, and silently produces nothing.

**Nothing is blocked on me. Four rulings (§21) and this proceeds.**
