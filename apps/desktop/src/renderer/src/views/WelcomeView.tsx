/**
 * The Welcome Center: the early-access getting-started surface. Reads the same
 * persisted onboarding state as the first-run wizard and shows the step catalog as
 * a checklist — steps the wizard skipped stay offered here. "Go" deep-links into
 * the existing view (and marks the step done); "Mark done" completes without
 * navigating; "Restart tour" resets the state so the wizard greets again on the
 * next launch (reset is audited). No new capability lives here — it is a doorway
 * into surfaces that already exist.
 */
import { useEffect, useState } from 'react';
import type {
  FeedbackCategory,
  OnboardingStatus,
  OnboardingStepId,
  PilotStatus,
} from '@neuropause/shared';
import { FEEDBACK_CATEGORIES } from '@neuropause/shared';
import { useShell } from '@renderer/state/ShellProvider';
import { ipc } from '@renderer/lib/ipc';
import { HELP_DOCS } from '@neuropause/shared';
import { createLogger } from '@renderer/lib/logger';
import { Button } from '@renderer/components/ui/Button';
import { type SectionId } from '@renderer/shell/sections';

const log = createLogger('welcome');

const STEP_LINKS: Partial<Record<OnboardingStepId, SectionId>> = {
  organization: 'organization',
  connectors: 'connectors',
  ai_setup: 'operations',
};

