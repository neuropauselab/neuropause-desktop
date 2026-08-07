/**
 * EnterpriseModulesHub — the "Modules" surface of the Enterprise experience.
 *
 * It reads the registered ERP modules from the backend registry and renders a
 * left rail + the generic `EnterpriseModuleScreen`. Because the UI is fully
 * descriptor-driven, THIS component never changes as modules are added — a new
 * module (Finance, CRM, …) appears here automatically once it is registered.
 *
 * Phase 7 (Product Experience): with 100+ registered modules the flat rail
 * became unnavigable, so it is now grouped by business family (reusing the
 * Business Workspace's own `groupModulesByFamily` — one grouping truth, no
 * drift), filterable as you type, and scrollable. The old zero-module
 * "foundation ready" panel — unreachable since the first module registered —
 * is replaced by the shared EmptyState.
 */
import { useEffect, useMemo, useState } from 'react';
import type { EnterpriseModuleSummary } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Card } from '@renderer/components/ui/Card';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { SkeletonLines } from '@renderer/components/ui/Skeleton';
import { groupModulesByFamily } from '@renderer/business/businessModel';
import { EnterpriseModuleScreen } from './EnterpriseModuleScreen';

export function EnterpriseModulesHub(): JSX.Element {
  const [modules, setModules] = useState<EnterpriseModuleSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    void ipc.enterpriseModules.list().then((m) => {
      if (!alive) return;
      setModules(m);
      setActiveId((cur) => cur ?? m[0]?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const active = useMemo(
    () => modules?.find((m) => m.id === activeId) ?? null,
    [modules, activeId],
  );

  // Filter by title/family as you type, then bucket into the canonical
  // business families (modules keep their registry order within each).
  const families = useMemo(() => {
    if (!modules) return [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? modules.filter(
          (m) =>
            m.title.toLowerCase().includes(q) ||
            (m.group ?? '').toLowerCase().includes(q),
        )
      : modules;
    return groupModulesByFamily(filtered);
  }, [modules, query]);

  if (modules === null) {
    return (
      <Card variant="hairline">
        <SkeletonLines rows={4} />
      </Card>
    );
  }

  if (modules.length === 0) {
    return (
      <EmptyState
        icon="layers"
        title="No enterprise modules registered"
        description="Modules appear here automatically as they register on the framework."
      />
    );
  }

  return (
    <div className="flex gap-6">
      <aside className="w-60 shrink-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${modules.length} modules…`}
          aria-label="Filter modules"
          className="mb-2 h-8 w-full rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 text-sm text-ink outline-none placeholder:text-faint focus-visible:shadow-focus"
        />
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pb-2 pr-1">
          {families.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-faint">
              No module matches “{query.trim()}”.
            </p>
          )}
          {families.map((family) => (
            <div key={family.meta.group} role="group" aria-label={family.meta.label}>
              <div className="flex items-center justify-between px-2 pb-1 pt-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
                  {family.meta.label}
                </span>
                <span className="text-2xs tabular-nums text-faint">{family.modules.length}</span>
              </div>
              <div className="space-y-0.5">
                {family.modules.map((m) => {
                  const on = m.id === activeId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setActiveId(m.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-md transition',
                        on ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink fill-hover',
                      )}
                    >
                      <Icon name={(m.icon || 'grid') as IconName} size={16} />
                      <span className="flex-1 truncate font-medium">{m.title}</span>
                      <span className="text-2xs tabular-nums text-faint">{m.activeCount}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {active && (
          <>
            <div className="mb-4">
              <h2 className="text-xl font-semibold tracking-tight">{active.title}</h2>
              {active.description && (
                <p className="mt-0.5 text-md text-muted">{active.description}</p>
              )}
            </div>
            <EnterpriseModuleScreen key={active.id} module={active} />
          </>
        )}
      </div>
    </div>
  );
}
