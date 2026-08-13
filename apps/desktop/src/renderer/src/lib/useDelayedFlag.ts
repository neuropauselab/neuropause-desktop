/**
 * "Only say you are loading if you actually are."
 *
 * The failure this fixes is specific and very common: a lazy chunk resolves in
 * 40ms, the Suspense fallback mounts and unmounts inside two frames, and the
 * user sees a spinner FLASH. That flash is worse than no feedback at all —
 * it draws the eye to a thing that is already gone, and it makes a fast app
 * look unstable.
 *
 * So the loading indicator waits. Under the delay nothing is shown and the
 * transition looks instant, which is the truth. Past it the wait is real and
 * deserves acknowledgement.
 *
 * 120ms is the working threshold: below roughly that, a change reads as
 * immediate, so a spinner would be reporting a wait the user never had.
 */
import { useEffect, useState } from 'react';

export const LOADING_FLASH_THRESHOLD_MS = 120;

/**
 * `false` until `delayMs` has elapsed, then `true`. Resets whenever `delayMs`
 * changes. Mounted for the lifetime of the thing that is loading, so unmounting
 * (the load finished) cancels the timer before it can fire.
 */
export function useDelayedFlag(delayMs: number = LOADING_FLASH_THRESHOLD_MS): boolean {
  const [elapsed, setElapsed] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) {
      setElapsed(true);
      return;
    }
    setElapsed(false);
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  return elapsed;
}
