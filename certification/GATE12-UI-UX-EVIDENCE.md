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
