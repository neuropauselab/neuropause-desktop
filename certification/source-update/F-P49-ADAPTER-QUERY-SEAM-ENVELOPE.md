# FG-15 · THE GRAPH ADAPTER QUERY SEAM — GATE DOC (F-P49's neighbourhood)

**STATUS: ACCEPTED AND APPLIED, 21 Aug 2026.** The operator accepted the envelope and directed the worker to
take the next free FG number and report it back — *"I do not assign identifiers, per the standing rule that
produced the ninth collision."*

**GATE NUMBER: FG-15, assigned by the worker and reported back.** Derivation, stated so it can be checked:
FG-1…FG-12 are closed; **FG-13 is RESERVED** (`grantedScopes` nullable — prepared, sequenced after P0, not
applied); **FG-14 is CLOSED** (`c563cdd`, causal episode identity, F-P40). `FG-15` and `FG-16` appear in the
corpus **only inside a rhetorical sentence** — *"solving this once as FG-14, again as FG-15, and again as FG-16
is how the product does not finish"* — which is a warning, **not an assignment**. A reserved-but-unapplied number
is still taken; that is why this is FG-15 and not FG-13.

**ACCEPTANCE CONDITION (operator, verbatim): byte-identical URLs, with the unmodified verification suite green as
the no-change proof — and the self-avoidance clause holds as the condition of acceptance:** *each `$select`
assertion is tabled against the consumer that earns it; a pin that copies the adapter's own string asserts only
that the string equals itself.*

**BOUNDARIES HELD:** `mockGraph` untouched · no network path added · nothing else in `verification/` moved.

*(The sections below are the envelope as presented, preserved verbatim. The outcome is recorded at §9.)*

**GATE CLASS:** `certification/gate-detector.sh apps/desktop/src/main/verification/m365ReadBack.ts` → **`GATE`**
(*matches security/governance*). A sensitive-surface diff is presented verbatim and waits for a token; it is never
slipped in alongside other work.

---

## 1 · THE FINDING — THE REQUEST IS NOT CONSTRUCTIBLE IN ISOLATION

This is the finding itself, not a preamble to a fix.

`m365ReadBack.ts:43-45` and `:55-57` build each Graph URL as an **inline template literal passed directly into
`get(...)` inside the async closure**. `get` (`:32-39`) reaches **`connectorVault.get()` at `:33` *before* `fetch`
at `:35`**. There is no pure function that returns the request, and no point at which the constructed request is
observable without executing the closure.

**The consequence for testing:** to observe the URL you must stub **two** things — the vault and global `fetch` —
and a pin built that way asserts the query shape only through mocks it supplied itself. That is not a contract
pin; it is a mirror of the implementation, which is exactly F-P49's defect one layer up.

**Compounding facts, measured:**
- `makeM365GraphReader` has **never been executed by anything.** Its only two test mentions are
  `mockGraph.test.ts:34` (a hand-copied "faithful mirror" — F-P49) and `vocabularyReconciliation.test.ts:252`
  (a source-*text* string assertion).
- `mockGraph.ts:127,130` dispatches on a **folder-path regex**. It parses no `$select`, no `$filter`, no `$top`,
  no `$orderby`, and ignores tenant/workspace, account and action id entirely.

---

## 2 · THE MINIMAL SEAM — TWO EXPORTED PURE QUERY BUILDERS

Nothing else moves in `verification/`. No behaviour changes: the closures call the builders, the builders return
the same strings the closures previously interpolated inline. **Byte-identical URLs — that is the acceptance
condition, and it is why the existing unmodified verification suite passing green is the no-change proof.**

### THE DIFF, VERBATIM

