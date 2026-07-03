/**
 * Small presentational primitives for the Developer Portal: a lightweight modal,
 * labelled form fields, styled inputs, and code blocks with copy. Built on the
 * app's existing tokens so they sit naturally beside the Operations primitives.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal className="surface-raised relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl shadow-card">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline)] px-5 py-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-faint">{subtitle}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-[var(--hairline)] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-2xs text-faint">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2 text-sm outline-none transition focus:border-accent focus-visible:shadow-focus';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input {...props} className={cn(inputCls, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea {...props} className={cn(inputCls, 'font-mono text-xs leading-relaxed', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return <select {...props} className={cn(inputCls, 'appearance-none', props.className)} />;
}

export function InlineCode({ children }: { children: ReactNode }): JSX.Element {
  return <code className="rounded-md [background:var(--fill-2)] px-1.5 py-0.5 font-mono text-2xs text-ink">{children}</code>;
}

export function CodeBlock({ value, label }: { value: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className="relative">
      {label && <div className="mb-1 text-2xs font-medium uppercase tracking-wider text-faint">{label}</div>}
      <pre className="overflow-x-auto rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2.5 font-mono text-xs leading-relaxed text-ink">{value}</pre>
      <button type="button" aria-label="Copy" title={copied ? 'Copied' : 'Copy'} onClick={copy} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink">
        <Icon name={copied ? 'check' : 'clipboard'} size={14} />
      </button>
    </div>
  );
}

export function Stars({ value, count }: { value: number; count?: number }): JSX.Element {
  const full = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" title={count !== undefined ? `${value.toFixed(2)} (${count})` : value.toFixed(2)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name={n <= full ? 'star-fill' : 'star'} size={12} className={n <= full ? 'text-sysorange' : 'text-faint'} />
      ))}
      {count !== undefined && <span className="ml-1 text-2xs text-faint">{count}</span>}
    </span>
  );
}
