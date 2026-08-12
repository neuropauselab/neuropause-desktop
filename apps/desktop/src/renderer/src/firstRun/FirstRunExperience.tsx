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
import type { AiMode, UnderstandingAttribute, WorkspaceType } from '@neuropause/shared';
import { AI_MODE_LABELS } from '@neuropause/shared';
import {
  ATTRIBUTE_STATUS_LABELS,
  WORKSPACE_TYPES,
  WORKSPACE_TYPE_INCLUDES,
  WORKSPACE_TYPE_LABELS,
  WORKSPACE_TYPE_TAGLINES,
  inferFromWorkDescription,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { FIRST_RUN_COPY } from './experienceModel';
import { setWorkspaceType } from './workspaceTypeStore';

const log = createLogger('first-run');

type Step = 'welcome' | 'processing' | 'workspace' | 'discovery' | 'understanding';

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
  /**
   * P13C ROUND 17 · D-5. Three pieces of state so the screen can be HONEST:
   * the error is surfaced instead of swallowed, and the effective mode is shown
   * rather than the preference being displayed as if it were in force.
   */
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [effectiveMode, setEffectiveMode] = useState<AiMode | null>(null);
  const [restrictedByPlatform, setRestrictedByPlatform] = useState(false);
  const [chosenType, setChosenType] = useState<WorkspaceType | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [helpStyle, setHelpStyle] = useState<string | null>(null);
  const [workText, setWorkText] = useState('');
  const [attributes, setAttributes] = useState<UnderstandingAttribute[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
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

  /**
   * P13C ROUND 17 · D-5 — THE FIRST-RUN HIGH.
   *
   * This used to call `ai:config.setMode` and `ai:config.setExternalConsent`,
   * with the comment "The ACTUAL routing configuration — not a stored marketing
   * preference." The instinct was right and the authority tier was wrong: both
   * are `cloud:operate`, `platformOperatorRegistry` deliberately never
   * self-seeds, so on a fresh install the first call was refused, the catch
   * swallowed it, and `setStep('workspace')` never ran. The user clicked and
   * nothing happened. No install could complete onboarding.
   *
   * It now writes the ORGANISATION's preference through tenant RBAC. Still not
   * a marketing flag — it is one half of the real routing decision — but it is
   * the half a tenant is allowed to make. `min(platform, tenant)` does the rest.
   */
  const chooseProcessing = async (allowExternal: boolean): Promise<void> => {
    setBusy(true);
    setProcessingError(null);
    try {
      const view = await ipc.aiConfig.setPreference(allowExternal ? 'private_first' : 'local_only');
      setEffectiveMode(view.effectiveMode);
      setRestrictedByPlatform(view.restrictedByPlatform);
      await ipc.firstRun.set({ aiModeChosen: true });
      /**
       * A RESTRICTION IS SHOWN, NOT FLASHED. P13C ROUND 17g.
       *
       * `setStep('workspace')` unmounts this step, and the notice below lives
       * inside it. Advancing unconditionally rendered that notice only in the
       * gap between the state flush before the `await` above and the one after
       * it — a few milliseconds, unreadable. The preference was saved, the
       * platform could not honour it, and the screen moved on: precisely the
       * silent no-op D-5 was written to prevent, reproduced inside the code
       * that prevents it, and invisible to every test because no test mounted
       * this screen.
       *
       * When the platform CAN honour the choice, nothing changes — the step
       * advances as before. When it cannot, the step stays and the user
       * continues with one deliberate click. That is not a dead end, which is
       * the failure this decision started from; the button works. It is an
       * acknowledgement, which is the least a product owes someone whose
       * choice it has just filed away unfulfilled.
       */
      if (!view.restrictedByPlatform) setStep('workspace');
    } catch (err) {
      /**
       * NOT SWALLOWED. The old catch logged to a console nobody was attached to
       * and left the button inert — the failure mode that hid this bug for
       * fourteen rounds. A refusal here is now visible and actionable.
       */
      log.warn('Could not persist AI preference', { message: String(err) });
      setProcessingError(
        'That choice could not be saved. You can continue and set it later in Settings.',
      );
    } finally {
      setBusy(false);
    }
  };

  const chooseWorkspace = async (type: WorkspaceType): Promise<void> => {
    setBusy(true);
    try {
      // Persist the choice immediately (a quit here loses nothing), but do NOT
      // complete yet — discovery and the understanding check come first.
      await ipc.firstRun.set({ workspaceType: type });
      setChosenType(type);
      setWorkspaceType(type);
      setStep('discovery');
    } catch (err) {
      log.warn('Could not persist workspace type', { message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  /** Build the understanding set from the answers given so far. */
  const buildUnderstanding = (): UnderstandingAttribute[] => {
    const at = new Date().toISOString();
    const out: UnderstandingAttribute[] = [];
    if (chosenType) {
      out.push({
        key: 'context',
        label: 'Your context',
        value: WORKSPACE_TYPE_LABELS[chosenType],
        status: 'stated',
        source: 'You chose this during setup.',
        updatedAt: at,
      });
    }
    if (role) {
      out.push({
        key: 'role',
        label: 'You',
        value: role,
        status: 'stated',
        source: 'Your answer to "What best describes you?"',
        updatedAt: at,
      });
    }
    if (helpStyle) {
      out.push({
        key: 'helpStyle',
        label: 'You prefer',
        value: helpStyle,
        status: 'stated',
        source: 'Your answer to "How should NeuroPause help you?"',
        updatedAt: at,
      });
    }
    if (workText.trim()) {
      out.push({
        key: 'workDescription',
        label: 'In your words',
        value: workText.trim(),
        status: 'stated',
        source: 'You typed this.',
        updatedAt: at,
      });
      // DETERMINISTIC inference — every derived belief is marked `inferred`
      // and shown for confirmation. Inferred is never silently a fact.
      for (const inferred of inferFromWorkDescription(workText).attributes) {
        out.push({ ...inferred, status: 'inferred', updatedAt: at });
      }
    }
    return out;
  };

  const finishDiscovery = (): void => {
    setAttributes(buildUnderstanding());
    setStep('understanding');
  };

  const confirmUnderstanding = async (): Promise<void> => {
    setBusy(true);
    try {
      await ipc.firstRun.set({ attributes, state: 'completed' });
      onDone('ai-home');
    } catch (err) {
      log.warn('Could not persist understanding', { message: String(err) });
      setBusy(false);
    }
  };

  const correctAttribute = (key: string): void => {
    const attr = attributes.find((a) => a.key === key);
    if (!attr) return;
    setEditingKey(key);
    setEditValue(attr.value);
  };

  const saveCorrection = (): void => {
    if (!editingKey) return;
    const at = new Date().toISOString();
    setAttributes((list) =>
      list.map((a) =>
        a.key === editingKey
          ? { ...a, value: editValue.trim() || a.value, status: 'corrected', source: 'You corrected this during setup.', updatedAt: at }
          : a,
      ),
    );
    setEditingKey(null);
    setEditValue('');
  };

  const fade = reducedMotion
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25 } };

  return (
    <div
      // `app-bg` is the app's own opaque window background (deep black +
      // accent glow). It has to be an OPAQUE class, not a translucent
      // `--surface-*` token: first run is a full takeover, and anything
      // see-through lets the shell underneath bleed through the copy —
      // the welcome headline lands on top of the AI Home suggestions and
      // both become unreadable.
      className="app-bg fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto"
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
            {processingError !== null && (
              <p
                role="alert"
                className="mt-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-center text-sm text-danger"
              >
                {processingError}
              </p>
            )}
            {restrictedByPlatform && effectiveMode !== null && (
              /**
               * P13C ROUND 17 · D-5 · NO SILENT NO-OP.
               *
               * The organization asked for approved cloud AI and this install's
               * platform policy does not currently permit it. Saying nothing here
               * would replace a hard dead end with a lie, which is worse. The
               * preference IS saved and becomes effective the moment a platform
               * operator enables external processing.
               */
              <div className="mt-6">
                {/*
                 * `role="status"` because this is not an error — nothing failed,
                 * the write succeeded. It is a statement about what the saved
                 * choice will and will not do, and assistive tech should
                 * announce it as one. The error above keeps `role="alert"`; the
                 * two are different events and must not read as the same one.
                 */}
                <p
                  role="status"
                  className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-center text-sm text-warning"
                >
                  Saved. Your organization permits approved cloud AI — but this
                  installation has not enabled external processing, so AI work stays
                  on this device. Effective mode: {AI_MODE_LABELS[effectiveMode]}. Your
                  choice takes effect automatically once a platform operator turns
                  external processing on.
                </p>
                {/*
                 * The step does not advance on its own while this is showing —
                 * see `chooseProcessing`. This button is the whole difference
                 * between telling someone and appearing to.
                 */}
                <div className="mt-4 flex justify-center">
                  <Button variant="primary" autoFocus onClick={() => setStep('workspace')}>
                    Continue
                  </Button>
                </div>
              </div>
            )}
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

        {step === 'discovery' && (
          <motion.div {...fade}>
            <h2 className="text-center text-2xl font-semibold tracking-tight">
              Let&rsquo;s get to know you.
            </h2>
            <p className="mt-2 text-center text-sm text-muted">
              A few answers shape how NeuroPause helps. Everything you say here is stored on this device, shown
              back to you for confirmation, and editable.
            </p>

            {chosenType === 'personal' ? (
              <div className="mt-8 space-y-6">
                <ChipQuestion
                  title="What do you usually want help with?"
                  options={['Learning', 'Research', 'Writing', 'Planning', 'Travel', 'Finance', 'Creativity', 'Organization', 'Entertainment', 'Other']}
                  selected={role}
                  onSelect={setRole}
                />
                <ChipQuestion
                  title="How should NeuroPause help you?"
                  options={['Give me the answer quickly', 'Explain deeply', 'Give me options', 'Help me decide', 'Create something for me']}
                  selected={helpStyle}
                  onSelect={setHelpStyle}
                />
              </div>
            ) : (
              <div className="mt-8 space-y-6">
                <ChipQuestion
                  title="What best describes you?"
                  options={['Founder', 'Business owner', 'Executive', 'Manager', 'Consultant', 'Freelancer', 'Employee', 'Researcher', 'Developer', 'Student', 'Other']}
                  selected={role}
                  onSelect={setRole}
                />
                <div>
                  <h3 className="mb-2 text-sm font-semibold">What do you work on?</h3>
                  <textarea
                    value={workText}
                    onChange={(e) => setWorkText(e.target.value)}
                    rows={3}
                    placeholder="For example: I run a medical-component manufacturing company."
                    className="w-full rounded-xl border border-[var(--hairline)] bg-transparent px-3.5 py-3 text-sm leading-relaxed outline-none placeholder:text-faint focus:border-accent/60"
                    aria-label="What do you work on"
                  />
                  <p className="mt-1.5 text-xs text-faint">
                    NeuroPause may infer your industry from this — anything inferred is marked and shown to you
                    for confirmation, never treated as fact.
                  </p>
                </div>
              </div>
            )}

            <div className="mt-8 flex items-center justify-center gap-3">
              <Button variant="primary" disabled={busy || !role} onClick={finishDiscovery}>
                Continue
              </Button>
              <Button disabled={busy} onClick={finishDiscovery}>
                Skip these questions
              </Button>
            </div>
          </motion.div>
        )}

        {step === 'understanding' && (
          <motion.div {...fade}>
            <h2 className="text-center text-2xl font-semibold tracking-tight">
              Here&rsquo;s what I&rsquo;ve understood about you.
            </h2>
            <p className="mt-2 text-center text-sm text-muted">
              This is NeuroPause&rsquo;s current understanding — not objective truth. Every line shows where it
              came from, and you can correct anything now or later.
            </p>

            <div className="mx-auto mt-8 max-w-[560px] space-y-2">
              {attributes.length === 0 && (
                <p className="text-center text-sm text-faint">
                  Nothing recorded — you skipped the questions, which is fine. NeuroPause will learn as you use it.
                </p>
              )}
              {attributes.map((a) => (
                <div
                  key={a.key}
                  className="rounded-xl border border-[var(--hairline)] px-4 py-3"
                >
                  {editingKey === a.key ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-9 flex-1 rounded-lg border border-[var(--hairline)] bg-transparent px-3 text-sm outline-none focus:border-accent/60"
                        aria-label={`Correct ${a.label}`}
                        autoFocus
                      />
                      <Button size="sm" variant="primary" onClick={saveCorrection}>
                        Save
                      </Button>
                      <Button size="sm" onClick={() => setEditingKey(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-wider text-faint">{a.label}</div>
                        <div className="mt-0.5 text-sm font-medium">{a.value}</div>
                        <div className="mt-1 text-xs text-faint">
                          <span className={a.status === 'inferred' ? 'text-sysorange' : ''}>
                            {ATTRIBUTE_STATUS_LABELS[a.status]}
                          </span>
                          {' · '}
                          {a.source}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-faint underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
                        onClick={() => correctAttribute(a.key)}
                      >
                        Correct
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-8 flex items-center justify-center gap-3">
              <Button variant="primary" disabled={busy} onClick={() => void confirmUnderstanding()}>
                Yes, continue
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function ChipQuestion({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string;
  options: string[];
  selected: string | null;
  onSelect: (value: string) => void;
}): JSX.Element {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={title}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected === option}
            onClick={() => onSelect(option)}
            className={
              selected === option
                ? 'rounded-full border border-accent/60 bg-accent/15 px-3.5 py-1.5 text-sm'
                : 'rounded-full border border-[var(--hairline)] px-3.5 py-1.5 text-sm text-muted hover:text-ink'
            }
          >
            {option}
          </button>
        ))}
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
