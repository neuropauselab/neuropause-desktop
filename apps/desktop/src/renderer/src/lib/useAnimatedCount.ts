/**
 * A number that counts to its new value — used sparingly, and never lying.
 *
 * The case FOR animating a figure is narrow: when a number changes while the
 * user is looking at it, a short roll draws the eye to the thing that moved and
 * shows the direction of travel. That is genuine comprehension value.
 *
 * The cases AGAINST are broader, and this hook is shaped by them:
 *
 *  - **Never on mount.** A dashboard that spins every figure up from zero on
 *    load is decoration, and worse, for a few hundred milliseconds it displays
 *    numbers that are not true. "3 open holds" must not read "0, 1, 2" first.
 *  - **Never on a re-render that did not change the value.** The trigger is a
 *    value change, not a render.
 *  - **Never past ~300ms.** A figure the user cannot read yet is a figure they
 *    are waiting for.
 *  - **Integers stay integers.** Interpolating a record count through 4.7 puts
 *    a number on screen that could not exist.
 *  - **Reduced motion means no roll at all** — the value simply updates.
 *
 * And the hard rule: the returned value always CONVERGES exactly on the target
 * within the duration. A count that stops one short because a frame was missed
 * would silently misreport real data.
 */
import { useEffect, useRef, useState } from 'react';
import { DURATION, EASE } from './motion';

/** Above this, a roll is a distraction rather than a cue. */
export const MAX_COUNT_ROLL_MS = 300;

/** Cubic-bezier evaluation for the standard curve, y over t. */
function easeStandard(t: number): number {
  // The standard curve's shape, evaluated cheaply: exact bezier inversion is
  // not worth a solver here, and this matches it closely enough that no one
  // could tell the two apart in 260ms.
  const [, y1, , y2] = [EASE.standard[0], EASE.standard[1], EASE.standard[2], EASE.standard[3]];
  const u = 1 - t;
  return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
}

export interface AnimatedCountOptions {
  /** Milliseconds. Clamped to MAX_COUNT_ROLL_MS. */
  durationMs?: number;
  /** Skip the roll entirely (reduced motion, or a value that must not move). */
  disabled?: boolean;
}

/**
 * Returns the displayed value, rolling toward `target` when it CHANGES.
 * The first value is shown immediately, with no animation.
 */
export function useAnimatedCount(target: number, options: AnimatedCountOptions = {}): number {
  const duration = Math.min(options.durationMs ?? DURATION.moderate * 1000, MAX_COUNT_ROLL_MS);
  const [display, setDisplay] = useState(target);
  const previous = useRef(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const from = previous.current;
    previous.current = target;

    // Nothing moved, or motion is off: land on the number and stop.
    if (from === target || options.disabled || duration <= 0) {
      setDisplay(target);
      return;
    }
    // Non-finite input is a bug upstream; show it rather than animate to NaN.
    if (!Number.isFinite(from) || !Number.isFinite(target)) {
      setDisplay(target);
      return;
    }

    const integers = Number.isInteger(from) && Number.isInteger(target);
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const raw = from + (target - from) * easeStandard(t);
      // The final frame assigns the TARGET, not an interpolation of it — a
      // count that lands on 2.9999 and rounds is a count that can be wrong.
      setDisplay(t >= 1 ? target : integers ? Math.round(raw) : raw);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [target, duration, options.disabled]);

  return display;
}
