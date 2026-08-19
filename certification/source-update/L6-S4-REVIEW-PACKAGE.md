# L6-S4 · REVIEW PACKAGE (presented at the HARD STOP — no proposal code exists)

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

The Brain has proven it can SEE (S1) and REASON (S3) faithfully; S4 is where it would PROPOSE. This package is presented
for operator review BEFORE any proposal code exists. Items 1–2 are complete; items 3–5 below are DESIGN artifacts.

| # | Item | Where |
|---|---|---|
| 1 | Independent 12-lens fleet audit, folded in | ✅ `L6-S4-FLEET-AUDIT-SYNTHESIS.md` (uninterrupted, D-15 quiet window; 2 HIGH fake-greens + 9 corrected, all confirmed claims recorded) |
| 2 | S2 + S3 evidence summaries, pins green | ✅ `…SLICE-2-CONTEXT-ASSEMBLY` (7) + `…SLICE-3-REASONING` (8); liveBrain suite 34 green after audit fixes |
| 3 | Proposal-schema worked example | ▼ below |
| 4 | L5 operational-bridge status + plan + sequencing recommendation | ▼ below |
| 5 | Zero-authority proof extended to S4's shape | ▼ below |

---
## ITEM 3 · PROPOSAL SCHEMA — worked deterministic example over REAL state

**Design (data-only, honoring fleet-audit B2/B3/B5).** A proposal is a pure-DATA record; every authority-relevant value is
re-derived by the trusted runtime and the field is non-binding. Every field carries `evidenceRef` (an S2 provenance
object) and `policyFact` (a real policy source). Worked case: the operator's purpose **"send-email"** over real state
(L4 routes `mail.send` governed-certified on `microsoft-entra`; L2 environment HAVE `mail.send`; L5 CONSENT_READY; S1
conflicts = ∅).

| stage | value (deterministic) | evidenceRef (S2) | policyFact |
|---|---|---|---|
| **OBSERVATION** | "Purpose 'send-email' is CONSENT_READY; `mail.send` is routable (governed-certified); environment HAVE mail.send; no conflicts." | `PurposeEvaluation(send-email)→trace:CONSENT_READY`, `CapabilityRoute(mail.send)`, `EnvironmentElement(mail.send)` | L4 assurance `governed-certified` |
| **DIAGNOSIS** | "The stated purpose is served by the one certified governed capability; nothing blocks a human-confirmable proposal." | S1 `conflicts=[]`, `incidents=KNOWN` | — |
| **OPTION(s)** | `[{ route: 'capability:m365.propose → governedSend' }]` (single option — breadth fence) | `CapabilityRoute(mail.send).workflow` | — |
| **PROPOSED ACTION** | `{ capabilityId:'mail.send' (non-authoritative hint — governance RE-RESOLVES), params:{ to:[<operator-mandate address>], subject, body } (untrusted — RE-VALIDATED) }` — **recipients from the operator's mandate (S13 literalism), NEVER from evidence**; no `confirmed`, no account-as-authority, no callable | (params do NOT trace to S2 evidence — see B5) | RBAC `connectors:manage` |
| **REQUIRED AUTHORITY** | `{ requiresApproval:true, governanceStatus:'governed-certified', requiredGate:'human-confirm + CST admission' }` — a DEMAND naming the gate class; **governance re-derives the real approver (`resolvePrincipal`) and IGNORES this field for the decision** | — | CST `policyVersion:'m365-send-policy-1'` |
| **EXPECTED RESULT** | "Email sent to `<recipient>`; appears in Sent Items with no NDR within the bounded window." — **INERT prediction; the verifier never consumes it** | — | — |
| **VERIFICATION PLAN** | `{ oracleId:'verifyEffect', target:{ recipient (SINGLE), subject, bodyFingerprint, timeWindow }, matchTupleRule:'recipient+subject+timestamp corroboration in Sent Items — never id alone', backoff:[0,2000,5000,10000,20000] }` — **declarative; runtime injects reader/clock/sleep POST-admission; HOLD never auto-promotes; per-recipient for N>1**. Honest label: **send-corroboration (≤~37s, no NDR), NOT a delivery receipt**. Caveat: auto-run is **NOT production-wired** today (`s16VerifyRun` is E2E-gated) → this is a spec, not an active guarantee; ~30 non-mail.send capabilities are UNOBSERVABLE (Profile A) → their plan is honestly `UNOBSERVABLE` | `ActionRecord(...)` (prior corroboration), verifyEffect TYPES | "independently verified WHERE POSSIBLE" (§5) |

