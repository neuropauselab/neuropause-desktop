import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from './Icon';

type Tone = 'neutral' | 'accent' | 'blue' | 'green' | 'orange' | 'purple' | 'teal' | 'pink';

const TONES: Record<Tone, string> = {
  neutral: '[background:var(--fill-2)] text-muted',
  accent: 'bg-accent/15 text-accent',
  blue: 'bg-sysblue/15 text-sysblue',
  green: 'bg-sysgreen/15 text-sysgreen',
  orange: 'bg-sysorange/15 text-sysorange',
  purple: 'bg-syspurple/15 text-syspurple',
  teal: 'bg-systeal/15 text-systeal',
  pink: 'bg-syspink/15 text-syspink',
};

/** A small status/category pill. */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A keyboard key cap, e.g. ⌘ K. */
export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md border border-[var(--hairline-strong)] [background:var(--fill-1)] px-1.5 font-sans text-xs font-medium text-muted">
      {children}
    </kbd>
  );
}

/** Initials avatar with a stable accent gradient. */
export function Avatar({
  text,
  size = 28,
}: {
  text: string;
  size?: number;
}): JSX.Element {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background:
          'linear-gradient(135deg, rgb(var(--accent)), rgb(var(--c-purple)))',
      }}
    >
      {text}
    </span>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

/** A macOS-style segmented control. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}): JSX.Element {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  return (
    <div className="inline-flex rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-0.5">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={selected}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[10px] font-medium outline-none transition duration-150 focus-visible:shadow-focus',
              pad,
              selected
                ? 'surface-raised text-ink shadow-sm'
                : 'text-muted hover:text-ink',
            )}
          >
            {opt.icon && <Icon name={opt.icon} size={size === 'sm' ? 13 : 14} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
