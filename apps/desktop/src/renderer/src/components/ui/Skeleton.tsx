import { type CSSProperties } from 'react';
import { cn } from '@renderer/lib/cn';

/** A single shimmering placeholder block. */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}): JSX.Element {
  return <div className={cn('animate-pulse rounded-lg [background:var(--fill-2)]', className)} style={style} />;
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
