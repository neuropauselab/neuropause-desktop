/**
 * Loading placeholders.
 *
 * A skeleton earns its place by holding the SHAPE of what is coming, so the
 * page does not jump when content lands. That is the whole job — it is not
 * decoration, and it is not a substitute for telling the user something real.
 *
 * When to use which:
 *  - Skeleton: the shape is known and the wait is short. Content will replace
 *    it in place.
 *  - A progress message: the wait is long, or the user needs to know WHAT is
 *    happening ("Importing 4,000 rows…", "Checking for a local model…").
 *    Replacing that with a grey rectangle throws away information.
 */
import { type CSSProperties } from 'react';
import { cn } from '@renderer/lib/cn';

/** A single placeholder block. Sized by the caller to match its real content. */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <div
      className={cn('np-skeleton rounded-lg', className)}
      style={style}
      aria-hidden="true"
    />
  );
}

/** A header chip + title row used at the top of skeleton cards. */
export function SkeletonHeader(): JSX.Element {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <Skeleton className="h-7 w-7 rounded-lg" />
      <Skeleton className="h-4 w-32" />
    </div>
  );
}

/** A run of text-line placeholders. */
export function SkeletonLines({ rows = 3 }: { rows?: number }): JSX.Element {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="flex-1">
            <Skeleton className="mb-1.5 h-3 w-3/4" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A stack of card-shaped placeholders matching the hairline Card geometry used
 * across Holds, Understand and the module screens. Capped at a handful: a
 * skeleton for forty rows is more paint than the real list.
 */
export function SkeletonCards({ count = 3, lines = 2 }: { count?: number; lines?: number }): JSX.Element {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: Math.min(count, 5) }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-[var(--hairline)] px-4 py-3.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-4 w-2/5" />
          {Array.from({ length: lines }).map((__, j) => (
            <Skeleton key={j} className="mt-2 h-2.5" style={{ width: `${70 - j * 15}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The accessible wrapper for a loading region.
 *
 * Skeletons are `aria-hidden` — a screen reader announcing eight grey boxes is
 * noise. This supplies the one thing that is useful instead: a polite live
 * region saying what is loading, replaced by the content when it arrives.
 */
export function SkeletonRegion({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
