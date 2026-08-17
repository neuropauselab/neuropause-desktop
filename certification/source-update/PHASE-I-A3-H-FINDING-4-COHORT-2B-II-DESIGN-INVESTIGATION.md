# Phase I-A.3 — H-FINDING-4 Cohort-2B-ii Design Investigation (READ-ONLY)

**No production/test/frozen-surface change, no commit, no push.** Baseline HEAD `cc184d0`, branch
`cert/data-import-cst-integration`. Labels: `[PROVEN]`/`[PROVEN-ABSENT]`/`[INFERRED]`/`[DESIGN]`/
`[OPEN]`/`[NOT PROVEN]`.

## 1. Repository state `[PROVEN]`
HEAD `cc184d0` (chain `90527b4 → dc9e8f3 → 8846371 → cc184d0`). Working tree: only 4 prior read-only
docs untracked; nothing staged. Cohort-1/2A/2B-i committed and unchanged. No discrepancy.

## 2. Exact three-action inventory `[PROVEN]`
`drive.upload`, `drive.restoreVersion`, `contacts.update` — all `mutates:true`, scopes
`Files.ReadWrite` / `Files.ReadWrite` / `Contacts.ReadWrite`. **None is in any governed set**
(`COHORT1`/`COHORT2A`/`COHORT2B_I`) → all route to the raw `m365.execute` executor on IPC (verified
count 0 at commit `cc184d0`).

## 3. Source implementation evidence `[PROVEN]`
- **drive.upload** (`drive.ts` `upload`): `bytes ≤ CHUNK(5MB)` → `sendBinary('PUT', /me/drive/root:/{path}:/content, bytes)`
  (Graph PUT-content is an UPSERT: creates OR **replaces** existing content at the path); `> CHUNK` →
  `createUploadSession` with `'@microsoft.graph.conflictBehavior': 'replace'`, then chunked PUTs via raw
  `fetch()`. Params: `path`, `contentBytes` (base64), `contentType`.
- **drive.restoreVersion** (`drive.ts` `restoreVersion`): `POST /me/drive/items/{itemId}/versions/{versionId}/restoreVersion`.
  Params: `itemId`, `versionId`.
- **contacts.update** (`contacts.ts` `update`): `PATCH /me/contacts/{contactId}` with `contactBody(p, false)`
  — a PARTIAL update (only fields provided in params; no `If-Match`/etag). Params: `contactId` + any of
  givenName/surname/companyName/mobilePhone/emails.

## 4. Consequence analysis per action (A–H)
### drive.upload
- **A. Effect:** create-or-**overwrite** a file at `path` with `contentBytes`. `[PROVEN]`
- **B. Caller params:** path, contentBytes, contentType (renderer-supplied). `[PROVEN]`
- **C. Server state for consequence:** whether a file already exists at `path` (occupied ⇒ overwrite; empty ⇒ create). `[PROVEN]`
- **D. Fully param-derivable?** **NO** — the overwrite-vs-create outcome depends on server-side path occupancy, not in the request. `[PROVEN]`
- **E. Can overwrite existing state?** **YES** (both small PUT-content and large `conflictBehavior:'replace'`). `[PROVEN]`
- **F. Data loss possible?** Yes — the prior file content at `path` is replaced. `[PROVEN]`
- **G. Reversal guaranteed/conditional/unavailable:** **CONDITIONAL** — only via OneDrive version history. `[INFERRED]`
- **H. Provider version history restores prior state?** OneDrive typically retains versions (recoverable via `drive.restoreVersion`), **but repo source does not prove version retention is enabled for every account/library** ⇒ recovery is NOT provable from source. `[INFERRED, NOT PROVEN]`
### drive.restoreVersion
- **A. Effect:** replace the item's current content with version `versionId`. `[PROVEN]`
- **B/C. Params:** itemId, versionId; the version's content is server-side. `[PROVEN]`
- **D. Fully param-derivable?** The ACTION is (which version to restore); the resulting content is server-side. `[PROVEN]` (identity) / `[INFERRED]` (result)
- **E/F. Overwrite/loss:** replaces current content; OneDrive typically snapshots the pre-restore state as a new version. `[INFERRED]`
- **G/H. Reversal:** CONDITIONAL — a further restore can recover the pre-restore content IF versions are retained; NOT repo-proven. `[INFERRED, NOT PROVEN]`
### contacts.update
- **A. Effect:** partial overwrite of the named contact's fields. `[PROVEN]`
- **B/C. Params:** contactId + provided fields; the OLD field values are server-side. `[PROVEN]`
- **D. Fully param-derivable?** New values yes; the LOSS (old values) is server-side. `[PROVEN]`
- **E/F. Overwrite/loss:** YES — provided fields overwritten; **contacts have no version history and the connector has no contacts.restoreVersion** ⇒ old values are **unrecoverable**. `[PROVEN-ABSENT recovery]`
- **G/H. Reversal:** effectively UNAVAILABLE (a caller could re-set old values only if it already knew them). No provider version history. `[PROVEN-ABSENT]`

