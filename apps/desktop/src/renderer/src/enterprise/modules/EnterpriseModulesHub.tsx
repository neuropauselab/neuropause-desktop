/**
 * EnterpriseModulesHub — the "Modules" surface of the Enterprise experience.
 *
 * It reads the registered ERP modules from the backend registry and renders a
 * left rail + the generic `EnterpriseModuleScreen`. Because the UI is fully
 * descriptor-driven, THIS component never changes as modules are added — a new
 * module (Finance, CRM, …) appears here automatically once it is registered.
 *
 * With no modules registered (this foundation release), it shows a designed
 * "foundation ready" state that spells out what every future module inherits.
 */
import { useEffect, useMemo, useState } from 'react';
import type { EnterpriseModuleSummary } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Card } from '@renderer/components/ui/Card';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { SkeletonLines } from '@renderer/components/ui/Skeleton';
import { EnterpriseModuleScreen } from './EnterpriseModuleScreen';

const INHERITED: { icon: IconName; label: string; detail: string }[] = [
  { icon: 'shield', label: 'Permissions', detail: 'RBAC-gated reads & writes' },
  { icon: 'clipboard', label: 'Audit trail', detail: 'Every change recorded' },
  { icon: 'activity', label: 'Timeline events', detail: 'Surfaced in Executive Center' },
  { icon: 'search', label: 'Search', detail: 'Title, tags & fields' },
  { icon: 'bell', label: 'Notifications', detail: 'Opt-in module alerts' },
  { icon: 'database', label: 'Offline-first', detail: 'Local atomic persistence' },
  { icon: 'refresh', label: 'Cloud-sync ready', detail: 'Revisioned records' },
  { icon: 'grid', label: 'Generic UI', detail: 'List · detail · form, free' },
];

export function EnterpriseModulesHub(): JSX.Element {
  const [modules, setModules] = useState<EnterpriseModuleSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

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

  if (modules === null) {
    return (
      <Card variant="hairline">
        <SkeletonLines rows={4} />
      </Card>
    );
  }

  if (modules.length === 0) return <FoundationReady />;

  return (
    <div className="flex gap-6">
      <aside className="w-56 shrink-0 space-y-1">
        {modules.map((m) => {
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

function FoundationReady(): JSX.Element {
  return (
    <Card variant="hairline" className="mx-auto max-w-2xl">
      <div className="flex flex-col items-center py-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <Icon name="layers" size={26} />
        </span>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">
          Enterprise module foundation is ready
        </h2>
        <p className="mt-1.5 max-w-md text-md text-muted">
          The reusable framework that every ERP module — Finance, CRM, Sales, Inventory, HR,
          Projects and more — is built on. No modules are installed yet; each one that registers
          appears here automatically and inherits all of the below.
        </p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {INHERITED.map((c) => (
          <div
            key={c.label}
            className="flex flex-col gap-1 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3"
          >
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <Icon name={c.icon} size={14} />
              {c.label}
            </span>
            <span className="text-xs text-faint">{c.detail}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
