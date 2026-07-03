/**
 * Disaster Recovery panel: backups, multi-region replication state, recovery
 * validations, and the business-continuity posture. Create backups, run recovery
 * validation, and check replication.
 *
 * Honest seam (stated in the subtitle): backups are metadata records and
 * validation runs in a sandbox — it verifies integrity and computes RPO/RTO
 * without ever touching production data.
 */
import { OpsPanel, Stat, StatusBadge, OpsTable, Bar, IconAction } from '@renderer/operations/primitives';
import { Button } from '@renderer/components/ui/Button';
import { useFederation } from './FederationProvider';
import { backupScopeMeta, formatBytes, relativeTime, replicationMeta, scoreTone, validationMeta } from './lib';

export function RecoveryPanel(): JSX.Element {
  const { backups, replicas, validations, continuity, drSummary, createBackup, runValidation, checkReplication } = useFederation();
  const inSync = replicas.filter((r) => r.status === 'in_sync').length;

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon="database" label="Backups" value={drSummary?.backups ?? backups.length} tone="blue" hint={drSummary?.lastBackupAt ? `last ${relativeTime(drSummary.lastBackupAt)}` : undefined} />
        <Stat icon="refresh" label="Replicas in sync" value={`${inSync}/${replicas.length}`} tone={inSync === replicas.length ? 'green' : 'orange'} />
        <Stat icon="check" label="Last validation" value={validations[0] ? validationMeta(validations[0].status).label : '—'} tone={validations[0]?.status === 'pass' ? 'green' : 'gray'} />
        <Stat icon="heart" label="Continuity score" value={`${continuity?.score ?? 0}`} tone={scoreTone(continuity?.score ?? 0)} />
      </div>

      <OpsPanel title="Business continuity" subtitle="High-availability and recovery posture">
        <div className="surface-raised grid grid-cols-2 gap-4 rounded-2xl p-4 shadow-card sm:grid-cols-4">
          <PostureItem label="High availability" on={continuity?.haEnabled ?? false} />
          <PostureItem label="Multi-region" on={continuity?.multiRegion ?? false} />
          <div><div className="text-2xs text-faint">RPO target</div><div className="text-lg font-semibold tracking-tight">{Math.round((continuity?.rpoTargetSeconds ?? 0) / 60)}m</div></div>
          <div><div className="text-2xs text-faint">RTO target</div><div className="text-lg font-semibold tracking-tight">{Math.round((continuity?.rtoTargetSeconds ?? 0) / 60)}m</div></div>
        </div>
      </OpsPanel>

      <OpsPanel
        title="Backups"
        subtitle="Metadata records — full and incremental snapshots"
        actions={<><Button variant="secondary" size="sm" icon="plus" onClick={() => void createBackup('incremental')}>Incremental</Button><Button variant="primary" size="sm" icon="database" onClick={() => void createBackup('full')}>Full backup</Button></>}
      >
        <OpsTable head={<tr className="text-left text-2xs uppercase tracking-wider text-faint"><th className="px-4 py-2.5 font-medium">Backup</th><th className="px-4 py-2.5 font-medium">Scope</th><th className="px-4 py-2.5 font-medium">Region</th><th className="px-4 py-2.5 text-right font-medium">Size</th><th className="px-4 py-2.5 text-right font-medium">Objects</th><th className="px-4 py-2.5 font-medium">Created</th><th className="px-4 py-2.5 text-right font-medium">Validate</th></tr>}>
          {backups.map((b) => {
            const bm = backupScopeMeta(b.scope);
            return (
              <tr key={b.id} className="border-t border-[var(--hairline)]">
                <td className="px-4 py-2.5"><span className="font-mono text-2xs text-muted">{b.id.slice(0, 12)}</span></td>
                <td className="px-4 py-2.5"><StatusBadge tone={bm.tone} label={bm.label} /></td>
                <td className="px-4 py-2.5 text-xs text-muted">{b.regionId}</td>
                <td className="px-4 py-2.5 text-right text-xs text-muted">{formatBytes(b.sizeBytes)}</td>
                <td className="px-4 py-2.5 text-right text-xs text-muted">{b.objectCount.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-xs text-faint">{relativeTime(b.createdAt)}</td>
                <td className="px-4 py-2.5 text-right"><IconAction icon="play" label="Run sandbox validation" onClick={() => void runValidation(b.id)} /></td>
              </tr>
            );
          })}
        </OpsTable>
      </OpsPanel>

      <div className="grid gap-6 lg:grid-cols-2">
        <OpsPanel
          title="Multi-region replication"
          subtitle="Per-region replication state"
          actions={<Button variant="ghost" size="sm" icon="refresh" onClick={() => void checkReplication()}>Check</Button>}
        >
          <div className="space-y-2">
            {replicas.map((r) => {
              const rm = replicationMeta(r.status);
              return (
                <div key={r.regionId} className="surface-raised flex items-center justify-between gap-3 rounded-xl p-3 shadow-card">
                  <div><div className="text-sm font-medium text-ink">{r.regionId}</div><div className="text-2xs text-faint">lag {r.lagSeconds}s · {relativeTime(r.lastReplicatedAt)}</div></div>
                  <StatusBadge tone={rm.tone} label={rm.label} pulse={r.status === 'lagging'} />
                </div>
              );
            })}
          </div>
        </OpsPanel>

        <OpsPanel title="Recovery validations" subtitle="Sandbox dry-runs — production is never touched">
          <div className="space-y-2">
            {validations.map((v) => {
              const vm = validationMeta(v.status);
              return (
                <div key={v.id} className="surface-raised rounded-xl p-3 shadow-card">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><StatusBadge tone={vm.tone} label={vm.label} />{v.sandbox && <StatusBadge tone="gray" label="Sandbox" />}</div>
                    <span className="text-2xs text-faint">{relativeTime(v.validatedAt)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-2xs">
                    <div><span className="text-faint">RPO</span><div className="font-medium text-ink">{v.rpoSeconds}s</div></div>
                    <div><span className="text-faint">RTO</span><div className="font-medium text-ink">{v.rtoSeconds}s</div></div>
                    <div><span className="text-faint">Items</span><div className="font-medium text-ink">{v.checkedItems.toLocaleString()}</div></div>
                  </div>
                  <div className="mt-2"><Bar value={v.integrityOk ? 1 : 0.3} tone={v.integrityOk ? 'green' : 'red'} /><div className="mt-0.5 text-2xs text-faint">{v.integrityOk ? 'Integrity verified' : 'Integrity check failed'}</div></div>
                </div>
              );
            })}
          </div>
        </OpsPanel>
      </div>
    </div>
  );
}

function PostureItem({ label, on }: { label: string; on: boolean }): JSX.Element {
  return (
    <div>
      <div className="text-2xs text-faint">{label}</div>
      <StatusBadge tone={on ? 'green' : 'gray'} label={on ? 'Enabled' : 'Off'} />
    </div>
  );
}
