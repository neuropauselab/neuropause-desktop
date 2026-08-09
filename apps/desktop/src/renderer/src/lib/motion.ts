/**
 * Motion tokens — the single source of truth for how this app moves.
 *
 * Motion was previously ad hoc: 23 files each picked their own duration and
 * easing curve inline. The result is not "inconsistent animation" in the
 * abstract — it is that a tab change, a modal, and a hover all feel like they
 * belong to different applications, which reads as *unfinished* long before a
 * user could name why.
 *
 * The scale below is deliberately small. Four durations and three curves cover
 * every interaction in the product; a fifth option is almost always a sign
 * that something else is wrong (usually a layout jump being masked by a slower
 * fade).
 *
 * Two rules hold everywhere:
 *
 *  1. **Nothing animates longer than it takes to read.** A UI transition is
 *     navigation feedback, not a performance. Anything past ~250ms starts
 *     costing the user time on every single interaction.
 *  2. **Reduced motion is honored at the source.** `MotionConfig reducedMotion="user"`
 *     is set once at the app root, so transform/opacity animations collapse to
 *     instant for users who asked for that — no per-component opt-in to forget.
 */
import type { Transition, Variants } from 'framer-motion';

/* ── durations (seconds — framer-motion's unit) ────────────────────────────── */

export const DURATION = {
  /** Hover, press, colour change. Below this it reads as a jump. */
  instant: 0.09,
  /** The default. Tab changes, fades, small reveals. */
  quick: 0.16,
  /** Overlays and anything entering from off-screen. */
  moderate: 0.22,
  /** Reserved for large surfaces entering the first time. */
  deliberate: 0.32,
} as const;

/* ── easing ────────────────────────────────────────────────────────────────── */

/**
 * `standard` is the macOS-feeling curve already used by the section
 * transition: fast out of the gate, long gentle settle. Kept as the default so
 * this module unifies rather than restyles.
 */
export const EASE = {
  /** Most things. Decelerating. */
  standard: [0.2, 0.8, 0.2, 1] as const,
  /** Elements leaving. Accelerating — exits should not linger. */
  exit: [0.4, 0.0, 1, 1] as const,
  /** Symmetric, for things that move back and forth (indicators, toggles). */
  inOut: [0.4, 0.0, 0.2, 1] as const,
};

/* ── ready-made transitions ────────────────────────────────────────────────── */

/**
 * A tween, typed so `duration` stays READABLE. framer-motion's `Transition` is
 * a union covering springs and inertia, so a value typed as it loses the
 * duration field — and then a test cannot assert "exits are not slower than
 * entrances", which is the rule most worth enforcing.
 */
export type Tween = Transition & {
  duration: number;
  ease: readonly [number, number, number, number];
};

export const TRANSITION: Record<'instant' | 'quick' | 'moderate' | 'exit', Tween> = {
  instant: { duration: DURATION.instant, ease: EASE.standard },
  quick: { duration: DURATION.quick, ease: EASE.standard },
  moderate: { duration: DURATION.moderate, ease: EASE.standard },
  exit: { duration: DURATION.instant, ease: EASE.exit },
};

/**
 * The spring used ONLY for shared-layout indicators (the sidebar's active pill,
 * segmented-tab underlines). A spring is right here and wrong almost
 * everywhere else: an indicator is a physical object the eye tracks between
 * two positions, so a little overshoot-free settle reads as solid. Content
 * fades are not objects and a spring makes them feel loose.
 */
export const INDICATOR_SPRING: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 42,
  mass: 0.8,
};

/**
 * Transient surfaces that arrive and leave under their own steam — toasts and
 * the command palette. Slightly softer than the indicator because these are
 * appearing rather than tracking, but still critically damped: a palette that
 * wobbles into place under a keystroke feels like a toy.
 */
export const TOAST_SPRING: Transition = { type: 'spring', stiffness: 460, damping: 38, mass: 0.9 };
export const PALETTE_SPRING: Transition = { type: 'spring', stiffness: 480, damping: 40, mass: 0.9 };

/* ── shared variants ───────────────────────────────────────────────────────── */