## 5. Reversibility analysis (I–J) `[PROVEN]`/`[INFERRED]`
CST `Reversibility` = `REVERSIBLE | PARTIALLY_REVERSIBLE | DIFFICULT_TO_REVERSE | IRREVERSIBLE | UNKNOWN`.
Honest, source-safe classification:
- **drive.upload:** overwrite recovery is INFERRED (OneDrive versions) but NOT repo-proven ⇒ the
  source-safe label is **conservative IRREVERSIBLE** (labelling it PARTIALLY_REVERSIBLE would **assert a
  version-recovery capability the repo cannot prove**). `[I: conservative IRREVERSIBLE]`
- **drive.restoreVersion:** same reasoning ⇒ **conservative IRREVERSIBLE**. `[I]`
- **contacts.update:** **DIFFICULT_TO_REVERSE** — source-proven no version history/recovery (precise and
  honest). `[PROVEN]` (conservative IRREVERSIBLE also acceptable).
**J. New metadata field necessary?** **NO** — the `ACTION_REVERSIBILITY` map + `reversibilityForAction()`
already exist (Cohort-2B-i). Adding entries (or relying on the IRREVERSIBLE default) requires no new
field and does NOT touch `actionSdk.ts`/`WriteAction`.

## 6. Server-state dependency analysis `[PROVEN]`
Two of the three have consequence that is **not param-derivable**: drive.upload (overwrite ⇔ path
occupancy) and contacts.update (loss ⇔ existing field values). This mirrors calendar.update (Cohort-2A),
which is governed CONSERVATIVELY. Governance authorizes the caller's inputs + confirmation; it does NOT
observe or assert the server-side pre-state. This must be recorded, not hidden.

## 7. Existing governedAction compatibility (K) `[DESIGN]`
Reusable unchanged for the MECHANICS: authority (actor/tenant), ownership/scope/token/confirmation,
canonical identity, atomic admission, idempotency, Profile-A, denial-before-effect, reconciliation. The
reversibility LABEL is descriptive CST evidence — the kernel does NOT branch on it — so governance for
these three is IDENTICAL to Cohort-2B-i; only the honest label differs (conservative IRREVERSIBLE /
DIFFICULT_TO_REVERSE, NOT REVERSIBLE). `[DESIGN]`

## 8. Canonical identity analysis (L) `[PROVEN]`
`sha256(canonicalize({tenantId,connectorId,accountId,actionId,params}))` is sufficient:
- drive.upload: `path` + `contentBytes` (full content) in params ⇒ same content+path → same identity
  (a genuine re-upload suppressed); different content → different identity. (The overwrite is not in
  identity — expected; identity identifies the ACTION, not the pre-existing target state.)
- drive.restoreVersion: `itemId` + `versionId` uniquely identify the restore.
- contacts.update: `contactId` + fields.
No material collision; non-canonicalizable params fail closed. `[PROVEN via the committed mechanism]`

## 9. Restart durability analysis (M) `[DESIGN]`
Routing through `governedAction` reuses the committed `DurableIdempotencyStore` via the shared
`m365ActionPorts` → single-process restart-durable single-use, no new store. `[DESIGN reuse]`

## 10. Denial-before-effect analysis (O) `[PROVEN mechanism]`/`[NOT PROVEN per-id]`
Inherited from `governedAction` (action-agnostic; proven for Cohort-1/2A/2B-i). Dedicated per-id
`effectCalls===0` controls must be added in the implementation gate (unconfirmed/unauthorized/missing-
scope/missing-token/missing-actor/non-canonical). `[NOT PROVEN per-id until written]`

## 11. Concurrency / replay analysis (N, P) `[PROVEN mechanism]`
Atomic single-winner (one effect for concurrent duplicates) and process-lifetime + restart replay
suppression inherited from CST + the durable store. **NetworkError → UNKNOWN → reconcile → HOLD → no
blind re-execution** — critical here: it prevents a blind second overwrite/upload. NOTE `[OPEN]`:
drive.upload's resumable path uses raw `fetch()` (partial-write possible; generic errors classify as
UNKNOWN, not the typed taxonomy) — governance HOLDs (no blind re-upload) but does NOT clean up a partial
upload. Document, do not "fix" here.

## 12. Option evaluation (Q,R,S,T)
| Option | Source-supported? | New authority(Q) | New decision contract(R) | New store(S) | Frozen surface(T) |
|---|---|---|---|---|---|
| **A — reuse governedAction, conservative IRREVERSIBLE (default)** | **YES** | No | No | No | `governedAction.ts` (COHORT2B_II set) + `connectors/index.ts` (routing) — adapter surfaces, NOT the frozen kernel/store/actionSdk |
| B — reuse + precise per-action reversibility (contacts.update→DIFFICULT_TO_REVERSE; drive.*→PARTIALLY_REVERSIBLE) | Partly — PARTIALLY_REVERSIBLE for drive.* would OVER-CLAIM version recovery (unprovable from source) | No | No | No | same as A + map entries |
| C — new governance mechanism | Not needed (kernel is generic) | maybe | maybe | maybe | more |
| D — leave on executor, certify only partial governance | Under-governed (no idempotency/durability) — inferior | No | No | No | none, but no closure |
**Q/R/S = NO** for the recommended path. **T:** only the adapter surfaces (`governedAction.ts`,
`connectors/index.ts`) — the same files edited for 2B-i; the CST kernel, `durableIdempotencyStore.ts`,
`actionSdk.ts`, `sendTransition`/governedSend, and worker surfaces are NOT touched.

