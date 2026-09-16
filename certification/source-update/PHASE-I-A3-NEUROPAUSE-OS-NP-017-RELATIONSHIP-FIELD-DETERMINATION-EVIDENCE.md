# NP-017 · TYPED-RELATIONSHIP FIELDS — DETERMINATION + VALIDITY GUARD
## The slice was queued as "field completion". The determination found two of the four fields cannot be added as metadata at all. **No field was added. A guard was.**

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: SOURCE-PROVEN + TEST-VERIFIED.** Zero production code changed. Zero frozen touch. PROCEED-class
(gate-detector run before the file was written). NP-000 = HOLD unchanged.

## Why this slice did not do what it was queued to do

The queue entry read: *valid_from / valid_to / source_evidence / confidence per link.* Applying the FIELD
LIFECYCLE ladder (ARCHITECTURE-MAPPING §0.3, adopted the same day) before writing anything produced a different
picture — and one genuine hazard.

## SOURCE → OBSERVATION

**The row today** (`dataPlane/relationshipStore.ts`, `RelationshipLink`, 14 fields + tenantId), measured against
spec §21's seven:

| §21 field | Reality | Lifecycle rung |
|---|---|---|
| source | `sourceModuleId` + `sourceRecordId` (+ `sourceField`, `sourceValue`) | **ENFORCEMENT + ADVERSARIAL TEST** |
| relationship_type | `relationshipKey` (36 declared keys, boot-validated against live descriptors) | **ENFORCEMENT + ADVERSARIAL TEST** |
| target | `targetModuleId` + `targetRecordId` | **ENFORCEMENT + ADVERSARIAL TEST** |
| confidence | **PRESENT AND PER-LINK** — `confidence: number` on every row | CONSUMER (display only) |
| source_evidence | PARTIAL — a de-normalized cluster (`sourceField`, `sourceValue`, `method`, `decidedBy`, `correlationId`, `reason`); **no provenance-record id, no sourceTrust** | CONSUMER |
| valid_from | **ABSENT** | BELOW FIELD |
| valid_to | **ABSENT** — no field, no closure, no tombstone | BELOW FIELD |

