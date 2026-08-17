# Phase I-A.3 — H-FINDING-4 Cohort-2B Implementation-Readiness (READ-ONLY)

**No production/test/frozen-surface change, no commit, no push.** Baseline HEAD `8846371`, branch
`cert/data-import-cst-integration`. Labels: `[PROVEN]`/`[PROVEN-ABSENT]`/`[INFERRED]`/`[DESIGN]`/
`[OPEN]`/`[NOT PROVEN]`.

## 1. Repository state `[PROVEN]`
HEAD `8846371`; chain `90527b4 → dc9e8f3 → 8846371`. Working tree: only two prior read-only docs
untracked; nothing staged. No discrepancy.

## 2. Scope
Exactly the 12 Cohort-2B actions (no more, no less). Read-only investigation only.

## 3. Exact 12-action inventory `[PROVEN]` (source-cited)
| Action | Endpoint (effect) | scopes | in a governed set? |
|---|---|---|---|
| mail.saveDraft | POST /me/messages (draft) | Mail.ReadWrite | **No** (→ m365.execute) |
| mail.move | POST /me/messages/{id}/move | Mail.ReadWrite | No |
| mail.markRead | PATCH /me/messages/{id} {isRead} | Mail.ReadWrite | No |
| mail.restore | POST /me/messages/{id}/move → inbox | Mail.ReadWrite | No |
| mail.addAttachment | POST /me/messages/{id}/attachments | Mail.ReadWrite | No |
| drive.upload | PUT /me/drive/root:/{path}:/content (conflict=replace) | Files.ReadWrite | No |
| drive.rename | PATCH /me/drive/items/{id} {name} | Files.ReadWrite | No |
| drive.move | PATCH /me/drive/items/{id} {parentReference} | Files.ReadWrite | No |
| drive.createFolder | POST /me/drive/items/{parent}/children (conflict=rename) | Files.ReadWrite | No |
| drive.restoreVersion | POST /me/drive/items/{id}/versions/{v}/restoreVersion | Files.ReadWrite | No |
| contacts.create | POST /me/contacts | Contacts.ReadWrite | No |
| contacts.update | PATCH /me/contacts/{id} | Contacts.ReadWrite | No |
All `mutates:true`; **none is in `GOVERNED_ACTION_COHORT1` or `GOVERNED_ACTION_COHORT2A`** (verified,
count 0 each) → all route to the raw executor on IPC. `[PROVEN]`

## 4. Per-action effect classification `[PROVEN]` — NOT homogeneous
- **Reversible internal data mutation (9):** mail.saveDraft (draft; not sent), mail.move, mail.restore
  (folder move; reversible), mail.markRead (toggle), mail.addAttachment (to a message/draft),
  drive.rename, drive.move (reversible), drive.createFolder (conflict=rename ⇒ non-destructive),
  contacts.create (deletable). **None externally communicative; none a hard delete.**
- **Overwrite / partially-reversible, CONDITIONAL loss (3):**
  - **drive.upload** — PUT to a path with `conflictBehavior:'replace'` (`drive.ts` upload/resumable)
    **OVERWRITES an existing file** at that path. Destructiveness depends on whether the path is
    already occupied — **server-side state NOT in the request params**. Mitigated by OneDrive version
    history (⇒ PARTIALLY_REVERSIBLE). NOTE: the resumable path uses raw `fetch()`, so its transport
    errors classify as UNKNOWN (conservative) rather than the typed taxonomy. `[PROVEN]`
  - **drive.restoreVersion** — replaces current content with a prior version; the current becomes a new
    version (OneDrive-kept). PARTIALLY_REVERSIBLE. `[PROVEN]`
  - **contacts.update** — PATCH overwrites contact fields; **no version history** ⇒ overwritten values
    are lost (DIFFICULT_TO_REVERSE for the changed fields). `[PROVEN]`

## 5. Per-action consequence derivability `[PROVEN]`
- 10 of 12: consequence fully derivable from the action + params.
- **drive.upload:** content/path ARE in params, but the OVERWRITE consequence depends on **server-side
  path occupancy** (category C — server-side state not in the request). `[PROVEN]`
- **contacts.update:** the new values ARE in params, but the LOSS (old field values overwritten) is
  server-side (category C). `[PROVEN]`
No provider-behavior invented.

