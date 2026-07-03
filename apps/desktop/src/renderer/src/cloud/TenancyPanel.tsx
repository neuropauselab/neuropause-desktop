/**
 * Multi-Tenant Runtime. Tenants across regions with tier + status, per-tenant
 * storage isolation (namespace, encryption key, residency), the region map, and
 * the home tenant's projects, teams, and AI workers. Provisioning a tenant and
 * suspend/resume are propose-and-apply IPC calls (the home tenant is protected).
 */
import { useState } from 'react';
import type { CloudTenant } from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { TEXT_TONE } from '@renderer/operations/lib';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { Modal, Field, Input, Select } from '@renderer/developer/primitives';
import { useCloud } from './CloudProvider';
import { tenantTierMeta, tenantStatusMeta, residencyMeta, formatBytes, formatNum, relativeTime } from './lib';

export function TenancyPanel(): JSX.Element {
  const { tenants, tenantSummary, regions, isolation, projects, teams, workers, createTenant, setTenantStatus, createProject } = useCloud();
  const [creating, setCreating] = useState(false);
  const home = tenants.find((t) => t.isHome) ?? null;

  return (
    <div className="space-y-6">
      <OpsPanel
        title="Tenants"
        subtitle="Organizations provisioned across regions, each isolated by namespace, encryption key, and data residency"
        actions={<Button variant="primary" size="sm" icon="plus" onClick={() => setCreating(true)}>New tenant</Button>}
      >
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="grid" label="Tenants" value={tenantSummary?.tenants ?? tenants.length} tone="accent" />
          <Stat icon="check" label="Active" value={tenantSummary?.active ?? 0} tone="green" />
          <Stat icon="globe" label="Regions" value={tenantSummary?.regions ?? 0} tone="blue" />
          <Stat icon="cpu" label="AI workers" value={tenantSummary?.workers ?? 0} tone="purple" />
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="[background:var(--fill-1)] text-left text-2xs font-semibold uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5">Tenant</th>
                <th className="px-4 py-2.5">Tier</th>
                <th className="px-4 py-2.5">Region</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => <TenantRow key={t.id} tenant={t} region={regions.find((r) => r.id === t.regionId)?.name ?? t.regionId} onSetStatus={setTenantStatus} />)}
            </tbody>
          </table>
        </div>
      </OpsPanel>

      <OpsPanel title="Storage isolation" subtitle="Every tenant has its own namespace, encryption key, and residency boundary">
        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="[background:var(--fill-1)] text-left text-2xs font-semibold uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5">Tenant</th>
                <th className="px-4 py-2.5">Namespace</th>
                <th className="px-4 py-2.5">Residency</th>
                <th className="px-4 py-2.5 text-right">Objects</th>
                <th className="px-4 py-2.5 text-right">Size</th>
              </tr>
            </thead>
            <tbody>
              {isolation.map((i) => {
                const res = residencyMeta(i.residency);
                return (
                  <tr key={i.tenantId} className="border-t border-[var(--hairline)]">
                    <td className="px-4 py-2.5 font-medium">{i.tenantName}</td>
                    <td className="px-4 py-2.5"><code className="rounded [background:var(--fill-2)] px-1.5 py-0.5 text-2xs">{i.namespace}</code></td>
                    <td className="px-4 py-2.5"><StatusBadge tone={res.tone} label={res.label} /></td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-faint">{formatNum(i.objects)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatBytes(i.bytes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </OpsPanel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <OpsPanel title="Regions" subtitle="Available cloud regions">
          <div className="space-y-2">
            {regions.map((r) => {
              const res = residencyMeta(r.residency);
              return (
                <div key={r.id} className="flex items-center justify-between rounded-xl [background:var(--fill-1)] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Icon name="globe" size={14} className={TEXT_TONE[res.tone]} />
                    <span className="text-sm">{r.name}</span>
                  </div>
                  <StatusBadge tone={res.tone} label={res.label} />
                </div>
              );
            })}
          </div>
        </OpsPanel>

        <OpsPanel
          title="Projects"
          subtitle={home ? `${home.name} · home tenant` : 'Home tenant'}
          actions={home ? <Button variant="ghost" size="sm" icon="plus" onClick={() => { const name = window.prompt('Project name'); if (name && home) void createProject({ tenantId: home.id, name }); }}>Add</Button> : undefined}
        >
          {projects.filter((p) => !home || p.tenantId === home.id).length === 0 ? (
            <EmptyState icon="folder" title="No projects" compact />
          ) : (
            <div className="space-y-2">
              {projects.filter((p) => !home || p.tenantId === home.id).map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl [background:var(--fill-1)] px-3 py-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <code className="text-2xs text-faint">{p.key}</code>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>

        <OpsPanel title="Teams & workers" subtitle={home ? home.name : 'Home tenant'}>
          <div className="space-y-3">
            <div>
              <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">Teams</div>
              {teams.filter((t) => !home || t.tenantId === home.id).length === 0 ? (
                <div className="text-2xs text-faint">No teams yet.</div>
              ) : teams.filter((t) => !home || t.tenantId === home.id).map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-xl [background:var(--fill-1)] px-3 py-2">
                  <span className="text-sm">{t.name}</span>
                  <span className="text-2xs text-faint">{t.memberCount} member{t.memberCount === 1 ? '' : 's'}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">AI workers ({workers.filter((w) => !home || w.tenantId === home.id).length})</div>
              <div className="flex flex-wrap gap-1.5">
                {workers.filter((w) => !home || w.tenantId === home.id).map((w) => (
                  <span key={w.id} className="rounded-lg [background:var(--fill-2)] px-2 py-1 text-2xs">{w.name}</span>
                ))}
              </div>
            </div>
          </div>
        </OpsPanel>
      </div>

      {creating && <CreateTenantModal onClose={() => setCreating(false)} onCreate={async (input) => { await createTenant(input); setCreating(false); }} regions={regions.map((r) => ({ id: r.id, name: r.name }))} />}
    </div>
  );
}

function TenantRow({ tenant, region, onSetStatus }: { tenant: CloudTenant; region: string; onSetStatus: (id: string, status: CloudTenant['status']) => void }): JSX.Element {
  const tier = tenantTierMeta(tenant.tier);
  const status = tenantStatusMeta(tenant.status);
  return (
    <tr className="border-t border-[var(--hairline)]">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium">{tenant.name}</span>
          {tenant.isHome && <span className="rounded [background:var(--fill-2)] px-1.5 py-0.5 text-3xs uppercase tracking-wider text-faint">Home</span>}
        </div>
        <div className="text-2xs text-faint">Created {relativeTime(tenant.createdAt)}</div>
      </td>
      <td className="px-4 py-2.5"><StatusBadge tone={tier.tone} label={tier.label} /></td>
      <td className="px-4 py-2.5 text-faint">{region}</td>
      <td className="px-4 py-2.5"><StatusBadge tone={status.tone} label={status.label} pulse={tenant.status === 'provisioning'} /></td>
      <td className="px-4 py-2.5 text-right">
        {tenant.isHome ? (
          <span className="text-2xs text-faint">Protected</span>
        ) : tenant.status === 'suspended' ? (
          <Button variant="ghost" size="sm" icon="play" onClick={() => onSetStatus(tenant.id, 'active')}>Resume</Button>
        ) : (
          <Button variant="ghost" size="sm" icon="pause" onClick={() => onSetStatus(tenant.id, 'suspended')}>Suspend</Button>
        )}
      </td>
    </tr>
  );
}

function CreateTenantModal({ onClose, onCreate, regions }: { onClose: () => void; onCreate: (input: { name: string; regionId: CloudTenant['regionId']; tier: CloudTenant['tier'] }) => void; regions: { id: string; name: string }[] }): JSX.Element {
  const [name, setName] = useState('');
  const [regionId, setRegionId] = useState(regions[0]?.id ?? 'us-east');
  const [tier, setTier] = useState<CloudTenant['tier']>('business');
  return (
    <Modal
      open
      title="Provision a tenant"
      subtitle="A new isolated tenant — namespace, encryption key, and region are assigned automatically"
      onClose={onClose}
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" icon="plus" disabled={!name.trim()} onClick={() => onCreate({ name: name.trim(), regionId: regionId as CloudTenant['regionId'], tier })}>Provision</Button></>}
    >
      <div className="space-y-3">
        <Field label="Tenant name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" /></Field>
        <Field label="Region"><Select value={regionId} onChange={(e) => setRegionId(e.target.value)}>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
        <Field label="Tier"><Select value={tier} onChange={(e) => setTier(e.target.value as CloudTenant['tier'])}><option value="free">Free</option><option value="business">Business</option><option value="enterprise">Enterprise</option></Select></Field>
      </div>
    </Modal>
  );
}