> **CORRECTION TO MY OWN MAPPING (recorded, §2 #17 in spirit).** ARCHITECTURE-MAPPING's Part A row read
> *"confidence at classification, not per-link"* and *"3 of 7"*. **The source says otherwise: confidence is
> stored on the row.** The true count is **4 of 7 real, 1 partial, 2 absent.** The earlier row was written from
> a scout summary rather than the type; the mapping is corrected in the same commit as this evidence, and the
> claim is now pinned against the real declaration.

**`at` is not a validity start.** `link()` is idempotent per `(owner, sourceRecordId, relationshipKey)` and, on
re-resolution, preserves only `id` while spreading the rest — so `at`, `method`, `confidence`, `decidedBy` and
`reason` are **overwritten by the latest pass**. Re-resolution is routine (every import, every record save).
`at` therefore means *last resolved at*, and no honest `valid_from` can be derived from it.

## THE DECISIVE QUESTION — does any decision depend on a link?

**YES — exactly one, and it is consequential: a governed record DELETE is REFUSED while an incoming link
exists.** The handler returns `ok:false`, mutates nothing, and opens a durable Hold unless the caller re-sends
`force:true`.

**And it depends on EXISTENCE and COUNT alone — never on a per-link attribute.** This is structural, not
incidental: the decision layer is typed over `IncomingLink`, which carries exactly `relationshipKey`, `label`,
`sourceModuleId`, `sourceModuleTitle` — **no confidence, no method, no decidedBy, no timestamp** — and the
mapper that builds it drops the rest at the boundary. Pinned both ways: the interface has none of those fields,
and the mapper mentions none of them. A weak link refuses exactly as hard as a strong one.

Everything else is display or aggregate (graph edges, related-records hops, dashboard counts). **No ingestion
decision depends on a link**: the import commits *first* and resolution runs afterwards, and
`RelationshipDef.mandatory` is declared and read by nothing — so no row is rejected, no parent must resolve, no
child is refused. **No time-dependent use exists**: no traversal is date-filtered anywhere.

## THE HAZARD THIS SLICE EXISTS TO NAME

> **`valid_to` is not a metadata field here. The one enforcement consumes link EXISTENCE — so "this link is no
> longer valid" is semantically "this refusal no longer applies."**
>
> **"An expiring link is a lapsing refusal."**
> **"A weak link refuses exactly as hard as a strong one."**
>
> (Both recorded verbatim by operator ruling, 20 Aug 2026.)

Adding temporal validity to links, then filtering by it anywhere on the read path, would **weaken a governed
refusal as a side effect of a data-model change** — a delete that is refused today would proceed tomorrow,
with no governance decision ever having been made about it. That is the exact shape of defect this program
exists to prevent, arriving through the door marked "completing a spec field".

**So the two absent fields are not implementable as metadata.** They require a prior ruling: *how does the
delete assessor treat an expired link?* That is a governance question, and it is the operator's.

## WHAT LANDED — the guard, not the fields

`dataPlane/relationshipFieldDetermination.test.ts` (14 pins, green): the §21 field reality including the
confidence correction; `at` proven to be last-resolved-at; the decision layer proven unable to see any per-link
attribute; existence-only refusal proven in both directions; and **THE VALIDITY GUARD** — nothing in the
relationship path (store, engine, traversal, assessor) filters links by time, and the assessor consumes the link
array whose shrinking would change the verdict. The guard's docstring names itself: *if you are here because
this failed, you have added temporal validity to links; that is a GOVERNANCE change and needs its own ruling and
a presented gate — do not delete this test to make it pass.*

## PROPOSED — nothing applied, for the operator's ruling

1. **valid_from / valid_to — RULED (operator, 20 Aug 2026): NOT BUILT.** *A field lands with the consumer that
   earns it, and none exists.* **The VALIDITY GUARD is permanent law.** If validity is ever built, the default
   is **ADDITIVE-AND-IGNORED by the delete assessor — an expired link still refuses; a governed refusal never
   lapses silently** — and making expiry lapse the refusal is a NEW GOVERNANCE RULE requiring its own policy
   definition → evidence → adversarial tests → presented gate (CLAUDE §2 #18).
2. **source_evidence — RULED: DEFERRED to its first real consumer.** A safe, honest increment exists — carry the `ProvenanceRecord` id (and the NP-010
   `sourceTrust` label) onto the link, so a link can name the import that produced it rather than only its
   correlation id. It touches no decision (the assessor cannot see it), and it raises source_evidence from a
   de-normalized cluster to a referenced record. **Not built** — it is still a new field on a store, and the
   ladder says a field with no consumer is a debt; it should land with the consumer that wants it.
3. **confidence: nothing to do.** It already exists per-link. The safety property lives UPSTREAM in the
   resolver, which refuses to write a link below deterministic strength and never name-matches a financial
   link — so a downstream confidence threshold would be redundant, not safer.

## Recorded findings — NOT fixed in-slice

- **F-N17-1** `RelationshipDef.mandatory` — declared, never read; pinned as the proof no ingestion decision
  depends on a link.
- **F-N17-2** the resolver, not a threshold, is where link safety lives (pinned).
- **F-N17-3** a link outlives its endpoints: deleting a target does not touch the link; the read path detects
  the dangling end at render time and shows `(deleted record …)`, counted as `brokenLinks`. Honest by design
  ("a broken edge is shown rather than hidden"), recorded because it interacts with any future validity model.
- **F-N17-4 — STAYS SOURCE_REQUIRED (operator-ruled), with the principle recorded verbatim:**
  > **"A declared governance capability is not the same thing as a reachable governance path."**

  The CST kernel HAS a relationship-freshness gate (STALE → HOLD) that is **unreachable**: all three
  desktop adapters omit `relationships` and construct `PolicyStore` without `relationshipActions`, so the
  assessment is always NOT_APPLICABLE. Whether dataPlane links are *meant* to feed it is unsettled — and the
  shapes do not line up today (`RelationshipRef` wants `observedAt: number` + `epistemicStatus`; the link has an
  ISO `at` and no epistemic status). **SOURCE_REQUIRED.**
- **F-N17-5** orphan exports: `linkFor()` and `declaredRelationships()` have zero production callers.

## Verification (all RUN)

`relationshipFieldDetermination.test.ts` **14/14** · typecheck node clean · lint clean · **full main 872 files /
9145 passed / 3 skipped** (was 871/9131/3 — the delta is exactly this file) · gate-detector PROCEED before
writing · zero external effects.

## REMAINING UNKNOWN

Whether a governed refusal may ever lapse on a link's expiry (the ruling that unblocks valid_from/valid_to) ·
whether dataPlane links are intended to feed the CST relationship gate (F-N17-4) · whether `outgoing()` should
participate in the delete assessment at all (today only `incoming` does).
