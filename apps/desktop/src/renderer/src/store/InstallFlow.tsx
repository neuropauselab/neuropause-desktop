import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { NpsProgressEvent, StoreAppDetail } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { Spinner } from '@renderer/components/Spinner';
import { ipc } from '@renderer/lib/ipc';
import { glyphOf, toTone, PERMISSION_META } from './lib';

type Phase = 'review' | 'running' | 'done' | 'error';

interface Step {
  key: string;
  label: string;
  icon: 'package' | 'shield' | 'lock' | 'download' | 'cpu' | 'check';
}

const STEPS: Step[] = [
  { key: 'resolve', label: 'Resolve release', icon: 'package' },
  { key: 'download', label: 'Download package', icon: 'download' },
  { key: 'verify', label: 'Verify integrity', icon: 'shield' },
  { key: 'signature', label: 'Validate signature', icon: 'lock' },
  { key: 'install', label: 'Install & register', icon: 'cpu' },
];

/** Maps an NPS status to how far the visual stepper has progressed. */
function activeStep(status: NpsProgressEvent['status'] | null): number {
  switch (status) {
    case 'queued':
    case 'resolving':
      return 0;
    case 'downloading':
      return 1;
    case 'verifying':
      return 2; // verify + signature animate together
    case 'installing':
      return 4;
    case 'completed':
      return STEPS.length;
    default:
      return 0;
  }
}

export function InstallFlow({
  app,
  onClose,
  onInstalled,
  onLaunch,
}: {
  app: StoreAppDetail;
  onClose: () => void;
  onInstalled: () => void;
  onLaunch: () => void;
}): JSX.Element {
  const [phase, setPhase] = useState<Phase>('review');
  const [event, setEvent] = useState<NpsProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live progress for the stepper animation.
  useEffect(() => {
    const off = ipc.nps.onProgress((e) => {
      if (e.appSlug === app.slug) setEvent(e);
    });
    return off;
  }, [app.slug]);

  const start = async (): Promise<void> => {
    setPhase('running');
    setError(null);
    try {
      const res = await ipc.nps.install({
        slug: app.slug,
        grantedPermissions: app.permissions.map((p) => p.permission),
      });
      if (res.ok) {
        onInstalled();
        setPhase('done');
      } else {
        setError(res.message ?? 'Installation failed.');
        setPhase('error');
      }
    } catch (err) {
      setError((err as Error).message);
      setPhase('error');
    }
  };

  const step = activeStep(event?.status ?? null);
  const tone = toTone(app.iconTone);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="glass-panel relative w-full max-w-[460px] rounded-3xl p-6"
      >
        {/* Header */}
        <div className="flex items-center gap-3.5">
          <AppGlyph glyph={glyphOf(app)} tone={tone} size={52} radius={15} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold">{app.name}</div>
            <div className="truncate text-xs text-faint">{app.developer.name}</div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-faint fill-hover hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <AnimatePresence mode="wait">
          {phase === 'review' && (
            <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="mt-5">
                <h3 className="text-sm font-semibold">Permissions requested</h3>
                {app.permissions.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">
                    This app requests no special permissions.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2.5">
                    {app.permissions.map((p) => {
                      const meta = PERMISSION_META[p.permission];
                      return (
                        <li key={p.permission} className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg [background:var(--fill-2)] text-muted">
                            <Icon name={meta.icon} size={15} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{meta.label}</span>
                              <span
                                className={cn(
                                  'rounded px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider',
                                  p.required
                                    ? 'bg-sysorange/15 text-sysorange'
                                    : '[background:var(--fill-2)] text-faint',
                                )}
                              >
                                {p.required ? 'Required' : 'Optional'}
                              </span>
                            </div>
                            <p className="text-xs text-faint">{p.reason ?? meta.description}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" icon="download" onClick={() => void start()}>
                  Install
                </Button>
              </div>
            </motion.div>
          )}

          {(phase === 'running' || phase === 'done') && (
            <motion.div key="steps" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ol className="mt-5 space-y-1">
                {STEPS.map((s, i) => {
                  const state = phase === 'done' || i < step ? 'done' : i === step ? 'active' : 'pending';
                  return (
                    <li key={s.key} className="flex items-center gap-3 py-1.5">
                      <span
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-full',
                          state === 'done'
                            ? 'bg-sysgreen/15 text-sysgreen'
                            : state === 'active'
                              ? 'bg-accent/15 text-accent'
                              : '[background:var(--fill-2)] text-faint',
                        )}
                      >
                        {state === 'done' ? (
                          <Icon name="check" size={15} />
                        ) : state === 'active' ? (
                          <Spinner size={14} />
                        ) : (
                          <Icon name={s.icon} size={14} />
                        )}
                      </span>
                      <span
                        className={cn(
                          'text-sm',
                          state === 'pending' ? 'text-faint' : 'font-medium text-ink',
                        )}
                      >
                        {s.label}
                      </span>
                    </li>
                  );
                })}
              </ol>

              {phase === 'running' && event?.status === 'downloading' && event.bytesTotal ? (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full [background:var(--fill-2)]">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${Math.round((event.progress ?? 0) * 100)}%` }}
                  />
                </div>
              ) : null}

              {phase === 'done' && (
                <div className="mt-5">
                  <div className="flex items-center gap-2 text-sm font-medium text-sysgreen">
                    <Icon name="check" size={16} /> Installed and added to your registry.
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>
                      Done
                    </Button>
                    <Button variant="primary" icon="launch" onClick={onLaunch}>
                      Open
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {phase === 'error' && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="mt-5 flex items-start gap-3 rounded-xl bg-syspink/10 p-3.5">
                <Icon name="info" size={18} className="mt-0.5 shrink-0 text-syspink" />
                <div>
                  <div className="text-sm font-semibold">Installation didn’t complete</div>
                  <p className="mt-0.5 text-xs text-muted">{error}</p>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
                <Button variant="primary" icon="refresh" onClick={() => void start()}>
                  Try again
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
