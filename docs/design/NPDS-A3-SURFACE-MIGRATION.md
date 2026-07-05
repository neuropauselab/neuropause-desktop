# NPDS A.3 — Surface Standardization (Executive Center)

Architectural migration, **not** a redesign. Evolves `Card` into a complete surface
primitive whose variants **reproduce existing hand-rolled styles verbatim**, then
migrates ONE screen (Executive Center) with **pixel-identical** output.

## STEP 1 — Surface Variant Catalog (audit)
The app's "custom cards" are distinct, intentional surfaces — not sloppy dupes.
Catalogued with their exact class strings:
| Variant | Real source | Class string |
|---------|-------------|--------------|
| `raised` | the standard Card (default) | `surface-raised rounded-2xl shadow-card` |
| `flat` | Executive Center section cards | `rounded-2xl border border-white/5 bg-white/[0.02]` |
| `hairline` | Decision Center / Org Explorer | `rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)]` |
| `glass` | floating translucent panels | `glass rounded-2xl shadow-glass` |
| `floating` | menus / popovers | `glass rounded-2xl shadow-pop` |
| `dashboard` | dense KPI tiles | `rounded-xl border border-white/5 bg-white/[0.02]` |

Also present: **~20 screens** use ad-hoc card shells; **143 raw `<button>`** vs 189
`<Button>`. Those are the remaining backlog (below) — migrated per-screen, verified.

## STEP 2 — Card primitive upgraded (no existing variant changed)
`Card` gains a `variant` prop (`CardVariant`) where each value is a COMPLETE surface
preset reproducing a real style. Precedence: an explicit `variant` fully defines the
surface; otherwise the legacy A.2 `surface`/`elevation` props apply (defaulting to
the historical raised Card). So:
- **New:** `<Card variant="flat" />` etc. reproduce real styles exactly.
- **Unchanged:** `<Card />` and every A.2 `surface`/`elevation` caller render
  byte-identically (no existing variant modified).

## STEP 3 — Executive Center migrated (pixel-identical)
The section cards changed from an inline `<section className="rounded-2xl border
border-white/5 bg-white/[0.02] p-4">` to `<Card variant="flat" flush className="p-4">`.

**Pixel-identity proof:**
```
flat variant  = 'rounded-2xl border border-white/5 bg-white/[0.02]'
+ flush        (suppresses the default p-5)
+ className    'p-4'
= rounded-2xl border border-white/5 bg-white/[0.02] p-4   ← identical to the original
```
The element changes from `<section>` to `<div>` (Card's root); visually identical.
Inner list-item shells were left as-is this increment (they're a nested surface;
migrating them is a follow-up, per "one screen, minimal" — the outer card is the
standardization target).

## STEP 4 — Backward compatibility
All 52 existing `<Card>`/`<Button>` callers untouched and compiling. Legacy
`surface`/`elevation` props retained and functional. No caller broke.

## STEP 5 — Verification
- **Typecheck:** desktop + backend **0 errors**.
- **Lint:** clean.
- **Tests:** **633 passed** (contract test now asserts the 6-variant catalog +
  retained legacy props).
- **Production build:** succeeds — `electron-vite build` compiles EnterpriseView
  (137.14 kB, unchanged from pre-migration 137.16 kB). No API/backend/logic touched.
- **Zero API regressions:** no IPC, contract, or business-logic change.

## STEP 6 — Docs
- **Surface Variant Catalog:** the table above (each variant ↔ real style).
- **Variant Usage Guide:** use `variant` for surfaces; `flush` when you control
  padding; legacy `surface`/`elevation` remain for existing code but new code should
  prefer `variant`.
- **Migration Strategy:** per screen — (1) identify each inline surface, (2) match it
  to a variant (add one if genuinely new), (3) swap with `flush`+exact padding, (4)
  **verify pixel-identity on device (screenshot before/after)**, (5) commit.
- **Remaining Screen Backlog** (each its own verified increment, verified visually):
  Decision Center, Organization Explorer, Notifications, Workspace, the federation/
  developer/ecosystem panels (~20 files), plus the raw-`<button>`→`<Button>` pass.

## Known limitations — read honestly
- **Visual identity is proven by class-string equivalence + successful build, not by
  my eyes** (I can't render). The change is designed to be pixel-identical and the
  math is exact, but **please confirm on macOS**: open Enterprise → Executive and
  check the section cards look unchanged vs. before. Given identical emitted classes,
  they will — but you own the final visual sign-off.
- Only the Executive Center **outer** section cards migrated. Inner list-item shells
  and the KPI tiles are intentionally left for a follow-up (kept the diff minimal).
- Other screens' surfaces (hairline/glass/etc.) now have variants ready, but are NOT
  migrated yet — that's the backlog, one verified screen at a time.
