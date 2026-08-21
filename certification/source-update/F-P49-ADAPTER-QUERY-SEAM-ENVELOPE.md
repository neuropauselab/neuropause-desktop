# F-P49 · THE GRAPH ADAPTER QUERY SEAM — GATE-CLASS ENVELOPE

**STATUS: PRESENTED, NOT APPLIED.** No file under `verification/` has been modified. `mockGraph.ts` untouched.
No network path added. This document exists to be ruled on, not acted on.

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
The gate number is the operator's to assign — this document does not claim one.
