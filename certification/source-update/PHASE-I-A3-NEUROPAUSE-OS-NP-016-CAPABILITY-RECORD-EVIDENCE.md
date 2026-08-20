# NP-016 · THE 16-FIELD CAPABILITY RECORD + RULING-2 ALIASES — CLOSING EVIDENCE
## NP-012 §3 ruling, slice 4 of 6. ARCHITECTURE-SPEC §23 in the S23 kit; §24–25 names aliased, never renamed. PROCEED-class, zero frozen touch, zero sensitive touch.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: TEST-VERIFIED.** Zero external effects; ceremony surfaces untouched; NP-000 = HOLD unchanged.

## What the record is for (and why it earned its keep immediately)

The kit's seven artifacts answer *"were the required artifacts produced?"*. The §23 record answers a different
question: ***"what does this system actually KNOW about this capability, and from where?"*** — and filling it
honestly forces every answer to name its source. That is not bookkeeping: **the moment the sixteen fields were
composed over the real substrate, three places where two parts of the system answer differently fell out of it.**
A record that had stored bare values would have picked a winner and hidden them.

So every field carries a STATE, never a bare value:

| State | Meaning |
|---|---|
| `KNOWN` | a real value **with the source that yielded it** — `known()` will not construct one without a source |
| `CONFLICTING` | two sources disagree — **surfaced as a failing finding**, never resolved by preference |
| `ABSENT` | nothing here supplies it, **and why** (a blank reason is itself reported as a defect) |
| `SOURCE_REQUIRED` | the SPEC defines no value space for this field |

`risk_class` and `lifecycle_state` are typed `CapabilityFieldState<never>` — **the compiler refuses to populate
them.** That is the operator's ruling made structural: the field exists, its taxonomy waits for the source. Not a
stub; the enforced difference between "we don't know" and "we made one up".

The classification rule is general, not per-field: agreeing readings **corroborate** into one KNOWN answer with
both sources named; disagreeing readings **conflict**; none is an honest absence. Nothing is special-cased, which
is why it caught divergences nobody was looking for.

## Findings the record exposed (recorded, deliberately NOT fixed in this slice)

- **F-N16-1 — `certification_state` genuinely CONFLICTS for `calendar.create`.** `mutationAssuranceFor` is keyed
  on the CONNECTOR, so `calendar.create` inherits `governed-certified` (and is `aiSelectable`) from the connector
  `mail.send` certified — while `isCertifiedConsequential('calendar.create')` is false and the S5.1 boundary
  REFUSES it. Both predicates are driven live in the pin, so this is code, not fixture. Deny-by-default still
  holds at the boundary (the refusal is real); the defect is that the DISCOVERY layer claims a standing the
  boundary denies — the F-5 truth-order class. Scope-fenced here; a fix touches capability discovery.
- **F-N16-2 — derived vs enforced authority disagree for `calendar.create`.** `deriveAuthority` yields
  `policyVersion: null` while `cst/governedAction.ts` governs it under `POLICY_VERSION = 'm365-action-policy-1'`.
  Pinned as a finding; the record surfaces the derived value with its source so the disagreement is legible.
- **F-N16-3 — two reversibility vocabularies.** The CST five-value `'IRREVERSIBLE'` (uppercase) vs the proposal
  artifact's three-value `'irreversible'` (lowercase). Recorded; unifying them is not this slice.
- **F-N16-4 — two oracle identities for one oracle.** The registry says `verifyEffect`; the recorded provenance
  (NP-014) says `m365ReadBack:sentItems+inbox`. Both are honest at their own layer; a future registry slice must
  choose which the record's `oracle_id` means.
- **F-N16-5 — manifest consent scopes do not include the action scopes.** `mail.send` requires `Mail.Send` and
  `calendar.create` requires `Calendars.ReadWrite`, while the `microsoft-entra` manifest's consent list requests
  neither (it lists `Calendars.Read`). This is consistent with the live S15 finding F-1 (the real token carried a
  broad ~47-scope grant, so sends worked anyway) — recorded here as the manifest-minimization work item it is.

Also recorded, not a defect: `calendar.create`'s `IRREVERSIBLE` is a **conservative default**, not a claim — the
source comment says its true class is closer to UNKNOWN because attendee state is not param-derivable.

## What landed

