/**
 * Cloud Synchronization — the real live-sync engine's console.
 *
 * Everything here is projected from the engine's own two sources of truth (the
 * durable outbound queue and the local mirror of reconciled records) via
 * `livesync:detail`; nothing is estimated. Pausing is a real pause: the scheduler
 * cancels its timer and the engine refuses cycles, so local edits stay queued on
 * this device until sync resumes.
 */
import type { LiveSyncEntityState, SyncEntityType } from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { TEXT_TONE } from '@renderer/operations/lib';
import { Button } from '@renderer/components/ui/Button';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { useCloud } from './CloudProvider';
import { liveSyncStateMeta, syncEntityLabel, syncEntityMeta, relativeTime } from './lib';

const ENTITY_ICON: Record<SyncEntityType, IconName> = {
  organization: 'grid',
  membership: 'user',
  workspace_settings: 'settings',
  connected_account: 'lock',
  connector_config: 'connectors',
  org_prefs: 'list',
  memory: 'memory',
};

export function SyncPanel(): JSX.Element {
  const { liveSync, syncNow, setSyncOnline } = useCloud();
  const status = liveSync?.status ?? null;
  const online = status?.online ?? true;
  const syncing = status?.state === 'syncing';
  const entities = liveSync?.entities ?? [];
  const conflicts = liveSync?.conflicts ?? [];

  const pending = status?.pendingCount ?? 0;
  const mirrored = entities.reduce((sum, e) => sum + e.synced, 0);
  const stateMeta = liveSyncStateMeta(status?.state ?? 'offline');

  return (
    <div className="space-y-6">
      <OpsPanel
        title="Synchronization"
        subtitle="Offline-first, record-level sync of org-scoped state — queued locally, reconciled last-write-wins on the server"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={online ? 'secondary' : 'primary'}
              size="sm"
              icon={online ? 'pause' : 'play'}
              onClick={() => void setSyncOnline(!online)}
            >
              {online ? 'Pause sync' : 'Resume sync'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="refresh"
              disabled={!online || syncing}
              onClick={() => void syncNow()}
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          </div>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="refresh" label="Entity types" value={entities.length} tone="accent" />
          <Stat icon="check" label="Synced records" value={mirrored} tone={mirrored > 0 ? 'green' : 'gray'} />
          <Stat icon="upload" label="Pending" value={pending} tone={pending > 0 ? 'orange' : 'gray'} />
          <Stat icon="bolt" label="Conflicts resolved" value={conflicts.length} tone={conflicts.length > 0 ? 'red' : 'gray'} />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl [background:var(--fill-1)] px-3 py-2 text-2xs">
          <Icon
            name={syncing ? 'refresh' : online ? 'globe' : 'pause'}
            size={13}
            className={online ? (syncing ? TEXT_TONE.blue : TEXT_TONE.green) : TEXT_TONE.gray}
          />
          <StatusBadge tone={stateMeta.tone} label={stateMeta.label} pulse={syncing} />
          <span className="text-faint">{connectionCopy(status?.state ?? null, pending)}</span>
          {liveSync && (
            <span className="ml-auto flex items-center gap-3 text-faint">
              {liveSync.orgId ? (
                <span>
                  Org <code className="text-2xs">{liveSync.orgId}</code>
                </span>
              ) : (
                <span>No active organization</span>
              )}
              <span>
                Device <code className="text-2xs">{shortId(liveSync.deviceId)}</code>
              </span>
              <span>Cursor {status?.cursor ?? 0}</span>
              {status?.lastSyncedAt && <span>Last sync {relativeTime(status.lastSyncedAt)}</span>}
            </span>
          )}
        </div>

        {status?.lastError && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-[var(--hairline)] px-3 py-2 text-2xs">
            <Icon name="info" size={13} className={`mt-px shrink-0 ${TEXT_TONE.red}`} />
            <span className="text-faint">
              <span className="font-medium text-ink">Last sync failed</span> — {status.lastError}
              {status.failures > 1 && ` (${status.failures} consecutive failures; retrying with backoff)`}
            </span>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="[background:var(--fill-1)] text-left text-2xs font-semibold uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5">Entity type</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Synced</th>
                <th className="px-4 py-2.5 text-right">Pending</th>
                <th className="px-4 py-2.5">Last change</th>
              </tr>
            </thead>
            <tbody>
              {entities.length === 0 ? (
                <tr className="border-t border-[var(--hairline)]">
                  <td colSpan={5} className="px-4 py-6 text-center text-2xs text-faint">
                    {liveSync ? 'Nothing synced yet on this device.' : 'Loading sync state…'}
                  </td>
                </tr>
              ) : (
                entities.map((e) => <EntityRow key={e.entityType} state={e} />)
              )}
            </tbody>
          </table>
        </div>
      </OpsPanel>

      <OpsPanel
        title="Conflict log"
        subtitle="Concurrent edits the engine reconciled, newest first — resolved last-write-wins on version with updatedAt as the tiebreak"
      >
        {conflicts.length === 0 ? (
          <div className="rounded-xl [background:var(--fill-1)] px-3 py-6 text-center text-2xs text-faint">
            No conflicts — every change reconciled cleanly.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="[background:var(--fill-1)] text-left text-2xs font-semibold uppercase tracking-wider text-faint">
                  <th className="px-4 py-2.5">Entity type</th>
                  <th className="px-4 py-2.5">Record</th>
                  <th className="px-4 py-2.5">Detected on</th>
                  <th className="px-4 py-2.5">Resolution</th>
                  <th className="px-4 py-2.5">When</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c, i) => (
                  <tr key={`${c.entityType}:${c.entityId}:${c.at}:${i}`} className="border-t border-[var(--hairline)]">
                    <td className="px-4 py-2.5">{syncEntityLabel(c.entityType)}</td>
                    <td className="px-4 py-2.5">
                      <code className="text-2xs text-faint">{c.entityId}</code>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge
                        tone={c.direction === 'push' ? 'orange' : 'blue'}
                        label={c.direction === 'push' ? 'Push' : 'Pull'}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-faint">Last write wins</td>
                    <td className="px-4 py-2.5 text-2xs text-faint">{relativeTime(c.at)}</td>
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

function EntityRow({ state }: { state: LiveSyncEntityState }): JSX.Element {
  const meta = syncEntityMeta(state);
  return (
    <tr className="border-t border-[var(--hairline)]">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Icon name={ENTITY_ICON[state.entityType]} size={14} className="text-faint" />
          <span className="font-medium">{syncEntityLabel(state.entityType)}</span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <StatusBadge tone={meta.tone} label={meta.label} />
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-faint">{state.synced}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {state.pending > 0 ? (
          <span className="text-sysorange">{state.pending}</span>
        ) : (
          <span className="text-faint">0</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-2xs text-faint">
        {state.lastChangeAt ? relativeTime(state.lastChangeAt) : '—'}
      </td>
    </tr>
  );
}

/** Plain-language explanation of what the engine is doing right now. */
function connectionCopy(state: 'idle' | 'syncing' | 'offline' | 'error' | null, pending: number): string {
  const queued = pending === 1 ? '1 change is queued' : `${pending} changes are queued`;
  switch (state) {
    case 'syncing':
      return 'Reconciling with the cloud…';
    case 'error':
      return `Sync failed — ${queued} and will retry automatically.`;
    case 'offline':
      return pending > 0
        ? `Sync is paused — ${queued} on this device until you resume.`
        : 'Sync is paused — changes stay on this device until you resume.';
    case 'idle':
      return pending > 0 ? `Connected — ${queued} for the next cycle.` : 'Connected — everything is up to date.';
    default:
      return 'Reading sync state…';
  }
}

/** First segment of a UUID — enough to identify the device without the noise. */
function shortId(id: string): string {
  return id.split('-')[0] ?? id;
}
