import { useRef } from 'react';
import type { Screenshot } from '@neuropause/shared';
import { Icon } from '@renderer/components/ui/Icon';
import { StoreImage } from './StoreImage';

/** A horizontal, snap-scrolling gallery of app screenshots. */
export function ScreenshotCarousel({ shots }: { shots: Screenshot[] }): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  if (shots.length === 0) return null;

  const nudge = (dir: 1 | -1): void => ref.current?.scrollBy({ left: dir * 640, behavior: 'smooth' });

  return (
    <div className="group relative">
      <div
        ref={ref}
        className="flex snap-x gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {shots.map((s) => (
          <div key={s.id} className="aspect-[16/10] w-[440px] shrink-0 snap-start">
            <StoreImage
              src={s.url}
              alt={s.caption ?? 'Screenshot'}
              className="h-full w-full"
              rounded="rounded-2xl border border-[var(--hairline)]"
            />
          </div>
        ))}
      </div>
      {shots.length > 1 && (
        <>
          <CarouselButton side="left" onClick={() => nudge(-1)} />
          <CarouselButton side="right" onClick={() => nudge(1)} />
        </>
      )}
    </div>
  );
}

function CarouselButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Previous' : 'Next'}
      onClick={onClick}
      className={`absolute top-1/2 ${
        side === 'left' ? 'left-2' : 'right-2'
      } flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--hairline)] opacity-0 shadow-card backdrop-blur transition-opacity group-hover:opacity-100 [background:var(--glass)]`}
    >
      <Icon name={side === 'left' ? 'chevron-left' : 'chevron-right'} size={18} />
    </button>
  );
}