1. **`capabilities/certificationKit.ts`** (+ ~150 lines, additive): `CapabilityFieldState`, `FieldReading`,
   `known` / `absent` / `sourceRequired` / `fromReadings`, the sixteen-field `CapabilityRecord` in the spec's own
   order and naming, `CapabilityObservations` (what the caller READ, each reading carrying its source),
   `composeCapabilityRecord`, `capabilityRecordFindings` (record → the kit's existing `KitFinding` vocabulary,
   CONFLICTING ⇒ `ok:false`), `conflictingFields`. **The kit's purity contract is preserved** — still zero runtime
   imports; every real reading is injected by the caller that read it. Authority and verification method are taken
   from the kit's own DERIVATION FUNCTIONS, so the record can never claim an authority the runtime would not
   derive. The existing seven-artifact record, `runKitChecks` and `kitComplete` are UNTOUCHED — all prior kit
   pins pass unmodified.
2. **`capabilities/canonicalAliases.ts`** (new, main-only, non-frozen): the Ruling-2 alias table with **exactly
   two rows** — `NP-CON-M365-000001 ⇄ microsoft-entra` and `NP-CAP-M365-MAIL-SEND-0001 ⇄ mail.send`.
   **Why only two:** Ruling 2 says existing ids are aliased "in the registry when it lands"; assigning canonical
   NUMBERS to the other 21 connectors and 33 M365 actions is a registry decision, not a fact about this system,
   and minting fifty identifiers nobody ruled on is invention. So the table covers exactly what is both real
   today and exemplified by the spec — the certified vertical — and everything else honestly answers `null`.
   The row for `microsoft-entra` records the reality it names: there is no separate M365 connector; Outlook mail
   and calendar ride the identity-directory connector on one Graph token. **NP-CONNECTION-\*** is deliberately
   NOT modeled: `acct_*` ids are runtime-minted per connection, so a static table would be the wrong shape.
3. **`capabilities/capabilityRecord.test.ts`** (17 pins).

## The pins (17, all RUN green first try)

mail.send: identity/scope/authority/oracle KNOWN each with its source · two agreeing sources CORROBORATE with
both named · risk_class + lifecycle_state SOURCE_REQUIRED · **version ABSENT and the connector's `1.0.0` is
provably not borrowed into it** (`JSON.stringify` asserted free of it) · no conflicts, all field checks pass.
calendar.create: the certification CONFLICT asserted **with both predicates driven live** and reported as a
failing finding · oracle fields ABSENT carrying what is NEEDED · input_schema ABSENT where mail.send's is KNOWN ·
derived-vs-enforced policyVersion finding · approval still required for the uncertified capability.
The rule itself: corroborate / conflict / honest-absence · a KNOWN value cannot exist without a source · a
reasonless ABSENT is a defect.
Aliases: both directions resolve · deny-by-default for unassigned and invented names (`slack` → null,
`NP-CAP-M365-MAIL-SEND-0002` → null) · every alias points at a REAL manifest/action id (drift fails here rather
than aliasing fiction) · **THE INVARIANT: resolving an alias grants nothing** — `isCertifiedConsequential` and
`mutationAssuranceFor` asked with the CANONICAL names return false / `governance-not-proven`, and only the
existing ids carry the standing · the alias module has zero runtime edges into governance or execution.

## Honest bounds

- The record is composed in TESTS from readings taken from source — it is not yet wired to a production reader,
  and no UI shows it. That is the S23 kit's existing shape (its back-fills live in tests too), and the operator's
  ruling puts the full exercise at ladder rung 2 (calendar.create) post-ceremony.
- Five findings are RECORDED, not fixed; each names the module a fix would touch.
- Aliases cover the certified vertical only, by design stated above.
- `verify-e2e-strip` deliberately NOT re-run (it rebuilds `out/` as release; the armed ceremony build stays the
  LAST build). Seed chunk verified present.

## Verification (all RUN)

`capabilityRecord.test.ts` 17/17 first run · the full `capabilities/` suite **203/203 across 14 files** (every
pre-existing kit, selection and dry-run pin unmodified and green — the kit extension disturbed nothing) ·
typecheck node clean · lint clean · honesty scan 0 findings · gate-detector PROCEED on all three paths (zero
frozen, zero sensitive) · ceremony seed chunk verified present · **full main suite 869 files / 9091 passed /
3 skipped** (was 868/9074/3 — the delta is exactly this suite; zero regressions).
