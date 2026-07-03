/**
 * Enterprise Administration. The cross-tenant control view: a tenant table with
 * tier/status/region/users/spend, the user list with source + MFA, usage,
 * billing rollup, and a compliance report (SOC 2 / GDPR / ISO 27001 controls +
 * data-residency posture with an overall score). Read-only.
 */
import { OpsPanel, Stat, StatusBadge, Bar } from '@renderer/operations/primitives';
import { TEXT_TONE } from '@renderer/operations/lib';
import { Icon } from '@renderer/components/ui/Icon';
import { useCloud } from './CloudProvider';
import { tenantTierMeta, tenantStatusMeta, complianceStatusMeta, scoreTone, formatMoney, formatNum, formatBytes } from './lib';

export function AdminPanel(): JSX.Element {
  const { admin } = useCloud();
  if (!admin) return <div className="rounded-2xl [background:var(--fill-1)] px-4 py-10 text-center text-sm text-faint">Loading administration…</div>;

  const { tenants, users, usage, billing, compliance } = admin;
  const sTone = scoreTone(compliance.score);

  return (
    <div className="space-y-6">
      <OpsPanel title="Administration" subtitle="Cross-tenant control plane — tenants, users, usage, billing, and compliance">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="grid" label="Tenants" value={tenants.length} tone="accent" />
          <Stat icon="user" label="Active users" value={usage.activeUsers} tone="blue" />
          <Stat icon="analytics" label="API req 30d" value={formatNum(usage.apiRequests30d)} tone="purple" />
          <Stat icon="database" label="Storage" value={formatBytes(usage.storageBytes)} tone="green" />
        </div>
      </OpsPanel>

      <OpsPanel title="Tenants" subtitle="Tier, status, region, users, and monthly spend">
        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="[background:var(--fill-1)] text-left text-2xs font-semibold uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5">Tenant</th>
                <th className="px-4 py-2.5">Tier</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Region</th>
                <th className="px-4 py-2.5 text-right">Users</th>
                <th className="px-4 py-2.5 text-right">Projects</th>
                <th className="px-4 py-2.5 text-right">Monthly</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => {
                const tier = tenantTierMeta(t.tier);
                const status = tenantStatusMeta(t.status);
                return (
                  <tr key={t.tenantId} className="border-t border-[var(--hairline)]">
                    <td className="px-4 py-2.5 font-medium">{t.name}</td>
                    <td className="px-4 py-2.5"><StatusBadge tone={tier.tone} label={tier.label} /></td>
                    <td className="px-4 py-2.5"><StatusBadge tone={status.tone} label={status.label} /></td>
                    <td className="px-4 py-2.5 text-faint">{t.region}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{t.users}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-faint">{t.projects}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(t.monthlySpend)}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-[var(--hairline)] [background:var(--fill-1)] font-semibold">
                <td className="px-4 py-2.5" colSpan={6}>Total monthly</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(billing.totalMonthly, billing.currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </OpsPanel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Users" subtitle="Home tenant — source and MFA status">
          <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="[background:var(--fill-1)] text-left text-2xs font-semibold uppercase tracking-wider text-faint">
                  <th className="px-4 py-2.5">User</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Source</th>
                  <th className="px-4 py-2.5 text-right">MFA</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-[var(--hairline)]">
                    <td className="px-4 py-2.5"><div className="font-medium">{u.name}</div><div className="text-2xs text-faint">{u.email}</div></td>
                    <td className="px-4 py-2.5 text-faint">{u.role}</td>
                    <td className="px-4 py-2.5"><StatusBadge tone={u.source === 'scim' ? 'blue' : u.source === 'sso' ? 'purple' : 'gray'} label={u.source.toUpperCase()} /></td>
                    <td className="px-4 py-2.5 text-right">{u.mfa ? <Icon name="check" size={14} className={TEXT_TONE.green} /> : <span className="text-2xs text-faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </OpsPanel>

        <OpsPanel title="Usage" subtitle="Last 30 days">
          <div className="space-y-2">
            <UsageRow icon="analytics" label="API requests" value={formatNum(usage.apiRequests30d)} />
            <UsageRow icon="refresh" label="Sync operations" value={formatNum(usage.syncOps30d)} />
            <UsageRow icon="database" label="Storage used" value={formatBytes(usage.storageBytes)} />
            <UsageRow icon="cpu" label="Active AI workers" value={String(usage.activeWorkers)} />
            <UsageRow icon="user" label="Active users" value={String(usage.activeUsers)} />
          </div>
        </OpsPanel>
      </div>

      <OpsPanel
        title="Compliance"
        subtitle="SOC 2, GDPR, and ISO 27001 controls with data-residency posture"
        actions={<div className="flex items-center gap-2"><span className="text-2xs text-faint">Score</span><span className={`text-lg font-semibold ${TEXT_TONE[sTone]}`}>{compliance.score}</span></div>}
      >
        <div className="mb-3"><Bar value={compliance.score / 100} tone={sTone} /></div>
        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="[background:var(--fill-1)] text-left text-2xs font-semibold uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5">Framework</th>
                <th className="px-4 py-2.5">Control</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Detail</th>
              </tr>
            </thead>
            <tbody>
              {compliance.controls.map((c) => {
                const meta = complianceStatusMeta(c.status);
                return (
                  <tr key={c.id} className="border-t border-[var(--hairline)]">
                    <td className="px-4 py-2.5"><StatusBadge tone="gray" label={c.framework} /></td>
                    <td className="px-4 py-2.5 font-medium">{c.control}</td>
                    <td className="px-4 py-2.5"><StatusBadge tone={meta.tone} label={meta.label} /></td>
                    <td className="px-4 py-2.5 text-2xs text-faint">{c.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">Data residency</div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {compliance.residencyByRegion.map((r) => (
              <div key={r.region} className="flex items-center justify-between rounded-xl [background:var(--fill-1)] px-3 py-2">
                <div className="flex items-center gap-2"><Icon name="globe" size={13} className="text-faint" /><span className="text-sm">{r.region}</span></div>
                <span className="text-2xs text-faint">{r.tenants} tenant{r.tenants === 1 ? '' : 's'} · {r.residency.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
      </OpsPanel>
    </div>
  );
}

function UsageRow({ icon, label, value }: { icon: Parameters<typeof Icon>[0]['name']; label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-xl [background:var(--fill-1)] px-3 py-2">
      <div className="flex items-center gap-2"><Icon name={icon} size={14} className="text-faint" /><span className="text-sm">{label}</span></div>
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  );
}
