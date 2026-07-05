# NeuroPause Design System (NPDS) — A.1 Foundation

Infrastructure-only foundation for NPDS. It creates a typed, importable design
layer that **mirrors values already defined** in `tailwind.config.ts` / `index.css`
and **documents the real contracts** of existing primitives. It changes **no
screen, no layout, no business logic** — future UI inherits from here.

## STEP 1 — Audit (evidence)
Quantified from the renderer:
- **Radius fragmentation:** `rounded-xl` (174×), `rounded-lg` (167×), `rounded-2xl`
  (166×), `rounded-full` (117×), plus md/3xl/sm — no single radius reference.
- **Color/glass fragmentation:** 19 distinct white-tint utilities
  (`bg-white/5`, `bg-white/[0.02]`, `text-white/30…80`) repeated across components.
- **Foundation already present:** `tailwind.config.ts` defines a real token set
  (type scale, radii 10/14/18/24, shadows card/pop/glass/focus, ease-emphasized,
  Apple system colors); `components/ui/` already has `Card`, `Button`, `Icon`,
  `Skeleton`, `EmptyState`, `Menu`, `Page`, `VirtualList`, `BarChart`.
- **Not yet extracted:** `Input`, `Badge`, `Chip`, `Toolbar`, `Modal`,
  `Notification` primitive (styling currently inline where used).

Conclusion: NPDS should **consolidate and expose** existing tokens/primitives, not
invent a parallel system — matching the "never duplicate, reuse every primitive"
rule.

## STEP 2–6 — What this increment adds
All under `apps/desktop/src/renderer/src/design/`:
- **`tokens.ts`** — typed mirror of the config: `spacing` (8→64), `radius`,
  `fontSize`, `typographyRoles` (Display XL → Monospace Metrics, each mapped to a
  real step), `elevation`/`shadow`, `surfaces`, `semanticColors`/`statusColors`,
  `durations`, `easing`, `springs`, `blur`, `layers` (spatial z-order). No new
  visual values — every token traces to the existing config.
- **`motion.ts`** — reusable Framer Motion presets built from the tokens
  (`panelMotion`, `dialogMotion`, `commandPaletteMotion`, `notificationMotion`,
  `voiceMotion`, `cardHoverMotion`, `reducedMotion`). Animates nothing on its own.
- **`theme.ts`** — semantic role → token-name mapping for light/dark/high-contrast/
  system; High-Contrast strategy documented (override the same CSS vars). No
  restyle applied.
- **`contracts.ts`** — typed catalog of the **real** primitive contracts (Button
  variants/sizes, Card modifiers, etc.) + an honest `missingPrimitives` list.
- **`index.ts`** — barrel.

## Architecture
```
tailwind.config.ts / index.css   ← authoritative CSS values (unchanged)
        │  mirrored (values, not overrides)
        ▼
design/tokens.ts ──► design/motion.ts (framer presets)
        │                design/theme.ts (semantic maps)
        │                design/contracts.ts (real component contracts)
        ▼
design/index.ts  ← future components import tokens/presets from here
```

## STEP 7 — Verification
- **Files changed:** `design/{tokens,motion,theme,contracts,index}.ts` (new),
  `design/tokens.test.ts` (renderer-scoped), `main/design/npdsTokens.test.ts`
  (executes in the main-scoped runner), this doc. No existing file modified.
- **Tests:** desktop **632 passed** (8 new NPDS tests that actually run in CI:
  spacing rhythm, radius/type-step mapping, duration/layer sanity, spring validity,
  theme declaration, **Button contract asserted against the real component**, honest
  missing-primitives list). Renderer-scoped `tokens.test.ts` additionally covers the
  motion presets (runs if renderer tests are enabled; guaranteed by typecheck now).
- **Typecheck:** desktop + backend **0 errors**. **Lint:** clean.
- **Performance impact:** none — pure constants + presets, imported only where used;
  no screen renders differently as a result of this increment.
- **Accessibility impact:** none yet; `reducedMotion` preset + High-Contrast theme
  plan are provided for future components to adopt.

## Known limitations — read honestly
- **This is engineering infrastructure, not a visual result.** No screen looks
  different. Whether adopting these tokens *improves* any screen is a visual
  judgment to be made on macOS when components migrate — deliberately out of scope
  here (STEP rules: "do not redesign any screen").
- The renderer-scoped `tokens.test.ts` does not run under the current vitest
  include (`src/main/**`); its coverage is mirrored by the main-scope test for the
  pure parts, and the motion presets are covered by typecheck. Enabling renderer
  tests (add `src/renderer/**` to the vitest include) would run it as-is.
- `Input`/`Badge`/etc. are documented as missing, not created — extracting them is
  a later increment (with visual verification on device).
- Tokens **mirror** the Tailwind config; they don't yet **generate** it. A future
  step could make `tailwind.config.ts` import from `tokens.ts` to enforce a single
  source at build time (kept out here to avoid touching the build).

## Migration guide (for future increments)
1. Import from `@renderer/design` instead of repeating utilities:
   `import { durations, panelMotion, statusColors } from '@renderer/design'`.
2. When extracting a missing primitive (e.g. `Badge`), give it a `variants` map and
   add its contract to `contracts.ts`; the contract test will hold it accountable.
3. To add High-Contrast: define `.theme-hc` CSS-var overrides in index.css per
   `theme.ts` notes; no component code changes.
4. Adopt motion presets by spreading a variant onto a `motion.*` element; do it one
   surface at a time and verify on macOS.