## 6. Current IPC routing `[PROVEN]`
`M365ActionExecute` → `mail.send`→governedSend; `COHORT1||COHORT2A`→governedAction (durable); **else →
`m365.execute` (raw executor)**. All 12 hit the raw executor: RBAC + ownsAccount + `mutates&&confirmed`
+ scope + token + pre-effect denial `[PROVEN]`; **no** decision identity / exact binding / idempotency /
durability `[PROVEN-ABSENT]`.

## 7. Current worker routing `[PROVEN]`
All 12 reach the worker path via `runBinding` case `'m365'` → `M365Executor.execute`, AFTER Boundary B
(action-agnostic) + durable `decisionId` consumption. Governed; no bypass; unchanged.

## 8. Governance gap `[PROVEN]`
IPC ingress for the 12 = authorization + confirmation + denial-before-effect, but **no idempotency,
decision identity, exact binding, or durability**. Same posture the 13 Cohort-1 and 3 Cohort-2A actions
had before their gates. Effect-domain coverage NOT PROVEN at the IPC ingress.

## 9. governedAction reuse analysis `[DESIGN]` — mechanics reusable; reversibility is NOT
| Property | Reusable for all 12? |
|---|---|
| Authority (actor `deps.actor()`, tenant `deps.workspaceId()`) | **Yes** `[PROVEN available]` |
| ownership / scope / token / confirmation | **Yes** (same connector facts) |
| C3 consequence (confirmation-gated) | **Yes** (all mutate) — conservative-acceptable |
| **Reversibility = IRREVERSIBLE (hardcoded)** | **NO** — DISHONEST for reversible internal mutations; must become PER-ACTION `[DESIGN/OPEN]` |
| Profile-A / expectedPostState | Yes (Graph responses are ACKNOWLEDGEMENTS, not authoritative reads) |
| Canonical identity | Yes (see §11) |
| Durable idempotency store | **Yes** (shared ports; no new store) |
| New authority / decision contract / durable store | **None required** `[PROVEN]` |
**Central conclusion:** the adapter's uniform `IRREVERSIBLE` label cannot be honestly inherited by
Cohort-2B (unlike 2A, whose external-communication justified conservative IRREVERSIBLE). **Per-action
reversibility metadata is REQUIRED.** `[DESIGN]`

## 10. Durable-store reuse analysis `[DESIGN]` (reuse; no new store)
Routing the 12 through `governedAction` reuses the committed `DurableIdempotencyStore` via the shared
`m365ActionPorts` — same TENANT/OWNER scope (tenant-embedding key), atomic-rename persistence, replay,
restart hydration. No new store, no new persistence file, no second idempotency mechanism.

## 11. Canonical identity analysis `[PROVEN]`/`[DESIGN]`
`sha256(canonicalize({tenantId,connectorId,accountId,actionId,params}))` is sufficient for all 12:
- Consequential fields are in params: mail (messageId/destinationId/subject/body/isRead/name/
  contentBytes), drive (path/contentBytes/itemId/parentId/name/versionId), contacts (contactId + fields).
- `contentBytes` (base64 file/attachment content) is included → different content ⇒ different identity;
  identical content+path ⇒ same identity (a genuine re-upload is suppressed — same single-use semantics
  as Cohort-1). canonicalize handles large strings/arrays; fail-closed on non-canonicalizable.
- **Caveat (not a collision):** server-side-state-dependent CONSEQUENCE (drive.upload overwrite;
  contacts.update field loss) is NOT captured by identity — expected: identity identifies the ACTION,
  not pre-existing state. No two materially-different effects share an identity; no logically-identical
  action gets two identities (modulo byte-identical content). Do NOT claim identity captures server state.

## 12. Replay / idempotency analysis `[DESIGN]`
Same CST semantics as Cohort-1/2A: exact replay + reordered-key → suppressed; different params →
independent; concurrent identical → one effect (atomic claim); interrupted UNKNOWN → reconcile/HOLD;
restart replay → durable suppression. **NeuroPause admission/idempotency ≠ provider idempotency ≠
effect success** (Graph does NOT dedupe these; a suppressed replay prevents a duplicate NeuroPause
admission, not a provider-side guarantee).

## 13. Denial-before-effect requirements `[PROVEN]` mechanism / `[NOT PROVEN]` per-id
The `governedAction` denial-before-effect is proven action-agnostically. Dedicated Cohort-2B negative
controls the implementation gate MUST add (per representative action, incl. the 3 overwrite actions):
unconfirmed → HOLD; missing actor / unauthorized account / missing scope / missing/invalid token →
DENIED; non-canonical params → DENIED; each with `effectCalls===0` AND `action.run===0`; plus replay,
reordered-key, different-params, concurrent, restart-durable, and UNKNOWN-restart controls. `[NOT PROVEN]`
until written.

