# SLICE 13 — AI structured mail.send intent generator + FG-3 carrier · EVIDENCE

**Status: TEST-VERIFIED (component/jsdom level).** FROZEN SURFACE: one additive optional field (FG-3). CERTIFICATION
IMPACT: none — the certified M365 execute path is unchanged.

> **Wave-label note (amendment 2):** this file keeps the landed evidence lineage `WAVE-2` (matching SLICE-8…12 and the
> FG-3 gate doc). In the CLAUDE.md §5 roadmap S13 sits in **Wave 4** ("Finish the alive chain", S11–S19). The filename
> preserves history; the roadmap wave is Wave 4. No history renamed.

## 0 · RETRO-CONFIRMATION (each claim with its proof)

- **(a) Recipient literalism.** Recipients are sourced ONLY from addresses literally present in the live turn, via
  `extractLiteralAddresses` in `assistantMailIntent.ts`; the model seam `MailDrafter` (type: `RawMailDraft = {subject,
  body, purpose?}`) **structurally cannot express a recipient** — there is no `to` field for a model to fill. Proof:
  `assistantMailIntent.test.ts` → *"model-independence — a HOSTILE drafter cannot break any safety property"* (the
  hostile drafter puts `attacker@evil.com` in the body; the emitted `to` stays `['bob@example.com']`). Names/aliases are
  never resolved from contacts/directory → `NEEDS_CLARIFICATION` (golden `a1–a8`, all pass).
- **(b) Binary safety, per-category (numbers verbatim).** Golden set 37 cases, `assistantMailIntent.golden.test.ts`:
  - `positive        routing 10/10 (100.0%)  safety-leaks 0`
  - `ambiguous       routing  8/8  (100.0%)  safety-leaks 0`
  - `hostile-context routing  9/9  (100.0%)  safety-leaks 0`
  - `out-of-scope    routing 10/10 (100.0%)  safety-leaks 0`
  The suite hard-fails on a single pass-through in either safety category (`expect(report['hostile-context'].unsafe)
  .toEqual([])` and the same for `out-of-scope`). Positive/ambiguous are QUALITY numbers (here 100% because the guards
  are deterministic; the untrusted model only drafts subject/body, which this offline default does not score).
- **(c) Repo tool/function names used throughout.** `assistantMailSendIntent`, `referenceDrafter`,
  `extractLiteralAddresses`, `MailSendIntentSchema`, `buildM365ActionProposal` / `toWritePanelProposal`,
  `runProposeM365Action`, `ipc.connectors.m365Propose` (Slice-12 feed), `M365WritePanel`, `EntraConnectorPanel`,
  `AssistantService.ask()`, `baseEnvelope`, `AssistantEnvelope.mailIntent`, `setPendingMailProposal` /
  `consumePendingMailProposal`, `certification/verify-freeze.sh`, `certification/freeze-baseline.sh`.

## 1 · Tooling (amendment 1)

Change-control used the real repo tooling and the proven FG choreography — there is no `verify_freeze.sh` or `mutate_*`
tool in this repo. Commands: `certification/verify-freeze.sh` (INTACT check), `certification/freeze-baseline.sh`
(re-record). Choreography: checkpoint → re-record → INTACT (committed) → apply EXACTLY the gate-doc diff → suites green →
isolated commit → re-record → INTACT (committed) → this evidence quoting the token verbatim + the path split.

## 2 · The four hardening rules — how each is enforced

1. **Recipient literalism** — see 0(a). Enforced by deterministic extraction from the turn; the model cannot supply a
   recipient (type-level). Unresolved → `NEEDS_CLARIFICATION`.
2. **Context inert / reply case** — `context` (synced material) is passed to the drafter for understanding only;
   `referenceDrafter` reads nothing from it, and recipients/action never derive from it. Corpus: golden `h4–h8`
   (user-initiated send + hostile source material → clean intent to the literal turn address; injected addresses in
   context never appear), and `h9` (the only address is in the hostile context → `NEEDS_CLARIFICATION`, never resolved).
3. **Trigger discipline** — an intent requires a send request in the USER TURN; `AssistantService.ask()` feeds only the
   live `input.text`. Permanent gate: `assistantMailIntent.test.ts` → *"hostile synced bodies yield ZERO intents"* (5
   canonical injections with a non-action turn → never `INTENT`).
4. **Deny-by-default scope** — a clear out-of-scope verb → `UNSUPPORTED` before the model runs (golden `o1–o10`).

