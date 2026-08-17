# Phase I-A.3 — H-FINDING-4 Cohort-2B-ii Implementation Evidence

**Status: IMPLEMENTED + VERIFIED — AWAITING FINAL REVIEW / COMMIT AUTHORIZATION. Not committed. Not
pushed.** Baseline HEAD `cc184d0`. Labels: `[PROVEN]`/`[PROVEN-ABSENT]`/`[INFERRED]`/`[DESIGN]`/`[OPEN]`.

## 1. Exact three-action scope
`drive.upload`, `drive.restoreVersion`, `contacts.update` — the overwrite / partially-reversible remainder.

## 2. Source-derived effect semantics `[PROVEN]`
- **drive.upload** (`drive.ts`): small (≤5MB) `PUT :/content` (upsert — **replaces** content if the path
  is occupied); large → resumable session `conflictBehavior:'replace'` via raw `fetch`. Overwrite depends
  on **server-side path occupancy — not in params**. `[PROVEN]`
- **drive.restoreVersion** (`drive.ts`): `POST .../versions/{versionId}/restoreVersion`; replaces current
  content with a prior version (itemId+versionId in params). `[PROVEN]`
- **contacts.update** (`contacts.ts`): PARTIAL `PATCH /me/contacts/{contactId}` with only provided fields;
  **no etag / no version history** ⇒ overwritten field values are **unrecoverable**. `[PROVEN-ABSENT recovery]`

## 3. Governance routing `[PROVEN]`
`connectors/index.ts`: the governedAction branch now matches `COHORT1 || COHORT2A || COHORT2B_I ||
COHORT2B_II`, using the identical `governedAction` call and the SAME durable `m365ActionPorts`. mail.send
→ governedSend and the `m365.execute` fallback are unchanged; the three actions no longer fall through to
the raw executor. `[PROVEN]`

## 4. Authority `[PROVEN]`
`actorId=deps.actor()` (session, never renderer, `''`→DENY), `tenantId=deps.workspaceId()`, ownership/
scope/token via `m365OwnsAccount`/`m365GrantedScopes`/`m365GetToken`, `confirmed`. Identical to Cohort-1/
2A/2B-i.

## 5. Canonical identity `[PROVEN]`
`sha256(canonicalize({tenantId,connectorId,accountId,actionId,params}))` — unchanged formula. Tests:
reordered keys → same identity; different path / content / itemId / versionId / contactId / field values →
different identity. The non-param-derivable overwrite/loss (server-side) is correctly NOT in identity —
identity identifies the ACTION, not the pre-existing target state.

## 6. Consequence classification (conservative, source-supported) `[PROVEN]`/`[INFERRED]`
- `drive.upload` → **IRREVERSIBLE** (via the conservative default; OneDrive version recovery is INFERRED,
  not repo-provable — labelling PARTIALLY_REVERSIBLE would over-claim). `[INFERRED → conservative IRREVERSIBLE]`
- `drive.restoreVersion` → **IRREVERSIBLE** (same reasoning). `[INFERRED → conservative]`
- `contacts.update` → **DIFFICULT_TO_REVERSE** (source-proven no version history/recovery). `[PROVEN]`
Implementation: `drive.*` rely on the existing `IRREVERSIBLE` default (no map entry); one map entry
`['contacts.update','DIFFICULT_TO_REVERSE']` was added to `ACTION_REVERSIBILITY`. Reversibility is
descriptive CST evidence, **NOT part of the idempotency key**, so it changes NEITHER identity NOR admission,
and Cohort-1/2A/2B-i behavior is unchanged.

## 7. Denial-before-effect `[PROVEN]`
For all three: unconfirmed → HOLD; unauthorized account / missing scope / missing token / missing actor /
non-canonicalizable params → DENIED — each with `effectCalls===0` AND the injected `action.run` counter
`===0`. Effect unreachable, not merely a verdict.

## 8. Replay `[PROVEN]`
First → one effect; exact + reordered-key → suppressed; different consequential params → independent.

## 9. Concurrency `[PROVEN]`
Concurrent identical (drive.upload) → exactly one effect (CST atomic single-winner); single-process scope.

## 10. Restart durability `[PROVEN]`
All three: fresh `DurableIdempotencyStore` from the same file (= restart) + replay → no second effect.
Reuses the committed store; no new store.

## 11. UNKNOWN / reconciliation `[PROVEN]`
All three: `NetworkError` → UNKNOWN → restart replay → reconcile/HOLD, **never re-executes** (no blind
second overwrite/upload). Critical for the overwrite actions.

