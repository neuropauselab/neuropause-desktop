import { Icon } from '@renderer/components/ui/Icon';

/** Five-star rating, rounded to the nearest whole star, with an optional count. */
export function RatingStars({
  average,
  count,
  size = 13,
  showValue = true,
}: {
  average: number;
  count?: number;
  size?: number;
  showValue?: boolean;
}): JSX.Element {
  const filled = Math.round(average);
  return (
    <span className="inline-flex items-center gap-1 text-sysyellow">
      <span className="inline-flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Icon key={i} name={i < filled ? 'star-fill' : 'star'} size={size} />
        ))}
      </span>
      {showValue && (
        <span className="ml-0.5 text-xs font-medium text-muted">
          {count && count > 0 ? average.toFixed(1) : 'New'}
          {count && count > 0 ? <span className="text-faint"> ({count})</span> : null}
        </span>
      )}
    </span>
  );
}
