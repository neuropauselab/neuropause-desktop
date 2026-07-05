/**
 * NeuroPause Design Tokens (NPDS A.1).
 *
 * A typed, importable mirror of the design values ALREADY defined in
 * `apps/desktop/tailwind.config.ts` and `index.css`. This file invents no new
 * visual values — every token here traces to an existing definition, so code and
 * docs can reference tokens by name instead of repeating magic strings/Tailwind
 * utilities. It changes no screens and no styling; it is infrastructure only.
 *
 * Source of truth: the Tailwind config remains authoritative for what the CSS
 * engine emits. These constants document and expose those same values to TS
 * (e.g. for Framer Motion presets, tests, and future component variants).
 */

/** Spacing scale (px) — matches the request's 8/12/16/20/24/32/48/64 rhythm. */
export const spacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
  '4xl': 64,
} as const;

/** Corner radius (px) — mirrors tailwind.config borderRadius. */
export const radius = {
  lg: 10,
  xl: 14,
  '2xl': 18,
  '3xl': 24,
} as const;

/**
 * Type scale — mirrors tailwind.config fontSize. Each entry is [size, lineHeight,
 * letterSpacing?]. Named roles (STEP 3) map onto these existing steps rather than
 * introducing new sizes.
 */
export const fontSize = {
  '2xs': { size: '10.5px', lineHeight: '14px', letterSpacing: '0.02em' },
  xs: { size: '11.5px', lineHeight: '16px' },
  sm: { size: '12.5px', lineHeight: '17px' },
  base: { size: '13.5px', lineHeight: '19px' },
  md: { size: '14.5px', lineHeight: '20px' },
  lg: { size: '16px', lineHeight: '22px', letterSpacing: '-0.01em' },
  xl: { size: '19px', lineHeight: '24px', letterSpacing: '-0.015em' },
  '2xl': { size: '24px', lineHeight: '29px', letterSpacing: '-0.02em' },
  '3xl': { size: '30px', lineHeight: '34px', letterSpacing: '-0.022em' },
  '4xl': { size: '38px', lineHeight: '42px', letterSpacing: '-0.025em' },
} as const;

/**
 * Executive typography roles (STEP 3) → existing type-scale steps + weight.
 * These are documentation/mapping only; they compose the Tailwind classes that
 * already exist (e.g. role 'kpiNumber' → text-3xl font-semibold tabular-nums).
 */
export const typographyRoles = {
  displayXl: { step: '4xl', weight: 600, tracking: 'tight' },
  display: { step: '3xl', weight: 600, tracking: 'tight' },
  heading: { step: '2xl', weight: 600, tracking: 'tight' },
  section: { step: 'xl', weight: 600 },
  panelTitle: { step: 'lg', weight: 600 },
  cardTitle: { step: 'md', weight: 600 },
  kpiNumber: { step: '3xl', weight: 600, numeric: true },
  kpiMetric: { step: 'xl', weight: 600, numeric: true },
  body: { step: 'base', weight: 400 },
  label: { step: 'xs', weight: 500, uppercase: true },
  metadata: { step: 'xs', weight: 400 },
  evidence: { step: 'xs', weight: 400 },
  timeline: { step: 'sm', weight: 400 },
  caption: { step: '2xs', weight: 400 },
  monoMetric: { step: 'sm', weight: 500, mono: true, numeric: true },
} as const;

/** Elevation → the existing boxShadow tokens. Higher index = more lifted. */
export const elevation = {
  card: 'shadow-card', // resting surface
  pop: 'shadow-pop', // hover / lifted
  glass: 'shadow-glass', // floating panels / dialogs
  focus: 'shadow-focus', // focus ring
} as const;

/** Raw shadow values (mirror of tailwind.config boxShadow), for non-Tailwind use. */
export const shadow = {
  glass: '0 24px 64px -24px rgba(0,0,0,0.55)',
  pop: '0 12px 32px -12px rgba(0,0,0,0.45), 0 2px 8px -4px rgba(0,0,0,0.30)',
  card: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -16px rgba(0,0,0,0.20)',
  focus: '0 0 0 3.5px rgb(var(--accent) / 0.35)',
} as const;

/**
 * Surface hierarchy (STEP 6 depth). These map to the material component classes
 * defined in index.css (`surface-base`, `surface-raised`, glass panels). Depth
 * communicates focus, not decoration.
 */
export const surfaces = {
  base: 'surface-base', // Layer 1 — workspace surface
  raised: 'surface-raised', // Layer 2/3 — panels & cards
  glass: 'glass', // Layer 4+ — floating dialogs / palette / voice
} as const;

/** Semantic + Apple system status colors → the channel-driven Tailwind color names. */
export const semanticColors = {
  accent: 'accent',
  text: 'ink',
  textSubtle: 'subtle',
  textFaint: 'faint',
} as const;

export const statusColors = {
  info: 'sysblue',
  success: 'sysgreen',
  warning: 'sysorange',
  danger: 'syspink',
  purple: 'syspurple',
  teal: 'systeal',
  yellow: 'sysyellow',
} as const;

/** Motion durations (ms). Mirrors the fade-in timing and adds a named ramp. */
export const durations = {
  fast: 120,
  normal: 200,
  slow: 320,
  dialog: 260,
  panel: 220,
  hover: 150,
  focus: 120,
  notification: 240,
  commandPalette: 200,
  voice: 300,
} as const;

/** The macOS-like easing already used by components (ease-emphasized). */
export const easing = {
  emphasized: [0.2, 0.8, 0.2, 1] as const, // cubic-bezier(0.2,0.8,0.2,1)
  standard: [0.4, 0, 0.2, 1] as const,
} as const;

/** Spring presets for Framer Motion (STEP 5). Tuned to feel calm + macOS-like. */
export const springs = {
  soft: { type: 'spring', stiffness: 210, damping: 26, mass: 1 },
  snappy: { type: 'spring', stiffness: 320, damping: 30, mass: 0.9 },
  gentle: { type: 'spring', stiffness: 160, damping: 24, mass: 1 },
} as const;

/** Blur / glass strength (px) for translucent materials. */
export const blur = {
  panel: 20,
  dialog: 30,
  overlay: 12,
} as const;

/** Spatial layer order (STEP 6) — z-index intent, not pixel values. */
export const layers = {
  background: 0,
  workspace: 1,
  panels: 2,
  cards: 3,
  dialogs: 4,
  voice: 5,
  notifications: 6,
  commandPalette: 7,
} as const;

export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radius;
export type TypographyRole = keyof typeof typographyRoles;
export type ElevationToken = keyof typeof elevation;
export type DurationToken = keyof typeof durations;
export type SpringToken = keyof typeof springs;
export type StatusColor = keyof typeof statusColors;
export type LayerToken = keyof typeof layers;