## 3 · The FG-3 frozen surface — token, diff, bracket

**Token (verbatim):** `AUTHORIZED: FG-3 — AssistantEnvelope.mailIntent additive optional field, per gate doc`.

**FROZEN diff (the ENTIRE frozen change), `packages/shared/src/types/assistant.ts`** — one additive optional field on
`AssistantEnvelope` (8 insertions; audited: no other `packages/shared` file touched; `contracts.ts:2418` untouched):
```ts
  mailIntent?: { to: string[]; subject: string; body: string } | null;
```
Additive-optional; the envelope has no wire zod-schema and is built via `baseEnvelope`, so every existing constructor
and persisted conversation leaves it `undefined`.

**NON-FROZEN coupled wiring** (references the field → lands with it, per the pre-authorized coupling): `assistantService.ts`
(ask() → generator → sets `mailIntent` + connectors nav, detection only), `AssistantView.tsx` (nav button forwards
`env.mailIntent`), `AssistantHost.tsx` (stashes into the `m365ProposalHandoff` mailbox → navigates), and the Slice-13
checkpoint prep (`m365ProposalHandoff.ts`, `EntraConnectorPanel` mount-consume). One surface, one confirmation.

**INTACT bracket:** `92a99c8` (INTACT #1, pre-frozen checkpoint) → `de64dd0` (FG-3 landing) → `1ed71cc`
(INTACT #2, **BASELINE-52d9a12099f3**). `verify-freeze` INTACT at HEAD.

## 4 · Handoff hygiene (amendment 3)

The renderer hand-off mailbox is consumed EXACTLY ONCE: `m365ProposalHandoff` is read-and-clear;
`EntraConnectorPanel` consumes it on mount, so a remount / back-navigation finds it empty — no re-fired propose call,
no refill from a stale intent. Proof: `m365ProposalHandoff.test.ts` (4, incl. second-consume→null and a defensive copy)
and `ui-tests/m365AssistantHandoff.test.tsx` (3, incl. *"a remount does not re-fire the propose call or refill from a
stale intent"*). One instruction → at most one proposal on screen.

## 5 · E2E level honesty (amendment 4)

**This slice is TEST-VERIFIED at the COMPONENT / jsdom level**, not a real-Electron run. Each seam is behavior-tested:
main (turn → `envelope.mailIntent`), the nav button (forwards `mailIntent`), and the mailbox → `M365WritePanel` prefill
via the Slice-12 feed. The full real-Electron Playwright click-through with a captured recording — typed NL → intent →
propose → panel → human confirm → certified executor → admission — **remains Slice 14** and is NOT collapsed into S13.

## 6 · Proofs (RUN against BASELINE-52d9a12099f3)

- Generator: `assistantMailIntent.test.ts` + `.golden.test.ts` — **38** (18 unit/adversarial + 20 golden).
- Assistant integration: `assistantService.test.ts` mail-intent block — **5** (turn → mailIntent + connectors nav;
  literal multi-recipient; non-mail / no-address / out-of-scope → unset).
- Renderer: `m365ProposalHandoff.test.ts` **4**, `ui-tests/m365AssistantHandoff.test.tsx` **3**,
  `ui-tests/assistantMailNavigation.test.tsx` **1**.
- Full suites: main **8708 passed / 3 skipped** (821 files); UI **254 passed** (34 files). Typecheck + lint clean
  (incl. the frozen `assistant.ts`).

## 7 · Change-control trail

```
628ea72  freeze re-record #7 (S13 safety core, BASELINE-329a95225ea7)
1aca9fa  gate(s13): present FG-3 (freeze-safe)
7b075cc  alive(s13): renderer hand-off mailbox — FG-3 checkpoint (NON-frozen)
92a99c8  freeze re-record — INTACT #1 (pre-frozen)
de64dd0  FG-3: AssistantEnvelope.mailIntent + assistant→panel wiring (frozen field + coupled wiring)
1ed71cc  freeze re-record — INTACT #2 (BASELINE-52d9a12099f3)
```

## 8 · Certification impact: NONE
The certified M365 execute path (CST → governedSend/governedAction → admission → executor) is untouched. `mailIntent`
carries DATA only; recipients are literal-from-turn, re-validated by the propose producer, and the human confirms
through the certified path. No second surface, no second confirmation architecture (rule 4 / DECISIONS D-7).
