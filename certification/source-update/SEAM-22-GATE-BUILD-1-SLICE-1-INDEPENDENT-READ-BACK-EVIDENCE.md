# SEAM-22 / GATE-BUILD-1 · SLICE 1 — THE INDEPENDENT READ-BACK SURFACE
**23 Aug 2026 · TEST-VERIFIED · zero frozen touches · zero sensitive edits · zero external effects**

## SLICE_ID / PURPOSE
`SEAM-22-S1` — build the smallest independent read-back surface (build-directive §20–§21; P0 target F):
reconstruct REQUEST → VERDICT → EXECUTION → OBSERVATION → VERIFICATION from **persisted evidence only**,
with one epistemically honest FINAL_STATUS per row and the five funnel rungs predicate-identical to
`deriveWriteStates`.

## WHY THIS SLICE FIRST (the §53 dependency measurement)
The §54 hypothesis (approval consumption first) fails against the gate topology: **the entire
`apps/desktop/src/main/cst/` directory is FROZEN** (`certification/frozen-surfaces.json`), as are
`connectors/index.ts`, `runtimeCore.ts` and `packages/shared/` — so approval consumption (A), executor
routing (B), cohort ActionRecord emission (C), resource fencing (D), cross-call import idempotency and
send-key canonicalization (E) are ALL FG-gate-blocked (operator-token hard stops, CLAUDE.md §2 #1).
The read-back (F) is the only P0 target with zero frozen/sensitive edits — and §59's run plan requires
it BEFORE the first real verification. The measured first slice is therefore F.

## FILES_CHANGED
- `apps/desktop/src/main/reconciliation/readBack.ts` — NEW (non-frozen, non-sensitive dir).
- `apps/desktop/src/main/reconciliation/readBack.test.ts` — NEW (12 pins).

## OLD_BEHAVIOR → NEW_BEHAVIOR
- OLD: every read-back component existed (query API, D-16 authority, reconciler, provenance) but no
  surface bound them; "what happened to this send?" was answerable only by the aggregate five-state
  funnel or by reading raw JSON.
- NEW: `readBack(scopeTenantId, ref)` (ref = requestId | transitionId | FG-14 correlationId) returns a
  `ReadBackReport`: per-row FINAL_STATUS (REFUSED / GATE_NOT_EVALUATED / REQUESTED / DENIED / AUTHORIZED /
  EXECUTED / PROVIDER_ACKNOWLEDGED / UNKNOWN / VERIFIED_FAILURE / VERIFIED_SUCCESS), the five rungs, the
  §14 timeline verbatim (request/event/record/verification/effect times — null preserved, never inferred),
  deviation, and a structural `NOT_PERSISTED` list naming what the evidence store cannot answer
  (relationship · purpose · policyVersion · approval object · claim/fencing token) — stated, never fabricated.
  `reconstructReadBack(records, ref)` is the pure Electron-free core for any future CLI/IPC surface
  (one derivation, §56 no-duplicate-source-of-truth).

## GOVERNANCE_PATH / SECURITY_IMPACT
- READ-ONLY over the S34a store; no import path into governance/execution (observer invariant untouched).
- Classification goes ONLY through the D-16 authority (`classifyTerminal`/`isSuccessTerminal`) —
  deny-by-default; a success-looking outcome string outside the verification object is never trusted
  (pinned). The D-16 anti-re-entry pin's consumer list is untouched; this module never compares a stored
  terminal against a literal.
- Route A honored: governance rows (outcome `NOT_STARTED`) report REFUSED/GATE_NOT_EVALUATED with NO
  funnel rungs — identical exclusion semantics to the counter (F-5 class protected).
- Tenant-scoped via the store's own filter; F-P45 accommodation documented at the surface (the scope key
  is the WORKSPACE id the writer records; the migration stays owed and is NOT taken here).
- Empty ref refused (a listing is not a read-back — deny-by-default).

## TESTS_ADDED (12, all first-run green)
full-chain VERIFIED_SUCCESS incl. §14 timeline · acknowledged-unverified = PROVIDER_ACKNOWLEDGED (§2 #14) ·
**false-success catch** (ACKNOWLEDGED + VERIFY_FAILED ⇒ VERIFIED_FAILURE + deviation) · success-lookalike
outcome string never trusted · governance DENY ⇒ REFUSED, no rungs · SKIP ⇒ GATE_NOT_EVALUATED ·
UNKNOWN/HOLD stay UNKNOWN (§2 #9; unresolved verification never promoted) · tenant isolation ·
FG-14 correlationId match · empty-ref refusal · **independence: reconstruction from persisted bytes after
an in-memory reset (§21)** · NOT_PERSISTED honesty pin.

## TESTS_RUN / REGRESSION_RESULT
- Focused + adjacent: `readBack` (12) + `readBackReconciler` (20) + `actionRecord` (13) +
  `m365WriteStates` (8) + `verificationTerminals` (2) = **55/55 green**.
- `tsc --noEmit -p tsconfig.node.json` clean · eslint clean on both new files.
- Full main vitest suite: run recorded in the §1 update accompanying this slice.

## EVIDENCE / READ-BACK
This document + the pins above. The slice's own read-back: the independence pin re-reads the persisted
`action-records.json` through a reset store and reproduces VERIFIED_SUCCESS from bytes, not memory.

## REMAINING_RISK / ROLLBACK
- The OPERATOR-FACING invocation (IPC channel or packaged CLI) is deliberately NOT built:
  renderer-reachable surfaces require frozen `packages/shared` contracts (FG gate), and a `.cjs` CLI would
  duplicate the derivation (§56). Follow-up envelope: one additive IPC channel + renderer surface, or a
  built-output CLI — operator's choice, gate presented when taken. Dashboard status: READBACK = PARTIAL
  (capability real and pinned; operator command surface pending gate).
- Rollback: delete the two new files (no other file changed).

## STATUS
**CLOSED (TEST-VERIFIED).** Custody note: this slice is the first repository mutation of the SEAM
programme; pre-change FREEZE INTACT was captured (baseline `40616b9` = HEAD, ANCESTRY OK · SOURCE OK)
and no frozen or sensitive path was touched.

---

## ADDENDUM · SLICE 1b — §21 MAXIMAL INDEPENDENCE (same sitting)
The recon fleet's read-back agent identified the honest gap in slice 1's independence: `readBack()`
reads through the live singleton, whose `ensureLoaded` memoizes — an in-process read of memory, not of
the file. Landed (single purpose, non-frozen): `createActionRecordReader(dir)` in
`connectors/actionRecord.ts` — a **READ-ONLY** fresh reader (exposes `query` only; cannot observe,
verify, or persist) over the identical envelope/load path and identical filter semantics (no forked
parser, §56) — and `readBackFromDisk(dir, scopeKey, ref)` in `reconciliation/readBack.ts`. **Pinned:**
with the singleton deliberately pointed elsewhere, `readBackFromDisk` still reconstructs the persisted
truth (the divergence-catching form an operator surface should use); the reader is runtime-verified
write-free. 14 readBack pins total; focused+adjacent 60/60; tsc node clean; lint clean; full main suite
re-run recorded in §1.
