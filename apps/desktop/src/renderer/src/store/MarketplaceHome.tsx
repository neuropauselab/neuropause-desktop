import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CategorySummary, StoreAppCard as StoreAppCardDto } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Skeleton } from '@renderer/components/ui/Skeleton';
import { ipc } from '@renderer/lib/ipc';
import { HeroBanner } from './HeroBanner';
import { AppRail } from './AppRail';
import { StoreAppCard } from './StoreAppCard';
import { RAILS } from './sections';

const RESULTS_PAGE = 24;

/** The marketplace landing surface: hero + editorial rails, or search results. */
export function MarketplaceHome(): JSX.Element {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategorySummary[]>([]);

  // Debounce the search box so we don't query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let active = true;
    void ipc.catalog
      .categories()
      .then((res) => {
        if (active) setCategories(res.items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const searching = debounced.length > 0 || category !== null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1240 }}>
        {/* Header + search */}
        <div className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">AI Store</h1>
              <p className="mt-1 text-md text-muted">
                Discover, install, and launch AI — your operating layer for every model and tool.
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3.5 focus-within:shadow-focus">
            <Icon name="search" size={16} className="text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps, agents, MCP servers, and tools"
              className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="text-faint hover:text-ink"
              >
                <Icon name="close" size={15} />
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip active={category === null} onClick={() => setCategory(null)}>
              All
            </Chip>
            {categories.map((c) => (
              <Chip key={c.slug} active={category === c.slug} onClick={() => setCategory(c.slug)}>
                {c.name}
              </Chip>
            ))}
          </div>
        </div>

        {searching ? (
          <SearchResults query={debounced} category={category} />
        ) : (
          <>
            <HeroBanner />
            {RAILS.map((rail) => (
              <AppRail key={rail.id} rail={rail} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:shadow-focus',
        active ? 'bg-accent text-accent-fg' : 'text-muted hover:text-ink [background:var(--fill-1)]',
      )}
    >
      {children}
    </button>
  );
}

/** Paginated search results grid. */
function SearchResults({
  query,
  category,
}: {
  query: string;
  category: string | null;
}): JSX.Element {
  const [items, setItems] = useState<StoreAppCardDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const reqId = useRef(0);

  // Reset + fetch first page whenever the query or category changes.
  useEffect(() => {
    const id = ++reqId.current;
    setItems(null);
    setPage(1);
    void ipc.catalog
      .search({ q: query || undefined, category: category ?? undefined, sort: 'relevance', page: 1, pageSize: RESULTS_PAGE })
      .then((res) => {
        if (reqId.current === id) {
          setItems(res.items);
          setTotal(res.total);
        }
      })
      .catch(() => {
        if (reqId.current === id) {
          setItems([]);
          setTotal(0);
        }
      });
  }, [query, category]);

  const loadMore = async (): Promise<void> => {
    const next = page + 1;
    setLoadingMore(true);
    try {
      const res = await ipc.catalog.search({
        q: query || undefined,
        category: category ?? undefined,
        sort: 'relevance',
        page: next,
        pageSize: RESULTS_PAGE,
      });
      setItems((prev) => [...(prev ?? []), ...res.items]);
      setPage(next);
    } finally {
      setLoadingMore(false);
    }
  };

  const hasMore = useMemo(() => (items ? items.length < total : false), [items, total]);

  if (items === null) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="surface-raised rounded-2xl p-4 shadow-card">
            <Skeleton className="h-[46px] w-[46px] rounded-xl" />
            <Skeleton className="mt-4 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon="search"
        title="No matching apps"
        description="Try a different search or category."
      />
    );
  }

  return (
    <>
      <p className="mb-4 text-xs text-faint">
        {total} {total === 1 ? 'result' : 'results'}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((app) => (
          <StoreAppCard key={app.id} app={app} />
        ))}
      </div>
      {hasMore && (
        <div className="mt-7 flex justify-center">
          <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </>
  );
}