/**
 * The section (tab) change. Y travel is intentionally tiny: a larger slide
 * makes every navigation feel like a page load, and at 6px the eye reads
 * "this replaced that" without waiting for it.
 */
export const sectionVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: TRANSITION.quick },
  exit: { opacity: 0, y: -4, transition: TRANSITION.exit },
};

/** Overlays: a short scale-in reads as "in front of", not "replacing". */
export const overlayVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: TRANSITION.quick },
  exit: { opacity: 0, transition: TRANSITION.exit },
};

export const dialogVariants: Variants = {
  initial: { opacity: 0, scale: 0.97, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: TRANSITION.moderate },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: TRANSITION.exit },
};

/**
 * Staggered list entry.
 *
 * `stagger` is capped hard. A per-item delay that grows without bound turns a
 * 40-row list into a two-second wait for the last row — the animation stops
 * being polish and becomes latency. 18ms × at most 8 items means the whole
 * list has settled inside ~150ms no matter how long it is.
 */
export const STAGGER_STEP = 0.018;
export const STAGGER_MAX_ITEMS = 8;

export const listVariants: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: STAGGER_STEP } },
};

export const listItemVariants: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: TRANSITION.quick },
};

/** Delay for the nth item, flattened past the cap. */
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_MAX_ITEMS) * STAGGER_STEP;
}

/**
 * Toasts. They enter from the edge they live on and leave the same way, so the
 * stack reads as a physical tray rather than items blinking in place. `layout`
 * on the card handles restacking when one in the middle is dismissed.
 */
export const toastVariants: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: TOAST_SPRING },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: TRANSITION.exit },
};

/**
 * The command palette. It descends slightly rather than scaling from centre:
 * the palette belongs to the top of the window (that is where ⌘K lives in the
 * user's mental model), and dropping from there preserves that relationship.
 */
export const paletteVariants: Variants = {
  initial: { opacity: 0, scale: 0.97, y: -8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: PALETTE_SPRING },
  exit: { opacity: 0, scale: 0.98, y: -6, transition: TRANSITION.exit },
};

/* ── CSS transition classes ────────────────────────────────────────────────── */

/**
 * Tailwind classes for interactions that must NOT go through React.
 *
 * Hover and press are the highest-frequency interactions in the app; routing
 * them through a JS animation loop costs a re-render per pointer move for
 * something CSS does on the compositor. These strings keep the timing
 * consistent with the tokens above without paying that cost.
 *
 * `motion-reduce:transition-none` is part of each one — the CSS layer needs the
 * same respect for the user's preference that `MotionConfig` gives the JS layer.
 */
export const CSS_TRANSITION = {
  /** Colour/opacity only — hover states, text tone changes. */
  colors: 'transition-colors duration-100 ease-out motion-reduce:transition-none',
  /** Colour + transform — buttons, chips, anything that presses. */
  interactive:
    'transition-[background-color,color,border-color,box-shadow,transform] duration-100 ease-out motion-reduce:transition-none',
  /** Elevation change on hover — cards. */
  elevation:
    'transition-[box-shadow,background-color,border-color,transform] duration-150 ease-out motion-reduce:transition-none',
  /** Rotation — disclosure chevrons. */
  rotate: 'transition-transform duration-150 ease-out motion-reduce:transition-none',
} as const;

/**
 * Cursor + disabled affordances, applied together so they cannot drift apart.
 *
 * The pairing matters: `disabled:pointer-events-none` alone means the browser
 * shows the *default arrow* over a disabled control, which reads as "not a
 * control" rather than "a control you cannot use right now". Keeping the
 * not-allowed cursor requires leaving pointer events on and blocking the
 * interaction instead.
 */
export const AFFORDANCE = {
  /** A control the user can act on. */
  clickable: 'cursor-pointer select-none',
  /** Disabled but still legible AS a control. */
  disabled: 'disabled:cursor-not-allowed disabled:opacity-50',
  /** In-flight: the action was accepted, the result has not arrived. */
  busy: 'aria-busy:cursor-progress',
} as const;
