import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { FeaturedEntry } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { ipc } from '@renderer/lib/ipc';
import { RatingStars } from './RatingStars';
import { useStore } from './StoreProvider';
import { glyphOf, toTone } from './lib';

/** A rotating, editorial hero across the top of the marketplace. */
export function HeroBanner(): JSX.Element | null {
  const { openDetail } = useStore();
  const [entries, setEntries] = useState<FeaturedEntry[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let active = true;
    void ipc.catalog
      .featured()
      .then((res) => {
        if (active) setEntries(res.items);
      })
      .catch(() => {
        if (active) setEntries([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!entries || entries.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % entries.length), 7000);
    return () => clearInterval(t);
  }, [entries]);

  if (entries === null) {
    return <div className="mb-9 h-[208px] animate-pulse rounded-3xl [background:var(--fill-2)]" />;
  }
  if (entries.length === 0) return null;

  const entry = entries[index % entries.length];
  const tone = toTone(entry.app.iconTone);

  return (
    <div className="relative mb-9">
      <AnimatePresence mode="wait">
        <motion.button
          key={entry.id}
          type="button"
          onClick={() => openDetail(entry.app.slug)}
          initial={{ opacity: 0, scale: 0.99 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          className="relative block w-full overflow-hidden rounded-3xl border border-[var(--hairline)] p-7 text-left outline-none focus-visible:shadow-focus"
        >
          {/* Tinted gradient backdrop derived from the app's tone. */}
          <div className={cn('absolute inset-0 -z-10', HERO_BG[tone])} />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/10 to-transparent" />

          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-white backdrop-blur">
            Featured
          </span>

          <div className="mt-4 flex items-end justify-between gap-6">
            <div className="max-w-[560px]">
              <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">
                {entry.headline}
              </h1>
              {entry.subheadline && (
                <p className="mt-2 text-md text-white/80">{entry.subheadline}</p>
              )}
              <div className="mt-5 flex items-center gap-4">
                <span className="inline-flex items-center gap-2 rounded-xl bg-white/95 px-3 py-1.5 text-sm font-semibold text-black shadow-sm">
                  {entry.ctaLabel ?? 'View app'}
                </span>
                <span className="text-sm font-medium text-white/85">{entry.app.name}</span>
              </div>
            </div>
            <div className="hidden flex-col items-center gap-2 sm:flex">
              <AppGlyph glyph={glyphOf(entry.app)} tone={tone} size={72} radius={20} />
              <RatingStars average={entry.app.rating.average} count={entry.app.rating.count} showValue={false} />
            </div>
          </div>
        </motion.button>
      </AnimatePresence>

      {entries.length > 1 && (
        <div className="absolute bottom-4 right-6 flex gap-1.5">
          {entries.map((e, i) => (
            <button
              key={e.id}
              type="button"
              aria-label={`Show featured ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn(
                'h-1.5 rounded-full transition-[background-color,color,border-color,box-shadow,transform,opacity] motion-reduce:transition-none',
                i === index % entries.length ? 'w-5 bg-white' : 'w-1.5 bg-white/45',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Literal gradient backgrounds per tone.
const HERO_BG: Record<string, string> = {
  accent: 'bg-gradient-to-br from-accent to-syspurple',
  blue: 'bg-gradient-to-br from-sysblue to-systeal',
  green: 'bg-gradient-to-br from-sysgreen to-systeal',
  orange: 'bg-gradient-to-br from-sysorange to-syspink',
  purple: 'bg-gradient-to-br from-syspurple to-accent',
  teal: 'bg-gradient-to-br from-systeal to-sysblue',
  pink: 'bg-gradient-to-br from-syspink to-syspurple',
};
