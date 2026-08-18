# NP_STATE.md — operational state (read after CLAUDE.md, before work)
Living, TRACKED working doc (committed each slice; excluded from the freeze source spec — see DECISIONS.md D-5). Mirror of CLAUDE.md §1 with operational detail.

## Now
- HEAD `c8e42f4` · FREEZE INTACT (`BASELINE-0df776a6a740`, baseline commit `5534c45`) · branch `cert/data-import-cst-integration`.
- Suites (verified this session): main **8656 passed / 3 skipped** (818 files) · typecheck clean · lint clean on the two FG-2 files.
- Landed: Slices 1–11. Slice 10 = FG-1 (`capability:m365.propose` contract). Slice 11 = FG-2 (`runtimeCore` registration — the channel is now LIVE-REGISTERED, data-only).
- **Next: Slice 12** — live delivery + `M365WritePanel.proposal` production feed (dev-triggered) + comma-in-address hardening.

## Change-control trail
```
7fc53e2  FG-1: capability:m365.propose contract     (frozen pair + 2 non-frozen lines) — ISOLATED
8afb562  freeze re-record #2 (INTACT, BASELINE-2a3c45c5acef)
201e774  docs(s10): FG-1 gate-execution evidence    (certification/, freeze-safe)
c73e741  alive(s11): capability:m365.propose handler (NON-frozen prep) — full suite green
2668ab8  freeze re-record #3 (INTACT, baseline c73e741)
5534c45  FG-2: runtimeCore registration + typing fix (2 frozen lines + non-frozen fallback fix) — see D-note
aff5d13  freeze re-record #4 (INTACT, BASELINE-0df776a6a740, baseline commit 5534c45)
c8e42f4  evidence(s11): FG-2 gate execution record   (certification/, freeze-safe)
```

## Next 3 steps
1. **Living-docs governance commit** (this step): commit the 3 freeze-script spec edits + the 4 now-tracked docs (D-5). No re-record needed (all excluded from the source spec).
2. S12 — live delivery + `M365WritePanel.proposal` production feed (dev-triggered) + comma-in-address hardening with a pinned test.
3. S13 — AI structured intent generator (assistant), injection-gated.

## Ready but unwired (proposal path now registered; production FEED still absent — S12)
- `capabilities/m365ActionProposal.ts` — `buildM365ActionProposal` + `toWritePanelProposal` (26/26 tests).
- `capability:m365.propose` IPC — contract (FG-1) + handler registered (FG-2); data-only. No production caller yet.
- `M365WritePanel.proposal` prop (Slice 7, 6/6 tests) — fed by nothing in production yet.

## Honest status
Everything to date is **TEST-VERIFIED**, not LIVE. One connector (M365) has a governed consequential path; nothing executes without human confirmation; nothing external is effect-verified yet (Profile A). Backend down/empty; builds unsigned; NOT CERTIFIED (13C).
