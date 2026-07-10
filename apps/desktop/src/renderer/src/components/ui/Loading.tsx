/**
 * Loading — the single renderer entry point for premium, content-shaped loading placeholders. It turns the
 * pure shared `loadingSpec` (page/module/section/panel/dialog/table/card/list/background) into the EXISTING
 * Skeleton primitives — it does NOT introduce a new skeleton or loading framework. Two usages:
 *   • Bare skeleton (early-return):  <Loading kind="panel" cards={6} />
 *   • Async wrapper (real gate):     <Loading kind="table" pending={loading}>{content}</Loading>
 * In wrapper mode the skeleton shows ONLY while `pending` is true (real async), then the children render.
 */
import type { ReactNode } from 'react';
import { loadingSpec, type LoadingKind, type LoadingSpec } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Skeleton, SkeletonHeader, SkeletonLines } from '@renderer/components/ui/Skeleton';

interface LoadingProps {
  kind?: LoadingKind;
  /** When children are provided, they render once `pending` is false; the skeleton shows while pending. */
  pending?: boolean;
  rows?: number;
  columns?: number;
  cards?: number;
  header?: boolean;
  label?: string;
  className?: string;
  children?: ReactNode;
}

export function Loading({
  kind = 'section',
  pending,
  rows,
  columns,
  cards,
  header,
  label,
  className,
  children,
}: LoadingProps): JSX.Element {
  // Wrapper mode: real async gate — reveal children as soon as the work is done.
  if (children !== undefined && !pending) return <>{children}</>;
  const spec = loadingSpec(kind, { rows, columns, cards, header, label });
  return (
    <div role="status" aria-busy="true" aria-label={spec.label} className={cn(className)}>
      <span className="sr-only">{spec.label}</span>
      <SkeletonBody spec={spec} />
    </div>
  );
}

function CardGrid({ cards }: { cards: number }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: cards }, (_, i) => `c${i}`).map((k) => (
        <Skeleton key={k} className="h-24 w-full" />
      ))}
    </div>
  );
}

function TableSkeleton({
  rows,
  columns,
  header,
}: {
  rows: number;
  columns: number;
  header: boolean;
}): JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
      {header && (
        <div className="flex gap-3 border-b border-[var(--hairline)] px-3.5 py-2.5">
          {Array.from({ length: columns }, (_, i) => `h${i}`).map((k) => (
            <Skeleton key={k} className="h-3.5 flex-1" />
          ))}
        </div>
      )}
      {Array.from({ length: rows }, (_, r) => `r${r}`).map((rk) => (
        <div
          key={rk}
          className="flex gap-3 border-b border-[var(--hairline)] px-3.5 py-3 last:border-b-0"
        >
          {Array.from({ length: columns }, (_, c) => `${rk}c${c}`).map((ck) => (
            <Skeleton key={ck} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

function SkeletonBody({ spec }: { spec: LoadingSpec }): JSX.Element {
  switch (spec.variant) {
    case 'card':
      return <Skeleton className="h-28 w-full" />;
    case 'inline':
      return <Skeleton className="h-4 w-32" />;
    case 'grid':
      return <CardGrid cards={spec.cards} />;
    case 'table':
      return <TableSkeleton rows={spec.rows} columns={spec.columns} header={spec.header} />;
    case 'lines':
      return (
        <div className="space-y-4">
          {spec.header && <SkeletonHeader />}
          <SkeletonLines rows={spec.rows} />
        </div>
      );
    case 'stack':
    default:
      return (
        <div className="space-y-4">
          {spec.header && <SkeletonHeader />}
          {spec.cards > 0 && <CardGrid cards={spec.cards} />}
          {spec.rows > 0 && <SkeletonLines rows={spec.rows} />}
        </div>
      );
  }
}
