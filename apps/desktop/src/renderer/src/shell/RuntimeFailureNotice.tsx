/**
 * P13C ROUND 36 — GATE 1. THE SHELL FINALLY SAYS WHEN THE RUNTIME FAILED.
 *
 * `initRuntimeCore` failure deliberately keeps the window up — but before this
 * notice, the result was a complete, authenticated-looking UI over ~650 dead
 * channels, every screen degrading into its own empty state with no common
 * cause named anywhere. The one diagnostic built to explain the failure sat
 * behind a secure channel the failed init never registered.
 *
 * This reads the state from the BASE router (registered before the window
 * opens), subscribes to the transition broadcast, and renders nothing unless
 * the state is 'failed' — a healthy boot pays one invoke. The copy names what
 * happened, what it means, and the one action a user can take.
 */
import { useEffect, useState } from 'react';
import type { RuntimeStateDto } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';

const log = createLogger('runtime-failure-notice');

export function RuntimeFailureNotice(): JSX.Element | null {
  const [state, setState] = useState<RuntimeStateDto | null>(null);

  useEffect(() => {
    let alive = true;
    ipc.runtime
      .state()
      .then((s) => {
        if (alive) setState(s);
      })
      .catch((err: unknown) => {
        // The base router registers before the window exists, so this should
        // be unreachable; if it happens, log it — never invent a state.
        log.warn('runtime state unavailable', err);
      });
    const unsubscribe = ipc.runtime.onStateChanged((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  if (state?.state !== 'failed') return null;

  return (
    <div
      role="alert"
      className="app-no-drag border-b border-danger/40 bg-danger/10 px-4 py-2 text-xs leading-relaxed text-danger"
    >
      <strong>NeuroPause&apos;s runtime failed to start.</strong> Sign-in and local settings still work,
      but workspaces, data, and AI are unavailable this session
      {state.message ? <> — {state.message}</> : null}. Quit and reopen the app; if this keeps
      happening, send the log at <code>userData/logs/app.log</code> to support.
    </div>
  );
}
