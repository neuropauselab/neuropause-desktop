# NPDS A.2 — Component Standardization

Adopts the A.1 foundation into the reusable primitives by **standardizing their
typed APIs** — additively and backward-compatibly. No page, layout, or business
logic changed. No default rendering changed.

## STEP 1 — Audit (evidence, and an honest finding)
Auditing the primitives revealed they are **already tokenized**:
- **41 semantic-token usages** (`bg-accent`, `text-ink`, `surface-raised`,
  `text-sys*`, `shadow-{card,pop,glass,focus}`, `ease-emphasized`) vs **2 raw
  rgba** values (an `AppGlyph` inset highlight + a chart bar radius).
- `Button`, `Card`, `Page`, `Menu`, `EmptyState` etc. already reference the design
  tokens defined in `tailwind.config.ts`.

**Conclusion (stated plainly):** there are essentially **no magic values in the
primitives left to replace** — the "duplicated values" the directive expects live
at the **page level** (the 19 inline white-tint utilities from the A.1 audit), and
consolidating those means editing screens, which this increment's rules forbid and
which can't be visually verified in CI. So A.2 does the safe, real work: it
**standardizes the component APIs** the directive lists (STEP 3), additively.

Also important: **Tailwind class strings are compiled at build time and cannot
consume TS token constants at runtime.** Rewriting `rounded-xl` to
`` rounded-[${radius.xl}px] `` would change what the compiler emits and risk a
non-matching arbitrary value — an unverifiable visual change. We deliberately did
NOT do that; the TS tokens (A.1) and the Tailwind tokens remain two views of the
same values, with the config authoritative for emitted CSS.

## STEP 3 — Standardized APIs (the actual change)
Both additive; **defaults preserve the exact prior appearance**:
- **Button** — added `loading?: boolean` (shows the shared `Spinner`, sets
  `aria-busy`, and disables — a real gap; there was no loading state) and made
  `disabled` explicit (`disabled || loading`). Variants/sizes unchanged.
- **Card** — added typed `surface?: 'base'|'raised'|'glass'` and
  `elevation?: 'card'|'pop'|'glass'`, mapping to the existing material/shadow
  classes. Defaults `surface='raised'` + `elevation='card'` emit `surface-raised`
  + `shadow-card` — byte-for-byte the previous output.
- **contracts.ts** updated to document the new props; the runnable contract test
  now asserts them.

## STEP 4 — Accessibility
- Button `loading` sets `aria-busy` and disables interaction (no double-submit).
- Existing `focus-visible:shadow-focus` rings retained on all Button variants.
- The A.1 `reducedMotion` preset remains available for components adopting motion;
  no new motion added here. High-contrast/dark-mode continue to work via the
  CSS-var-driven tokens (unchanged).

## STEP 5 — Motion
No duplicated transition values were introduced or changed. Button/Card keep their
existing `duration-*`/`ease-emphasized` classes (already token-driven). The
centralized presets (A.1 `motion.ts`) are the path for *future* motion adoption,
done per-surface with on-device verification.

## Files changed
- `components/ui/Button.tsx` — `loading` prop + Spinner + aria-busy (additive).
- `components/ui/Card.tsx` — typed `surface` + `elevation` props (additive).
- `design/contracts.ts` — documented the new props.
- `main/design/npdsTokens.test.ts` — assert the standardized props.
- This doc.

## STEP 7 — Verification
- **Components standardized:** 2 (Button, Card). **Props added:** 3 (`loading`,
  `surface`, `elevation`), all optional.
- **Backward compatibility: proven.** 52 existing `<Button>`/`<Card>` call sites
  compile unchanged; defaults reproduce the prior class output exactly.
- **Tests:** desktop **633 passed** (contract test extended to cover the new APIs).
  Typecheck: desktop + backend **0**. Lint: clean.
- **Performance impact:** none (a spinner renders only when `loading`; class
  composition is equivalent otherwise).

## Variant matrix
| Component | Prop | Values | Default |
|-----------|------|--------|---------|
| Button | variant | primary, secondary, ghost, danger | secondary |
| Button | size | sm, md | md |
| Button | loading | true/false | false |
| Card | surface | base, raised, glass | raised |
| Card | elevation | card, pop, glass | card |
| Card | interactive | true/false | false |
| Card | flush | true/false | false |

## Known limitations — read honestly
- **No visual verification here.** The changes are additive and defaults are
  byte-identical in emitted classes, but that the `loading` spinner and the
  non-default `surface`/`elevation` options *look* right is a macOS check.
- **Primitives were already tokenized**, so the "replace magic values" step was
  largely a no-op — the honest outcome, not a shortfall. The real remaining
  duplication is page-level inline utilities, which are out of scope (they'd
  require editing screens).
- Only Button + Card gained new props this increment (the two with real API gaps).
  Page/Menu/EmptyState already expose adequate typed APIs; extracting the *missing*
  primitives (`Input`, `Badge`, etc.) is a later increment.
