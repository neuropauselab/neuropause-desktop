import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Kbd } from '@renderer/components/ui/controls';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { CATALOG, CATEGORIES } from '@renderer/data/catalog';
import type { AppCategory } from '@renderer/data/types';

/** Empty-state / "+" surface for the Workspace: pick an app to open in a tab. */
export function AppLauncher({
  onOpenApp,
}: {
  onOpenApp: (appId: string, title: string) => void;
}): JSX.Element {
  const [category, setCategory] = useState<AppCategory | 'All'>('All');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATALOG.filter((a) => {
      const matchesCat = category === 'All' || a.category === category;
      const matchesQuery =
        !q || a.name.toLowerCase().includes(q) || a.developer.toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });
  }, [category, query]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-8 py-8">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Open an app</h2>
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-md text-muted">
            Launch any AI app in its own tab, or press
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
            to search.
          </p>
        </div>

        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3">
            <Icon name="search" size={16} className="text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps"
              className="flex-1 bg-transparent text-base outline-none placeholder:text-faint"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="mb-5 flex flex-wrap gap-1.5">
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((app, i) => (
            <motion.button
              key={app.id}
              type="button"
              onClick={() => onOpenApp(app.id, app.name)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: i * 0.02 }}
              className="surface-raised group flex items-start gap-3 rounded-2xl p-4 text-left shadow-card transition duration-150 ease-emphasized hover:-translate-y-0.5 hover:shadow-pop"
            >
              <AppGlyph glyph={app.glyph} tone={app.tone} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-base font-semibold">{app.name}</span>
                  {app.connected && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sysgreen" title="Connected" />
                  )}
                </div>
                <div className="truncate text-xs text-faint">{app.developer}</div>
                <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-muted">{app.tagline}</p>
              </div>
              <Icon
                name="arrow-right"
                size={16}
                className="mt-0.5 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-accent"
              />
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
