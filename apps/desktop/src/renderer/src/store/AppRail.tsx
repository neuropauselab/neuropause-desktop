import { useEffect, useRef, useState } from 'react';
import type { StoreAppCard as StoreAppCardDto } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Skeleton } from '@renderer/components/ui/Skeleton';
import { ipc } from '@renderer/lib/ipc';
import type { RailDef } from './sections';
import { StoreAppCard } from './StoreAppCard';
import { TONE_TINT } from './lib';

const PAGE = 12;

/**
 * A horizontally-scrolling shelf of apps. It fetches lazily — only once it
 * scrolls near the viewport (IntersectionObserver) — and hides itself entirely
 * if the source returns nothing, so the home never shows an empty shelf.
 */
export function AppRail({ rail }: { rail: RailDef }): JSX.Element | null {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [apps, setApps] = useState<StoreAppCardDto[] | null>(null);
  const [armed, setArmed] = useState(false);

  // Arm fetching when the rail nears the viewport.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || armed) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArmed(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [armed]);

  useEffect(() => {
    if (!armed) return;
    let active = true;
    const load =
      rail.source.kind === 'section'
        ? ipc.catalog.sections(rail.source.key, 1, PAGE)
        : ipc.catalog.search({ ...rail.source.params, page: 1, pageSize: PAGE });
    void load
      .then((res) => {
        if (active) setApps(res.items);
      })
      .catch(() => {
        if (active) setApps([]);
      });
    return () => {
      active = false;
    };
  }, [armed, rail]);

  const nudge = (dir: 1 | -1): void => {
    scrollerRef.current?.scrollBy({ left: dir * 560, behavior: 'smooth' });
  };

  // Hide the rail once we know it's empty.
  if (apps !== null && apps.length === 0) return null;

  return (
    <section ref={rootRef} className="mb-9">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TONE_TINT[rail.tone])}>
            <Icon name={rail.icon} size={16} />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold leading-tight tracking-tight">{rail.title}</h2>
            <p className="text-xs text-faint">{rail.subtitle}</p>
          </div>
        </div>
        <div className="hidden gap-1 sm:flex">
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => nudge(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink"
          >
            <Icon name="chevron-left" size={16} />
          </button>
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => nudge(1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink"
          >
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {apps === null
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="w-[266px] shrink-0 snap-start">
                <RailCardSkeleton />
              </div>
            ))
          : apps.map((app) => (
              <div key={app.id} className="w-[266px] shrink-0 snap-start">
                <StoreAppCard app={app} />
              </div>
            ))}
      </div>
    </section>
  );
}

function RailCardSkeleton(): JSX.Element {
  return (
    <div className="surface-raised rounded-2xl p-4 shadow-card">
      <div className="flex items-start gap-3">
        <Skeleton className="h-[46px] w-[46px] rounded-xl" />
        <div className="flex-1">
          <Skeleton className="mb-1.5 h-3.5 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>
      <Skeleton className="mt-4 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-2/3" />
      <div className="mt-4 flex items-center justify-between">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-7 w-12 rounded-lg" />
      </div>
    </div>
  );
}

