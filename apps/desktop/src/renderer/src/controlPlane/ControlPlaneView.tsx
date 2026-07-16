/**
 * P11 — Cloud Control Center. The global management surface over the EXISTING cloud subsystems
 * (multi-tenant runtime, API platform, cloud sync, identity, cross-org federation, disaster
 * recovery), built from house primitives + the P8.6 VirtualList. Tabs: Overview (fleet health +
 * totals), Fleet (subsystem detail), Regions (per-region rollup), Tenants (directory), Deployments
 * (health-gated), and Usage (metering + quota + cost). Reads via `ipc.controlPlane.*`; refreshes
 * on the existing `cloud:event` broadcast. No new runtime, store, or engine.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ControlPlaneOverview } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { Bar, OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Field, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill } from '@renderer/workforce/primitives';
import { VirtualList } from '@renderer/workforceCenter/VirtualList';
import {
  gateLabel,
  gateTone,
  healthLabel,
  healthTone,
  replicationLabel,
  replicationTone,
  residencyLabel,
  statusTone,
  subsystemIcon,
  tierLabel,
  tierTone,
  utilizationTone,
} from './controlPlaneModel';

type Tab = 'overview' | 'fleet' | 'regions' | 'tenants' | 'deployments' | 'usage';

function fmtGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

export function ControlPlaneView(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<ControlPlaneOverview | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const refresh = useCallback(async () => {
    try {
      setData(await ipc.controlPlane.overview());
    } catch {
      /* keep last snapshot */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.controlPlane.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: 'gauge' | 'pulse' | 'globe' | 'grid' | 'server' | 'database' }[] = [
    { id: 'overview', label: 'Overview', icon: 'gauge' },
    { id: 'fleet', label: 'Fleet', icon: 'pulse' },
    { id: 'regions', label: 'Regions', icon: 'globe' },
    { id: 'tenants', label: 'Tenants', icon: 'grid' },
    { id: 'deployments', label: 'Deployments', icon: 'server' },
    { id: 'usage', label: 'Usage', icon: 'database' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Cloud Control Plane</h1>
            <p className="mt-1 text-md text-muted">
              One management plane for every subsystem — tenants, regions, deployments, identity, federation, and recovery.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Refresh"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink"
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>

        <nav className="mb-6 flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition',
                tab === t.id ? 'bg-white/10 text-ink' : 'text-muted hover:bg-white/5 hover:text-ink',
              )}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </nav>

        {!ready ? (
          <LoadingBlock label="Loading control plane…" />
        ) : !data ? (
          <EmptyState icon="server" title="Control plane unavailable" hint="No control-plane data could be loaded." />
        ) : tab === 'overview' ? (
          <Overview data={data} />
        ) : tab === 'fleet' ? (
          <Fleet data={data} />
        ) : tab === 'regions' ? (
          <Regions data={data} />
        ) : tab === 'tenants' ? (
          <Tenants data={data} />
        ) : tab === 'deployments' ? (
          <Deployments data={data} />
        ) : (
          <Usage data={data} />
        )}
      </div>
    </div>
  );
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function Overview({ data }: { data: ControlPlaneOverview }): JSX.Element {
  const { fleet } = data;
  return (
    <div>
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name="gauge" size={24} />
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold tracking-tight">{fleet.score}%</span>
            <StatusBadge tone={healthTone(fleet.status)} label={healthLabel(fleet.status)} />
          </div>
          <div className="text-xs text-faint">Global fleet health across {fleet.subsystems.length} subsystems</div>
        </div>
      </div>

      <Grid cols={4}>
        <Stat icon="grid" label="Tenants" value={fleet.totals.tenants} hint={`${fleet.totals.activeTenants} active`} />
        <Stat icon="globe" label="Regions" value={fleet.totals.regions} tone="blue" />
        <Stat icon="server" label="Deployments" value={`${fleet.totals.healthyDeployments}/${fleet.totals.deployments}`} tone="green" />
        <Stat icon="cpu" label="Workers" value={fleet.totals.workers} tone="purple" />
      </Grid>
      <div className="mt-3">
        <Grid cols={4}>
          <Stat icon="user" label="Organizations" value={fleet.totals.organizations} />
          <Stat icon="lock" label="Provisioned users" value={fleet.totals.provisionedUsers} tone="blue" />
          <Stat icon="pulse" label="API requests (30d)" value={fleet.totals.requests30d.toLocaleString()} tone="green" />
          <Stat icon="gauge" label="Health score" value={`${fleet.score}%`} tone={fleet.status === 'healthy' ? 'green' : 'orange'} />
        </Grid>
      </div>

      <OpsPanel title="Subsystem health" subtitle="The managed cloud subsystems, rolled up" className="mt-6 mb-0">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fleet.subsystems.map((sub) => (
            <div key={sub.id} className="rounded-2xl border border-[var(--hairline)] p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
                  <Icon name={subsystemIcon(sub.id)} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{sub.label}</div>
                  <div className="text-2xs text-faint">{sub.detail}</div>
                </div>
                <StatusBadge tone={healthTone(sub.status)} label={healthLabel(sub.status)} />
              </div>
              <div className="mt-2 text-2xs text-faint">
                {sub.metric.toLocaleString()} {sub.unit}
              </div>
            </div>
          ))}
        </div>
      </OpsPanel>
    </div>
  );
}

