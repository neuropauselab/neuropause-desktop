/**
 * BusinessFamilySection — one business family's landing page, plus drill-down into a module's records.
 *
 * Everything here is a projection over EXISTING production IPC — no new store, no new engine:
 *   • KPIs            → the module registry summaries (`recordCount` / `activeCount`).
 *   • Quick actions   → the real generic create flow (`EnterpriseModuleScreen` opened in create mode).
 *   • Scoped search   → `enterprise:module.search`, fanned out across the family's modules and merged.
 *   • Recent records  → `enterprise:module.list` sorted by the entity's real `updatedAt`.
 *   • Recent activity → the unified `enterprise:timeline.query`, filtered to the family's module ids.
 *   • Favorites       → the real persisted personalization store (`enterprise:personalization.*`).
 *
 * Opening a module renders the existing `EnterpriseModuleScreen` VERBATIM — that is where the real
 * per-record AI insight, custom record actions, detail and form already live. There is no family-level AI
 * panel because there is no family-level AI API; fabricating one would violate the authenticity mandate.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  EnterpriseEntity,
  EnterpriseModuleSummary,
  EnterpriseTimelineEntry,
  FavoriteItem,
  PersonalizationState,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { useToast } from '@renderer/state/ToastProvider';
import { cn } from '@renderer/lib/cn';
import { Card } from '@renderer/components/ui/Card';
import { Button } from '@renderer/components/ui/Button';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { SkeletonLines } from '@renderer/components/ui/Skeleton';
import { formatRelative } from '@renderer/lib/format';
import { EnterpriseModuleScreen } from '@renderer/enterprise/modules/EnterpriseModuleScreen';
import { FamilyDashboard } from './FamilyDashboard';
import {
  BUSINESS_FAVORITE_KIND,
  businessFavoriteId,
  familyModuleIds,
  moduleIdFromBusinessFavorite,
  type BusinessFamilyGroup,
} from './businessModel';

interface OpenIntent {
  moduleId: string;
  create: boolean;
  query?: string;
  /** Bumped on every open so the module screen remounts (fresh create / fresh pre-filter). */
  nonce: number;
}

export function BusinessFamilySection({
  family,
  initialModuleId,
  onConsumeInitial,
}: {
  family: BusinessFamilyGroup;
  initialModuleId?: string | null;
  onConsumeInitial?: () => void;
}): JSX.Element {
  const [intent, setIntent] = useState<OpenIntent | null>(null);

  const openModule = useCallback(
    (moduleId: string, opts?: { create?: boolean; query?: string }) =>
      setIntent((prev) => ({
        moduleId,
        create: opts?.create ?? false,
        query: opts?.query,
        nonce: (prev?.nonce ?? 0) + 1,
      })),
    [],
  );

  // Consume a one-shot deep-link into a specific module of this family (command palette / search).
  useEffect(() => {
    if (initialModuleId && family.modules.some((m) => m.id === initialModuleId)) {
      openModule(initialModuleId);
      onConsumeInitial?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialModuleId, family.meta.group]);

  const activeModule = intent ? (family.modules.find((m) => m.id === intent.moduleId) ?? null) : null;

  if (intent && activeModule) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setIntent(null)}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
        >
          <Icon name="chevron-left" size={15} /> {family.meta.label}
        </button>
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight">{activeModule.title}</h2>
          {activeModule.description && (
            <p className="mt-0.5 text-md text-muted">{activeModule.description}</p>
          )}
        </div>
        <EnterpriseModuleScreen
          key={`${intent.moduleId}:${intent.nonce}`}
          module={activeModule}
          initialCreate={intent.create}
          initialQuery={intent.query ?? ''}
        />
      </div>
    );
  }

  return <FamilyLanding family={family} onOpen={openModule} />;
}

type OpenModule = (moduleId: string, opts?: { create?: boolean; query?: string }) => void;

