/**
 * P13C F-7 — the pre-authentication service-status notice.
 *
 * The founder's Windows machine did exactly this: launched, showed a sign-in
 * form, rejected every attempt, and told him nothing — while the main process
 * logged `subsystem=backend ok=false` to a file he will never open. The
 * application knew. It had no lawful way to say so, because the two channels
 * that carry health came off the public allowlist in Rounds 10 and 11.
 *
 * This component is the mouth for `system:backendReachability`. It owns one
 * editorial rule, which is why it is a component and not three lines inside
 * LoginScreen: **the copy never asks the reader to run anything.** No "is the
 * backend running?", no port, no URL, no command. A founder who installed an
 * installer cannot act on any of that, and printing it turns an outage into a
 * message that reads like his own mistake.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackendReachability } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { Spinner } from '@renderer/components/Spinner';

/** How often to re-check while the notice is on screen. */
const POLL_MS = 15_000;

type Phase = 'checking' | 'reachable' | 'unreachable';

/** Public copy per failure class. Support can triage; the reader gets a plain fact. */
function detailFor(lastError: BackendReachability['lastError']): string {
  switch (lastError) {
    case 'timeout':
      return 'The service did not respond in time.';
    case 'dns':
      return 'The service address could not be found on this network.';
    case 'refused':
      return 'The service refused the connection.';
    case 'http_error':
      return 'The service responded, but reported a problem.';
    default:
      return 'The connection could not be completed.';
  }
}

export function BackendReachabilityNotice(): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('checking');
  const [detail, setDetail] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const alive = useRef(true);

  const check = useCallback(async (refresh: boolean): Promise<void> => {
    try {
      const result = await ipc.system.backendReachability(refresh);
      if (!alive.current) return;
      if (result.reachable) {
        setPhase('reachable');
        setDetail(null);
      } else if (result.checkedAt === null) {
        // No probe has completed yet. `reachable:false` here means "we have not
        // asked", not "the answer is no". Rendering it as an outage put a false
        // alarm on the login screen of every healthy launch — caught by running
        // the app, not by the tests, which asserted the field and not the
        // meaning.
        setPhase('checking');
        setDetail(null);
      } else {
        setPhase('unreachable');
        setDetail(detailFor(result.lastError));
      }
    } catch {
      // The channel itself failed. Say nothing rather than invent a cause —
      // an unknown state rendered as an outage is the same false-status error
      // this program exists to stop.
      if (alive.current) setPhase('checking');
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void check(false);
    const id = setInterval(() => void check(false), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [check]);

  const onRetry = useCallback(async (): Promise<void> => {
    setRetrying(true);
    setPhase('checking');
    try {
      await check(true);
    } finally {
      if (alive.current) setRetrying(false);
    }
  }, [check]);

  // Nothing to say when the service is fine. The first render is 'checking',
  // which is also silent — a status line that flashes on every healthy launch
  // trains people to ignore it.
  if (phase === 'reachable') return null;
  if (phase === 'checking' && !retrying) return null;

  if (phase === 'checking') {
    return (
      <div
        className="mb-4 flex items-center gap-2.5 rounded-xl border border-surface-border bg-surface-raised px-3.5 py-2.5 text-[12.5px] text-muted"
        role="status"
      >
        <Spinner />
        <span>Checking connection…</span>
      </div>
    );
  }

  return (
    <div
      className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[12.5px] text-amber-200"
      role="status"
    >
      <p className="font-medium">NeuroPause cannot reach its AI service right now.</p>
      {detail ? <p className="mt-1 text-amber-200/80">{detail}</p> : null}
      <p className="mt-1 text-amber-200/80">
        Sign-in needs the service. Nothing is wrong with this computer.
      </p>
      <button
        type="button"
        onClick={() => void onRetry()}
        disabled={retrying}
        className="app-no-drag mt-2 rounded-lg border border-amber-400/40 px-2.5 py-1 text-[12px] font-medium text-amber-100 transition hover:bg-amber-400/10 disabled:opacity-50"
      >
        Retry
      </button>
    </div>
  );
}