```diff
 const addr = (r?: GraphRecipient): string => r?.emailAddress?.address ?? '';
 
+/**
+ * THE REQUESTS, CONSTRUCTIBLE WITHOUT EXECUTING THE READER (F-P49).
+ *
+ * These exist so the query shape can be pinned by a contract test with NO network, NO credentials and NO vault
+ * stub. They are pure: same input, same string, no I/O. The reader below is their only production caller, so
+ * there is ONE definition of each request and no second copy to drift (F-N16-1's rule).
+ *
+ * The $select lists are load-bearing, not decoration — each field named here is CONSUMED by the read-back:
+ * internetMessageId (corroboration id) · toRecipients (tuple limb) · sentDateTime (the verbatim provider
+ * instant, NP-015) · subject/bodyPreview (fingerprints). Removing one silently degrades every verification
+ * to UNKNOWN.
+ */
+export function sentItemsQuery(): string {
+  return `${GRAPH}/me/mailFolders/sentitems/messages?$top=25&$select=subject,toRecipients,sentDateTime,internetMessageId,bodyPreview&$orderby=sentDateTime%20desc`;
+}
+
+export function inboxQuery(): string {
+  return `${GRAPH}/me/mailFolders/inbox/messages?$top=25&$select=subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20desc`;
+}
+
 /** Build a read-only Graph reader for one connected account. Re-reads the token per call (it may refresh). */
 export function makeM365GraphReader(workspaceId: string, connectorId: string, accountId: string): {
```

```diff
     readSentItems: async (): Promise<SentItem[]> => {
-      const rows = await get(
-        `${GRAPH}/me/mailFolders/sentitems/messages?$top=25&$select=subject,toRecipients,sentDateTime,internetMessageId,bodyPreview&$orderby=sentDateTime%20desc`,
-      );
+      const rows = await get(sentItemsQuery());
```

```diff
     readInbox: async (): Promise<InboxItem[]> => {
-      const rows = await get(
-        `${GRAPH}/me/mailFolders/inbox/messages?$top=25&$select=subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20desc`,
-      );
+      const rows = await get(inboxQuery());
```

**Three hunks, one file. Nothing else in `verification/` is touched.**

---

## 3 · WHAT THE PIN WOULD ASSERT

**Derived from what the read-back CONSUMES — never hand-copied from the adapter.** A pin that copies the
adapter's own string asserts only that the string equals itself; that is F-P49's disease with extra steps. Each
assertion below traces to a consumer:

| Assertion | Consumer that earns it |
|---|---|
| path is `/me/mailFolders/sentitems/messages` — the **sent folder**, not `/me/messages` | send-corroboration is a Sent Items claim; a mailbox-wide read would corroborate against the wrong population |
| `$select` **⊇** `{internetMessageId, toRecipients, sentDateTime, subject, bodyPreview}` — superset, not equality, so adding a field is not a failure | `verifyEffect`'s tuple + fingerprints |
| `sentDateTime` present | NP-015: the corroborated row's instant is read **verbatim** as `effectTime`; **an untimeable row cannot corroborate** |
| `internetMessageId` present | the corroboration id; absent ⇒ every terminal degrades to UNKNOWN |
| `$top` present and bounded | a pass must be bounded; an unbounded read is an unbounded reconciliation tick |
| `$orderby=sentDateTime desc` | the bounded-interval reasoning (`requestTime ≤ effect ≤ at`) assumes recency ordering |
| inbox path + `$select ⊇ {from, subject, receivedDateTime, bodyPreview}` | bounce detection |
| token rides in an **`Authorization: Bearer` header** and **never appears in the URL** | NP-013's credential boundary; a URL is logged, a header is redacted |

**Cost: zero.** No network, no credentials, no vault, no Electron, no `out/` rebuild.

---

## 4 · THE FALSIFICATION GAP — WHY THE MOCK CANNOT DO THIS

Stated plainly, because this is the whole argument for the seam:

**Drop `internetMessageId` from `$select` and the mock still hands it back.** `mockGraph.ts` never reads the
query — it matches the folder path with a regex and returns a fixed object built from `state.lastSent`. So every
existing test stays green, `mockGraph.test.ts` stays green, the e2e runners stay green — **and in production every
verification silently degrades to UNKNOWN**, because the corroboration id the oracle needs was never requested.
The same holds for `sentDateTime`: NP-015 already established that *an untimeable row cannot corroborate*, so
losing that one field converts VERIFIED_SUCCESS into UNKNOWN across the board.

