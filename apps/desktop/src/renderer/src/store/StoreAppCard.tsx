import { motion } from 'framer-motion';
import type { StoreAppCard as StoreAppCardDto } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { RatingStars } from './RatingStars';
import { useStore } from './StoreProvider';
import { connectionStatus, glyphOf, pricingLabel, toTone } from './lib';

/**
 * A premium store card. The whole card opens the detail page; the trailing
 * action installs (or opens, if already installed) without navigating.
 */
export function StoreAppCard({
  app,
  className,
}: {
  app: StoreAppCardDto;
  className?: string;
}): JSX.Element {
  const { openDetail, isInstalled, launch } = useStore();
  const installed = isInstalled(app.slug);
  const conn = connectionStatus(app.slug);

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={() => openDetail(app.slug)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail(app.slug);
        }
      }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        'surface-raised group flex w-full cursor-pointer flex-col rounded-2xl p-4 text-left shadow-card outline-none focus-visible:shadow-focus',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AppGlyph glyph={glyphOf(app)} tone={toTone(app.iconTone)} size={46} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-[15px] font-semibold leading-tight">{app.name}</span>
            {app.developer.isVerified && (
              <Icon name="verified" size={14} className="shrink-0 text-sysblue" />
            )}
          </div>
          <div className="truncate text-xs text-faint">{app.developer.name}</div>
          <div className="mt-1">
            <RatingStars average={app.rating.average} count={app.rating.count} size={11} />
          </div>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 min-h-[2.5rem] flex-1 text-sm leading-snug text-muted">
        {app.tagline}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-2xs font-medium text-faint">
          <span className="rounded-md [background:var(--fill-2)] px-1.5 py-0.5 uppercase tracking-wider">
            {pricingLabel(app.pricingKind)}
          </span>
          {conn === 'connected' && (
            <span className="inline-flex items-center gap-1 text-sysgreen">
              <span className="h-1.5 w-1.5 rounded-full bg-sysgreen" /> Connected
            </span>
          )}
        </span>

        {installed ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              launch(app.slug, app.name);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                launch(app.slug, app.name);
              }
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-accent fill-hover"
          >
            <Icon name="launch" size={14} /> Open
          </span>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              openDetail(app.slug);
            }}
          >
            Get
          </Button>
        )}
      </div>
    </motion.div>
  );
}