## 14. Failure semantics `[PROVEN]`/`[OPEN]`
Profile A applies to all 12: HttpError/Auth/RateLimit/Input → EXECUTION_FAILED; NetworkError → UNKNOWN →
reconcile → HOLD → no blind retry; VERIFIED_SUCCESS unreachable. **UNKNOWN→HOLD is SAFE for every one**
(no blind re-execution; especially important for the overwrite actions — a HOLD prevents a blind second
overwrite). NOTE `[OPEN]`: drive.upload's resumable path raises generic `fetch` errors that classify as
UNKNOWN (conservative), not the typed taxonomy — safe but coarser; document, do not "fix" here.

## 15. Renderer / IPC trust analysis `[PROVEN]`
Direct-action model unchanged: actor/tenant authoritative (never renderer); connector/account/action/
params/confirmed renderer-supplied and governed. **drive.upload's `path` + `contentBytes` are
renderer-supplied consequential fields** (they choose the write target / overwrite candidate) — governed
by authorization + confirmation, NOT excluded. Do NOT claim renderer exclusion; do NOT introduce
worker-style Boundary-B into IPC (source does not require it).

## 16. Worker Boundary-B verification `[PROVEN]`
All 12 stay on the worker path (runBinding → Boundary B → durable consumption → M365Executor); no
regression, no bypass, H-FINDING-3 not reopened. Worker code unchanged.

## 17. Frozen-surface verification `[PROVEN]`
Unchanged this gate (read-only): CST kernel, `durableIdempotencyStore.ts`, `sendTransition`/governedSend,
`mail.ts`, m365 `executor.ts`, `actionSdk.ts`, BoundDecisionClaim/mint, `ExecuteEngine`/`ExecutionSession`/
`ExecutionStore`, Boundary-B, worker router/index/runtime, `runtimeCore`, `contracts.ts`, `storeScope.ts`,
`package.json`, Node engine.

## 18. Option A/B/C/D comparison `[DESIGN]`
| | A: per-action consequence/reversibility metadata | B: separate adapters per class | C: new decision contract | D: independent partial governance |
|---|---|---|---|---|
| Source alignment | HIGH (parameterize the existing adapter) | duplicative | unnecessary | leaves gap |
| New authority | No | No | likely | No |
| New decision contract | No | No | Yes | No |
| New durable store | No | No | maybe | No |
| Semantic correctness | **honest per-action reversibility** | honest but heavy | over-engineered | dishonest/partial |
| Frozen surfaces | `governedAction.ts` (map + set), `connectors/index.ts`; **NOT** actionSdk/kernel/store | more files | contracts + store | none but no closure |
| Over/under-governance risk | low (C3 conservative + honest reversibility) | low | high complexity | under-governed |
**Recommend Option A.** Add a per-action reversibility map (default IRREVERSIBLE ⇒ Cohort-1/2A behavior
unchanged; reversibility is NOT in the idempotency key, so identity/admission are unaffected) and route
the 12 through `governedAction`. Keep C3. No new authority/decision/store; kernel untouched.

## 19. Recommended implementation cohort structure `[DESIGN]`
Because Cohort-2B is not homogeneous, split for review emphasis (one mechanism, per-action reversibility):
- **Cohort 2B-i — reversible internal (REVERSIBLE), 9:** mail.saveDraft, mail.move, mail.restore,
  mail.markRead, mail.addAttachment, drive.rename, drive.move, drive.createFolder, contacts.create.