**A green suite would be reporting on a request the product no longer sends.** That is the precise gap the pin
closes and the mock, by construction, cannot.

---

## 5 · THREAT ANALYSIS, BOTH DIRECTIONS

**If applied.** The builders are pure string returns with no I/O, no branching and no inputs, so they cannot leak
a credential (the token is never in the URL — asserted by the pin itself), cannot widen a scope, and cannot alter
what is read. `makeM365GraphReader` remains the only production caller. The risk is the ordinary one for any
extraction: a transcription error in the moved string. **Mitigated by the acceptance condition — byte-identical
URLs — and by the unmodified verification suite, which must stay green without edits.**

**If NOT applied.** The adapter's query shape stays unpinnable, and it remains true that the only code exercising
the Graph mapping is a hand-copied mirror (F-P49). The first person to trim `$select` for latency, or to switch
folders, does so with **no test anywhere in the repository able to notice.** Given the read-back is now the
production caller for F-P39's terminal, that field list is on the critical path to every verification the product
will ever produce.

---

## 6 · VERIFICATION PLAN

1. `gate-detector.sh` on the path **before** the edit (already run: `GATE`).
2. INTACT #1 → apply the three hunks → full main suite → isolated commit → re-record → INTACT #2.
3. **The no-change proof:** the existing `verifyGovernedSend`/`verifyEffect`/`mockGraph` suites run **unmodified**
   and stay green. Any edit to them would void the proof.
4. Suite delta must be **exactly the new pin file** — measured, not asserted, the way `68e3349` was (+1 file,
   +4 tests, zero existing assertions changed).
5. `verify-e2e-strip.sh` **NOT run** — it rebuilds `out/` as release and the armed ceremony build must remain the
   last build. The seam adds no e2e surface, so the strip property is unaffected by construction.

---

## 7 · WHAT THIS DOES NOT DO

- It does **not** execute `makeM365GraphReader`. The adapter remains never-executed; a query-shape pin is not an
  execution proof, and **REACHABLE is not BELIEVABLE** (§5.0d).
- It does **not** close F-P39 — the terminal is still never produced.
- It does **not** close F-P41 — producible is not produced.
- It does **not** fix F-P49. The hand-copied mirror in `mockGraph.test.ts` survives this seam untouched; it needs
  its own ruling.
- It does **not** flip `productionWired`, which is a hardcoded literal at `executionGate.ts:67-68` consumed only
  by a display string.

---

## 8 · THE TOKEN

Nothing is applied until the literal token is given:

```
AUTHORIZED: FG-N — m365ReadBack pure query builders, three hunks one file, per gate doc
```

**Silence is not consent; enthusiasm is not consent. A diff that changes after the token requires a new token.**

---

## 9 · OUTCOME — FG-15 CLOSED, AND R2/R5's GATE CONDITION

**LANDED at `b5fcae3`**, baseline `BASELINE-ca426c6b3fd6`, INTACT both sides, gate-detector run **before** the
edit (`GATE`). Main **884 / 9260 / 5** (was 883 / 9252 / 5) — **delta exactly +1 file, +8 tests**, zero existing
assertions changed; typecheck 0, lint 0. **Byte-identity proven mechanically**, not asserted: the pre-edit
literals were extracted from git and diffed against the builders' returns — empty diff. **The pin was proven
load-bearing by mutation**: dropping `internetMessageId` from `$select` turned it red with the exact message, and
the file was restored **byte-identically** (sha256 compared before and after).

### R2 — **GATE CONDITION NOT MET, AND THE CONDITION IS NOT WHAT R2 EXPECTED: R2 IS OBSOLETE.**