/* ── Fleet ───────────────────────────────────────────────────────────────── */

function Fleet({ data }: { data: ControlPlaneOverview }): JSX.Element {
  const { fleet } = data;
  return (
    <OpsPanel title={`Fleet · ${healthLabel(fleet.status)}`} subtitle="Detailed subsystem signals across the managed cloud">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {fleet.subsystems.map((sub) => (
          <div key={sub.id} className="rounded-2xl border border-[var(--hairline)] p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
                <Icon name={subsystemIcon(sub.id)} size={17} />
              </span>
              <div className="min-w-0 flex-1 text-sm font-medium">{sub.label}</div>
              <StatusBadge tone={healthTone(sub.status)} label={healthLabel(sub.status)} />
            </div>
            <div className="mt-3">
              <Field label={sub.unit} value={sub.metric.toLocaleString()} />
              <Field label="Detail" value={sub.detail} />
            </div>
          </div>
        ))}
      </div>
    </OpsPanel>
  );
}

/* ── Regions ─────────────────────────────────────────────────────────────── */

function Regions({ data }: { data: ControlPlaneOverview }): JSX.Element {
  return (
    <OpsPanel title={`Regions · ${data.regions.length}`} subtitle="Per-region tenants, deployments, and replication health">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.regions.map((r) => (
          <div key={r.id} className="rounded-2xl border border-[var(--hairline)] p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
                <Icon name="globe" size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.name}</div>
                <div className="text-2xs text-faint">{residencyLabel(r.residency)} · {r.available ? 'available' : 'unavailable'}</div>
              </div>
              <StatusBadge tone={healthTone(r.health)} label={healthLabel(r.health)} />
            </div>
            <div className="mt-3 flex items-center justify-between text-2xs text-faint">
              <span>{r.tenants} tenant(s)</span>
              <span>{r.healthyDeployments}/{r.deployments} deploys</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Pill tone={replicationTone(r.replication)}>{replicationLabel(r.replication)}</Pill>
              {r.lagSeconds > 0 && <span className="text-2xs text-faint">lag {r.lagSeconds}s</span>}
            </div>
          </div>
        ))}
      </div>
    </OpsPanel>
  );
}

/* ── Tenants ─────────────────────────────────────────────────────────────── */

