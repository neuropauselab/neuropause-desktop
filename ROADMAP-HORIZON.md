# ROADMAP-HORIZON.md — the long arc (Live-Brain-track LB-6 … LB-23) · DIRECTION, NOT ENTERED
### Recorded 19 Aug 2026 at the S4 opening. Living, TRACKED, freeze-excluded (D-5).

**Status of this document: DIRECTION ONLY.** Nothing here is in §5 and nothing here is authorized to build. Each phase
enters CLAUDE.md §5 **only through the five-field amendment discipline** (observable object · collection boundary ·
capability contract · verification method · failure/UNKNOWN state) + per-layer operator approval, when its turn approaches
and its five fields can be refreshed against the real substrate. The finish line and the constitution are unchanged; this
is the horizon the current work aims at, so today's slices don't paint into a corner.

**Binding constraints that already govern every phase here (verbatim, non-negotiable):**
- The constitutional line holds forever: INTELLIGENCE proposes · AUTHORITY decides · CONSENT confirms · EXECUTION acts
  once · VERIFICATION proves. No phase merges them.
- §2#14 universal read-back: every capability is REQUEST → EXECUTION → EXTERNAL EFFECT → INDEPENDENT READ-BACK →
  VERIFIED_SUCCESS/VERIFIED_FAILURE/UNKNOWN (D-16 vocabulary, deny-by-default). No phase claims executor-success.
- Predictive/anticipatory intelligence is **FORBIDDEN until a verified history exists** — a prediction is a proposal that
  traces to *observed, independently-verified* outcomes, never to a model's guess.
- **Workforce intelligence carries the non-surveillance constraint (verbatim):** *work, ownership, deliverables, evidence
  — never invasive personal monitoring.* No keystroke/screen/location/biometric surveillance, ever, under any phase.

---
## THE CAPABILITY LADDER (A–E) — the spine every connector climbs
- **A · OBSERVE** — read-only, governed discovery + truthful state (where L1–L4 live today).
- **B · PROPOSE** — a certified data proposal, zero-authority (S4).
- **C · EXECUTE-ONCE** — governed, human-confirmed, at-most-once, read-back verified (M365 mail.send today; S5 generalizes).
- **D · POLICY-BOUNDED** — ALLOW/ASK/DENY under a compiled, hashed policy (S28) with limits; still per-action evidenced.
- **E · CONTROLLED AUTONOMY** — bounded, revocable, kill-switched, digest-reported; never a jump from C.
Each capability is certified independently at each rung (S23 kit); a connector at rung C for one capability is not at
rung C for another (the per-capability motto).