## 13. Recommended implementation path (design only — NOT implemented) `[DESIGN]`
**Option A — reuse `governedAction` with CONSERVATIVE reversibility.** Add a `GOVERNED_ACTION_COHORT2B_II`
set = {drive.upload, drive.restoreVersion, contacts.update}; route it through the same `governedAction`
+ durable ports; **label conservatively**: drive.upload / drive.restoreVersion default to IRREVERSIBLE
(recovery not repo-provable), and contacts.update to DIFFICULT_TO_REVERSE (source-proven no recovery) —
optionally IRREVERSIBLE for all three uniformly. **Do NOT label the drive actions PARTIALLY_REVERSIBLE**
(that asserts unprovable version recovery). Governance is identical to 2B-i; the difference is only the
honest higher-consequence label. No new authority/decision/store; CST kernel unchanged.

## 14. Required future files / surfaces `[DESIGN]`
`cst/governedAction.ts` (add `GOVERNED_ACTION_COHORT2B_II` set + optional reversibility-map entries),
`connectors/index.ts` (extend routing to include the 2B-ii set), NEW `cst/governedAction.cohort2bii.test.ts`.
**NOT** `actionSdk.ts`, the CST kernel, the durable store, `runtimeCore`, `contracts.ts`, `package.json`.

## 15. Certification boundary (after a future implementation gate) `[DESIGN]`
**SCOPED CERTIFIABLE** — governed IPC admission (authoritative identity/context, canonical identity,
atomic + single-process-restart-durable admission, denial-before-effect) with an HONEST higher-
consequence reversibility label. **Not** a claim that the overwrite/loss is reversible, that Graph
retains versions, or that the effect/verification succeeded.

## 16. Explicit non-claims
NOT claimed: reversibility of the overwrite/loss · that OneDrive version history exists/restores · that
data loss is recoverable · provider idempotency · Graph effect / effect success / verification success ·
renderer exclusion · cross-process / power-loss durability · that the overwrite consequence is
param-derivable · all M365 writes · universal governance. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠
UNIVERSAL.**

## 17. Remaining risks `[OPEN]`
1. **drive.upload silent overwrite** — a confirmed upload to an occupied path overwrites; the confirmation
   is generic and the occupancy is server-side (governed conservatively, not eliminated).
2. **contacts.update unrecoverable loss** — overwritten fields have no version history/restore.
3. **drive.upload resumable raw-`fetch` path** — partial-write possible; errors are UNKNOWN (coarse);
   governance HOLDs but does not clean up.
4. **Version-retention is INFERRED, not repo-proven** — so recovery must not be claimed.
These are CONSEQUENCE-SEVERITY risks that governance MITIGATES (authorization + confirmation + single-use
+ UNKNOWN→HOLD) but does NOT remove — the reason 2B-ii is a distinct, higher-consequence cohort.

## 18. Separate implementation-readiness decision `[DESIGN]`
**IMPLEMENTATION-READY via Option A.** The mechanism (governedAction + durable store + unchanged kernel)
is reusable with no new authority, decision contract, or store; the only per-action work is the
conservative reversibility label + routing + dedicated tests. The residual consequence risks (§17) are
CERTIFICATION-HONESTY items to record explicitly, NOT implementation blockers.

## 19. Required tests for a future implementation gate `[DESIGN]`
Membership + boundary (the 3 route; nothing else added); governed execution per action; full
denial-before-effect matrix (`effectCalls===0` and `action.run===0`); canonical identity
(reordered/different/content — incl. drive.upload contentBytes); restart-durable single-use per action;
UNKNOWN(NetworkError)+restart → reconcile/HOLD never re-executes (esp. drive.upload); concurrency
one-effect; explicit reversibility-label evidence (drive.* = conservative IRREVERSIBLE, contacts.update =
DIFFICULT_TO_REVERSE) with a recorded note that overwrite/loss reversal is NOT claimed; mail.send +
Cohort-1/2A/2B-i + worker regression green.

## 20. Exact next gate
A separately-authorized **Cohort-2B-ii implementation gate (Option A)** from HEAD `cc184d0`: add
`GOVERNED_ACTION_COHORT2B_II` + conservative labels, route through the existing adapter + durable store,
add the §19 tests, and record the §17 consequence risks in the evidence. This gate does NOT begin it.

## STOP
Read-only design investigation complete. No code, no tests, no commit, no push, no frozen surface changed.
