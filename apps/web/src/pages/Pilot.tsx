import { useCallback, useEffect, useState } from 'react';
import { getToken, pilot, type Day7Report, type PilotStatus } from '../lib/api';

const CONSENT_VERSION = 'pilot-terms-draft-v1';

export default function Pilot() {
  const [st, setSt] = useState<PilotStatus | null>(null);
  const [day7, setDay7] = useState<Day7Report | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const signedIn = getToken() != null;

  const refresh = useCallback(() => {
    if (!signedIn) return;
    pilot
      .status()
      .then(setSt)
      .catch((e: Error) => setMsg(e.message));
  }, [signedIn]);
  useEffect(refresh, [refresh]);

  const act = (fn: () => Promise<unknown>, ok: string) => () =>
    fn()
      .then(() => {
        setMsg(ok);
        refresh();
      })
      .catch((e: Error) => setMsg(e.message));

  return (
    <main>
      <h1>NeuroPause Global Pilot</h1>
      <p>
        30-day free controlled pilot. <strong>Day 7 is a measurement checkpoint — never a billing
        date.</strong> No payment method exists on your account and nothing converts automatically.
      </p>
      {!signedIn && (
        <p>
          <a href="/sign-in">Sign in</a> to view your pilot status.
        </p>
      )}
      {msg && <p style={{ color: '#92400e' }}>{msg}</p>}
      {signedIn && st && (
        <section>
          <h2>Your pilot</h2>
          {!st.enrollment ? (
            <div>
              <p>Consent recorded: {st.consentVersion ?? 'none yet'}</p>
              <button onClick={act(() => pilot.consent(CONSENT_VERSION), `Consent ${CONSENT_VERSION} recorded.`)}>
                1 · Record consent ({CONSENT_VERSION})
              </button>{' '}
              <button onClick={act(() => pilot.enroll(), 'Enrolled — pilot active.')} disabled={!st.consentVersion}>
                2 · Enroll in the pilot
              </button>
            </div>
          ) : (
            <div>
              <p>
                State: <strong>{st.enrollment.state}</strong> · Day {st.day} · {st.eventCount} events
                recorded
              </p>
              <button onClick={act(() => pilot.event('session_started'), 'Session event recorded.')}>
                Record session event
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  act(() => pilot.event('feedback_submitted', { text: feedback }), 'Feedback recorded.')();
                  setFeedback('');
                }}
                style={{ marginTop: 8 }}
              >
                <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Pilot feedback" required />
                <button type="submit" style={{ marginLeft: 8 }}>Submit feedback</button>
              </form>
              <h3 style={{ marginTop: 16 }}>Day-7 measurement</h3>
              <button onClick={() => pilot.day7().then(setDay7).catch((e: Error) => setMsg(e.message))}>
                Load measurement report
              </button>
              {day7 && (
                <pre style={{ background: '#f4f4f5', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
                  {JSON.stringify(day7, null, 2)}
                </pre>
              )}
              <p style={{ color: '#666', fontSize: 13 }}>
                Outcomes (continue / paid / institutional / extend / stop) are reachable only through a
                recorded human decision — the backend enforces this, not this page.
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