function FamilyLanding({ family, onOpen }: { family: BusinessFamilyGroup; onOpen: OpenModule }): JSX.Element {
  const moduleIds = useMemo(() => familyModuleIds(family), [family]);
  const familyKey = moduleIds.join(',');

  const [recent, setRecent] = useState<{ entity: EnterpriseEntity; module: EnterpriseModuleSummary }[] | null>(null);
  const [activity, setActivity] = useState<EnterpriseTimelineEntry[] | null>(null);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const { error: raiseError } = useToast();

  // Load recent records + recent activity + favorites for this family — all from existing IPC.
  useEffect(() => {
    let alive = true;
    setRecent(null);
    setActivity(null);
    void (async () => {
      const perModule = await Promise.all(
        family.modules.map(async (m) => {
          const rows = await ipc.enterpriseModules
            .records(m.id, { limit: 5 })
            .catch(() => [] as EnterpriseEntity[]);
          return rows.map((entity) => ({ entity, module: m }));
        }),
      );
      if (alive) {
        const merged = perModule
          .flat()
          .sort((a, b) => b.entity.updatedAt.localeCompare(a.entity.updatedAt))
          .slice(0, 6);
        setRecent(merged);
      }

      const page = await ipc.enterpriseTimeline.query({ order: 'desc', limit: 100 }).catch(() => null);
      if (alive) {
        const ids = new Set(moduleIds);
        setActivity((page?.entries ?? []).filter((e) => e.sourceModule !== null && ids.has(e.sourceModule)).slice(0, 6));
      }

      const pers = await ipc.enterprise.personalization.get().catch(() => null);
      if (alive && pers) {
        const ids = new Set(moduleIds);
        setFavorites(pers.favorites.filter((f) => f.kind === BUSINESS_FAVORITE_KIND && ids.has(moduleIdFromBusinessFavorite(f.id))));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyKey]);

  const toggleFavorite = useCallback(
    async (m: EnterpriseModuleSummary, wasFavorite: boolean) => {
      // D-7b Site 4 — a refused favorite must SPEAK. `personalization.favorite`
      // is `dashboard:read` + requireAuth, so a not-signed-in / non-member /
      // under-permissioned actor is REJECTED at the secure-bridge boundary; the
      // old `.catch(() => null)` + `if (state)` guard swallowed it, so the star
      // click did nothing and said nothing. The `try` is scoped to the awaited
      // write alone, so the success `setFavorites` below can never raise a false
      // failure toast — and the star (derived from `favorites`) is never updated
      // optimistically, so on failure it correctly stays put.
      let state: PersonalizationState;
      try {
        state = await ipc.enterprise.personalization.favorite({
          id: businessFavoriteId(m.id),
          kind: BUSINESS_FAVORITE_KIND,
          label: m.title,
          tab: 'business',
        });
      } catch (err) {
        // Verbatim boundary message (the D-6 `invoke` wrapper already restored the
        // clean text); a persistent, announced (role="alert") error toast, keyed
        // per module so failures on different modules don't overwrite one another.
        raiseError(wasFavorite ? `Couldn’t remove ${m.title} from favorites` : `Couldn’t favorite ${m.title}`, {
          message: err instanceof Error && err.message ? err.message : 'The request failed.',
          dedupeKey: `business-favorite:${m.id}`,
        });
        return;
      }
      const ids = new Set(moduleIds);
      setFavorites(state.favorites.filter((f) => f.kind === BUSINESS_FAVORITE_KIND && ids.has(moduleIdFromBusinessFavorite(f.id))));
    },
    [moduleIds, raiseError],
  );

  const favoriteModuleIds = useMemo(
    () => new Set(favorites.map((f) => moduleIdFromBusinessFavorite(f.id))),
    [favorites],
  );

  return (
    <div className="space-y-6">
      {/* Header + real KPIs */}
      <div>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Icon name={family.meta.icon} size={18} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{family.meta.label}</h1>
            <p className="text-sm text-faint">{family.meta.blurb}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Kpi label="Records" value={family.recordCount} />
          <Kpi label="Active" value={family.activeCount} />
          <Kpi label="Modules" value={family.modules.length} />
          {family.hasAi && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-xs text-muted">
              <Icon name="sparkles" size={12} /> AI insights on records
            </span>
          )}
          <span
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-2xs text-faint"
            title="The RBAC scope enforced on this family's records (main process)"
          >
            <Icon name="shield" size={11} /> {family.meta.permission}
          </span>
        </div>
      </div>

      {/* Phase 7.2 — the live family dashboard (real records via the generic IPC). */}
      <FamilyDashboard family={family} />

      {/* Scoped search across the family's modules */}
      <ScopedSearch family={family} onOpen={onOpen} />

      {/* Quick actions — the real generic create flow, per module */}
      <div>
        <SectionLabel>Quick actions</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {family.modules.map((m) => (
            <Button key={m.id} size="sm" variant="ghost" icon="plus" onClick={() => onOpen(m.id, { create: true })}>
              New {m.singular}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PanelCard title="Modules" icon="grid">
          <div className="space-y-0.5">
            {family.modules.map((m) => {
              const fav = favoriteModuleIds.has(m.id);
              return (
                <div key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 fill-hover">
                  <Icon name={(m.icon || 'grid') as IconName} size={15} className="text-muted" />
                  <button type="button" onClick={() => onOpen(m.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium text-ink">{m.title}</span>
                  </button>
                  <span className="text-2xs tabular-nums text-faint" title="Active records">{m.activeCount}</span>
                  <button
                    type="button"
                    aria-label={fav ? `Unfavorite ${m.title}` : `Favorite ${m.title}`}
                    onClick={() => void toggleFavorite(m, fav)}
                    className={cn('rounded p-1 transition-colors', fav ? 'text-accent' : 'text-faint hover:text-muted')}
                  >
                    <Icon name={fav ? 'star-fill' : 'star'} size={14} />
                  </button>
                  <button type="button" aria-label={`Open ${m.title}`} onClick={() => onOpen(m.id)} className="text-faint transition-colors hover:text-ink">
                    <Icon name="arrow-right" size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </PanelCard>

        <PanelCard title="Recent records" icon="clock">
          {recent === null ? (
            <SkeletonLines rows={4} />
          ) : recent.length === 0 ? (
            <Empty>No records yet.</Empty>
          ) : (
            <div className="space-y-0.5">
              {recent.map(({ entity, module }) => (
                <button
                  key={`${module.id}:${entity.id}`}
                  type="button"
                  onClick={() => onOpen(module.id, { query: entity.title })}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left fill-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{entity.title}</span>
                    <span className="block truncate text-2xs text-faint">
                      {module.singular} · {formatRelative(entity.updatedAt)}
                    </span>
                  </span>
                  <Icon name="arrow-right" size={14} className="shrink-0 text-faint" />
                </button>
              ))}
            </div>
          )}
        </PanelCard>

        <PanelCard title="Recent activity" icon="activity">
          {activity === null ? (
            <SkeletonLines rows={4} />
          ) : activity.length === 0 ? (
            <Empty>No recent activity.</Empty>
          ) : (
            <div className="space-y-0.5">
              {activity.map((e) => (
                <div key={e.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5">
                  <Icon name="dot" size={14} className="mt-0.5 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{e.title}</span>
                    <span className="block truncate text-2xs text-faint">
                      {e.actorLabel ? `${e.actorLabel} · ` : ''}
                      {formatRelative(e.at)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </PanelCard>

        <PanelCard title="Favorites" icon="star">
          {favorites.length === 0 ? (
            <Empty>Star a module to pin it here.</Empty>
          ) : (
            <div className="space-y-0.5">
              {favorites.map((f) => {
                const mid = moduleIdFromBusinessFavorite(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onOpen(mid)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left fill-hover"
                  >
                    <Icon name="star-fill" size={14} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.label}</span>
                    <Icon name="arrow-right" size={14} className="shrink-0 text-faint" />
                  </button>
                );
              })}
            </div>
          )}
        </PanelCard>
      </div>
    </div>
  );
}

function ScopedSearch({ family, onOpen }: { family: BusinessFamilyGroup; onOpen: OpenModule }): JSX.Element {
  const searchKey = family.modules.map((m) => m.id).join(',');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ entity: EnterpriseEntity; module: EnterpriseModuleSummary }[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      const perModule = await Promise.all(
        family.modules.map(async (m) => {
          const rows = await ipc.enterpriseModules.search(m.id, term, 5).catch(() => [] as EnterpriseEntity[]);
          return rows.map((entity) => ({ entity, module: m }));
        }),
      );
      if (!alive) return;
      setResults(perModule.flat().slice(0, 8));
      setSearching(false);
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, searchKey]);

  return (
    <div>
      <div className="relative">
        <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${family.meta.label}…`}
          aria-label={`Search ${family.meta.label} records`}
          className="w-full rounded-xl border border-[var(--hairline)] bg-white/[0.03] py-2 pl-9 pr-3 text-sm outline-none focus:border-accent"
        />
      </div>
      {q.trim() && (
        <Card className="mt-2">
          {searching && results.length === 0 ? (
            <SkeletonLines rows={2} />
          ) : results.length === 0 ? (
            <Empty>No matches in {family.meta.label}.</Empty>
          ) : (
            <div className="space-y-0.5">
              {results.map(({ entity, module }) => (
                <button
                  key={`${module.id}:${entity.id}`}
                  type="button"
                  onClick={() => onOpen(module.id, { query: entity.title })}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left fill-hover"
                >
                  <Icon name={(module.icon || 'grid') as IconName} size={14} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{entity.title}</span>
                    <span className="block truncate text-2xs text-faint">{module.title}</span>
                  </span>
                  <Icon name="arrow-right" size={14} className="shrink-0 text-faint" />
                </button>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* ── small presentational helpers ── */

function Kpi({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-[var(--hairline)] px-2.5 py-1">
      <span className="text-sm font-semibold tabular-nums text-ink">{value.toLocaleString()}</span>
      <span className="text-2xs text-faint">{label}</span>
    </span>
  );
}

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">{children}</div>;
}

function PanelCard({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }): JSX.Element {
  return (
    <Card>
      <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
        <Icon name={icon} size={13} /> {title}
      </div>
      {children}
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <div className="px-2 py-5 text-center text-sm text-faint">{children}</div>;
}