R2 asked that **subject cannot be a limb** when the target is built from the evidence store. Measured at HEAD
**[CURRENT SOURCE]**: `readBackReconciler.ts:172` passes `subjectMatchKey: record.subjectFingerprint`, and
`verifyEffect.ts:124-127` compares it in the **RECORD-FINGERPRINT codomain** (`recordFingerprint(item.subject)`),
not the plaintext one. **D2 dissolved R2's premise rather than satisfying it.** The original defect — two
functions named `fingerprint` with different codomains, so `subjectOk` was always false — was fixed by aligning
the codomain, **so the limb survives and works.**

**Implementing R2 as written would now be a REGRESSION**: removing `subjectMatchKey` would delete a working limb
and leave corroboration resting on recipient + time window alone. **R2 should be RETIRED by ruling, not built.**
That is the operator's call; this document does not retire it.

### R5 — **GATE CONDITION PARTIALLY MET. TWO CONDITIONS FAIL, AND BOTH ARE NAMED.**

**Already built [CURRENT SOURCE]:** `requireUniqueMatch` exists on both `VerificationTarget` (`verifyEffect.ts:60`)
and `GovernedSendRef` (`verifyGovernedSend.ts:60`), and **the production caller already opts in** —
`readBackReconciler.ts:175` sets it `true`. More than one hit ⇒ `state: 'HOLD'`, detail *"AMBIGUOUS, held for
reconciliation (ambiguity is never corroboration)"*. The bounded interval exists: `sentAtWindow {fromMs, toMs}`
with `maxWidthMs: MAX_CORROBORATION_WIDTH_MS` (120 s), exceeded ⇒ UNKNOWN with zero provider reads.

**CRITERION 8 — MET.** Ambiguity yields the `unresolved` class and **it is pinned**:
`readBackReconciler.test.ts:273` asserts `v.provenance.method` contains `AMBIGUOUS`. **One precision worth
keeping:** the terminal is **`HOLD`**, not the literal string `UNKNOWN`. Per `classifyTerminal`, HOLD is in the
`unresolved` class, and §2 #9 routes UNKNOWN → HOLD → RECONCILIATION — so the *behaviour* is R5's, while the
*vocabulary* is D-16's. Recorded rather than smoothed over.

**FAILING CONDITION 1 — THE UNIQUENESS KEY IS THE WRONG WIDTH.** R5 specifies uniqueness over *"exactly one row
in the bounded interval matching the recipient."* Source computes `sent.filter((m) => matchesTuple(m, target))` —
uniqueness over the **FULL TUPLE** (recipient **and** subject **and** window **and** body **and** id). The tuple
is the *narrower* key, so **it detects less ambiguity**: two Sent Items rows to the same recipient in the same
window that differ only in subject are **not** ambiguous today, and one of them would corroborate. R5's key is
deliberately wider because a wider key is the safer one.

**FAILING CONDITION 2 — "ZERO → NOT FOUND" HAS NO DISTINCT TERMINAL.** Zero hits returns
`state: 'HOLD'` (*"not observed after bounded backoff"*) and >1 hits returns `state: 'HOLD'` (*"AMBIGUOUS"*).
**Both land on the same terminal, separated only by prose in `detail`/`method`.** Introducing a distinct
NOT_FOUND terminal would change the D-16 vocabulary, which is **governance-class under §2 #18** and needs its own
ruling — so this is reported, not designed around.

**PROVENANCE STRING, VERBATIM** (`readBackReconciler.ts:306`):
`provenance: { source: 'readBackReconciler', method, oracle: deps.oracleId }`, with
`oracleId = 'm365ReadBack:sentItems+inbox'`.

**THE RESIDUAL, IN MY WORDS.** The query shape is now pinned, so R5's *gate* — "it waits on the Graph adapter" —
is genuinely lifted. What remains is not adapter work at all: **R5's mechanism is already in production and
already switched on; what is wrong is the width of its uniqueness key and the flattening of two different
negatives onto one terminal.** So R5 is smaller than it looked and lives entirely inside `verifyEffect`, while
R2 turns out to be a proposal to *undo* a fix. **Neither implemented in this pass, by instruction.**
