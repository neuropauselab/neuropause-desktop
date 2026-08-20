# ARCHITECTURE-MAPPING — Concentric spec ⇄ the proven implementation (NP-012 §2)
### 2026-08-20 · PART A is classified against committed evidence; PART B is BLOCKED on the spec text (never fabricated). Nothing is claimed implemented because it is specified.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Source status:** the Concentric Systems Architecture document itself was NOT found in the repo or workspace
(searched: repo-wide + Desktop for "concentric"/ring definitions/advisor doc). PART B rows await the operator
pasting the spec; ARCHITECTURE.md (§0) is likewise blocked — a canonical reference is committed only from the
source text, never reconstructed. What IS in hand: the master directive's enumerations, which fully define the
fifteen-line table and several element families.

## §1 · THE FIFTEEN-LINE TABLE ⇄ CLAUDE.md §2 (complete)

| # | Non-equivalence | Verdict | Cross-reference / pin |
|---|---|---|---|
| 1 | INTELLIGENCE ≠ AUTHORITY | ALREADY LAW | §2 #6 + #13; zero-runtime-import pins ×6 (liveBrain suite) |
| 2 | CONFIDENCE ≠ PERMISSION | ALREADY LAW | AUTONOMY.md authority wall; §2 #9 |
| 3 | CONNECTIVITY ≠ AUTHORITY | LAW IN BEHAVIOR (implicit in text) | §2 #7/#8; S5.1 structural-ASK pin (no ALLOW branch exists); the renderer's missing SAY-so is F-MR-5, open |
| 4 | REGISTRATION ≠ AUTHORIZATION | LAW IN BEHAVIOR | §2 #8 deny-by-default; capability discovery projects descriptions only — no callable/token crosses (`liveCapabilitySources.ts`) |
| 5 | CERTIFICATION ≠ UNIVERSAL PERMISSION | ALREADY LAW | §2 #11; the calendar dry-run pin ("connector certified ≠ action certified"); ladder standing rules (§49) |
| 6 | EXECUTION ≠ SUCCESS | ALREADY LAW (verbatim) | §2 #14 |
| 7 | UNKNOWN ≠ SUCCESS | ALREADY LAW (verbatim) | §2 #9 |
| 8 | MEMORY ≠ AUTHORITY | ALREADY LAW (verbatim) | §2 #15 |
| 9 | LEARNING ≠ AUTHORITY | ALREADY LAW | §2 #15's scope ("no outcome memory, experience record, or reproduction fingerprint ever sets…") |
| 10 | INTENT ≠ PURPOSE | RECORDED (modeling) | master directive §11; L5 constraints (§5 OS-tracks); no collapsing code exists to pin yet |
| 11 | PURPOSE ≠ CAPABILITY | RECORDED (modeling) | L4/L5 constraints; `capabilityGraph` routes purposes→capabilities without granting (pinned) |
| 12 | CAPABILITY ≠ AUTHORITY | ALREADY LAW | L4 constraint verbatim ("cannot grant authority") + §2 #8; capabilityGraph pins |
| 13 | PROPOSAL ≠ EXECUTION | ALREADY LAW | §2 #7 + #13; ASK-only structural (proposalExecutionBoundary) |
| 14 | EXECUTION ≠ EXTERNAL EFFECT | ALREADY LAW | §2 #14 ("a 2xx/ack/executor return is submission") |
| 15 | EXTERNAL EFFECT ≠ VERIFIED OUTCOME | ALREADY LAW (verbatim) | §2 #14, D-16 terminals |
| NEW | **PAYMENT ≠ AUTHORITY** | **CANONIZED NOW → §2 #16** | Recorded BEFORE any Razorpay capability work exists; the #15 pattern extended to money |

## §2 · THE TWO BINDING VOCABULARY RULINGS (recorded)

**Ruling 1 — verification vs state assessment, never merged.** D-16 terminals remain the ONLY verification
vocabulary: `VERIFIED_SUCCESS / VERIFIED_FAILURE / UNKNOWN → HOLD → reconciliation → UNRESOLVED`, plus the
first-class non-execution outcomes `DENIED / CANCELLED / EXPIRED`. The spec's five-value set applies ONLY to
declared-vs-observed STATE assessment, mapped side-by-side onto the existing `Certainty` vocabulary
(`liveBrainState.ts`):

| Spec (state assessment) | Ours today | Note |
|---|---|---|
| VERIFIED | `VERIFIED` | corroborated only — same discipline |
| CONFLICT | `CONFLICTING` | naming DIVERGENT, semantics same |
| UNKNOWN | `UNKNOWN` | identical |
| UNOBSERVED | ≈ `UNAVAILABLE` | ours means "source unreadable"; spec's "never probed" nuance PARTIAL |
| STALE | **absent** | candidate field, not started (Part B/§3) |

