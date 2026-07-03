import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

/**
 * A lightweight fixed-height list virtualizer. Only the rows in (and near) the
 * viewport are rendered, so a list of hundreds of items stays smooth. Rows are
 * a uniform height; an overscan buffer keeps scrolling free of blank frames.
 *
 * If `height` is omitted, the list fills its parent and measures itself, so it
 * can sit inside a flex column under a static header.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  height,
  gap = 0,
  overscan = 4,
  renderRow,
  className,
  getKey,
}: {
  items: T[];
  rowHeight: number;
  height?: number;
  gap?: number;
  overscan?: number;
  renderRow: (item: T, index: number) => ReactNode;
  className?: string;
  getKey?: (item: T, index: number) => string | number;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [measured, setMeasured] = useState(0);

  // Self-measure when no explicit height is provided.
  useLayoutEffect(() => {
    if (height !== undefined) return;
    const el = containerRef.current;
    if (!el) return;
    const update = (): void => setMeasured(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [height]);

  const viewport = height ?? measured;
  const itemSize = rowHeight + gap;
  const total = items.length;
  const totalHeight = Math.max(0, total * itemSize - gap);

  const start = Math.max(0, Math.floor(scrollTop / itemSize) - overscan);
  const visible = viewport > 0 ? Math.ceil(viewport / itemSize) + overscan * 2 : overscan * 2;
  const end = Math.min(total, start + visible);
  const offsetY = start * itemSize;

  return (
    <div
      ref={containerRef}
      className={cn('overflow-y-auto', className)}
      style={{ height: height ?? '100%' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {items.slice(start, end).map((item, i) => {
            const index = start + i;
            return (
              <div
                key={getKey ? getKey(item, index) : index}
                style={{ height: rowHeight, marginBottom: gap }}
              >
                {renderRow(item, index)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
