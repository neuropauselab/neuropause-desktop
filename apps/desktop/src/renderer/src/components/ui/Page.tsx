import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

/** Standard scrollable view container with a centered, padded column. */
export function ViewScroll({
  children,
  max = 1100,
  className,
}: {
  children: ReactNode;
  max?: number;
  className?: string;
}): JSX.Element {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn('mx-auto px-8 py-7', className)} style={{ maxWidth: max }}>
        {children}
      </div>
    </div>
  );
}

/** Consistent page heading with optional subtitle and right-aligned action. */
export function ViewHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-[640px] text-md text-muted">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
