/**
 * Dark design tokens (Mobile M1-08) — the phone's premium dark system, sharing
 * the validated Phase 7 categorical palette with the desktop so charts read as
 * one product across surfaces.
 */
export const colors = {
  bg: '#0a0a0f',
  surface: '#14141b',
  surfaceRaised: '#1c1c26',
  hairline: 'rgba(255,255,255,0.08)',
  ink: '#f5f5f7',
  muted: '#a0a0ab',
  faint: '#6b6b76',
  accent: '#3987e5',
  danger: '#e2504f',
  /** Phase 7 dark categorical palette (validated, accessible). */
  categorical: [
    '#3987e5',
    '#d95926',
    '#199e70',
    '#c98500',
    '#d55181',
    '#008300',
    '#9085e9',
    '#e66767',
  ],
  /** KPI band tones (match the desktop). */
  bands: {
    healthy: '#199e70',
    watch: '#c98500',
    'at-risk': '#d95926',
    critical: '#d55181',
  },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;
export const font = {
  h1: 28,
  h2: 20,
  body: 15,
  small: 13,
  tiny: 11,
} as const;
