# NP_STATE.md — operational state (read after CLAUDE.md, before work)
Living, TRACKED working doc (committed each slice; excluded from the freeze source spec — see DECISIONS.md D-5). Mirror of CLAUDE.md §1 with operational detail.

## Now
- HEAD `1ed71cc` · FREEZE INTACT (`BASELINE-52d9a12099f3`, baseline commit `de64dd0`) · branch `cert/data-import-cst-integration`.
- Suites (RUN against BASELINE-52d9a12099f3): full main **8708/3 skipped** (821) · UI **254** (34) · typecheck + lint clean (incl. frozen `assistant.ts`).
- Landed: Slices 1–13. **Slice 13 COMPLETE**: mail.send intent generator (safety model-INDEPENDENT) + FG-3 (`AssistantEnvelope.mailIntent`) + assistant→panel wiring (ask() → `mailIntent` → renderer hand-off → S12 feed → the ONE `M365WritePanel`). FG-3 INTACT bracket 92a99c8 → de64dd0 → 1ed71cc. Golden per-category positive 10/10 · ambiguous 8/8 · hostile 9/9 · out-of-scope 10/10 (zero pass-throughs). Hand-off consumed exactly once (amendment 3). Component/jsdom level — real-Electron Playwright is S14.

## Change-control trail (S13 / FG-3)
```
c15bec2  alive(s13): mail.send intent generator + golden set (NON-frozen safety core)
628ea72  freeze re-record #7 (INTACT, BASELINE-329a95225ea7)
1aca9fa  gate(s13): present FG-3 (freeze-safe)
7b075cc  alive(s13): renderer hand-off mailbox — FG-3 checkpoint (NON-frozen)
92a99c8  freeze re-record — INTACT #1 (pre-frozen)
de64dd0  FG-3: AssistantEnvelope.mailIntent + assistant→panel wiring (frozen field + coupled wiring)
1ed71cc  freeze re-record — INTACT #2 (BASELINE-52d9a12099f3)
```

## Next 3 steps
1. **S14** — full mock E2E in the REAL Electron app (Playwright): typed NL → intent → propose → panel → human-style confirm → certified executor → mock Graph → admission, with a captured recording. Negative e2e: hostile context → nothing appears; ambiguous → the assistant asks. ⛔ hard stop before S15 (anything real).
2. Carry the S13 seams into the real-app run (assistant turn → `mailIntent` → hand-off → the ONE M365WritePanel → certified confirm).
3. S15 prep (test-tenant + consent runbook) — human-gated.

## Wired this slice (S13)
- `assistantMailSendIntent` has a real production caller: `AssistantService.ask()` — a mail.send turn sets `envelope.mailIntent` (recipients literal-from-turn) + a connectors deep link; detection only, no execution.
- `AssistantEnvelope.mailIntent` (FG-3) → `AssistantHost` stashes into `m365ProposalHandoff` → `EntraConnectorPanel` consumes once → feeds the ONE `M365WritePanel` via the S12 feed (rule 4).

## Honest status
Everything to date is **TEST-VERIFIED**, not LIVE. One connector (M365) has a governed consequential path; nothing executes without human confirmation; nothing external is effect-verified yet (Profile A). Backend down/empty; builds unsigned; NOT CERTIFIED (13C).
