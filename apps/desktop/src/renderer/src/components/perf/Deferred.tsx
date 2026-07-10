/**
 * Deferred — the progressive-rendering primitive. It renders `fallback` immediately, then mounts the
 * expensive `children` after the first commit, when the browser is idle (requestIdleCallback) or on the
 * next animation frame. This is REAL deferral of expensive work — no artificial delay, no placeholder
 * timer — so lightweight content paints first and heavy subtrees (charts, big timelines, analytics) follow
 * a beat later. Reuse it to sequence a page: header + summary cards first, heavy sections deferred.
 */
import { useEffect, useState, type ReactNode } from 'react';

export function Deferred({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}): JSX.Element {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const handle = w.requestIdleCallback(() => setReady(true));
      return () => w.cancelIdleCallback?.(handle);
    }
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return <>{ready ? children : fallback}</>;
}
