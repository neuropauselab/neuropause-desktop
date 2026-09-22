import { useCallback, useEffect, useState } from 'react';
import { getToken, pilot, type Day7Report, type PilotStatus, type PilotTerms } from '../lib/api';

/**
 * THE CONSENT VERSION IS NO LONGER HARD-CODED HERE, AND THAT IS THE POINT.
 *
 * This page used to declare `CONSENT_VERSION = 'pilot-terms-draft-v1'` and send it as the
 * record of what a participant agreed to. That string named no document anywhere in the
 * system — not a file, not a row, not a URL — so a consent record could not be reconstructed
 * against anything. NP-PILOT-FIRST-003 recorded it as C-05.
 *
 * The page now READS what is published (`GET /pilot/terms`) and can only offer what it was
 * told. The registry ships empty, so the honest state today is "no terms are published" and
 * NO CONSENT BUTTON IS RENDERED. That is not a gap to work around; it is the correct
 * behaviour until a human publishes real terms.
 *
 * The backend refuses independently (`terms_unknown`), so this page is the honest surface
 * over the refusal, never the thing enforcing it.
 */
const EXITED = ['WITHDRAWN', 'TERMINATED', 'COMPLETED'];

export default function Pilot() {
  const [st, setSt] = useState<PilotStatus | null>(null);
  const [terms, setTerms] = useState<PilotTerms[] | null>(null);
  const [day7, setDay7] = useState<Day7Report | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [exitReason, setExitReason] = useState('');
  const [confirmExit, setConfirmExit] = useState(false);
  const signedIn = getToken() != null;

  const refresh = useCallback(() => {
    if (!signedIn) return;
    pilot
      .status()
      .then(setSt)
      .catch((e: Error) => setMsg(e.message));
    pilot
      .terms()
      .then((r) => setTerms(r.terms))
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

  const offered = terms?.[0] ?? null;
  const state = st?.enrollment?.state ?? null;
  const exited = state != null && EXITED.includes(state);

  return (
    <main>
      <h1>NeuroPause Global Pilot</h1>
      {/*
        CLAIM BOUNDARY. The previous copy read "No payment method exists on your account",
        which is a factual assertion ABOUT THE READER'S ACCOUNT that this page never checks —
        a compile-time string presented as a live fact. The backend does have a billing module,
        so an account could hold a payment method from elsewhere and this page would still have
        said otherwise.

        What IS measurable, and is what the copy now says: the pilot itself has no billing
        step. Measured — zero billing/payment/subscription references anywhere in
        apps/backend/src/pilot (positive control: 12 files exist in apps/backend/src/billing),
        and the web client calls no billing endpoint. "Nothing converts automatically" is a
        property of this pilot; "you have no card on file" was never this page's to assert.
      */}
      <p>
        30-day free controlled pilot. <strong>Day 7 is a measurement checkpoint, not a billing
        date.</strong> This pilot has no billing step: it collects no payment method, and
        nothing converts to a paid plan automatically. Any outcome — including a paid one — is
        reachable only through a recorded human decision.
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
              {terms === null ? (
                <p>Checking which pilot terms are published…</p>
              ) : offered === null ? (
                /* The honest empty state. No consent button exists to press. */
                <p>
                  <strong>No pilot terms are published yet, so enrolment is not open.</strong> You
                  cannot agree to something that has not been published, and this page will not
                  ask you to.
                </p>
              ) : (
                <div>
                  <p>
                    Terms offered: <strong>{offered.version}</strong>
                    <br />
                    Document: <code>{offered.contentReference}</code>
                    <br />
                    Content digest: <code>{offered.digest}</code>
                    {offered.publishedAt && (
                      <>
                        <br />
                        Published: {new Date(offered.publishedAt).toLocaleString()}
                      </>
                    )}
                  </p>
                  <button onClick={act(() => pilot.consent(offered.version), `Consent to ${offered.version} recorded.`)}>
                    1 · Agree to these terms
                  </button>{' '}
                  <button onClick={act(() => pilot.enroll(), 'Enrolled — pilot active.')} disabled={!st.consentVersion}>
                    2 · Enroll in the pilot
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <p>
                State: <strong>{state}</strong> · Day {st.day} · {st.eventCount} events recorded
              </p>
              {exited ? (
                /* An exited participation is terminal. Nothing here offers a way back in:
                   re-enrollment is not a decision anyone has made. */
                <p>
                  Your participation ended ({state}). Your recorded pilot data is kept as
                  evidence and is not deleted by leaving.
                </p>
              ) : (
                <>
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

                  {/* C-03. Leaving was previously impossible from any surface. */}
                  <h3 style={{ marginTop: 16 }}>Leave the pilot</h3>
                  <p style={{ color: '#666', fontSize: 13 }}>
                    You can leave at any time. Leaving is permanent for this pilot, takes effect
                    immediately, and does not delete what has already been recorded.
                  </p>
                  {!confirmExit ? (
                    <button onClick={() => setConfirmExit(true)}>Withdraw from the pilot…</button>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(() => pilot.withdraw(exitReason), 'You have withdrawn from the pilot.')();
                        setExitReason('');
                        setConfirmExit(false);
                      }}
                    >
                      <input
                        value={exitReason}
                        onChange={(e) => setExitReason(e.target.value)}
                        placeholder="Reason for leaving (recorded)"
                        required
                      />
                      <button type="submit" style={{ marginLeft: 8 }}>Confirm withdrawal</button>{' '}
                      <button type="button" onClick={() => setConfirmExit(false)}>Cancel</button>
                    </form>
                  )}
                </>
              )}
              <p style={{ color: '#666', fontSize: 13, marginTop: 16 }}>
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
