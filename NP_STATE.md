# NP_STATE.md — operational state (read after CLAUDE.md, before work)
Living, TRACKED working doc (committed each slice; excluded from the freeze source spec — see DECISIONS.md D-5). Mirror of CLAUDE.md §1 with operational detail.

## Now
- HEAD `f9d9ef2` · FREEZE INTACT (`BASELINE-35431ae7446f`, baseline commit `e55a245`) · branch `cert/data-import-cst-integration`.
- Suites (verified this session): main **8661 passed / 3 skipped** (818 files) · UI **250 passed** (32 files) · typecheck clean · lint clean on changed files.
- Landed: Slices 1–12. Slice 11 = FG-2 (`runtimeCore` registration — channel LIVE-REGISTERED, data-only). Slice 12 = first production feed of `capability:m365.propose` → `M365WritePanel` (dev-triggered) + typed refusal/loading/transport UI + comma-in-address hardening. NON-frozen throughout (D-6).
- **Next: Slice 13** — AI structured intent generator (`assistantMailSendIntent`) → the same propose path; injection-gated; golden set ≥30. The comma gate (S12) is green, so AI may now supply `to`.

## Change-control trail
```
c8e42f4  evidence(s11): FG-2 gate execution record        (certification/, freeze-safe)
5aadbb5  governance(D-5): track 4 living docs + exclude from freeze source spec
48c2cdf  alive(s12): comma-in-address hardening (producer) (NON-frozen source)
014d163  freeze re-record #5 (INTACT, BASELINE-3a820f71d6d5)
e55a245  alive(s12): first production feed capability:m365.propose (NON-frozen renderer + UI test)
f9d9ef2  freeze re-record #6 (INTACT, BASELINE-35431ae7446f, baseline commit e55a245)
```

## Next 3 steps
1. S13 — `assistantMailSendIntent(userTurn, context)` → schema-constrained intent → zod → the propose path. Generator gains zero authority; only the user's explicit live turn (never synced content). Golden set ≥30 with an honest accuracy report.
2. Extend the AI-boundary corpus: hostile synced bodies → zero intents (permanent CI gate).
3. S14 — full mock e2e in the real Electron app (Playwright): typed NL → intent → propose → panel → confirm → mock execute → admission.

## Wired this slice (S12)
- `capability:m365.propose` now has a real production caller: `ipc.connectors.m365Propose` (renderer) → the data-only handler → `M365WritePanel` prefill. Dev-triggered only (`import.meta.env.DEV`).
- `M365WritePanel.proposal` prop (Slice 7) — now FED in production (dev trigger), remounted via `key` so a new proposal re-seeds fields.
- Comma hardening green — the S13 prerequisite gate.

## Honest status
Everything to date is **TEST-VERIFIED**, not LIVE. One connector (M365) has a governed consequential path; nothing executes without human confirmation; nothing external is effect-verified yet (Profile A). Backend down/empty; builds unsigned; NOT CERTIFIED (13C).
