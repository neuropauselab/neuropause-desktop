/**
 * Cloud Synchronization. The eight syncable domains (knowledge graph, AI memory,
 * timeline, governance, AI workers, templates, connectors, marketplace) with
 * version, pending changes, and status; offline-first toggle; full + per-domain
 * sync; and the resolved-conflict log (server-authoritative last-write-wins).
 */
import type { SyncDomain, SyncDomainState } from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { TEXT_TONE } from '@renderer/operations/lib';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { useCloud } from './CloudProvider';
import { syncStatusMeta, titleCase, relativeTime } from './lib';

const DOMAIN_ICON: Record<SyncDomain, Parameters<typeof Icon>[0]['name']> = {
  knowledge_graph: 'connectors',
  ai_memory: 'memory',
  timeline: 'clock',
  governance: 'shield',
  ai_workers: 'cpu',
  templates: 'doc',
  connectors: 'connectors',
  marketplace: 'store',
};

function domainLabel(d: SyncDomain): string {
  return titleCase(d.replace(/_/g, ' '));
}

export function SyncPanel(): JSX.Element {
  const { syncStates, syncSummary, syncConflicts, syncDomain, syncAll, setOnline, recordChange } = useCloud();
  const online = syncSummary?.online ?? true;

  return (
    <div className="space-y-6">
      <OpsPanel
        title="Synchronization"
        subtitle="Offline-first, incremental sync of every local-first store to the cloud — with conflict resolution"
        actions={
          <div className="flex items-center gap-2">
            <Button variant={online ? 'secondary' : 'primary'} size="sm" icon={online ? 'pause' : 'play'} onClick={() => setOnline(!online)}>{online ? 'Go offline' : 'Go online'}</Button>
            <Button variant="primary" size="sm" icon="refresh" disabled={!online} onClick={() => void syncAll()}>Sync all</Button>
          </div>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="refresh" label="Domains" value={syncSummary?.domains ?? syncStates.length} tone="accent" />
          <Stat icon="check" label="Synced" value={syncSummary?.synced ?? 0} tone="green" />
          <Stat icon="upload" label="Pending" value={syncSummary?.pending ?? 0} tone={(syncSummary?.pending ?? 0) > 0 ? 'orange' : 'gray'} />
          <Stat icon="bolt" label="Conflicts" value={syncSummary?.conflicts ?? 0} tone={(syncSummary?.conflicts ?? 0) > 0 ? 'red' : 'gray'} />
        </div>

        <div className="mb-3 flex items-center gap-2 rounded-xl [background:var(--fill-1)] px-3 py-2 text-2xs">
          <Icon name={online ? 'globe' : 'pause'} size={13} className={online ? TEXT_TONE.green : TEXT_TONE.gray} />
          <span className="text-faint">{online ? 'Connected to cloud' : 'Offline — changes are queued and will sync on reconnect'}</span>
          {syncSummary?.lastFullSyncAt && <span className="ml-auto text-faint">Last full sync {relativeTime(syncSummary.lastFullSyncAt)}</span>}
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="[background:var(--fill-1)] text-left text-2xs font-semibold uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5">Domain</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Version</th>
                <th className="px-4 py-2.5 text-right">Pending</th>
                <th className="px-4 py-2.5">Last synced</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {syncStates.map((s) => <DomainRow key={s.domain} state={s} online={online} onSync={() => void syncDomain(s.domain)} onEdit={() => void recordChange(s.domain)} />)}
            </tbody>
          </table>
        </div>
      </OpsPanel>

      <OpsPanel title="Conflict log" subtitle="Resolved with server-authoritative last-write-wins; the local value is preserved for audit">
        {syncConflicts.length === 0 ? (
          <div className="rounded-xl [background:var(--fill-1)] px-3 py-6 text-center text-2xs text-faint">No conflicts — everything reconciled cleanly.</div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="[background:var(--fill-1)] text-left text-2xs font-semibold uppercase tracking-wider text-faint">
                  <th className="px-4 py-2.5">Domain</th>
                  <th className="px-4 py-2.5">Entity</th>
                  <th className="px-4 py-2.5">Field</th>
                  <th className="px-4 py-2.5">Resolution</th>
                  <th className="px-4 py-2.5">When</th>
                </tr>
              </thead>
              <tbody>
                {syncConflicts.map((c) => (
                  <tr key={c.id} className="border-t border-[var(--hairline)]">
                    <td className="px-4 py-2.5">{domainLabel(c.domain)}</td>
                    <td className="px-4 py-2.5"><code className="text-2xs text-faint">{c.entityId}</code></td>
                    <td className="px-4 py-2.5 text-faint">{c.field}</td>
                    <td className="px-4 py-2.5"><StatusBadge tone="blue" label={`${c.resolution} wins`} /></td>
                    <td className="px-4 py-2.5 text-2xs text-faint">{relativeTime(c.resolvedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

function DomainRow({ state, online, onSync, onEdit }: { state: SyncDomainState; online: boolean; onSync: () => void; onEdit: () => void }): JSX.Element {
  const meta = syncStatusMeta(state.status);
  return (
    <tr className="border-t border-[var(--hairline)]">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Icon name={DOMAIN_ICON[state.domain]} size={14} className="text-faint" />
          <span className="font-medium">{domainLabel(state.domain)}</span>
        </div>
      </td>
      <td className="px-4 py-2.5"><StatusBadge tone={meta.tone} label={meta.label} pulse={state.status === 'syncing'} /></td>
      <td className="px-4 py-2.5 text-right tabular-nums text-faint">v{state.localVersion}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{state.pendingChanges > 0 ? <span className="text-sysorange">{state.pendingChanges}</span> : <span className="text-faint">0</span>}</td>
      <td className="px-4 py-2.5 text-2xs text-faint">{relativeTime(state.lastSyncedAt)}</td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" icon="bolt" onClick={onEdit} title="Simulate a local edit">Edit</Button>
          <Button variant="ghost" size="sm" icon="refresh" disabled={!online} onClick={onSync}>Sync</Button>
        </div>
      </td>
    </tr>
  );
}
