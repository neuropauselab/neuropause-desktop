/** Sandbox › Scenarios — the versioned scenario registry with per-scenario version history. */
import { useState } from 'react';
import type { Scenario, ScenarioVersion } from '@neuropause/shared';
import { Icon } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { ipc } from '@renderer/lib/ipc';
import { useSandbox } from '@renderer/sandbox/SandboxProvider';
import { relativeTime } from '@renderer/sandbox/sandboxModel';
import { Drawer, Pill, SectionCard } from './shared';

export function ScenariosPanel(): JSX.Element {
  const { scenarios, searchQuery } = useSandbox();
  const [selected, setSelected] = useState<Scenario | null>(null);
  const [versions, setVersions] = useState<ScenarioVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const nowMs = Date.now();

  const q = searchQuery.toLowerCase();
  const list = scenarios.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q) || s.metadata.tags.some((t) => t.toLowerCase().includes(q)),
  );

  const open = async (s: Scenario): Promise<void> => {
    setSelected(s);
    setLoading(true);
    try {
      setVersions(await ipc.sandbox.scenarioVersions(s.id));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <SectionCard title="Scenarios" subtitle={`${list.length} of ${scenarios.length}`} icon="checklist" tint="blue">
        {list.length === 0 ? (
          <EmptyState icon="checklist" title="No scenarios" description="Scenarios are registered by the enterprise and AI QA runners as they exercise the platform." compact />
        ) : (
          <div className="space-y-1">
            {list.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void open(s)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition fill-hover"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Icon name="checklist" size={14} className="shrink-0 text-faint" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {s.name}
                      {s.archived && <span className="ml-2 text-2xs text-faint">archived</span>}
                    </div>
                    <div className="truncate text-2xs text-faint">
                      {s.key}
                      {s.metadata.category ? ` · ${s.metadata.category}` : ''}
                      {s.metadata.tags.length ? ` · ${s.metadata.tags.join(', ')}` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone="gray" label={`v${s.latestVersion}`} subtle />
                  <span className="text-2xs text-faint">{s.versionCount} versions</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <Drawer
        open={selected !== null}
        title={selected?.name ?? 'Scenario'}
        subtitle={selected ? `${selected.key} · ${selected.versionCount} versions` : undefined}
        onClose={() => setSelected(null)}
      >
        {loading ? (
          <div className="py-8 text-center text-sm text-faint">Loading versions…</div>
        ) : versions.length === 0 ? (
          <EmptyState icon="doc" title="No versions" compact />
        ) : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.id} className="rounded-lg border border-[var(--hairline)] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Version {v.version}</span>
                  <span className="text-2xs text-faint">{relativeTime(v.createdAt, nowMs)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-2xs text-faint">
                  <span className="rounded [background:var(--fill-2)] px-1.5 py-0.5 font-mono">{v.checksum}</span>
                  {v.changelog && <span className="truncate">{v.changelog}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}
