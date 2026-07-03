/**
 * Enterprise Observability panel: a single operational view across every
 * subsystem (orgs, AI workers, connectors, sync, API platform, federation
 * runtime, security), the 14-day usage trend (historical reporting), and the
 * security event log. All metrics roll up live from the running subsystems.
 */
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { useFederation } from './FederationProvider';
import { relativeTime, severityMeta, subsystemHealthMeta } from './lib';
import type { ObsSubsystem } from '@neuropause/shared';

const SUBSYSTEM_ICON: Record<string, IconName> = {
  organizations: 'globe',
  workers: 'cpu',
  connectors: 'connectors',
  sync: 'refresh',
  api: 'server',
  federation: 'layers',
  security: 'shield',
};

export function ObservabilityPanel(): JSX.Element {
  const { observability, usage, securityEvents } = useFederation();
  const subsystems = observability?.subsystems ?? [];
  const maxApi = Math.max(1, ...usage.map((u) => u.apiRequests));

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon="gauge" label="Subsystems healthy" value={`${observability?.healthy ?? 0}/${subsystems.length || 7}`} tone={(observability?.degraded ?? 0) > 0 ? 'orange' : 'green'} />
        <Stat icon="activity" label="Degraded" value={observability?.degraded ?? 0} tone={(observability?.degraded ?? 0) > 0 ? 'orange' : 'green'} />
        <Stat icon="bell" label="Critical events" value={observability?.criticalEvents ?? 0} tone={(observability?.criticalEvents ?? 0) > 0 ? 'red' : 'green'} />
        <Stat icon="pulse" label="API req (today)" value={(usage[usage.length - 1]?.apiRequests ?? 0).toLocaleString()} tone="accent" />
      </div>

      <OpsPanel title="Subsystems" subtitle="Operational health across the federated deployment">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {subsystems.map((s) => (
            <SubsystemCard key={s.id} subsystem={s} />
          ))}
        </div>
      </OpsPanel>

      <OpsPanel title="Usage trend" subtitle="API requests over the last 14 days">
        <div className="surface-raised rounded-2xl p-4 shadow-card">
          <div className="flex h-32 items-end gap-1">
            {usage.map((u) => (
              <div key={u.at} className="group relative flex-1" title={`${new Date(u.at).toLocaleDateString()} · ${u.apiRequests.toLocaleString()} req`}>
                <div className="w-full rounded-t [background:var(--accent)] opacity-80 transition group-hover:opacity-100" style={{ height: `${Math.max(4, (u.apiRequests / maxApi) * 120)}px` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-2xs text-faint">
            <span>{usage[0] ? new Date(usage[0].at).toLocaleDateString() : ''}</span>
            <span>Today</span>
          </div>
        </div>
      </OpsPanel>

      <OpsPanel title="Security events" subtitle="Recent security-relevant activity across the federation">
        <div className="space-y-1.5">
          {securityEvents.slice(0, 12).map((e) => {
            const sm = severityMeta(e.severity);
            return (
              <div key={e.id} className="surface-raised flex items-center justify-between gap-3 rounded-xl p-2.5 shadow-card">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><StatusBadge tone={sm.tone} label={sm.label} /><span className="text-2xs uppercase tracking-wider text-faint">{e.source} · {e.category}</span></div>
                  <p className="mt-0.5 truncate text-xs text-muted">{e.detail}</p>
                </div>
                <span className="shrink-0 text-2xs text-faint">{relativeTime(e.at)}</span>
              </div>
            );
          })}
        </div>
      </OpsPanel>
    </div>
  );
}

function SubsystemCard({ subsystem }: { subsystem: ObsSubsystem }): JSX.Element {
  const hm = subsystemHealthMeta(subsystem.status);
  const icon = SUBSYSTEM_ICON[subsystem.id] ?? 'activity';
  return (
    <div className="surface-raised rounded-2xl p-4 shadow-card">
      <div className="flex items-start justify-between">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg [background:var(--fill-2)]"><Icon name={icon} size={16} /></span>
        <StatusBadge tone={hm.tone} label={hm.label} pulse={subsystem.status !== 'healthy'} />
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{subsystem.metric.toLocaleString()}<span className="ml-1 text-xs font-normal text-faint">{subsystem.unit}</span></div>
      <div className="text-xs text-faint">{subsystem.label}</div>
      <div className="mt-1 text-2xs text-faint">{subsystem.detail}</div>
    </div>
  );
}
