import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from './Icon';

/**
 * A graceful empty state — an icon, a short headline, and an optional action.
 * Used wherever a list can legitimately be empty, instead of leaving a void.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8' : 'py-16',
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-2xl [background:var(--fill-2)] text-faint',
          compact ? 'h-10 w-10' : 'h-12 w-12',
        )}
      >
        <Icon name={icon} size={compact ? 20 : 24} />
      </span>
      <h3 className={cn('font-semibold', compact ? 'mt-3 text-sm' : 'mt-4 text-base')}>{title}</h3>
      {description && (
        <p className={cn('text-faint', compact ? 'mt-1 max-w-[240px] text-xs' : 'mt-1 max-w-[320px] text-sm')}>
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
