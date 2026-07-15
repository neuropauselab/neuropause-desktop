/**
 * P8.6 — a lightweight, dependency-free virtualized list. Only the visible window of
 * fixed-height rows is rendered (plus overscan), padded with spacers so scroll height
 * and position stay exact. The windowing math is the pure, unit-tested `windowRange`.
 * Handles thousands of workers/packages without a new dependency.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { windowRange } from './workforceCenterModel';

export function VirtualList<T>({
  items,
  rowHeight,
  height,
  renderRow,
  rowKey,
  className,
}: {
  items: T[];
  rowHeight: number;
  height: number;
  renderRow: (item: T, index: number) => ReactNode;
  rowKey: (item: T, index: number) => string;
  className?: string;
}): JSX.Element {
  const [scrollTop, setScrollTop] = useState(0);
  const raf = useRef<number | null>(null);
  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setScrollTop(top));
  }, []);
  useEffect(() => () => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
  }, []);

  const { start, end, padTop, padBottom } = windowRange(scrollTop, height, rowHeight, items.length);
  const slice = items.slice(start, end);

  return (
    <div className={className} style={{ height, overflowY: 'auto' }} onScroll={onScroll}>
      <div style={{ height: padTop }} aria-hidden />
      {slice.map((item, i) => (
        <div key={rowKey(item, start + i)} style={{ height: rowHeight }}>
          {renderRow(item, start + i)}
        </div>
      ))}
      <div style={{ height: padBottom }} aria-hidden />
    </div>
  );
}