## LIVE-BRAIN-TRACK STAGES (LB-6 … LB-23) — direction
_LB- prefix denotes Live-Brain-track stages; these are NOT §5 slice numbers (which stay canonical + unique, e.g. S18/S23/S28)._
- **LB-6 · Operational-memory taxonomy** — a typed, tenant-scoped, evidence-backed memory of what happened and why; the
  substrate every higher intelligence reads. Four data states everywhere (HAVE/NEED/UNKNOWN/UNAVAILABLE); no fabrication.
  **THE EXPERIENCE-MEMORY ARC (detailed design — RECORDED 19 Aug 2026 at Phase-0 acceptance; NOT ENTERED; the leading
  candidate for the first post-ceremony arc; enters §5 only through the five-field discipline then; BUILD NONE OF IT NOW):**
  1. **ExperienceRecord** — a tenant-scoped record of each governed attempt, chained to its ActionRecord evidence (never a
     parallel store of authority; observation only).
  2. **Reproduction fingerprint** — a re-derivable fingerprint of the attempt's conditions (tenant · capability · account ·
     params-shape · substrate state), so "the same situation" is a provable claim, not a similarity guess.
  3. **Six-valued outcome memory** — VERIFIED_SUCCESS / VERIFIED_FAILURE / UNKNOWN / DENIED / CANCELLED / EXPIRED. The full
     honest vocabulary: refusals, cancellations, and expiries are remembered as first-class outcomes, never collapsed into
     failure or dropped; UNKNOWN stays UNKNOWN (D-16 discipline extended to memory).
  4. **Reproduction engine** — given a new intent, find provably-comparable past experiences by fingerprint; **similarity
     NEVER auto-converts to certainty** — a match yields evidence for a proposal, never a prediction stated as fact and
     never permission (§2 #15: memory informs governance; memory never becomes governance).
  5. **Failure intelligence** — verified failures become queryable knowledge (what failed, under which conditions, with what
     evidence), feeding proposals, never auto-remediation.
  6. **Reproduction-before-repair** — no repair is proposed until the failure is REPRODUCED under the fingerprint (the
     reproduce-first ruling generalized from test discipline to operational memory).
  7. **Validated knowledge** — a memory claim is promoted to knowledge only after REPEATED INDEPENDENT evidence (never one
     observation, never self-report); below that bar it stays labeled as unvalidated experience.
  8. **System self-awareness** — the system's account of its own capabilities derives from validated knowledge of what it
     has actually done and verified, not from its manifest or its plans.
  Constitutional bound (standing, §2 #15): no stage of this arc ever sets authority, approval, `confirmed`, policy, or
  admission; every consequential action re-derives authorization from the live substrate at execution time.
  **ENTRY CRITERION (NP-014 ruling, operator, 20 Aug 2026 — RULE-008 linkage):** `constitutionalInvariants.test.ts`
  asserts RULE-008 ("learning cannot create authorization") VACUOUS-BY-CONSTRUCTION today — it PROVES no learning
  code exists. The moment any stage of this arc lands code, that assertion FAILS BY DESIGN, and flipping RULE-008
  from vacuous to a REAL adversarial test (learning output driven at the authority seams → refused) is an ENTRY
  CRITERION of this arc — not a follow-up, a gate. The arc does not proceed on a red or vacuously-green RULE-008.
  Language notes (operator, 19 Aug 2026 — adopted as LANGUAGE, not architecture): the honest product-language for this
  arc when it enters is **"computational resilience"** — strength from remembered, verified experience, with no claim of
  feeling. And explicitly: governance verdicts (DENIED / CANCELLED / EXPIRED) enter experience memory as FIRST-CLASS
  outcomes WITHOUT passing through execution — DENIED is not FAILURE; CANCELLED is not FAILURE.
- **LB-7 · Change intelligence** — DECLARED vs OBSERVED over time → change records (drift, already scoped for L2 depth).
- **LB-8 · Drift intelligence** — declared/observed divergence as a first-class observation that feeds proposals, never an
  auto-fix.
- **LB-9 · Incident intelligence** — a verified-failure / conflict / UNKNOWN becomes a tracked incident with evidence + a
  proposed (never executed) remediation.
- **LB-10 · Dependency intelligence** — the environment/relationship graph (device·app·service·account·connector·workflow·
  data store·policy·capability·dependency·user·workspace·external system) with provenance per edge.
- **LB-11 · Product intelligence** — governed proposals about the product's own operation, traced to evidence.
- **LB-12 · Workforce intelligence** — coordination of AI workers by proposal: **work, ownership, deliverables, evidence —
  never invasive personal monitoring** (constraint binding, verbatim).
- **LB-13 · Founder / operator intelligence** — a truthful executive view; proposals, never autonomous decisions.
- **LB-14 · Predictive intelligence** — ONLY after a verified history exists; a prediction traces to independently-verified
  past outcomes + policy, and is a PROPOSAL under the same gates. Never a model guess presented as fact.
- **LB-15 · Self-assurance** — the system observes ITSELF through the ActionRecord pattern (recommendation → prediction →
  outcome → accuracy/FP/FN/UNKNOWN-rate), honest zero-baseline until real decisions flow.
- **LB-16 · The self-testing OS** — the assurance loop generates its own adversarial tests (the fleet pattern, D-15) as a
  standing gate, not a one-off. **Learning remains separate from governance change — the Brain must never rewrite its own
  constitution.**
- **LB-17 · The natural-language operating layer** — NL intent → structured proposal → the same governed pipeline; the model
  is untrusted data (§6), never authority.
- **LB-18 · SDK / platform** — a certified connector-authoring kit (S23 generalized) so third parties climb the A–E ladder
  under the same constitution.
- **LB-19 · Multi-node** — the governed runtime across nodes; tenant isolation + read-back preserved across the boundary.
- **LB-20 · Edge** — governed execution at the edge with the same at-most-once + read-back guarantees; offline ≠ authority.
- **LB-21…LB-23 · Reserved** — commercial scale, ecosystem, and the OS's own evolution; refreshed against reality when LB-6…LB-20 have
  each earned a closed slice. Not detailed here to avoid predicting a substrate that does not yet exist.

## RELEASE OVERLAY — the version ladder mapped onto the LB stages (RECORDED 19 Aug 2026; NOT ENTERED)
Adopted from the advisor's ladder as DIRECTION language over the existing stages — no new wave numbers, no new
architecture; every rung still enters only through the §5 five-field discipline.
- **v0.9.0 – v0.9.2** — Live Brain productization · workspace + capability reality · system-aware context (the substrate
  the L1–L6 arc has been building; polish and productize what is already proven).
- **v0.9.3 – v0.9.7** — the LB-6 experience-memory arc (ExperienceRecord → fingerprint → six-valued outcome memory →
  reproduction engine → failure intelligence → reproduction-before-repair), under §2 #15 and the language notes above.
- **v1.0 — THE COMMERCIAL GATE.** Definition (recorded verbatim in intent): the twelve-component core with **ONE
  unquestionably governed, observable, verifiable capability** — M365 `mail.send`, the proven loop (proposal → human
  confirm → CST → admission → at-most-once execution → independent read-back → evidence). **"v1.0 does not need 100
  connectors."** Everything outside the declared boundary ships explicitly NOT GOVERNED / NOT CERTIFIED (§2 #11, S47).
- **v1.1 – v1.5** — validated knowledge · system self-awareness · LB-7 change intelligence · LB-8 drift intelligence ·
  adaptive governance (policy evolution under S28-style compiled policies, never self-rewritten — LB-16 constraint).
- **v2.0** — multi-capability (the S23 kit generalized across connectors/capabilities, each individually certified).
- **v2.x** — the governed network (LB-19 multi-node · LB-20 edge · LB-18 SDK/platform).

**ONE QUESTION EXPLICITLY OPEN — do not resolve here:** whether the full experience arc (v0.9.3–v0.9.7) lands BEFORE
v1.0 (the advisor's sequencing) or v1.0 ships EARLIER on the proven loop alone. Decided by a §5 amendment AFTER the
S5.4 ceremony, against the substrate as it then exists. Recording both orderings is direction, not a decision.

## The rule this document exists to enforce
No phase above is built until it enters §5 with its five fields proven against the *real* substrate and the operator's
per-layer approval. Recording the horizon is not entering it. Direction keeps today's work honest; it never authorizes
tomorrow's.

## ID-NAMESPACE MAPPING (operator RULING 2, 20 Aug 2026 — the ONE table)
CLAUDE.md §5 S-numbers are canonical, unique, supreme. Colliding IDs from directives/advisor documents carry
namespace prefixes. Applied mapping:

| Namespace | Meaning | Collision resolved |
|---|---|---|
| S-nn | CLAUDE §5 roadmap slices | CANONICAL — nothing remaps these |
| NP-nnn | WORK_QUEUE tasks (committed history keeps its numbers forever) | NP-000…NP-010 = the existing queue meanings |
| M-nnn | The MASTER DIRECTIVE §44 strategic horizon (its "NP-001…NP-030" renumbered) | master-NP-001→M-001 … master-NP-029→M-029, recorded in WORK_QUEUE §MASTER HORIZON. Identity, not collision: master-NP-000 ≡ NP-000 (same ceremony) — NOT remapped |
| LB-n | Live-Brain roadmap stages (recorded-not-entered) | already namespaced; unchanged |
| MR-n | Master-recon findings (written as F-MR-n in the report; F-MR-n ≡ MR-n) | unchanged |
| F-N8-n / F-N10-n | NP-008 census / NP-010 census findings | no collisions; unchanged |
| FG-n / D-nn / O-nn / W-n | frozen gates / decisions / owner-row observations / diagnostic predicates | untouched namespaces |

No collision resisted the rule; none needed individual escalation.

## LADDER ORDER (operator RULING 1, 20 Aug 2026)
1. **mail.send** — certified; NP-000 completes its first Brain-proposed real action.
2. **calendar.create** — SECOND, immediately post-ceremony (cheapest full kit run; same connector; oracle =
   event GET-by-id; proves connector-certified ≠ every-action-certified by certifying a SECOND action on the
   SAME connector).
3. **Razorpay payment-link** — THIRD, the second-CONNECTOR abstraction test (new auth model, new oracle class,
   money-adjacent; full kit PLUS its own ceremony-class first real action when its turn comes).
Everything else BELOW THE LINE, refusing at the boundary, until the operator re-ranks. **No rung begins until
after NP-000.**
