/**
 * NeuroPause Theme Architecture (NPDS A.1, STEP 4).
 *
 * Documents the semantic → token mapping. The ACTUAL per-theme values live in
 * index.css as CSS custom properties (channel triplets), which already switch on
 * light/dark via `darkMode: 'class'`. This module does NOT restyle anything; it
 * records which semantic roles exist and which Tailwind color token each resolves
 * to, so future components reference `theme.text` etc. rather than raw classes,
 * and so a High-Contrast theme can be added by overriding the same CSS vars.
 */
import { semanticColors, statusColors } from './tokens';

export type ThemeName = 'light' | 'dark' | 'high-contrast' | 'system';

/** The list of themes the app intends to support (system follows the OS). */
export const themes: ThemeName[] = ['light', 'dark', 'high-contrast', 'system'];

/**
 * Semantic color roles → Tailwind token names (which are CSS-var-driven, so they
 * already adapt per theme). Adding High-Contrast = overriding the underlying CSS
 * vars in index.css under a `.theme-hc` class; no code here changes.
 */
export const themeColorRoles = {
  textPrimary: semanticColors.text, // 'ink'
  textSubtle: semanticColors.textSubtle, // 'subtle'
  textFaint: semanticColors.textFaint, // 'faint'
  accent: semanticColors.accent, // 'accent'
  info: statusColors.info,
  success: statusColors.success,
  warning: statusColors.warning,
  danger: statusColors.danger,
} as const;

/**
 * Surface roles → the material classes in index.css. Depth order matches
 * tokens.layers; each maps to an existing translucent material.
 */
export const themeSurfaceRoles = {
  workspace: 'surface-base',
  panel: 'surface-raised',
  floating: 'glass',
} as const;

/** How High-Contrast differs (documentation for the follow-up CSS, not applied here). */
export const highContrastNotes = {
  strategy: 'Override the same --text/--accent/--c-* CSS vars under a .theme-hc root class.',
  requirements: [
    'Raise text/background contrast to >= 7:1 for body text.',
    'Replace translucent materials with opaque fills for panels/dialogs.',
    'Thicken hairlines and focus rings for visibility.',
  ],
} as const;
