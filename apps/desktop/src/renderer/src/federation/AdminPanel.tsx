/**
 * Federation Administration panel: the centralized control plane — organization
 * and tenant counts, federation membership, shared resources, trust, security
 * review, and compliance review — folded with the Performance & Scalability
 * report (validated capacity envelopes, headroom, extension points, and measured
 * engine benchmarks). Scalability limits are stated honestly as the in-process,
 * single-node ceilings for this milestone.
 */
import { OpsPanel, Stat, StatusBadge, Bar, OpsTable } from '@renderer/operations/primitives';
import { useFederation } from './FederationProvider';
import { scoreTone } from './lib';
import type { ScalabilityDimension } from '@neuropause/shared';

export function AdminPanel(): JSX.Element {
  const { admin, scalability, orgs } = useFederation();

  return (
    <div>
      <OpsPanel title="Control plane" subtitle="Centralized federation administration">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat icon="globe" label="Peers" value={admin?.peers ?? 0} tone="blue" />
          <Stat icon="verified" label="Trusted" value={admin?.trustedPeers ?? 0} tone="purple" />
          <Stat icon="bell" label="Pending invites" value={admin?.pendingInvites ?? 0} tone={(admin?.pendingInvites ?? 0) > 0 ? 'orange' : 'green'} />
          <Stat icon="checklist" label="Approvals" value={admin?.pendingApprovals ?? 0} tone={(admin?.pendingApprovals ?? 0) > 0 ? 'orange' : 'green'} />
          <Stat icon="shield" label="Policies" value={admin?.policies ?? 0} tone="accent" />
          <Stat icon="heart" label="Compliance" value={`${admin?.complianceScore ?? 0}%`} tone={scoreTone(admin?.complianceScore ?? 0)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon="upload" label="Shared out" value={admin?.sharedOut ?? 0} tone="green" />
          <Stat icon="download" label="Shared in" value={admin?.sharedIn ?? 0} tone="blue" />
          <Stat icon="lock" label="Open security events" value={admin?.openSecurityEvents ?? 0} tone={(admin?.openSecurityEvents ?? 0) > 0 ? 'orange' : 'green'} />
          <Stat icon="database" label="Replicas in sync" value={admin?.replicasInSync ?? 0} tone="accent" />
        </div>
      </OpsPanel>

      <OpsPanel title="Organization management" subtitle="Federated organizations and their membership">
        <OpsTable head={<tr className="text-left text-2xs uppercase tracking-wider text-faint"><th className="px-4 py-2.5 font-medium">Organization</th><th className="px-4 py-2.5 font-medium">Role</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">Region</th><th className="px-4 py-2.5 text-right font-medium">Resources</th></tr>}>
          {orgs.map((o) => (
            <tr key={o.id} className="border-t border-[var(--hairline)]">
              <td className="px-4 py-2.5 font-medium text-ink">{o.name}</td>
              <td className="px-4 py-2.5"><StatusBadge tone={o.role === 'home' ? 'accent' : 'gray'} label={o.role === 'home' ? 'Home' : 'Peer'} /></td>
              <td className="px-4 py-2.5 text-xs capitalize text-muted">{o.status}</td>
              <td className="px-4 py-2.5 text-xs text-muted">{o.regionId}</td>
              <td className="px-4 py-2.5 text-right text-xs text-muted">{o.role === 'home' ? '—' : o.sharedOut + o.sharedIn}</td>
            </tr>
          ))}
        </OpsTable>
      </OpsPanel>

      <OpsPanel title="Scalability" subtitle="Validated capacity envelopes and headroom against current load">
        <div className="space-y-3">
          {(scalability?.dimensions ?? []).map((d) => (
            <DimensionRow key={d.id} dim={d} />
          ))}
        </div>
      </OpsPanel>

      <div className="grid gap-6 lg:grid-cols-2">
        <OpsPanel title="Engine benchmarks" subtitle="Measured over 5,000 entities (20ms budget)">
          <div className="space-y-2">
            {(scalability?.benchmarks ?? []).map((b) => (
              <div key={b.label} className="surface-raised rounded-xl p-3 shadow-card">
                <div className="flex items-center justify-between text-xs"><span className="font-mono text-muted">{b.label}</span><span className="font-medium text-ink">{b.valueMs.toFixed(2)}ms</span></div>
                <div className="mt-1.5"><Bar value={Math.min(1, b.valueMs / b.budgetMs)} tone={b.valueMs <= b.budgetMs ? 'green' : 'red'} /></div>
                <div className="mt-0.5 text-2xs text-faint">{Math.round((b.valueMs / b.budgetMs) * 100)}% of {b.budgetMs}ms budget</div>
              </div>
            ))}
          </div>
        </OpsPanel>

        <OpsPanel title="Extension points" subtitle="Where the architecture scales to a distributed deployment">
          <div className="space-y-2">
            {(scalability?.extensionPoints ?? []).map((e) => (
              <div key={e.id} className="surface-raised rounded-xl p-3 shadow-card">
                <div className="flex items-center gap-2"><StatusBadge tone="blue" label={e.area} /></div>
                <p className="mt-1 text-2xs leading-relaxed text-faint">{e.description}</p>
              </div>
            ))}
          </div>
        </OpsPanel>
      </div>
    </div>
  );
}

function DimensionRow({ dim }: { dim: ScalabilityDimension }): JSX.Element {
  const usedPct = dim.tested > 0 ? Math.min(1, dim.current / dim.limit) : 0;
  const headTone = dim.headroomPct >= 80 ? 'green' : dim.headroomPct >= 40 ? 'orange' : 'red';
  return (
    <div className="surface-raised rounded-xl p-3 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{dim.label}</span>
        <StatusBadge tone={headTone} label={`${dim.headroomPct}% headroom`} />
      </div>
      <div className="mt-2"><Bar value={usedPct} tone={headTone} /></div>
      <div className="mt-1 flex items-center justify-between text-2xs text-faint">
        <span>current {dim.current.toLocaleString()} {dim.unit}</span>
        <span>tested {dim.tested.toLocaleString()} · limit {dim.limit.toLocaleString()}</span>
      </div>
      <p className="mt-1 text-2xs text-faint">{dim.note}</p>
    </div>
  );
}
