/**
 * The first-run experience — launch → welcome → processing choice → workspace
 * type → the workspace. Full-screen, keyboard-first, three decisions, each
 * persisted the moment it is made through real stores:
 *
 *   "Try Free Locally"        → nothing (it is the door, not a claim)
 *   processing choice         → the REAL AI mode + external consent
 *                               (ipc.aiConfig.setMode / setExternalConsent)
 *   workspace type            → the experience profile, which reshapes nav
 *
 * What this screen never does: promise what the system cannot prove. There is
 * no "no credit card" line (nothing here verifies a registration), no "100%
 * local" claim (routing is Private First, and says exactly that), and Sign In
 * routes to the existing auth surface rather than pretending to be one.
 */
import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { WorkspaceType } from '@neuropause/shared';
import {
  WORKSPACE_TYPES,
  WORKSPACE_TYPE_INCLUDES,
  WORKSPACE_TYPE_LABELS,
  WORKSPACE_TYPE_TAGLINES,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { FIRST_RUN_COPY } from './experienceModel';
import { setWorkspaceType } from './workspaceTypeStore';

const log = createLogger('first-run');

type Step = 'welcome' | 'processing' | 'workspace';

export function FirstRunExperience({
  onDone,
  onSignIn,
}: {
  /** Called when the experience finishes or is skipped; the shell re-reads the profile. */
  onDone: (landing: 'ai-home' | null) => void;
  onSignIn: () => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>('welcome');
  const [busy, setBusy] = useState(false);
  const [ollamaReachable, setOllamaReachable] = useState<boolean | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    // A real probe, so the processing step can say whether a local model is
    // actually there — instead of implying one is.
    ipc.aiConfig
      .detectOllama()
      .then((d) => setOllamaReachable(d.reachable))
      .catch(() => setOllamaReachable(false));
  }, []);

  const skip = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await ipc.firstRun.set({ state: 'skipped' });
    } catch (err) {
      log.warn('Could not persist skip', { message: String(err) });
    } finally {
      setBusy(false);
      onDone(null);
    }
  }, [onDone]);

  const chooseProcessing = async (allowExternal: boolean): Promise<void> => {
    setBusy(true);
    try {
      // The ACTUAL routing configuration — not a stored marketing preference.
      await ipc.aiConfig.setMode('private_first');
      await ipc.aiConfig.setExternalConsent(allowExternal);
      await ipc.firstRun.set({ aiModeChosen: true });
      setStep('workspace');
    } catch (err) {
      log.warn('Could not persist AI mode', { message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const chooseWorkspace = async (type: WorkspaceType): Promise<void> => {
    setBusy(true);
    try {
      await ipc.firstRun.set({ workspaceType: type, state: 'completed' });
      setWorkspaceType(type);
      onDone('ai-home');
    } catch (err) {
      log.warn('Could not persist workspace type', { message: String(err) });
      setBusy(false);
    }
  };

  const fade = reducedMotion
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25 } };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto [background:var(--surface-0)]"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to NeuroPause"
    >
      <div className="mx-auto w-full max-w-[760px] px-8 py-12">
        {step === 'welcome' && (
          <motion.div {...fade} className="text-center">
            <h1 className="text-4xl font-semibold tracking-tight">{FIRST_RUN_COPY.headline}</h1>
            <p className="mx-auto mt-4 max-w-[520px] text-base leading-relaxed text-muted">
              {FIRST_RUN_COPY.supporting}
            </p>
            <div className="mt-10 flex items-center justify-center gap-3">
              <Button variant="primary" autoFocus onClick={() => setStep('processing')}>
                {FIRST_RUN_COPY.primaryCta}
              </Button>
              <Button onClick={onSignIn}>
                {FIRST_RUN_COPY.secondaryCta}
              </Button>
            </div>
            <button
              type="button"
              className="mt-8 text-sm text-faint underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
              disabled={busy}
              onClick={() => void skip()}
            >
              Skip setup for now
            </button>
          </motion.div>
        )}

        {step === 'processing' && (
          <motion.div {...fade}>
            <h2 className="text-center text-2xl font-semibold tracking-tight">
              {FIRST_RUN_COPY.processingQuestion}
            </h2>
            <p className="mt-2 text-center text-sm text-muted">
              This sets real routing, not a preference label. You can change it any time in Settings → AI.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <ChoiceCard
                icon="lock"
                title={FIRST_RUN_COPY.onDevice.title}
                body={FIRST_RUN_COPY.onDevice.body}
                footnote={
                  ollamaReachable === null
                    ? 'Checking for a local model…'
                    : ollamaReachable
                      ? 'A local model server is reachable on this device.'
                      : 'No local model server is reachable right now — you can set one up later (for example, Ollama). Until then, AI requests will fail on this device rather than being sent anywhere.'
                }
                cta="Keep it on this device"
                busy={busy}
                onChoose={() => void chooseProcessing(false)}
              />
              <ChoiceCard
                icon="globe"
                title={FIRST_RUN_COPY.withCloud.title}
                body={FIRST_RUN_COPY.withCloud.body}
                footnote="External providers are used only as a fallback, only once configured, and every response shows where it actually ran."
                cta="Allow approved cloud AI"
                busy={busy}
                onChoose={() => void chooseProcessing(true)}
              />
            </div>
            <p className="mt-6 text-center text-xs text-faint">
              Default is Private First: local processing is preferred wherever it can serve the request.
            </p>
          </motion.div>
        )}

        {step === 'workspace' && (
          <motion.div {...fade}>
            <h2 className="text-center text-2xl font-semibold tracking-tight">
              {FIRST_RUN_COPY.workspaceQuestion}
            </h2>
            <p className="mt-2 text-center text-sm text-muted">
              One product — this choice shapes the workspace, and you can change it later without losing anything.
            </p>
            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {WORKSPACE_TYPES.map((type) => (
                <div
                  key={type}
                  className="flex flex-col rounded-2xl border border-[var(--hairline)] p-5 text-left"
                >
                  <h3 className="text-base font-semibold">{WORKSPACE_TYPE_LABELS[type]}</h3>
                  <p className="mt-0.5 text-sm text-muted">{WORKSPACE_TYPE_TAGLINES[type]}</p>
                  <ul className="mt-4 flex-1 space-y-1.5">
                    {WORKSPACE_TYPE_INCLUDES[type].map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-muted">
                        <Icon name="check" size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant={type === 'personal' ? 'primary' : 'secondary'}
                    className="mt-5"
                    disabled={busy}
                    onClick={() => void chooseWorkspace(type)}
                  >
                    {type === 'business' ? 'Explore Business' : `Start ${WORKSPACE_TYPE_LABELS[type]}`}
                  </Button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function ChoiceCard({
  icon,
  title,
  body,
  footnote,
  cta,
  busy,
  onChoose,
}: {
  icon: 'lock' | 'globe';
  title: string;
  body: string;
  footnote: string;
  cta: string;
  busy: boolean;
  onChoose: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col rounded-2xl border border-[var(--hairline)] p-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl [background:var(--fill-2)]">
        <Icon name={icon} size={17} aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted">{body}</p>
      <p className="mt-3 text-xs text-faint">{footnote}</p>
      <Button variant="primary" className="mt-4" disabled={busy} onClick={onChoose}>
        {cta}
      </Button>
    </div>
  );
}
