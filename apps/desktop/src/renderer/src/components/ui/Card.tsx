import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover/press affordances for clickable cards. */
  interactive?: boolean;
  /** Removes default padding when you need full control of the interior. */
  flush?: boolean;
  /**
   * Complete surface preset. Each variant reproduces an existing hand-rolled
   * surface style VERBATIM, so screens can migrate with zero visual change.
   * Default 'raised' is the historical Card appearance (surface-raised + shadow-card).
   * When set, `variant` fully defines the surface and takes precedence over the
   * legacy `surface`/`elevation` props below.
   */
  variant?: CardVariant;
  /** @deprecated Legacy A.2 prop; use `variant`. Retained for backward-compat. */
  surface?: 'base' | 'raised' | 'glass';
  /** @deprecated Legacy A.2 prop; use `variant`. Retained for backward-compat. */
  elevation?: 'card' | 'pop' | 'glass';
  children?: ReactNode;
}

export type CardVariant = 'raised' | 'flat' | 'hairline' | 'glass' | 'floating' | 'dashboard';

/**
 * Each variant's COMPLETE class string — reproducing a real surface used in the
 * app today. Padding is applied separately (respecting `flush`), so these define
 * only radius/border/background/shadow. Verified against the actual inline styles:
 *   - raised    → the standard Card (surface-raised + shadow-card)
 *   - flat      → Executive Center section cards (border-white/5 + bg-white/[0.02])
 *   - hairline  → Decision/Org panels (hairline border + fill-1, no shadow)
 *   - glass     → floating translucent panels (glass material + glass shadow)
 *   - floating  → glass + stronger pop shadow (menus/popovers)
 *   - dashboard → flat surface tuned for dense KPI grids (rounded-xl)
 */
const VARIANT_CLASS: Record<CardVariant, string> = {
  raised: 'surface-raised rounded-2xl shadow-card',
  flat: 'rounded-2xl border border-white/5 bg-white/[0.02]',
  hairline: 'rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)]',
  glass: 'glass rounded-2xl shadow-glass',
  floating: 'glass rounded-2xl shadow-pop',
  dashboard: 'rounded-xl border border-white/5 bg-white/[0.02]',
};

// Legacy A.2 maps retained so existing surface/elevation callers keep working.
const SURFACE_CLASS: Record<NonNullable<CardProps['surface']>, string> = {
  base: 'surface-base',
  raised: 'surface-raised',
  glass: 'glass',
};

const ELEVATION_CLASS: Record<NonNullable<CardProps['elevation']>, string> = {
  card: 'shadow-card',
  pop: 'shadow-pop',
  glass: 'shadow-glass',
};

/** The standard translucent, rounded surface used throughout the shell. */
export function Card({
  interactive = false,
  flush = false,
  variant,
  surface,
  elevation,
  className,
  children,
  ...rest
}: CardProps): JSX.Element {
  // Precedence: an explicit `variant` fully defines the surface. Otherwise fall
  // back to the legacy surface/elevation props (defaulting to the historical
  // raised Card), so every existing caller renders byte-identically.
  const surfaceClasses = variant
    ? VARIANT_CLASS[variant]
    : cn(SURFACE_CLASS[surface ?? 'raised'], 'rounded-2xl', ELEVATION_CLASS[elevation ?? 'card']);

  return (
    <div
      className={cn(
        surfaceClasses,
        !flush && 'p-5',
        interactive &&
          'cursor-pointer transition duration-150 ease-emphasized hover:-translate-y-0.5 hover:shadow-pop active:translate-y-0',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A small, consistent header row for cards: icon chip + title + optional action. */
export function CardHeader({
  icon,
  title,
  tint = 'accent',
  action,
}: {
  icon: ReactNode;
  title: string;
  tint?: 'accent' | 'blue' | 'green' | 'orange' | 'purple' | 'teal' | 'pink';
  action?: ReactNode;
}): JSX.Element {
  const tintBg: Record<string, string> = {
    accent: 'bg-accent/15 text-accent',
    blue: 'bg-sysblue/15 text-sysblue',
    green: 'bg-sysgreen/15 text-sysgreen',
    orange: 'bg-sysorange/15 text-sysorange',
    purple: 'bg-syspurple/15 text-syspurple',
    teal: 'bg-systeal/15 text-systeal',
    pink: 'bg-syspink/15 text-syspink',
  };
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', tintBg[tint])}>
          {icon}
        </span>
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      </div>
      {action}
    </div>
  );
}