export function WelcomeView() {
  const { setSection } = useShell();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [fbCategory, setFbCategory] = useState<FeedbackCategory>('idea');
  const [fbMessage, setFbMessage] = useState('');
  const [fbState, setFbState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [exportMsg, setExportMsg] = useState('');
  const [pilot, setPilot] = useState<PilotStatus | null>(null);

  useEffect(() => {
    ipc.onboarding
      .status()
      .then(setStatus)
      .catch((err) => log.warn('Onboarding status unavailable', err));
    ipc.pilot
      .status()
      .then(setPilot)
      .catch((err) => log.warn('Pilot status unavailable', err));
  }, []);

  const goTo = (id: SectionId): void => {
    setSection(id);
  };

  const complete = async (step: OnboardingStepId, section?: SectionId) => {
    setBusy(true);
    try {
      const next = await ipc.onboarding.completeStep(step);
      setStatus(next);
      if (section) goTo(section);
    } catch (err) {
      log.warn('Could not complete step', err);
    } finally {
      setBusy(false);
    }
  };

  const restartTour = async () => {
    setBusy(true);
    try {
      setStatus(await ipc.onboarding.reset());
    } catch (err) {
      log.warn('Could not reset onboarding', err);
    } finally {
      setBusy(false);
    }
  };

  const done = status ? status.steps.filter((s) => s.completedAt !== null).length : 0;
  const total = status ? status.steps.length : 0;

  return (
    <div className="mx-auto w-full max-w-2xl p-8">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-accent">
        Early access
      </div>
      <h1 className="mb-2 text-2xl font-semibold text-ink">Welcome to NeuroPause</h1>
      <p className="mb-6 text-sm leading-relaxed text-muted">
        You are on the early-access build. Finish the checklist below to get the most out of the
        workspace — each item opens a surface that already exists in the app. Found something rough?
        The Operations view carries diagnostics and the support bundle.
      </p>

      <div className="surface rounded-2xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Getting started</span>
          <span className="text-xs text-muted">
            {done} of {total} done
          </span>
        </div>

        {status ? (
          <ul className="flex flex-col gap-3">
            {status.steps.map((step) => {
              const link = STEP_LINKS[step.id];
              const isDone = step.completedAt !== null;
              return (
                <li key={step.id} className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                        isDone ? 'bg-accent text-accent-fg' : 'border border-muted/40 text-muted'
                      }`}
                    >
                      {isDone ? '✓' : ''}
                    </span>
                    <div>
                      <div className={`text-sm ${isDone ? 'text-muted line-through' : 'text-ink'}`}>
                        {step.title}
                      </div>
                      <div className="text-xs text-muted">{step.description}</div>
                    </div>
                  </div>
                  {!isDone ? (
                    <div className="flex shrink-0 gap-2">
                      {link ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => void complete(step.id, link)}
                        >
                          Go
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void complete(step.id)}
                      >
                        Mark done
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">Loading your checklist…</p>
        )}
      </div>

      <div className="surface mt-4 rounded-2xl p-5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Share feedback</span>
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted">{exportMsg}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                ipc.feedback
                  .exportToFile()
                  .then((path) => setExportMsg(path ? 'Exported.' : ''))
                  .catch((err) => log.warn('Could not export feedback', err));
              }}
            >
              Export
            </Button>
          </span>
        </div>
        <p className="mb-3 text-xs text-muted">
          Early-access feedback is saved locally and can be exported for support — nothing is sent
          anywhere automatically.
        </p>
        <div className="mb-2 flex gap-2">
          {FEEDBACK_CATEGORIES.map((c) => (
            <Button
              key={c}
              variant={c === fbCategory ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setFbCategory(c)}
            >
              {c}
            </Button>
          ))}
        </div>
        <textarea
          className="surface mb-3 h-20 w-full resize-none rounded-xl p-3 text-sm text-ink outline-none focus-visible:shadow-focus"
          placeholder="What worked, what broke, what's missing…"
          value={fbMessage}
          onChange={(e) => {
            setFbMessage(e.target.value);
            if (fbState === 'sent') setFbState('idle');
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{fbState === 'sent' ? 'Thanks — saved.' : ''}</span>
          <Button
            variant="primary"
            size="sm"
            disabled={fbState === 'sending' || fbMessage.trim() === ''}
            onClick={() => {
              setFbState('sending');
              ipc.feedback
                .submit(fbCategory, fbMessage.trim(), 'welcome')
                .then(() => {
                  setFbMessage('');
                  setFbState('sent');
                })
                .catch((err) => {
                  log.warn('Could not save feedback', err);
                  setFbState('idle');
                });
            }}
          >
            Send feedback
          </Button>
        </div>
      </div>

      <div className="surface mt-4 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-ink">
              Pilot mode
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                  pilot?.enabled ? 'bg-accent text-accent-fg' : 'border border-muted/40 text-muted'
                }`}
              >
                {pilot?.enabled ? 'On' : 'Off'}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Marks this install as part of the early-access pilot and emphasizes feedback. It does
              not change your update channel or enable unreleased features.
            </p>
          </div>
          <Button
            variant={pilot?.enabled ? 'secondary' : 'primary'}
            size="sm"
            disabled={!pilot}
            onClick={() => {
              if (!pilot) return;
              const next = !pilot.enabled;
              ipc.pilot
                .setEnabled(next)
                .then((p) => {
                  setPilot(p);
                  if (next) {
                    ipc.onboarding
                      .completeStep('pilot')
                      .then(setStatus)
                      .catch(() => undefined);
                  }
                })
                .catch((err) => log.warn('Could not update pilot mode', err));
            }}
          >
            {pilot?.enabled ? 'Leave pilot' : 'Join pilot'}
          </Button>
        </div>
      </div>

      {/* Phase 8 (8.14): the bundled documentation, one click from the product. */}
      <div className="surface mt-4 rounded-2xl p-5">
        <div className="text-sm font-medium text-ink">Documentation</div>
        <p className="mt-1 text-xs text-muted">
          Guides bundled with this build — they open in your default Markdown viewer.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {HELP_DOCS.map((d) => (
            <Button
              key={d.id}
              variant="ghost"
              size="sm"
              onClick={() => {
                ipc.help.open(d.id).catch(() => undefined);
              }}
            >
              {d.title}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Button variant="secondary" size="sm" onClick={() => goTo('operations')}>
          Open diagnostics &amp; support
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void restartTour()}>
          Restart tour
        </Button>
      </div>
    </div>
  );
}
