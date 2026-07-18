import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  children?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm focus-visible:shadow-focus',
  secondary:
    'surface text-ink hover:[background:var(--fill-1)] focus-visible:shadow-focus',
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
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      className={cn(
        'inline-flex select-none items-center justify-center font-medium outline-none transition duration-100 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
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
        'flex h-8 w-8 items-center justify-center rounded-lg outline-none transition duration-100 active:scale-95 focus-visible:shadow-focus',
        active ? 'fill-active text-ink' : 'text-muted hover:text-ink fill-hover',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