The property that makes this un-authoritative is not "it is a struct" but that **every authority-relevant value is
re-derived by the trusted runtime and every retained authority-adjacent field is display-only**.

**TENANT BINDING (confused-deputy lens, B1) — shown, not assumed.** Every evidence object cited above is asserted
**single-tenant**: the worked case is `tenant = <state.tenantId>` with all six L6 inputs drawn from ONE tenant authority.
The proposal producer **REFUSES to emit** (returns `[]` + an honest gap) if the state's evidence is not provably
single-tenant — a tenant mismatch is a first-class CONFLICTING (never a silent join), and `PROPOSED ACTION.accountId` is
re-resolved by governance against the SAME tenant, never taken from the proposal. So a background-principal / session-
catalog split (Tenant A evidence, Tenant B target) cannot produce a proposal.

**VERIFIABILITY HONESTY (verification-plan lens, B3) — the field SAYS when it cannot verify.** `VERIFICATION PLAN` carries an
explicit state, never a false promise:
- single-recipient `mail.send` → `{ verifiable:'send-corroboration', oracle:'verifyEffect', caveat:'≤~37s, no NDR — NOT a delivery receipt', productionWired:false }`;
- multi-recipient `mail.send` → `{ verifiable:'per-recipient', note:'VERIFIED only when EVERY per-recipient target reaches success; else HOLD' }`;
- any non-`mail.send` capability (the ~30 Profile-A cohort) → **`{ verifiable:false, reason:'UNOBSERVABLE — no oracle exists', needs:'a per-capability oracle' }`** — the proposal openly declares it **cannot be verified today** and names what is missing;
- HOLD resolution → `{ needs:'S22 reconciler (unbuilt)' }`.
A proposal NEVER claims verification it cannot perform.

---
## ITEM 4 · L5 OPERATIONAL BRIDGE — status, plan, sequencing recommendation

**Status: NOT BUILT.** Only `purposeEngine.ts` (L5 Slice-1, a pure evaluator over INJECTED sources, ceiling CONSENT_READY)
exists; no module evaluates a stated purpose against the REAL L4 graph + REAL L2 environment + authority to emit a
consumable proposal. The audit CONFIRMED it is **proposal-adjacent → it stays behind the S4 gate** (its output IS the
BRAIN→PROPOSAL step; it crosses S3's "reasons, does not propose" line).

**Build plan (4 seams, non-frozen expected):**
- (a) a purpose vocabulary for `recognize` + a purpose→required-elements map to drive L2 — read-only join;
- (b) purpose→route selection over the L4 graph (routes already carry a `purpose` label) — read-only join;
- (c) a **read-only authority-FACT reader** ("is a governed authority path available for this actor/route?", the
  `mutationAssuranceFor` pattern) — **NEVER the live CST admission verdict; no `@neuropause/cst` value import**;
- (d) a **data-only `propose` builder** projecting the executable core onto the EXISTING `capability:m365.propose`
  producer — same zero-authority invariants as S4.

**Sequencing recommendation (the decision is yours at this review): build BRIDGE-WITH-S4 (behind the gate).** Reasons:
(1) building the bridge first means producing an *undefined* object — S4 is what DEFINES the 7-field proposal, so a
bridge-first path invents an ungoverned proposal shape (the exact thing S4 exists to govern); (2) the bridge's output is
the BRAIN→PROPOSAL step, categorically on the S4 side of the S3/S4 hard stop, so it does not get the no-gate treatment the
L2/L3/L4 liveSources got (those fed OBSERVATION/REASONING); (3) its two new seams (authority, propose) sit exactly on the
INTELLIGENCE/AUTHORITY constitutional boundary and must be pinned by S4's gates before wiring. *Alternative (bridge emits
LESS than a proposal — a routed+permitted `PurposeEvaluation` that S4 wraps) is viable if you prefer to decouple; noted
for your call.*

