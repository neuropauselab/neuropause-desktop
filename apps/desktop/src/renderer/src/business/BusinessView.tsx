/**
 * BusinessView — the top-level Business Workspace (EBS v1.0).
 *
 * The primary entry point for the enterprise modules, grouped by business family. It is a PRESENTATION layer:
 * it fetches the already-registered modules via the existing `enterprise:modules` IPC, groups them by their
 * real `descriptor.group`, and renders a family rail + the family section. It owns no data and creates no
 * architecture. Families with no real modules (Quality, HR, Projects) never appear here — they are recorded
 * in the Capability Registry as future, so the workspace only ever shows real, working areas.
 */
import { useEffect, useMemo, useState } from 'react';
import type { EnterpriseModuleSummary } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Card } from '@renderer/components/ui/Card';
import { Icon } from '@renderer/components/ui/Icon';
import { SkeletonLines } from '@renderer/components/ui/Skeleton';
import { useShell } from '@renderer/state/ShellProvider';
import { groupModulesByFamily, findFamilyForModule, totalBusinessRecords } from './businessModel';
import { BusinessFamilySection } from './BusinessFamilySection';

export function BusinessView(): JSX.Element {
  const { businessTab, clearBusinessTab } = useShell();
  const [modules, setModules] = useState<EnterpriseModuleSummary[] | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [pendingModuleId, setPendingModuleId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void ipc.enterpriseModules.list().then((m) => {
      if (alive) setModules(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  const families = useMemo(() => (modules ? groupModulesByFamily(modules) : []), [modules]);

  // Default the selected family to the first once modules load.
  useEffect(() => {
    if (families.length && activeGroup === null) setActiveGroup(families[0].meta.group);
  }, [families, activeGroup]);

  // Consume a one-shot deep-link to a specific business module (command palette / search).
  useEffect(() => {
    if (!businessTab || families.length === 0) return;
    const fam = findFamilyForModule(families, businessTab);
    if (fam) {
      setActiveGroup(fam.meta.group);
      setPendingModuleId(businessTab);
    }
    clearBusinessTab();
  }, [businessTab, families, clearBusinessTab]);

  if (modules === null) {
    return (
      <div className="p-6">
        <Card variant="hairline">
          <SkeletonLines rows={5} />
        </Card>
      </div>
    );
  }

  if (families.length === 0) return <BusinessEmpty />;

  const active = families.find((f) => f.meta.group === activeGroup) ?? families[0];
  const totalRecords = totalBusinessRecords(families);

  return (
    <div className="flex h-full min-h-0">
      {/* Family rail */}
      <nav className="w-[240px] shrink-0 overflow-y-auto border-r border-[var(--hairline)] p-3">
        <div className="px-2 pb-2 pt-1">
          <div className="text-lg font-semibold tracking-tight">Business</div>
          <div className="text-2xs text-faint">
            {families.length} areas · {totalRecords.toLocaleString()} records
          </div>
        </div>
        {families.map((f) => {
          const on = f.meta.group === active.meta.group;
          return (
            <button
              key={f.meta.group}
              type="button"
              onClick={() => {
                setActiveGroup(f.meta.group);
                setPendingModuleId(null);
              }}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                on ? 'bg-white/[0.08] text-ink' : 'text-muted hover:bg-white/[0.03]',
              )}
            >
              <Icon name={f.meta.icon} size={15} />
              <span className="flex-1 truncate">{f.meta.label}</span>
              <span className="text-2xs tabular-nums text-faint">{f.modules.length}</span>
            </button>
          );
        })}
      </nav>

      {/* Content pane */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto px-8 py-7" style={{ maxWidth: 1080 }}>
          <BusinessFamilySection
            key={active.meta.group}
            family={active}
            initialModuleId={pendingModuleId}
            onConsumeInitial={() => setPendingModuleId(null)}
          />
        </div>
      </div>
    </div>
  );
}

function BusinessEmpty(): JSX.Element {
  return (
    <div className="p-6">
      <Card variant="hairline" className="mx-auto max-w-xl">
        <div className="flex flex-col items-center py-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <Icon name="layers" size={24} />
          </span>
          <h2 className="mt-3 text-lg font-semibold tracking-tight">No business areas yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted">
            The Business Workspace groups the enterprise modules by area. Once a module is registered it appears
            here automatically — nothing is shown that has no real backing.
          </p>
        </div>
      </Card>
    </div>
  );
}
