# GATE 12 — UI / UX

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `997f909` (Gate 19)
**Scope:** Gate 12 only — the one code-resolvable residual (preview-tier nav placement). The Windows visual
items stay under Gate 20's machine-blocked hold (not touched).

The row was **YELLOW** with two residuals, both explicitly "not code-resolvable" as stated: *"preview-tier
placement of Enterprise/Marketplace nav is a product decision left open; Windows-only backdrop-filter cost +
Segoe type metrics and the Windows visual pass are machine-blocked (Gate 20's hold)."*

---

## THE UNRESOLVED DECISION (reproduced against the code)

`sections.ts` carries a `preview: true` flag (a not-yet-GA "Prototype-Model" surface, rendered with a visible
"Preview" badge — `Sidebar.tsx:79`) and a `tier: 'advanced'` flag (collapsed behind the sidebar's "Advanced"
disclosure). Almost every preview section is ALSO `tier: 'advanced'` (industry/strategy/twin/knowledge/
orchestration/network/auto-ops/commercial/ecosystem/cloud/federation centers). **The two outliers were
`enterprise` ("Enterprise" — the executive command center) and `marketplace` ("Enterprise Marketplace")**: both
`preview: true` but in the PRIMARY sidebar (Business / Work groups), mixed with production surfaces. The lone
intentional primary-preview exception is `intent-home`, the Today landing.

So the decision was purely PLACEMENT: keep the two preview surfaces in the primary nav, or demote them to
Advanced like every other preview. Both are honest (the Preview badge stays) and functional, so this was a
genuine product/UX choice — presented with options rather than decided unilaterally.

## THE DECISION (operator, round 57): DEMOTE BOTH TO ADVANCED

Rationale (the safest enterprise-grade posture, and consistent with the existing pattern): the default sidebar
should present production-ready surfaces to an enterprise buyer; preview features are opt-in under Advanced,
where every other preview section already lives. Demotion is placement only — both keep the visible "Preview"
badge, stay non-hidden, and remain reachable via the command palette and universal search.

## IMPLEMENTATION

- **`src/renderer/src/shell/sections.ts`** — added `tier: 'advanced'` to the `enterprise` and `marketplace`
  section defs (two-field change; the SECTIONS array order and every nav lock over it are untouched — the
  Sidebar's `mainPrimary`/`advanced` filter does the rest).
- **`src/renderer/src/shell/sections.test.ts`** — the existing "never collapses a daily/core surface behind
  Advanced" lock listed `enterprise` (encoding the pre-decision placement); moved it to the "marks … as
  advanced" lock alongside `marketplace`, and added a dedicated decision block pinning the rule: **every preview
  section is `tier:'advanced'` except the `intent-home` landing**; `enterprise`/`marketplace` are specifically
  advanced; both stay preview-badged + reachable; a control that a production surface (`business`) is never
  demoted.
- **`ui-tests/previewNavPlacement.test.tsx`** (new) — a driven-UI test over the REAL App/AppShell/Sidebar
  proving the rendered reality: the default sidebar omits Enterprise + Enterprise Marketplace and keeps
  Business; expanding "Advanced" reveals both (still Preview-badged, reachable); Advanced is collapsed by default.
- **`ui-tests/setup.ts`** — harness hardening: stub `Element.prototype.scrollTo` (jsdom gap, same class as the
  existing `scrollIntoView` stub) so a full-App mount's scroll-memory restore (`AppShell.tsx:564`) doesn't throw
  an async uncaught in the UI suite.

Nothing weakened: no tenancy/authz/consent/provenance/fail-closed surface is touched — this is nav-render
placement only; the AI Store (production) stays primary; the Preview badge keeps the honesty (UI-truth) intact.

## UX WORKFLOW VERIFIED (driven UI)

Over the real shell: the default sidebar shows production surfaces (Business present) and hides the two preview
surfaces; the "Advanced" disclosure is collapsed by default and, when expanded, reveals Enterprise + Enterprise
Marketplace with their Preview badge — placement changed, discoverability preserved (palette + search + Advanced).

## TESTS / RESULTS

- `sections.test.ts` **43** (was 39; +4 decision pins, 2 locks updated); `previewNavPlacement.test.tsx` **3/3**.
- Full main suite: **9494 passed / 7 skipped / 0 failed**.
- Full UI suite: **54 files / 342 passed / 0 errors** (the scrollTo stub cleared the async uncaught).
- Typecheck web **0**; ESLint on changed files **clean**.

## NEGATIVE CONTROLS (executed)

Revert the two `tier:'advanced'` additions → both the driven-UI placement test ("default sidebar hides
Enterprise + Marketplace") and the data-pin decision tests fail (the sections reappear in the primary nav);
restore → all green. Proves the pins are load-bearing on the real registry + rendered sidebar.

## GATE 12 RESULT

**YELLOW → GREEN.** The one code-resolvable residual (preview-tier nav placement) is decided, implemented, and
pinned at both the registry-data and rendered-UI levels, negative-controlled. Remaining (non-blocking,
machine-blocked, NOT a Gate-12 code item): the Windows-only visual pass — `backdrop-filter` cost, Segoe type
metrics — sits under Gate 20's hold and needs a Windows machine, exactly as the row always stated.

## EXACT NEXT COMMAND

```bash
cd apps/desktop
npx vitest run src/renderer/src/shell/sections.test.ts
npx vitest run -c vitest.ui.config.ts ui-tests/previewNavPlacement.test.tsx
```


---

# GATE 12 — UI/UX · re-examination + genuine closure (2026-08-31, base HEAD `bfea8de`)

**Directive:** close Gate 12 *genuinely, not cosmetically* — re-examine the Enterprise/Marketplace nav
placement with the strongest existing architecture, fix real UI/UX defects, and pin the decision.

## THE PLACEMENT DECISION — RE-EXAMINED AND CONFIRMED (not reversed)

Two independent audits (nav-duplication/architecture + reachability/UI-truth/a11y) both concluded the round-57
**demotion of `enterprise` + `marketplace` to the Advanced disclosure is the strongest, most consistent option**,
and reversing it would be wrong:

- After the demotion, `intent-home` is provably the **only** primary preview surface — every other preview
  section is already `tier:'advanced'`, so demotion makes the honesty rule uniform (measured in `sections.ts`).
- The **production** storefront `store` ("AI Store") stays primary; only the **preview** `marketplace`
  ("Enterprise Marketplace") drops — the honest consumer-vs-preview split.
- No sidebar group is emptied (`business` keeps 6, `workspace` keeps 8 incl. `store`; the always-empty
  `platform` group is pre-existing and filtered out by `Sidebar.tsx`).
- Demotion *reduces* the aggregate-vs-detail overlap (Enterprise's command-center tabs vs the standalone
  Organization/Business/Administration/Operations sections) by removing the aggregate from the primary nav.
- Promoting `enterprise` to primary is deferred to when it sheds `preview:true` — not an importance question.

**No duplicate navigation was created or found reachable from two visible entries** (verified: each
`activeSection` maps to exactly one view; hidden/superseded sections route but never appear in sidebar, palette,
or search).

## THE REAL GAP THAT KEPT GATE 12 *COSMETICALLY* CLOSED — NOW FIXED

The round-57 justification was *"placement only — nothing hidden; both stay reachable via the command palette
and universal search."* That reachability half was **true in code but tested only by a data proxy**
(`sections.test.ts` asserted `advanced ⇒ !hidden`, then *assumed* the palette/search filter on `hidden` alone).
A future `tier` filter on `CommandPalette.tsx` or `searchModel.fromSection` would have **silently broken the
demoted surfaces' reachability with every existing test still green.** That is the difference between cosmetic
and genuine closure, and it is now pinned end-to-end.

## FINDINGS FIXED THIS ROUND

1. **Reachability is now tested through the REAL channels** (was: untested proxy).
   - `ui-tests/previewNavReachability.test.tsx` (new, driven-UI over the real App/AppShell/CommandPalette):
     opens the palette exactly as the shell does (`menu:command` broadcast), and proves **Enterprise** and
     **Enterprise Marketplace** appear as real "Go to" commands and navigate on select, while a **hidden**
     section (`control-plane`) never does. (Query-echo hand-off commands are filtered out of the assertions.)
   - `search/searchModel.test.ts` (+2): the **real** `enterprise`/`marketplace` SectionDefs (advanced+preview)
     flow through the real `fromSection` mapper to a non-null section hit; a **real** hidden section maps to
     null. Premise-guarded (asserts they are actually `tier:'advanced'`+`preview`) so it can't pass vacuously.

2. **The two preview storefronts had near-identical descriptions — a "which do I click?" IA hazard — now
   differentiated** (`sections.ts`): `marketplace` → *"Signed, governed packages — publisher trust and org-wide
   install policy"* (its Governance/Publishers job); `ecosystem` → *"The org storefront and partner exchange —
   discover and share workers, connectors, and templates"* (its storefront/Exchange/Partners job). Pinned by a
   new distinctness test in `sections.test.ts` (distinct + job-differentiated along governance vs storefront).
   Descriptions are purely presentational (SectionDef doc) — no route/id/lock depends on them.

## RECORDED, NOT FIXED (out of this gate's scope, no defect to the user)

- `business` ↔ Enterprise→Modules render the same surface — an **aggregate-vs-detail** pattern, and the demotion
  already removes the double-visibility. Not duplicate *navigation* (one sidebar entry each).
- Icon reuse (`store`/`globe`/`database` each on 3 sections) and the `opscenter` "Operations" label vs the
  Enterprise "Operations" tab — cosmetic; both mitigated by the demotion (Enterprise is under Advanced).
- Advanced disclosure is a flat ~20-item list — a future sub-grouping opportunity; not a defect.
- Sidebar a11y verified CORRECT: Preview badge is `aria-hidden` with the meaning carried by the button
  `aria-label` (`… — Preview`); the Advanced disclosure has `aria-expanded`/`aria-controls`; groups are labelled.

## TESTS / RESULTS

- `sections.test.ts` **44** (+1 storefront-distinctness); `searchModel.test.ts` **+2** (real-registry reachability
  + hidden negative control); `previewNavReachability.test.tsx` **3/3** (new); `previewNavPlacement.test.tsx`
  **3/3** (unchanged, still green).
- Full main suite: **917 files / 9582 passed / 7 skipped / 0 failed** (delta exactly +3 = the new main-suite pins).
- Full UI suite: **70 files / 405 passed / 0 failed** (delta exactly +3 = `previewNavReachability`).
- Typecheck node **0** / web **0**; ESLint on changed files **clean**; `electron-vite build` **exit 0**.

## NEGATIVE CONTROLS (executed; source restored byte-identically)

| Control | Mutation | Result |
|---|---|---|
| NC-A | `CommandPalette` section filter adds `&& sct.tier !== 'advanced'` (demoted surfaces dropped from palette) | previewNavReachability **2 fail** (Enterprise + Marketplace no longer reachable); restore → 3 pass |
| NC-B | `searchModel.fromSection` also drops `tier==='advanced'` (demoted surfaces dropped from search) | searchModel **1 fail** (real-registry reachability); restore → pass |

Both prove the reachability pins are load-bearing: they catch the exact regression (a `tier` filter) that would
silently defeat the round-57 "still reachable" claim. `CommandPalette.tsx` sha256 `d84f0449…` and `searchModel.ts`
sha256 `dde6a8a9…` verified identical after restore.

## USER WORKFLOWS VERIFIED (driven UI, macOS/local)

- Default sidebar hides Enterprise + Enterprise Marketplace, keeps production Business + AI Store (existing).
- Expanding "Advanced" reveals both, Preview-badged (existing).
- **Command palette:** typing "Enterprise Marketplace" / "Enterprise" surfaces the demoted surface as a "Go to"
  command; selecting it navigates (palette closes). A hidden section never appears (new).
- **Universal search:** the real advanced+preview section defs map to real section hits via the production mapper;
  a hidden section never does (new).

## WINDOWS-ONLY RESIDUAL (unchanged, machine-blocked under Gate 20)

The Windows visual pass — `backdrop-filter` cost + Segoe type metrics — remains the only Gate-12 item that needs
Windows hardware. It is not a code item and is not resolvable on macOS/Linux.

## GATE 12 RESULT

**GREEN — genuinely closed.** The placement decision is confirmed as the strongest architecture; the reachability
half of its honesty claim is now pinned end-to-end (palette + search, real channels, premise-guarded,
negative-controlled); and the one real IA defect found (indistinguishable storefront descriptions) is fixed and
pinned. No permissions/tenancy/security/consent/routing weakened; no other GREEN gate touched.