function Tenants({ data }: { data: ControlPlaneOverview }): JSX.Element {
  return (
    <OpsPanel title={`Tenant directory · ${data.tenants.length}`} subtitle="Every managed tenant, home-first">
      {data.tenants.length === 0 ? (
        <EmptyState icon="grid" title="No tenants" hint="Provision a tenant to populate the directory." />
      ) : (
        <VirtualList
          items={data.tenants}
          rowHeight={58}
          height={Math.min(560, Math.max(120, data.tenants.length * 58))}
          rowKey={(t) => t.id}
          renderRow={(t) => (
            <div className="flex h-[54px] items-center gap-3 rounded-xl border border-white/5 px-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted">
                <Icon name="grid" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {t.name}
                  {t.isHome && <span className="ml-1.5 text-2xs text-faint">(home)</span>}
                </div>
                <div className="truncate text-2xs text-faint">{t.regionId} · {residencyLabel(t.residency)} · {fmtGb(t.bytes)}</div>
              </div>
              <Pill tone={tierTone(t.tier)}>{tierLabel(t.tier)}</Pill>
              <Pill tone={statusTone(t.status)}>{t.status}</Pill>
              <StatusBadge tone={healthTone(t.health)} label={healthLabel(t.health)} />
            </div>
          )}
        />
      )}
    </OpsPanel>
  );
}

/* ── Deployments ─────────────────────────────────────────────────────────── */

function Deployments({ data }: { data: ControlPlaneOverview }): JSX.Element {
  return (
    <OpsPanel title={`Deployments · ${data.deployments.length}`} subtitle="Regional API deployments with health-gated promotion (advisory)">
      {data.deployments.length === 0 ? (
        <EmptyState icon="server" title="No deployments" hint="Deployments appear here as services roll out across regions." />
      ) : (
        <div className="rounded-2xl border border-[var(--hairline)]">
          {data.deployments.map((d) => (
            <div key={d.id} className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted">
                <Icon name="server" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.service} <span className="text-2xs text-faint">{d.version}</span></div>
                <div className="truncate text-2xs text-faint">{d.regionId} · {d.healthyReplicas}/{d.replicas} replicas · {d.uptimePct}% · p95 {d.p95LatencyMs}ms</div>
              </div>
              <Pill tone={gateTone(d.gate)}>{gateLabel(d.gate)}</Pill>
              <StatusBadge tone={healthTone(d.status)} label={healthLabel(d.status)} />
            </div>
          ))}
        </div>
      )}
    </OpsPanel>
  );
}

/* ── Usage ───────────────────────────────────────────────────────────────── */

function Usage({ data }: { data: ControlPlaneOverview }): JSX.Element {
  const { usage } = data;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="pulse" label="API requests (30d)" value={usage.requests30d.toLocaleString()} />
        <Stat icon="refresh" label="Sync ops (30d)" value={usage.syncOps30d.toLocaleString()} tone="blue" />
        <Stat icon="cpu" label="Active workers" value={usage.activeWorkers} tone="purple" />
        <Stat icon="database" label="Monthly spend" value={`${usage.currency} ${usage.monthlySpend.toLocaleString()}`} tone="green" />
      </Grid>

      <OpsPanel title="Quotas" subtitle="Usage against the home tenant's plan limits (advisory)" className="mt-6 mb-0">
        <div className="rounded-2xl border border-[var(--hairline)] p-4">
          {usage.quotas.map((q) => (
            <div key={q.resource} className="mb-3 last:mb-0">
              <div className="mb-1 flex items-baseline justify-between text-2xs">
                <span className="text-faint">{q.resource} <span className="ml-1 opacity-70">({tierLabel(q.tier)})</span></span>
                <span className="tabular text-muted">{q.used.toLocaleString()} / {q.limit.toLocaleString()} · {q.utilizationPct}%</span>
              </div>
              <Bar value={q.utilizationPct / 100} tone={utilizationTone(q.utilizationPct)} />
            </div>
          ))}
        </div>
      </OpsPanel>
    </div>
  );
}