## 12. Failure semantics `[PROVEN]`
`HttpError` → `EXECUTION_FAILED`; `NetworkError` → `UNKNOWN`, no blind retry; no `VERIFIED_SUCCESS`
manufactured (no observation oracle). CONSUMED ≠ EFFECT SUCCESS ≠ VERIFICATION SUCCESS.

## 13. Regression evidence (this gate)
- `governedAction.cohort2bii.test.ts`: **31** (membership+boundary, conservative classification,
  execution ×3, denial matrix ×3, identity, restart ×3, UNKNOWN ×3, concurrency, failure/honesty).
- Targeted regression: **202/202** (incl. Cohort-2B-i 59, Cohort-2A 21, mail.send negative 16, Boundary-B
  8, durable worker consumption 9, Cohort-1 negative 15 + restart 6, storeScopeGate 12, durable store 11,
  m365Write 14).
- Full main suite: **8499 passed / 3 skipped** (was 8468 at `cc184d0` → +31 new; the transient +1 failure
  from the stale 2B-i assertion is resolved — see §17). UI: **24 files / 183 passed**. Typecheck clean
  (node+web). Lint (changed files, `--max-warnings 0`): clean. `git diff --check`: clean.

## 14. Frozen-surface verification `[PROVEN]`
Unchanged: CST kernel/`@neuropause/cst 1.3.0`, `durableIdempotencyStore.ts`, `sendTransition`/governedSend,
`mail.ts`, m365 `executor.ts`, `actionSdk.ts`, BoundDecisionClaim/mint, `ExecuteEngine`/`ExecutionSession`/
`ExecutionStore`, Boundary-B, worker router/index/runtime, `runtimeCore`, `contracts.ts`, `storeScope.ts`,
`package.json`, Node engine, Cohort-1 + Cohort-2A production. No new authority, decision contract, or store.

## 15. Provider limitations (honest) `[OPEN]`
- drive.upload silently overwrites an occupied path under a generic confirmation (occupancy server-side).
- contacts.update loss is unrecoverable (no version history).
- drive.upload's resumable raw-`fetch` path can partial-write; its errors classify as UNKNOWN (coarse);
  governance HOLDs but does not clean up.
- OneDrive version retention is INFERRED, not repo-proven — reversal is NOT claimed.
Governance MITIGATES these (authorization + confirmation + single-use + UNKNOWN→HOLD) but does NOT remove
them — the reason 2B-ii is a distinct, higher-consequence cohort.

## 16. Explicit non-claims
NOT claimed: provider reversibility · OneDrive version-retention guarantee · Graph effect / effect success
/ verification success · provider idempotency · renderer exclusion · cross-process / power-loss durability ·
that the overwrite/loss is recoverable · all M365 writes · universal governance. **IMPLEMENTED ≠ VERIFIED ≠
CERTIFIED ≠ UNIVERSAL.**

## 17. Discrepancy resolution (honest record)
The Cohort-2B-i test (`governedAction.cohort2b.test.ts`) contained a **forward-looking default assertion**
expecting the three future 2B-ii actions to be IRREVERSIBLE. Cohort-2B-ii intentionally supersedes that
default for `contacts.update` (→ DIFFICULT_TO_REVERSE, source-proven no version history). Under explicit
authorization, ONE stale assertion was corrected (drive.upload / drive.restoreVersion remain IRREVERSIBLE;
contacts.update → DIFFICULT_TO_REVERSE). **No Cohort-2B-i production behavior or classification changed —
the nine 2B-i actions remain REVERSIBLE.** Cohort-2B-i did NOT govern contacts.update; that is new in
Cohort-2B-ii. The correction does not broaden certification scope.

## 18. Certification boundary
> "The three Cohort-2B-ii M365 IPC actions are governed through the existing parameterized governedAction/
> CST path with conservative source-supported consequence classification: drive.upload and
> drive.restoreVersion are classified IRREVERSIBLE, while contacts.update is classified
> DIFFICULT_TO_REVERSE. The path uses authoritative IPC identity/context, canonical consequential-action
> identity, atomic admission, single-process restart-durable idempotency, and demonstrated denial-before-
> effect, reusing the committed durable store and unchanged CST kernel. No provider reversibility, provider
> idempotency, effect success, verification success, cross-process durability, or power-loss durability is
> claimed."

## 19. Remaining gaps
Cross-process / power-loss durability (OPEN); provider idempotency / effect success / verification (not
provided by any path); the §15 consequence risks (governed conservatively, not eliminated). With
Cohort-2B-ii, **all 29 consequential M365 write actions are now governed on the IPC ingress** (mail.send via
governedSend; the other 28 via governedAction) — but that whole-domain statement is a coverage observation,
not a new certification claim, and the §16 non-claims still hold.

## STOP
Implemented; tests run; evidence written; frozen surfaces checked. **No commit. No push.**