- **Cohort 2B-ii — overwrite / partially-reversible (PARTIALLY_REVERSIBLE; DIFFICULT_TO_REVERSE for
  contacts.update), 3:** drive.upload, drive.restoreVersion, contacts.update — implement WITH explicit
  review of the overwrite/loss semantics (drive.upload's non-param-derivable overwrite + raw-fetch
  resumable path; contacts.update's unversioned loss). Recommend 2B-i first (lowest risk), then 2B-ii.

## 20. Exact implementation files a future gate would touch `[DESIGN]`
`cst/governedAction.ts` (per-action reversibility map + `GOVERNED_ACTION_COHORT2B` set(s) + parameterize
the request's `reversibility` from the map), `connectors/index.ts` (extend routing), NEW
`cst/governedAction.cohort2b.test.ts`. **NOT** `actionSdk.ts` (use a map, not a WriteAction field),
NOT the CST kernel, durable store, Node/package.

## 21. Exact tests required (future gate) `[DESIGN]`
Membership (the 12 route; nothing else added); governed execution per action (effect once);
denial-before-effect matrix (§13) with `effectCalls===0`; canonical identity (reordered/different/
content); restart-durable single-use per representative action; UNKNOWN-restart reconcile/HOLD;
concurrency one-effect; explicit evidence that drive.upload/contacts.update reversibility is labelled
honestly (REVERSIBLE/PARTIALLY_REVERSIBLE), NOT IRREVERSIBLE; mail.send + Cohort-1/2A + worker
regression green.

## 22. Certification level available after implementation `[DESIGN]`
**SCOPED CERTIFIABLE** (same tier as Cohort-1/2A): governed IPC admission with authoritative identity/
context, canonical action identity, atomic + single-process-restart-durable admission, denial-before-
effect, and HONEST per-action reversibility. NOT provider idempotency, effect success, verification
success, cross-process or power-loss durability.

## 23. Per-action certification questions (current state) `[PROVEN]`/`[PROVEN-ABSENT]`
For all 12 (uniform today): Governed today = worker YES `[PROVEN]`, IPC PARTIAL `[PROVEN]`; Authoritative
= YES `[PROVEN]`; Pre-effect denial = IPC executor YES `[PROVEN]`; Exact consequential identity = IPC
`[PROVEN-ABSENT]` (would be `[DESIGN]` if routed); Process-lifetime idempotency = `[PROVEN-ABSENT]` (→
`[DESIGN]`); Restart-durable idempotency = `[PROVEN-ABSENT]` (→ `[DESIGN]` via shared store); Cross-process
durability = `[NOT PROVEN]`; Provider idempotency = `[PROVEN-ABSENT]`; Effect success = `[PROVEN-ABSENT]`;
Verification success = `[PROVEN-ABSENT]`; Renderer exclusion = `[PROVEN-ABSENT]` (direct-action, governed);
Worker Boundary-B = `[PROVEN]`; IPC governance = PARTIAL `[PROVEN]`; Certifiable today = **No** (IPC gap);
Minimum implementation = **Option A** (per-action reversibility metadata + routing + tests).

## 24. Permitted claim
> "The 12 Cohort-2B M365 IPC actions are worker-ingress governed (Boundary-B + durable decisionId) and
> IPC-ingress authorized (RBAC + ownership + scope + token + confirmation) with denial-before-effect, but
> lack decision identity, exact binding, idempotency, and durability on the IPC ingress. They are
> IMPLEMENTATION-READY to be governed through the committed governedAction/CST path and the SAME durable
> store, reusing the unchanged CST kernel with NO new authority, decision contract, or durable store —
> PROVIDED a per-action reversibility model is added, because Cohort-2B is not homogeneous: 9 are
> reversible internal mutations and 3 (drive.upload, drive.restoreVersion, contacts.update) are
> overwrite/partially-reversible with conditional loss (drive.upload's overwrite and contacts.update's
> field loss depend on non-param-derivable server-side state). Nothing here is implemented, tested, or
> certified."

## 25. Explicit non-claims
NOT claimed: all M365 actions/writes governed · universal governance · provider idempotency · Graph
effect success · verification success · renderer exclusion · cross-process/power-loss durability ·
Cohort-2B certification · that identity captures server-side overwrite/loss consequence. **IMPLEMENTED ≠
VERIFIED ≠ CERTIFIED ≠ UNIVERSAL**; AUTHORITY ≠ DECISION ≠ CLAIM ≠ ADMISSION ≠ EXECUTION ≠ EFFECT ≠
VERIFICATION ≠ EVIDENCE ≠ CERTIFICATION.

## 26. Next separately-authorized gate
A **Cohort-2B implementation gate** (Option A): add a per-action reversibility map + `GOVERNED_ACTION_
COHORT2B` set(s), route the 12 through `governedAction` with the shared durable store, and add the §21
tests — starting with 2B-i (reversible, 9) then 2B-ii (overwrite/partially-reversible, 3) with explicit
overwrite/loss review. From HEAD `8846371`. This gate does NOT begin it.

## STOP
Read-only readiness analysis complete. No code, no tests, no commit, no push, no frozen surface changed.
