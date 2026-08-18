# NP_STATE.md — operational state (read after CLAUDE.md, before work)
Living, TRACKED working doc (committed each slice; excluded from the freeze source spec — see DECISIONS.md D-5). Mirror of CLAUDE.md §1 with operational detail.

## Now
- HEAD `628ea72` · FREEZE INTACT (`BASELINE-329a95225ea7`, baseline commit `c15bec2`) · branch `cert/data-import-cst-integration`.
- Suites: assistantMailIntent **38/38** (18 unit/adversarial + 20 golden) · earlier this session main **8661/3** (818) · UI **250** (32) · typecheck + lint clean.
- Landed: Slices 1–12 + **Slice-13 safety core** (`c15bec2`): `assistantMailIntent.ts` — deterministic mail.send intent generator whose safety is model-INDEPENDENT (recipient literalism, context-inert, trigger discipline, deny-by-default scope). Golden set 37 cases per-category; binary safety = zero pass-throughs (hostile 9/9, out-of-scope 10/10).
- **In flight: Slice 13 stopped at FG-3** (see BLOCKERS.md B-2) — the assistant→panel carrier needs an additive optional `AssistantEnvelope.mailIntent` field (frozen `packages/shared`). Gate presented; non-frozen wiring prepped to land on token. Rule-4 ONE-SURFACE: renders in the existing M365WritePanel via the S12 feed (D-7).

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