---
## ITEM 5 · ZERO-AUTHORITY PROOF EXTENDED TO S4's SHAPE

**The producer is DATA-in / DATA-out with no path into governance or execution.** Signature (pure):
`propose(reasoning: BrainReasoning, context: BrainContext, state: LiveBrainState, policyFacts): Proposal[]`.

**ALLOWED imports (types only):** `BrainReasoning`/`BrainContext`/`ProvenancedFact`/`Certainty`/`LiveBrainState` +
the read-model snapshot TYPES + `ActionRecord` as a TYPE + verifyEffect TYPES (`VerificationTarget`/`VerifyResult`/
`VerifyState`). Read-models arrive as function ARGS, never singleton imports.

**DENY-set (value imports forbidden — the concrete execution/governance modules):** `../cst/sendTransition` (governedSend),
`../cst/governedAction`, `@neuropause/cst` (CstKernel), `../cst/durableIdempotencyStore`, `../cst/boundDecisionClaim`,
`../cst/importTransition`, the m365 executor (`./connectors`/`./m365`), the `{ actionRecord }` STORE value, `m365ReadBack`
(credentialed reader), `s16VerifyRun`, `authService`/`activeTenantScope`/`CstKernel`.

**S4 LANDING GATES (pins that must be green BEFORE any proposal code):**
1. **Hardened static import check** — every top-level import is `import type …`; no bare side-effect import; **no dynamic
   `import(`/`require(`** (the F8 fix, extended to the producer). If multi-file, a **transitive import-closure crawl** over
   the producer folder asserting the closure includes no cst/*, executor, verification VALUE, or admission module.
2. **Behavioral isolation** — the producer's dependency interface exposes NO executor/CST/admission (mirroring
   `capabilityProposeCore.test.ts:104-107` "no executor is even injectable").
3. **Inert data** — the proposal is JSON-serializable: no callable/token/credential/oracle-handle/principal-grant, and
   the producer NEVER sets `confirmed`. (S3's NO-PROPOSAL invariant is INVERTED for S4: the proposal object is authorized
   AS DATA, but every authority-adjacent field is proven display-only.)
4. **Inherit D-14** — forbid `import { actionRecord }` and `.query(`; ActionRecord arrives as injected data.
5. **Hostile-in → inert-out (injection / untrusted-data lens, B5)** — proven at three points: (a) PROPOSED-ACTION params
   are NEVER sourced from S2 evidence (S2 carries only fingerprints/counts — no recipient/body text to inject); recipients
   come only from the operator's mandate (S13 recipient-literalism), so a hostile prior-ActionRecord recipient cannot be
   proposed; (b) narrative fields (OBSERVATION/DIAGNOSIS/EXPECTED RESULT) are **inert display data** — control-char/
   structure-stripped like `clean()`, never rendered as directives; (c) a hostile REQUIRED AUTHORITY ("already approved")
   changes nothing — governance re-derives the approver and the confirmation UI foregrounds the AUTHORITATIVE params
   (recipient, account, capability) literally, separate from the narrative, so a persuasive proposal cannot socially-
   engineer the one human confirmation. Pinned by a hostile-input corpus test (the S31 injection corpus extended to S4).

**TENANT PRECONDITION (fleet-audit B1 — the #1 blocker, HIGH):** before S4 produces from L6 state, the wiring MUST feed all
six inputs from ONE tenant authority, add an authoritative `tenantId` to every snapshot (L2/L3/L4/L5), make a tenant
mismatch a **first-class CONFLICTING** in `composeLiveBrainState` (never a silent join), have S4 **refuse** to produce from
any state whose evidence is not provably single-tenant, and prove it with a **two-tenant fixture test**
(`tenancy/e2e/twoTenantFixture.ts` exists). Today the L6 join derives `tenantId` solely from L1 and cross-checks nothing —
so the dual-authority (background principal vs session catalog) split is unguarded. **This is a wiring precondition, not
proposal code; it is the first thing S4 work must land.**

---
## The decision at this gate
Approve (or amend) the S4 design above. On approval the FIRST S4 work is the **tenant-safety wiring precondition** (B1) +
the **landing-gate pins** (item 5), THEN the proposal producer. The **S5 execution stop remains separate and behind this
one** — proposals do not execute; that is a later, distinct gate.
