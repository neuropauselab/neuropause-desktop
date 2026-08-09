/**
 * Enterprise Toast system — a real, renderer-only transient-notification layer. There is no existing toast
 * infrastructure to reuse (the notification bell is a persisted inbox; `notificationScheduler` fires OS
 * notifications from main), so this is built fresh on the shared deterministic queue (`enqueueToast` /
 * dismiss / cap / dedupe from `@neuropause/shared`). It supports success / info / warning / error, timed
 * auto-dismiss (errors are persistent), de-duplication by key, a real action button (Undo / Retry with a
 * live callback), and pause-on-hover. Nothing here is faked — every toast is pushed by real code paths.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  defaultToastDuration,
  dismissAllToasts,
  dismissToast,
  enqueueToast,
  type ToastModel,
  type ToastSeverity,
} from '@neuropause/shared';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { AFFORDANCE, CSS_TRANSITION, toastVariants } from '@renderer/lib/motion';

interface LiveToast extends ToastModel {
  onAction?: () => void;
}
export interface ToastOptions {
  severity?: ToastSeverity;
  title: string;
  message?: string;
  durationMs?: number;
  dedupeKey?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextValue {
  toasts: LiveToast[];
  push: (opts: ToastOptions) => string;
  success: (title: string, opts?: Partial<ToastOptions>) => string;
  info: (title: string, opts?: Partial<ToastOptions>) => string;
  warning: (title: string, opts?: Partial<ToastOptions>) => string;
  error: (title: string, opts?: Partial<ToastOptions>) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let seq = 0;
const genId = (): string => `t_${Date.now().toString(36)}_${(seq++).toString(36)}`;

const SEVERITY_META: Record<ToastSeverity, { icon: IconName; color: string }> = {
  success: { icon: 'check', color: '#46a758' },
  info: { icon: 'info', color: '#6e8fd6' },
  warning: { icon: 'bolt', color: '#f5a623' },
  error: { icon: 'stop', color: '#e5484d' },
};

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<LiveToast[]>([]);

  const dismiss = useCallback((id: string) => setToasts((list) => dismissToast(list, id)), []);
  const dismissAll = useCallback(() => setToasts((list) => dismissAllToasts(list)), []);

  const push = useCallback((opts: ToastOptions): string => {
    const severity = opts.severity ?? 'info';
    const id = genId();
    const toast: LiveToast = {
      id,
      severity,
      title: opts.title,
      message: opts.message,
      durationMs: opts.durationMs ?? defaultToastDuration(severity),
      dedupeKey: opts.dedupeKey,
      actionLabel: opts.actionLabel,
      onAction: opts.onAction,
      createdAt: Date.now(),
    };
    setToasts((list) => enqueueToast(list, toast));
    return id;
  }, []);

  // Stable helper refs so consumers can list them in effect deps without churn.
  const success = useCallback((title: string, opts?: Partial<ToastOptions>) => push({ ...opts, severity: 'success', title }), [push]);
  const info = useCallback((title: string, opts?: Partial<ToastOptions>) => push({ ...opts, severity: 'info', title }), [push]);
  const warning = useCallback((title: string, opts?: Partial<ToastOptions>) => push({ ...opts, severity: 'warning', title }), [push]);
  const error = useCallback((title: string, opts?: Partial<ToastOptions>) => push({ ...opts, severity: 'error', title }), [push]);

  const value: ToastContextValue = { toasts, push, success, info, warning, error, dismiss, dismissAll };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

/* ── viewport ────────────────────────────────────────────────────────────────────── */

function ToastViewport({ toasts, onDismiss }: { toasts: LiveToast[]; onDismiss: (id: string) => void }): JSX.Element {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: LiveToast; onDismiss: (id: string) => void }): JSX.Element {
  const meta = SEVERITY_META[toast.severity];
  const paused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = (): void => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const arm = useCallback(() => {
    clear();
    if (toast.durationMs > 0 && !paused.current) timer.current = setTimeout(() => onDismiss(toast.id), toast.durationMs);
  }, [toast.durationMs, toast.id, onDismiss]);

  useEffect(() => {
    arm();
    return clear;
  }, [arm]);

  return (
    <motion.div
      // `layout` is what makes the stack behave like a tray: dismissing the
      // middle toast slides the ones below up instead of teleporting them.
      layout
      variants={toastVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      onMouseEnter={() => { paused.current = true; clear(); }}
      onMouseLeave={() => { paused.current = false; arm(); }}
      // Keyboard users need the same reprieve as the mouse: focusing anything
      // inside a toast must stop the countdown, or the Undo button disappears
      // while they are tabbing to it.
      onFocusCapture={() => { paused.current = true; clear(); }}
      onBlurCapture={() => { paused.current = false; arm(); }}
      className="glass-panel pointer-events-auto overflow-hidden rounded-xl shadow-glass"
      // An error is not a status update — it needs to interrupt. Everything
      // else is polite so a success toast does not cut across what the screen
      // reader is currently saying.
      role={toast.severity === 'error' ? 'alert' : 'status'}
      aria-live={toast.severity === 'error' ? 'assertive' : 'polite'}
    >
      <div className="flex items-start gap-3 border-l-2 p-3" style={{ borderColor: meta.color }}>
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md" style={{ color: meta.color, background: `${meta.color}1f` }}>
          <Icon name={meta.icon} size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">{toast.title}</div>
          {toast.message && <div className="mt-0.5 text-xs leading-snug text-muted">{toast.message}</div>}
          {toast.actionLabel && toast.onAction && (
            <button
              type="button"
              onClick={() => { toast.onAction?.(); onDismiss(toast.id); }}
              className={`mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-accent outline-none hover:text-accent-hover focus-visible:shadow-focus ${CSS_TRANSITION.colors} ${AFFORDANCE.clickable}`}
            >
              <Icon name={toast.actionLabel.toLowerCase() === 'undo' ? 'undo' : 'refresh'} size={12} /> {toast.actionLabel}
            </button>
          )}
        </div>
        <button type="button" aria-label="Dismiss" onClick={() => onDismiss(toast.id)} className={`shrink-0 rounded-md p-0.5 text-faint outline-none hover:text-ink focus-visible:shadow-focus ${CSS_TRANSITION.colors} ${AFFORDANCE.clickable}`}>
          <Icon name="close" size={14} />
        </button>
      </div>
    </motion.div>
  );
}
