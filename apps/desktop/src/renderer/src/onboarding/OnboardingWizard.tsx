/**
 * The first-run onboarding wizard. Renders as a modal overlay only when the
 * persisted onboarding state reports firstRun; walks the shared step catalog.
 * "Continue" completes the current step; steps with a destination offer a
 * "Take me there" that completes the step, deep-links into the existing view
 * (Organization, Connectors, Operations diagnostics), and closes the wizard —
 * the welcome checklist picks up whatever remains. "Skip tour" dismisses without
 * marking steps complete. All state lives in the main process via ipc.onboarding.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { OnboardingStatus } from '@neuropause/shared';
import type { OnboardingStepId } from '@neuropause/shared';
import type { SectionId } from '@renderer/shell/sections';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { Button } from '@renderer/components/ui/Button';

const log = createLogger('onboarding');

const STEP_LINKS: Partial<Record<OnboardingStepId, { section: SectionId; label: string }>> = {
  organization: { section: 'organization', label: 'Open Organization' },
  connectors: { section: 'connectors', label: 'Open Connectors' },
  ai_setup: { section: 'operations', label: 'Open Operations' },
};

export function OnboardingWizard({ onGoTo }: { onGoTo: (section: SectionId) => void }) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    ipc.onboarding
      .status()
      .then((s) => {
        if (!mounted) return;
        setStatus(s);
        if (s.firstRun) {
          setOpen(true);
          ipc.onboarding
            .start()
            .then((started) => {
              if (mounted) setStatus(started);
            })
            .catch(() => undefined);
        }
      })
      .catch((err) => log.warn('Onboarding status unavailable', err));
    return () => {
      mounted = false;
    };
  }, []);

  if (!open || !status) return null;
  const step = status.steps.find((s) => s.id === status.nextStep) ?? null;
  if (!step) return null;
  const index = status.steps.findIndex((s) => s.id === step.id);
  const total = status.steps.length;
  const link = STEP_LINKS[step.id];
  const last = index === total - 1;

  const complete = async (navigate: boolean) => {
    setBusy(true);
    try {
      const next = await ipc.onboarding.completeStep(step.id);
      setStatus(next);
      if (navigate && link) {
        onGoTo(link.section);
        setOpen(false);
      } else if (!next.nextStep) {
        setOpen(false);
      }
    } catch (err) {
      log.warn('Could not complete onboarding step', err);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await ipc.onboarding.dismiss();
    } catch (err) {
      log.warn('Could not dismiss onboarding', err);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to NeuroPause"
      >
        <motion.div
          className="surface w-[440px] max-w-[calc(100vw-48px)] rounded-2xl p-6 shadow-xl"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
        >
          <div className="mb-4 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Early access setup · step {index + 1} of {total}
            </span>
            <div className="flex gap-1.5" aria-hidden="true">
              {status.steps.map((s, i) => (
                <span
                  key={s.id}
                  className={`h-1.5 w-1.5 rounded-full ${
                    i < index ? 'bg-accent' : i === index ? 'bg-accent/80' : 'bg-muted/30'
                  }`}
                />
              ))}
            </div>
          </div>

          <h2 className="mb-2 text-lg font-semibold text-ink">{step.title}</h2>
          <p className="mb-6 text-sm leading-relaxed text-muted">{step.description}</p>

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void dismiss()}>
              Skip tour
            </Button>
            <div className="flex gap-2">
              {link ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void complete(true)}
                >
                  {link.label}
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => void complete(false)}
              >
                {last ? 'Finish' : 'Continue'}
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