**Ruling 2 — ID schemes.** `NP-CON-/NP-CAP-/NP-ORACLE-/NP-CONN-` apply to NEW connectors and capabilities from
the ladder onward; existing identifiers (`microsoft-entra`, `mail.send`, `acct_*`) stay and are ALIASED in the
registry when it lands (M-008+). No mass rename, ever.

## PART A · Elements auditable NOW (classified against committed evidence)

| Element | Verdict | Evidence |
|---|---|---|
| Tenant isolation default (cross-tenant → DENY) | **CONFIRMED** | unbound scope DENIES (`tenantOwnedStore.ts`); `crossTenant.test.ts` (1,119 lines); `storeScopeGate.test.ts`; boot-time `assertEveryModuleScoped()` |
| Authentication ≠ authorization | **CONFIRMED** | auth status (auth.ts) vs RBAC (`authzGate`, `runtimeAuthz` 1,108 lines); local principal = authenticated-nothing yet locally authorized; org channels still refuse |
| Credential boundary (spec: CredentialReference → SecureCredentialStore) | **CONFIRMED, naming DIVERGENT + one gap** | ours: store/vault split, ciphertext-only, refuse-plaintext, zero token IPC exposure (master-recon §C); GAP: desktop log redaction convention-only (F-MR-7) |
| Connector → capability → connection separation | **CONFIRMED (M365 vertical)** | manifests / action ids / `ConnectedAccount` — three real object kinds (CONNECTOR-REALITY.md); capability ids coarse outside M365 (PARTIAL breadth) |
| Declared-vs-observed assessments | **PARTIAL** | declared manifests vs observed connection/health exists per-connector; ONE systematic drift instance already caught (stale infra header, F-MR-2); no unified assessment vocabulary in code |
| Initiative → intention → purpose → need | **RECORDED-ONLY** | master §11 definitions; no code collapse and no code model |
| Typed relationships w/ evidence + confidence | **PARTIAL** | 36 typed keys + 3 chains + PENDING parking (dataPlane); confidence exists at classification; per-LINK evidence+confidence fields not verified — gap named |
| Live Brain scope | **CONFIRMED (mock)** | LIVE_BRAIN_READINESS.json; propose-only + zero-runtime-import pinned; 4 PARTIAL stages recorded there |
| Capability record (spec: 16 fields) | **PARTIAL** | S23 kit = 7 ruled artifacts; master §21 named 12 fields; the 16-field set awaits the spec text; assurance today is a 1-bit predicate |
| Observation type ladder (event/observation/measurement/state/inference/claim) | **ABSENT as a unified ladder** | fragments exist (platform events, ActionRecords, understanding attributes with stated/inferred status, health snapshots) — no typed ladder unifies them |
| Nine-timestamp temporal model | **ABSENT** | records carry 2–4 stamps (createdAt/updatedAt/importedAt/generatedAt); the nine-field model does not exist; exact fields await the spec |

## PART B · BLOCKED ON THE SPEC TEXT (listed, never guessed)

Rings 0–6 (boundary definitions + the ring diagram) · the identity OBJECT SET · the context model · the
cross-cutting controls list · the 16-field capability record's exact fields · the nine timestamp names · the
observation-ladder type semantics. **ARCHITECTURE.md (§0) is not committed until the operator supplies the spec
text** — a canonical reference is transcribed, not reconstructed.

## §3 · PRELIMINARY ranking (finalized after Part B; ZERO code without the operator's ruling)

1. **Credential-boundary completion** — mechanical log redaction (closes F-MR-7): high risk-reduction, low effort.
2. **Nine-timestamp fields on evidence records** (ActionRecord + provenance): high value for temporal honesty;
   effort medium; blocked on the spec's field names.
3. **Capability-record field completion in the S23 kit**: medium/low; natural companion to ladder rung 2.
4. **Typed relationship evidence+confidence per link** (business objects): medium/medium.
5. **STALE as a first-class state assessment** (Certainty extension): medium/low; touches Brain substrate — its
   own bounded slice.

## §4 · STATUS LANGUAGE (recorded verbatim, corrections folded)

NP-000's recorded status = **HOLD**; the pre-execution divergence is **FIXED** (NP-007 closed with evidence — the
advisor doc's §9 predates that and is superseded); the current hold reason is **TENANT AVAILABILITY only**.
**"NP-011 progress is never evidence of NP-000 readiness — the real external-effect proof passes independently."**
IMPORT ≠ APPROVAL ≠ POSTING is tested explicitly in slice B (`aggregatedImports.test.ts`: `approvedAt` empty +
draft pins), never inferred from code structure.
