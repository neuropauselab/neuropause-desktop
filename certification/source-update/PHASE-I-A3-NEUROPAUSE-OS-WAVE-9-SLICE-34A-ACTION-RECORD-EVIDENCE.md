# SLICE 34a — Queryable Action Record + decision logging (closes F-4) · EVIDENCE

**Status: CLOSED — TEST-VERIFIED. The observation layer's first stone.** F-4 (the certified send path writes no
structured decision record) is closed for the mail.send governed loop. FREEZE INTACT (both brackets recorded).

## The FG-5 token (honored, verbatim)
```
AUTHORIZED: FG-5 — connectors/index.ts action-record observer emit, one gated line, per gate doc
```
Authorized by the operator's v-complete execution directive ("FG-5 token stands … Apply EXACTLY the authorized frozen
observer emit"). Gate doc: `certification/source-update/FG-5-ACTION-RECORD-GATE.md`.

## Change-control bracket (both INTACT recorded)
```
<checkpoint>  alive(s34a): action-record store (non-frozen) — FG-5 checkpoint
              freeze: re-record at s34a action-record checkpoint — INTACT #1 (BASELINE-322115041eeb)
<frozen>      alive(s34a): FG-5 action-record observer emit — one gated line (closes F-4)
              freeze: re-record at FG-5 action-record emit — INTACT #2 (BASELINE-8f0f1e137d3f)
```

## Frozen / non-frozen path split
- **FROZEN (the authorized diff, exactly):** `connectors/index.ts` — one import (`actionRecord`) + ONE observer
  statement, placed AFTER `governedSend` resolves and the UNKNOWN-hold, before the existing `return mapSendOutcome`:
  `void actionRecord.observe(r, g, { actor: deps.actor() ?? '', tenantId: deps.workspaceId() }).catch(() => {});`
  (git: index.ts +5 — import + 3 comment lines + the one statement). It is an OBSERVER, never a gate: fire-and-forget +
  self-catching, so it cannot block/delay/alter the send or its response.
- **NON-FROZEN:** `connectors/actionRecord.ts` (the store + `observe`/`query`/`recordVerification` + `declareStoreScope`
  TENANT/CUSTOMER_DERIVED/retention-NONE, self-contained so no `runtimeCore` bindScope was needed — one gated line) +
  `actionRecord.test.ts` (13 tests).

## §2 — closing proof (all eight + query proof + observer invariant), each to a named test
| # | claim | named test (`connectors/actionRecord.test.ts`) |
|---|---|---|
| 1 | NORMAL — record carries the correct requestId/transitionId chain | `CLOSING PROOF > 1 · NORMAL` |
| 2 | OBSERVER FAILURE never changes the send result; the gap is logged, not swallowed | `CLOSING PROOF > 2 · OBSERVER FAILURE` + `observer contract > T-1` (evidence gap logged) |
| 3 | EVERY TERMINAL exercised — DENIED · NO_ACTOR · HOLD · ESCALATE · EXECUTION_FAILED · UNKNOWN · ACKNOWLEDGED · VERIFIED_SUCCESS · VERIFIED_FAILED; UNKNOWN never auto-promotes | `terminal coverage > T-2` (6 governance) + `CLOSING PROOF > 3b · NO_ACTOR` + `CLOSING PROOF > 3` (both verification terminals + UNKNOWN-stays-null) |
| 4 | VERIFICATION attaches to the EXISTING record; unknown transition → no phantom | `verification + query > T-4` + `CLOSING PROOF > 4` |
| 5 | NO CONTENT DUPLICATION — ids + fingerprints + admission reference only | `no content copy > T-3` (persisted file holds no subject/body text) |
| 6 | TENANT ISOLATION — A cannot query B's records | `verification + query > … tenant-isolated` |
| 7 | LOCAL ACTOR INTEGRITY — `local:<id>` exact through store + query, no stripping | `no content copy > T-3` + `CLOSING PROOF > 7` |
| 8 | FREEZE — INTACT #1 → exactly-authorized diff → INTACT #2 | this doc + `BASELINE-322115041eeb` → `BASELINE-8f0f1e137d3f` |
| — | QUERY PROOF — the full chain from the store alone (request → intent → actor → tenant → connector → verdict → outcome → 202 → verification → evidence ref), no raw logs | `CLOSING PROOF > QUERY PROOF` |
| — | OBSERVER INVARIANT — no value-import from the record layer into governance/execution (only a TYPE import of GovernedSendResult) | `CLOSING PROOF > INVARIANT` |

## Proofs (RUN against BASELINE-8f0f1e137d3f)
- `connectors/actionRecord.test.ts` — **13** (T-1..T-4 + tenant isolation + the 8 closing proofs incl. NO_ACTOR + query
  proof + observer invariant). Store-scope gate green (the new TENANT store declared).
- Full main **8796 passed / 3 skipped** (832 files) · UI **259** · typecheck node+web + lint clean · verify-e2e-strip PASS.

## Scope fence (§3, honest)
S34a lands ONLY the observation layer's first stone: the record + the one gated emit + the store-layer query. It does
NOT add a user-facing query IPC channel / renderer view (that touches frozen `channels.ts` — a separate later step), nor
Environment Intelligence, nor trace metrics (Wave-9 S35/S36). The FG-4 e2e guard-DENIED (a pre-governance, e2e-only
refusal) is out of the §2.3 governance-terminal set and is not wired here; the governance-layer DENIED/NO_ACTOR terminals
ARE captured by the one observer emit. Verification-terminal attachment is proven at the store layer
(`recordVerification`); wiring the in-session s16 verify runner to call it is a small non-frozen follow-on.

## Invariant (stated + pinned)
The action record is an OBSERVER, never a second governance mechanism. There is no import path from the record layer
back into governance or execution — pinned by `CLOSING PROOF > INVARIANT` (the only cst reference is a type import,
erased at runtime). The emit reads `r`/`g`/actor/tenant and writes evidence; nothing consults the record to decide or act.
