/**
 * NeuroPause Motion Presets (NPDS A.1, STEP 5).
 *
 * Reusable Framer Motion variants/transitions built from the design tokens. These
 * are infrastructure — they animate NOTHING on their own. A future component may
 * opt in (e.g. `<motion.div variants={panelMotion} .../>`), but this increment
 * wires them to no screen. All timings/springs come from `tokens.ts`, so motion
 * stays consistent and centrally tunable.
 */
import type { Transition, Variants } from 'framer-motion';
import { durations, easing, springs } from './tokens';

const sec = (ms: number): number => ms / 1000;

/** Base transitions by named speed. */
export const transitions = {
  fast: { duration: sec(durations.fast), ease: easing.emphasized } as Transition,
  normal: { duration: sec(durations.normal), ease: easing.emphasized } as Transition,
  slow: { duration: sec(durations.slow), ease: easing.emphasized } as Transition,
  spring: springs.soft as Transition,
  springSnappy: springs.snappy as Transition,
} as const;

/** Fade + slight rise — for panels appearing (Layer 2). */
export const panelMotion: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: transitions.normal },
  exit: { opacity: 0, y: 6, transition: transitions.fast },
};

/** Dialog — scale+fade from center (Layer 4). */
export const dialogMotion: Variants = {
  initial: { opacity: 0, scale: 0.97 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: sec(durations.dialog), ease: easing.emphasized },
  },
  exit: { opacity: 0, scale: 0.98, transition: transitions.fast },
};

/** Command palette — quick rise (Layer 7). */
export const commandPaletteMotion: Variants = {
  initial: { opacity: 0, y: -6, scale: 0.99 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: sec(durations.commandPalette), ease: easing.emphasized },
  },
  exit: { opacity: 0, y: -4, transition: transitions.fast },
};

/** Notification — slide in from the edge (Layer 6). */
export const notificationMotion: Variants = {
  initial: { opacity: 0, x: 16 },
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: sec(durations.notification), ease: easing.emphasized },
  },
  exit: { opacity: 0, x: 12, transition: transitions.fast },
};

/** Voice orb — gentle spring presence (Layer 5). */
export const voiceMotion: Variants = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1, transition: transitions.spring },
  exit: { opacity: 0, scale: 0.94, transition: transitions.fast },
};

/** Hover lift for interactive cards (Layer 3) — matches Card's existing hover feel. */
export const cardHoverMotion = {
  rest: { y: 0 },
  hover: { y: -2, transition: { duration: sec(durations.hover), ease: easing.emphasized } },
} as const;

/** Reduced-motion fallback: opacity only, no transforms. */
export const reducedMotion: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: transitions.fast },
  exit: { opacity: 0, transition: transitions.fast },
};
