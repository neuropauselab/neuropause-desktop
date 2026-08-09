/**
 * Pill-geometry segmented tabs + chips — the shared monochrome tab primitives.
 *
 * Geometry (per the restyle spec):
 *  - Container: inline-flex, width:fit-content ("hugs" its items — never full-width),
 *    3px padding, --pill-track background, 1px --border, fully rounded.
 *  - Items: 30px tall, 0 14px padding, 4px gap, nowrap, fully rounded.
 *  - Active: white bg / black fg / 600. Inactive: transparent / --text-2, hover lifts.
 *  - Overflow: horizontal scroll, hidden scrollbar, edge fade — never wraps.
 *  - Count badges: inner mini-pill, tabular-nums, tint flips on active (black-on-white).
 * Monochrome only; the sole colors are #000/#FFF/alpha via CSS vars.
 */
import { useId, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { AFFORDANCE, INDICATOR_SPRING } from '@renderer/lib/motion';
import { Icon, type IconName } from './Icon';

export interface SegmentedTabItem<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
  count?: number;
}

/** A horizontally-scrolling, hug-width pill tab row. */
export function SegmentedTabs<T extends string>({
  items,
  activeId,
  onChange,
  ariaLabel,
}: {
  items: SegmentedTabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
}): JSX.Element {
  // `layoutId` must be unique per tab row. Two SegmentedTabs on one screen
  // sharing an id would make the indicator fly between them — a genuinely
  // baffling effect, and one that only shows up on the screens that happen to
  // render two rows.
  const indicatorId = `pill-indicator-${useId()}`;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="np-pill-track inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto"
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn('np-pill-item relative', AFFORDANCE.clickable, active && 'np-pill-item--active')}
          >
            {active && (
              <motion.span
                layoutId={indicatorId}
                transition={INDICATOR_SPRING}
                className="np-pill-indicator"
                aria-hidden="true"
              />
            )}
            {item.icon && <Icon name={item.icon} size={14} className="relative z-10" />}
            <span className="relative z-10">{item.label}</span>
            {typeof item.count === 'number' && (
              <span className={cn('np-pill-count relative z-10', active && 'np-pill-count--active')}>
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A single standalone filter chip (same geometry as a tab item). */
export function Chip({
  label,
  count,
  active,
  onClick,
  icon,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  icon?: IconName;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('np-pill-item', AFFORDANCE.clickable, active && 'np-pill-item--active np-chip--active')}
    >
      {icon && <Icon name={icon} size={14} />}
      <span>{label}</span>
      {typeof count === 'number' && (
        <span className={cn('np-pill-count', active && 'np-pill-count--active')}>{count}</span>
      )}
    </button>
  );
}

/** A hug-width row wrapper for standalone chips with overflow scroll. */
export function ChipRow({ children }: { children: ReactNode }): JSX.Element {
  return <div className="np-pill-track inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto">{children}</div>;
}
