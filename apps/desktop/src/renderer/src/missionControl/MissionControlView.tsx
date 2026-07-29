/**
 * NCEA 11.0 — Mission Control view. Thin JSX over the tested view-model
 * (missionControlModel.ts); every derivation is a pure projection, every visual a
 * house primitive. Mission Control is the command center that unifies the
 * existing sections — navigation is DELEGATED to the shell via `onNavigate`
 * (a SectionId), so no new router or route is introduced. Read-only.
 */
import { useMemo, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Card } from '@renderer/components/ui/Card';
import { Button } from '@renderer/components/ui/Button';
import type { SectionId } from '../shell/sections';
import { useMissionControl } from './MissionControlProvider';
import {
  COMMAND_DOMAINS,
  buildSearchIndex,
  searchAll,
  missionControlOverview,
  activityFeed,
  notifications,
  statusBar,
  workspaceSwitcher,
  type SearchHit,
} from './missionControlModel';

export interface MissionControlViewProps {
  /** Delegates to the existing shell router — Mission Control adds no routes. */
  onNavigate?: (section: SectionId) => void;
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }): JSX.Element {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>
      <span className={cn('text-2xl font-semibold tabular-nums', tone)}>{value}</span>
    </Card>
  );
}

export function MissionControlView({ onNavigate }: MissionControlViewProps): JSX.Element {
  const snapshot = useMissionControl();
  const overview = useMemo(() => missionControlOverview(snapshot), [snapshot]);
  const searchIndex = useMemo(() => buildSearchIndex(snapshot), [snapshot]);
  const feed = useMemo(() => activityFeed(snapshot, { limit: 12 }), [snapshot]);
  const notes = useMemo(() => notifications(snapshot), [snapshot]);
  const status = useMemo(() => statusBar(snapshot), [snapshot]);
  const workspaces = useMemo(() => workspaceSwitcher(snapshot), [snapshot]);
  const [query, setQuery] = useState('');
  const hits = useMemo<SearchHit[]>(() => (query ? searchAll(query, searchIndex, { limit: 12 }) : []), [query, searchIndex]);

  const activeWs = workspaces.find((w) => w.active);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Mission Control</h1>
          <p className="text-sm text-neutral-500">
            {activeWs ? `${activeWs.orgName} · ${activeWs.name}` : 'Command center for the Enterprise Runtime'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className={cn('inline-flex items-center gap-1', status.auditValid ? 'text-emerald-600' : 'text-red-600')}>
            <Icon name="shield" size={14} /> audit {status.auditValid ? 'valid' : 'broken'}
          </span>
          <span>·</span>
          <span>{status.connectorsUp}/{status.connectorsTotal} connectors up</span>
          <span>·</span>
          <span>{status.pendingApprovals} approvals</span>
        </div>
      </header>

      {/* Universal search — provider-agnostic ranking over every entity kind */}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search organizations, people, AI employees, projects, tasks, documents, connectors, events…"
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400"
        />
        {hits.length > 0 && (
          <Card className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto p-1">
            {hits.map((h) => (
              <button
                key={h.id}
                onClick={() => h.domain && onNavigate?.(COMMAND_DOMAINS.find((d) => d.id === h.domain)!.section)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
              >
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-500">{h.kind}</span>
                <span className="flex-1 truncate">{h.title}</span>
                {h.subtitle && <span className="truncate text-xs text-neutral-400">{h.subtitle}</span>}
              </button>
            ))}
          </Card>
        )}
      </div>

      {/* Executive overview — KPIs derived from runtime projections */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Organizations" value={overview.organizations} />
        <Kpi label="AI employees" value={overview.aiEmployees} />
        <Kpi label="Open tasks" value={overview.openTasks} />
        <Kpi label="Pending approvals" value={overview.pendingApprovals} tone={overview.pendingApprovals ? 'text-amber-600' : ''} />
        <Kpi label="Connectors up" value={`${overview.connectors.up}/${overview.connectors.total}`} />
        <Kpi label="Running jobs" value={overview.automation.running} />
        <Kpi label="Workforce cost" value={`$${overview.costUsd.toFixed(2)}`} />
        <Kpi label="Runtime" value={overview.runtimeHealth} tone={overview.runtimeHealth === 'healthy' ? 'text-emerald-600' : 'text-amber-600'} />
      </section>

      {/* Command-center domains — each routes into its existing section */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-600">Command center</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {COMMAND_DOMAINS.map((d) => (
            <Button key={d.id} variant="secondary" onClick={() => onNavigate?.(d.section)} className="flex items-center justify-start gap-2">
              <Icon name={d.icon as IconName} size={16} />
              <span className="truncate">{d.label}</span>
            </Button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Activity feed */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-neutral-600">Recent activity</h2>
          <Card className="divide-y divide-neutral-100 p-0">
            {feed.length === 0 && <p className="p-3 text-sm text-neutral-400">No activity yet.</p>}
            {feed.map((a) => (
              <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className={cn('h-1.5 w-1.5 rounded-full', a.ok ? 'bg-emerald-500' : 'bg-red-500')} />
                <span className="flex-1 truncate">{a.domain}.{a.action}</span>
                <span className="truncate text-xs text-neutral-400">{a.actor}</span>
              </div>
            ))}
          </Card>
        </section>

        {/* Notifications */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-neutral-600">Notifications</h2>
          <Card className="divide-y divide-neutral-100 p-0">
            {notes.length === 0 && <p className="p-3 text-sm text-neutral-400">Nothing needs attention.</p>}
            {notes.map((n) => (
              <div key={n.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <Icon name={n.kind === 'approval' ? 'checklist' : 'bolt'} size={14} className={n.kind === 'alert' ? 'text-red-500' : 'text-amber-500'} />
                <span className="flex-1 truncate">{n.title}</span>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}
