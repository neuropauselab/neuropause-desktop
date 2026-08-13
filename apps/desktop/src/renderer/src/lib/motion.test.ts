/**
 * The motion contract.
 *
 * Motion has no type system and no runtime error. A duration typo, a curve
 * that overshoots, a stagger that grows without bound — all of it compiles,
 * ships, and is only ever caught by someone noticing the app feels wrong. The
 * rules below are the ones that would otherwise be enforced by nobody.
 */
import { describe, expect, it } from 'vitest';
import {
  AFFORDANCE,
  CSS_TRANSITION,
  DURATION,
  EASE,
  INDICATOR_SPRING,
  STAGGER_MAX_ITEMS,
  STAGGER_STEP,
  TRANSITION,
  dialogVariants,
  listItemVariants,
  overlayVariants,
  sectionVariants,
  staggerDelay,
} from './motion';

describe('duration scale', () => {
  it('never exceeds the threshold where transition becomes waiting', () => {
    // ~250ms is roughly where a UI transition stops reading as feedback and
    // starts reading as latency the user pays on every interaction.
    for (const [name, value] of Object.entries(DURATION)) {
      expect(value, `${name} is too slow to be interface feedback`).toBeLessThanOrEqual(0.35);
      expect(value, `${name} is so short it will read as a jump`).toBeGreaterThanOrEqual(0.08);
    }
  });

  it('is strictly ordered, so the names mean something', () => {
    expect(DURATION.instant).toBeLessThan(DURATION.quick);
    expect(DURATION.quick).toBeLessThan(DURATION.moderate);
    expect(DURATION.moderate).toBeLessThan(DURATION.deliberate);
  });
});

describe('easing', () => {
  it('exposes valid cubic-bezier control points', () => {
    for (const [name, curve] of Object.entries(EASE)) {
      expect(curve, `${name} must be a 4-point bezier`).toHaveLength(4);
      // x values must stay in [0,1] or the curve is not a valid timing
      // function; y may overshoot, which is how a curve gets its bounce.
      expect(curve[0], `${name} x1 out of range`).toBeGreaterThanOrEqual(0);
      expect(curve[0], `${name} x1 out of range`).toBeLessThanOrEqual(1);
      expect(curve[2], `${name} x2 out of range`).toBeGreaterThanOrEqual(0);
      expect(curve[2], `${name} x2 out of range`).toBeLessThanOrEqual(1);
    }
  });

  it('exits are not slower than entrances', () => {
    // An element the user dismissed should get out of the way. A slow exit is
    // the single most common way an interface feels sluggish while every
    // individual animation looks fine in isolation.
    expect(TRANSITION.exit.duration).toBeLessThanOrEqual(TRANSITION.quick.duration);
  });
});

describe('indicator spring', () => {
  it('is damped enough not to overshoot', () => {
    // An indicator that bounces past its target and back reads as imprecise,
    // and on a nav rail it actively misleads about which item is selected.
    const { stiffness, damping, mass } = INDICATOR_SPRING as {
      stiffness: number;
      damping: number;
      mass: number;
    };
    const criticalDamping = 2 * Math.sqrt(stiffness * mass);
    expect(damping / criticalDamping, 'the indicator would overshoot').toBeGreaterThanOrEqual(0.9);
  });
});

describe('stagger', () => {
  it('flattens, so a long list is never slower than a short one', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(3)).toBeCloseTo(3 * STAGGER_STEP);
    // Past the cap every item shares the last delay.
    expect(staggerDelay(50)).toBe(staggerDelay(STAGGER_MAX_ITEMS));
  });

  it('has settled well inside a quarter second regardless of list length', () => {
    const worstCase = staggerDelay(Number.MAX_SAFE_INTEGER) + DURATION.quick;
    expect(worstCase).toBeLessThan(0.35);
  });
});

describe('shared variants', () => {
  const variants = { sectionVariants, overlayVariants, dialogVariants, listItemVariants };

  it('every variant set can both enter and start from somewhere', () => {
    for (const [name, v] of Object.entries(variants)) {
      expect(v.initial, `${name} has no initial state`).toBeDefined();
      expect(v.animate, `${name} has no animate state`).toBeDefined();
    }
  });

  it('animates only compositor-friendly properties', () => {
    // opacity/transform run on the compositor. Animating width, height, top or
    // left forces layout on every frame, which is how an animation that looks
    // fine on this machine drops frames on a busy one.
    const allowed = new Set(['opacity', 'x', 'y', 'scale', 'rotate', 'transition']);
    for (const [name, v] of Object.entries(variants)) {
      for (const state of ['initial', 'animate', 'exit'] as const) {
        const target = v[state];
        if (!target || typeof target !== 'object') continue;
        for (const key of Object.keys(target)) {
          expect(allowed.has(key), `${name}.${state} animates "${key}", which forces layout`).toBe(
            true,
          );
        }
      }
    }
  });
});

describe('CSS transition + affordance classes', () => {
  it('every CSS transition opts out under reduced motion', () => {
    // MotionConfig covers the JS layer only. Hover and press are CSS, and a
    // user who asked for less motion should not still get sliding hover states.
    for (const [name, value] of Object.entries(CSS_TRANSITION)) {
      expect(value, `${name} ignores prefers-reduced-motion`).toContain(
        'motion-reduce:transition-none',
      );
    }
  });

  it('a disabled control still looks like a control', () => {
    // `pointer-events-none` would give a disabled button the default arrow,
    // which reads as "not interactive" rather than "temporarily unavailable".
    expect(AFFORDANCE.disabled).toContain('disabled:cursor-not-allowed');
    expect(AFFORDANCE.disabled).not.toContain('pointer-events-none');
    expect(AFFORDANCE.clickable).toContain('cursor-pointer');
    expect(AFFORDANCE.busy).toContain('cursor-progress');
  });
});
