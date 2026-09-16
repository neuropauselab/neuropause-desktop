# FG-3 — additive `AssistantEnvelope.mailIntent` carrier (Slice 13)

**STOP — awaiting token.** Nothing frozen applied. This gate adds ONE additive, optional field to the
`AssistantEnvelope` interface so the trusted main-side intent generator can hand a `mail.send` candidate to the
renderer, which feeds it into the EXISTING `M365WritePanel` through the Slice-12 propose feed. Per the Slice-13 rules
(rule 4 — ONE SURFACE) and DECISIONS D-7. Token requested:
`AUTHORIZED: FG-3 — AssistantEnvelope.mailIntent additive optional field, per gate doc`.

## Why a frozen surface appears here (honest)

The safety-critical generator (`assistantMailIntent.ts`, committed `c15bec2`) runs in MAIN; the panel renders in the
RENDERER. The proposal must appear ONLY in `M365WritePanel` via the Slice-12 feed (rule 4). Carrying the structured
`{to, subject, body}` across main→renderer needs a structured envelope field. `AssistantEnvelope.draft` is
`{kind,text,note}` and `navigation.query` is a bare string — using either would smuggle structured, authority-relevant
data through a string field, i.e. route around the frozen boundary. The rules forbid that. So we gate the clean carrier.

## The verbatim frozen diff (the ONLY frozen change)

File: `packages/shared/src/types/assistant.ts`, inside `interface AssistantEnvelope`, between `draft` and `navigation`:

```diff
   draft: AssistantDraft | null;
+  /**
+   * Wave-2 Slice-13 — an assistant-detected mail.send candidate, carried structurally so the renderer can feed it
+   * into the EXISTING M365WritePanel via the Slice-12 propose feed (one surface, one confirmation). Additive +
+   * optional: null/absent on every non-mail turn and on envelopes predating this field. The AI has NO authority
+   * here — recipients are extracted LITERALLY from the user's turn by the trusted generator, params are re-validated
+   * by the propose producer before display, and the human still confirms through the certified path.
+   */
+  mailIntent?: { to: string[]; subject: string; body: string } | null;
   /** A navigation resolution the renderer executes (deep link into the shell). */
   navigation: { section: string; query: string | null } | null;
```

That is the entire frozen surface change: one optional field on one interface.

## Threat analysis — both directions

**If we DON'T add it (route around instead):** the only non-frozen carriers are `draft.text` / `navigation.query`
(strings) or renderer-side re-derivation of recipients. Smuggling `{to,subject,body}` through a string is precisely
the boundary-erosion the freeze exists to prevent; renderer-side re-derivation duplicates safety logic in the UNTRUSTED
renderer (violates the AI/renderer-untrusted doctrine). Both are worse than a clean additive field.

**If we DO add it — what could go wrong, and why it can't:**
- *Does the AI gain authority?* No. The field carries DATA only. Recipients are literal-from-turn (rule 1) chosen by
  the deterministic generator, never by the model or synced content. The renderer feeds them back through the Slice-12
  `capability:m365.propose` producer, which RE-VALIDATES (format, comma hardening, ≤50 recipients) and re-resolves the
  authoritative account/tenant from the principal — never from this field. The human still confirms through the
  certified `m365Execute` path. `mailIntent` is a proposal, not authorization; it carries no token/credential/callable.
- *Does it break existing envelopes?* No. Additive + optional; `AssistantEnvelope` has NO wire zod-schema and is built
  via the `baseEnvelope` helper, so every existing constructor and persisted conversation leaves it `undefined`. Type
  is nullable to render an honest empty state.
- *Second surface / second confirmation?* No. The renderer routes it into the ONE existing `M365WritePanel` via the
  Slice-12 feed — no new review surface, no new confirm path (rule 4 / DECISIONS D-7).

## What the field ENABLES (the non-frozen wiring that lands with/after the token)

1. **Main** — `AssistantService.ask()`: after intent classification, call `assistantMailSendIntent(text, {referenceText}, referenceDrafter)`. Route the result:
   - `INTENT` → set `envelope.mailIntent = { to, subject, body }` + a short text answer + `navigation:{section:'connectors'}`.
   - `NEEDS_CLARIFICATION` → `envelope.clarification` (existing field).
   - `UNSUPPORTED` / `NO_ACTION` → the normal assistant flow (no hijack).
2. **Renderer** — a NEW renderer-only handoff mailbox (`m365ProposalHandoff.ts`, the `assistantHandoff` pattern):
   `AssistantHost` reads `envelope.mailIntent`, stores it, navigates to `connectors`; `EntraConnectorPanel` consumes it
   on mount and calls `ipc.connectors.m365Propose({ capabilityId:'mail.send', accountId, params })` (the Slice-12 feed)
   → `M365WritePanel` prefilled. ONE SURFACE.
3. **Tests** — main integration (turn → `mailIntent` populated / clarification / unsupported); renderer (envelope with
   `mailIntent` → panel prefilled via the feed; hostile turn → no `mailIntent`); the generator's golden + adversarial
   suites already gate the safety boundary.

## Verification plan (change-control choreography, §2.2)

Non-frozen-first (proven in FG-2): land what compiles standalone (the renderer handoff mailbox module) as a green
checkpoint → freeze re-record → INTACT → apply ONLY the one frozen field → re-record → INTACT → then the coupled
wiring (which references `mailIntent`) lands green → suites green → evidence with the frozen/non-frozen split, both
INTACT baselines, and the token quoted verbatim. Certified M365 execute path untouched → certification impact NONE.

## STOP
Awaiting the token. Safety core already committed (`c15bec2`, re-record `628ea72` — BASELINE-329a95225ea7). FREEZE INTACT.
