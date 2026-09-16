# FG-11 · SHARED SOURCE-LINEAGE — CLOSING EVIDENCE
## The eleventh frozen gate; the freeze never broken. NP-011 slice C-renderer.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: TEST-VERIFIED. Token honored; choreography walked; INTACT both sides.**

## The token (quoted verbatim, as given by the operator, 20 Aug 2026)

> AUTHORIZED: FG-11 — packages/shared sourceLineage addition (move from main), per gate doc

Given after the operator ran the gate doc's three read-only confirmations (their words: "deriveSourceLineage
lives in main only, packages/shared has no sourceLineage (genuinely additive), FREEZE INTACT, tree clean at the
landed commit"), with five conditions — each honored below.

## The bracket

- **INTACT #1:** `BASELINE-a70cbc0a4f83` @ `2413feb`, tree clean (0 dirty), verify-freeze INTACT — captured
  before any change.
- **FROZEN commit (isolated): `b2d6c46`** — EXACTLY the presented diff, nothing else: NEW pure module
  `packages/shared/src/business/sourceLineage.ts` (67 lines, byte-identical logic to the gate doc text) + ONE
  additive line `export * from './business/sourceLineage';` beside the existing
  `./business/familyDashboardModel` export. Full suites were green AT this commit (main 863/9018/3 · ui 41/278 ·
  typecheck clean) — run before committing, per condition 1.
- **NON-FROZEN accompaniment: `705057a`** — (a) main
  `enterprise/modules/finance/sourceLineage.ts` → THIN RE-EXPORT (zero deletions; the three generators' import
  paths untouched); (b) the ONE-RULE invariant pinned (`sourceLineage.test.ts` FG-11 block: main carries no
  sentence template, no Map, no record loop — a second implementation cannot re-enter unseen); (c) the
  pre-existing derivation pins run UNCHANGED through the re-export — **the byte-equivalence proof** (condition 2);
  (d) `FamilyDashboard.tsx` renders the lineage sentence over records it already fetches (no new IPC) +
  `familyDashboardLineage.ui.test.tsx` pins the exact mixed-provenance sentence (jsdom `ResizeObserver` no-op
  stub — chart geometry is not under test, stated in-file).
- **INTACT #2:** `BASELINE-61cede6a036a` @ `8529a19` — re-recorded over green.

## Conditions honored

1. **Choreography** — as above; the frozen commit is isolated and suite-green at commit time.
2. **One rule, zero copies, pinned** — the invariant test + unchanged main-side pins through the re-export.
3. **Purity pinned** — the shared module imports ONLY `EnterpriseEntity` (a type) — no I/O, network, filesystem,
   connector, authorization, or governance surface; record metadata in, lineage description out. (The module's
   only import line is the type import; verifiable by reading its 9-line header + imports.)
4. **Scope exact** — the module + export line + re-export + tile wiring + pins + scans + freeze checks + this
   evidence. No lineage redesign; no NP-012 work inside the bracket; NP-000 untouched.
5. **Precision language, verbatim:** "NP-011's implementation green-light is complete with FG-11; the ceremony
   green-light is separate — NP-000 remains independently held."

## Verification (all RUN)

Full main **863 files / 9019 passed / 3 skipped** (+1 test: the one-rule pin) · ui **42 files / 279 passed**
(+1 file: the tile pin) · typecheck clean (0 errors) · honesty scan **0 findings** · verify-freeze INTACT at both
brackets · zero external effects · ceremony surfaces untouched.

## What now exists (claim-honest)

Every financial number surface in the product that states a total also states its register: AR aging, cash flow,
and GST snapshots (main-stamped) and the Business family bands (renderer-derived) — all through ONE rule in ONE
module, carrying the NP-010 §2 honesty label everywhere. `unverified-source` remains the only assignable trust
value; VERIFIED still requires a corroboration mechanism that does not yet exist, and nothing here changed that.
