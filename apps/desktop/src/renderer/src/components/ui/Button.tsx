import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';
import { AFFORDANCE, CSS_TRANSITION } from '@renderer/lib/motion';
import { Icon, type IconName } from './Icon';
import { Spinner } from '../Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  /** Shows a spinner and disables interaction; preserves layout. Default false. */
  loading?: boolean;
  children?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm focus-visible:shadow-focus',
  secondary: 'surface text-ink hover:[background:var(--fill-1)] focus-visible:shadow-focus',
  ghost: 'text-muted hover:text-ink fill-hover focus-visible:shadow-focus',
  danger: 'text-syspink hover:[background:rgb(var(--c-pink)/0.12)] focus-visible:shadow-focus',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-sm gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-base gap-2 rounded-xl',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium outline-none',
        // Press feedback. `active:scale-[0.98]` is the whole interaction: a
        // button that does not move on press feels like an image of a button,
        // and no amount of hover styling compensates for it.
        'active:scale-[0.98] motion-reduce:active:scale-100',
        CSS_TRANSITION.interactive,
        AFFORDANCE.clickable,
        // NOT `disabled:pointer-events-none`. Removing pointer events gives a
        // disabled control the default arrow cursor, which reads as "this is
        // not a control" rather than "this control is unavailable right now".
        // The browser already blocks activation on a disabled button, so the
        // not-allowed cursor is both safe and more informative.
        AFFORDANCE.disabled,
        AFFORDANCE.busy,
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Spinner size={size === 'sm' ? 14 : 16} />
      ) : (
        icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />
      )}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: number;
  active?: boolean;
}

/** Square, quiet button for toolbars and tab bars. */
export function IconButton({
  icon,
  label,
  size = 18,
  active = false,
  className,
  ...rest
}: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg outline-none focus-visible:shadow-focus',
        'active:scale-95 motion-reduce:active:scale-100',
        CSS_TRANSITION.interactive,
        AFFORDANCE.clickable,
        AFFORDANCE.disabled,
        active ? 'fill-active text-ink' : 'text-muted hover:text-ink fill-hover',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
