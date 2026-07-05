import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover/press affordances for clickable cards. */
  interactive?: boolean;
  /** Removes default padding when you need full control of the interior. */
  flush?: boolean;
  /** Surface material. Default 'raised' preserves the existing appearance. */
  surface?: 'base' | 'raised' | 'glass';
  /** Resting shadow. Default 'card' preserves the existing appearance. */
  elevation?: 'card' | 'pop' | 'glass';
  children?: ReactNode;
}

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
  surface = 'raised',
  elevation = 'card',
  className,
  children,
  ...rest
}: CardProps): JSX.Element {
  return (
    <div
      className={cn(
        SURFACE_CLASS[surface],
        'rounded-2xl',
        ELEVATION_CLASS[elevation],
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
