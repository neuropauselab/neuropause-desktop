import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { Icon } from '@renderer/components/ui/Icon';
import { Badge } from '@renderer/components/ui/controls';
import { Button } from '@renderer/components/ui/Button';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { CATALOG, CATEGORIES } from '@renderer/data/catalog';
import type { AppCategory } from '@renderer/data/types';
import { useShell } from '@renderer/state/ShellProvider';

/**
 * Browsable AI catalog. Opening an app launches it in the Workspace. The full
 * marketplace — pricing, ratings, and install management — lands in Phase 3.
 */
export function StoreView(): JSX.Element {
  const { openApp } = useShell();
  const [category, setCategory] = useState<AppCategory | 'All'>('All');

  const apps = useMemo(
    () => (category === 'All' ? CATALOG : CATALOG.filter((a) => a.category === category)),
    [category],
  );

  return (
    <ViewScroll max={1180}>
      <ViewHeader
        title="AI Store"
        subtitle="Discover AI apps and open them in your Workspace. Pricing, ratings, and install management arrive in Phase 3."
        right={<Badge tone="accent">Phase 3 preview</Badge>}
      />

      <div className="mb-6 flex flex-wrap gap-1.5">
        {(['All', ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-medium transition-colors',
              category === c
                ? 'bg-accent text-accent-fg'
                : 'text-muted hover:text-ink [background:var(--fill-1)]',
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {apps.map((app, i) => (
          <motion.div
            key={app.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: i * 0.02 }}
            className="surface-raised flex flex-col rounded-2xl p-5 shadow-card"
          >
            <div className="flex items-start gap-3">
              <AppGlyph glyph={app.glyph} tone={app.tone} size={48} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold">{app.name}</div>
                <div className="truncate text-xs text-faint">{app.developer}</div>
              </div>
              <Badge tone="neutral">{app.category}</Badge>
            </div>
            <p className="mt-3 line-clamp-2 flex-1 text-sm leading-snug text-muted">{app.tagline}</p>
            <div className="mt-4 flex items-center justify-between">
              {app.connected ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sysgreen">
                  <span className="h-1.5 w-1.5 rounded-full bg-sysgreen" /> Connected
                </span>
              ) : (
                <span className="text-xs text-faint">Not connected</span>
              )}
              <Button size="sm" variant="primary" icon="launch" onClick={() => openApp(app.id, app.name)}>
                Open
              </Button>
            </div>
          </motion.div>
        ))}
      </div>
    </ViewScroll>
  );
}
