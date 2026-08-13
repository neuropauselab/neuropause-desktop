/**
 * P13 — Industry Center. The curated industry solution-pack surface over the EXISTING platform
 * (AI Workforce, Connectors, Governance, Marketplace). Twelve industry suites — each referencing
 * real workers, connectors, compliance rules and policies — projected against the live deployment
 * for an honest readiness signal. Tabs: Overview (platform rollup + KPIs), Suites (per-industry
 * packs), Compliance (frameworks), Collections (marketplace), and Readiness. Reads via
 * `ipc.industryPlatform.*`; refreshes on the existing `ecosystem:event` broadcast. No new runtime,
 * store, worker, connector, or marketplace.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  ExecutiveKpi,
  IndustryCatalogSnapshot,
  IndustryCollection,
  IndustryComplianceFramework,
  IndustryPlatformOverview,
  IndustrySuite,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { Bar, OpsPanel, Stat, StatusBadge, StatusDot } from '@renderer/operations/primitives';
import { EmptyState, Field, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill } from '@renderer/workforce/primitives';
import {
  activationTone,
  coverageTone,
  entityKindIcon,
  kpiBandTone,
  pct,
  refTone,
  statusLabel,
  statusTone,
} from './industryCenterModel';

type Tab = 'overview' | 'suites' | 'compliance' | 'collections' | 'readiness';

export function IndustryCenterView(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<IndustryPlatformOverview | null>(null);
  // IP-03b — the canonical Wave 9 catalog snapshot, bridged additively alongside the P13 projections.
  const [snapshot, setSnapshot] = useState<IndustryCatalogSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const refresh = useCallback(async () => {
    try {
      setData(await ipc.industryPlatform.overview());
    } catch {
      /* keep last snapshot */
    }
    try {
      setSnapshot(await ipc.industryPlatform.snapshot());
    } catch {
      /* canonical catalog optional — keep last */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.industryPlatform.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Overview', icon: 'grid' },
    { id: 'suites', label: 'Industry Suites', icon: 'package' },
    { id: 'compliance', label: 'Compliance', icon: 'shield' },
    { id: 'collections', label: 'Collections', icon: 'store' },
    { id: 'readiness', label: 'Readiness', icon: 'gauge' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Industry Center</h1>
            <p className="mt-1 text-md text-muted">
              Deployable industry solution packs — AI workers, connectors, compliance and KPIs —
              built on the one platform, no new runtime.
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

        {snapshot ? (
          <p className="mb-4 text-sm text-muted">
            Canonical industry catalog:{' '}
            <span className="font-medium text-ink">{snapshot.industries.length}</span> solution
            packs ·{' '}
            <span className="font-medium text-ink">{snapshot.readiness.liveVerifiedPct}%</span>{' '}
            capabilities live-verified · v{snapshot.version}
          </p>
        ) : null}

        <nav className="mb-6 flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition',
                tab === t.id
                  ? 'bg-white/10 text-ink'
                  : 'text-muted hover:bg-white/5 hover:text-ink',
              )}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </nav>

        {!ready ? (
          <LoadingBlock label="Loading industry platform…" />
        ) : !data ? (
          <EmptyState
            icon="package"
            title="Industry platform unavailable"
            hint="No industry-platform data could be loaded."
          />
        ) : tab === 'overview' ? (
          <Overview data={data} />
        ) : tab === 'suites' ? (
          <Suites suites={data.suites} />
        ) : tab === 'compliance' ? (
          <Compliance
            frameworks={data.compliance.frameworks}
            referenced={data.compliance.rulesReferenced}
            enabled={data.compliance.rulesEnabled}
          />
        ) : tab === 'collections' ? (
          <Collections collections={data.collections} />
        ) : (
          <Readiness data={data} />
        )}
      </div>
    </div>
  );
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function KpiStrip({ kpis }: { kpis: ExecutiveKpi[] }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {kpis.map((k) => (
        <div key={k.key} className="rounded-2xl border border-[var(--hairline)] p-3">
          <div className="flex items-center gap-1.5">
            <StatusDot tone={kpiBandTone(k.band)} />
            <span className="truncate text-2xs text-faint">{k.label}</span>
          </div>
          <div className="mt-1 text-lg font-semibold tabular">{k.display}</div>
        </div>
      ))}
    </div>
  );
}

function Overview({ data }: { data: IndustryPlatformOverview }): JSX.Element {
  const s = data.summary;
  return (
    <div>
      <Grid cols={4}>
        <Stat
          icon="package"
          label="Suites ready"
          value={`${s.ready}/${s.totalSuites}`}
          tone="green"
          hint={`${s.partial} partial · ${s.planned} planned`}
        />
        <Stat
          icon="cpu"
          label="Workers available"
          value={`${s.workersAvailable}/${s.workersReferenced}`}
          tone="blue"
        />
        <Stat
          icon="connectors"
          label="Connectors connected"
          value={`${s.connectorsConnected}/${s.connectorsReferenced}`}
          tone={s.connectorsConnected ? 'green' : 'orange'}
        />
        <Stat
          icon="shield"
          label="Compliance frameworks"
          value={s.complianceFrameworks}
          tone="purple"
        />
      </Grid>

      <div className="mt-6">
        <KpiStrip kpis={data.kpis} />
      </div>

      <OpsPanel
        title="Industry suites"
        subtitle="Deployment readiness by vertical"
        className="mt-6 mb-0"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.suites.map((suite) => (
            <div
              key={suite.id}
              className="flex items-center gap-2 rounded-xl border border-white/5 px-3 py-2"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted">
                <Icon name="package" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{suite.name}</div>
                <div className="truncate text-2xs text-faint">{suite.sector}</div>
              </div>
              <Pill tone={statusTone(suite.status)}>{statusLabel(suite.status)}</Pill>
            </div>
          ))}
        </div>
      </OpsPanel>
    </div>
  );
}

/* ── Suites ──────────────────────────────────────────────────────────────── */

function RefSummary({
  label,
  icon,
  active,
  total,
  verb,
}: {
  label: string;
  icon: IconName;
  active: number;
  total: number;
  verb: string;
}): JSX.Element {
  const tone = total === 0 ? 'gray' : active === total ? 'green' : active > 0 ? 'orange' : 'gray';
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/5 px-2.5 py-1.5">
      <Icon name={icon} size={14} />
      <span className="flex-1 text-2xs text-faint">{label}</span>
      <Pill tone={tone}>
        {active}/{total} {verb}
      </Pill>
    </div>
  );
}

function SuiteCard({ suite }: { suite: IndustrySuite }): JSX.Element {
  const r = suite.readiness;
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="flex items-start gap-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name="package" size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{suite.name}</span>
            <StatusBadge tone={statusTone(suite.status)} label={statusLabel(suite.status)} />
          </div>
          <div className="text-2xs text-faint">{suite.sector}</div>
        </div>
      </div>

      <p className="mt-2 text-2xs text-muted">{suite.summary}</p>

      <div className="mt-3 space-y-2">
        <div>
          <div className="mb-1 flex items-baseline justify-between text-2xs">
            <span className="text-faint">Platform coverage</span>
            <span className="tabular text-muted">{pct(r.coverage)}</span>
          </div>
          <Bar value={r.coverage} tone={coverageTone(r.coverage)} />
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between text-2xs">
            <span className="text-faint">Deployment activation</span>
            <span className="tabular text-muted">{pct(r.activation)}</span>
          </div>
          <Bar value={r.activation} tone={activationTone(r.activation)} />
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <RefSummary
          label="AI workers"
          icon="cpu"
          active={r.workers.available}
          total={r.workers.referenced}
          verb="active"
        />
        <RefSummary
          label="Connectors"
          icon="connectors"
          active={r.connectors.connected}
          total={r.connectors.referenced}
          verb="connected"
        />
        <RefSummary
          label="Compliance rules"
          icon="shield"
          active={r.compliance.enabled}
          total={r.compliance.referenced}
          verb="enabled"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {suite.frameworks.map((f) => (
          <span
            key={f.id}
            className="rounded-full border border-white/5 px-1.5 py-0.5 text-2xs text-faint"
          >
            {f.name}
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {suite.systems.slice(0, 6).map((sys) => (
          <span key={sys} className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-2xs text-muted">
            {sys}
          </span>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Field label="KPIs" value={suite.counts.kpis} />
        <Field label="Dashboards" value={suite.counts.dashboards} />
        <Field label="Automations" value={suite.counts.automations} />
        <Field label="Playbooks" value={suite.counts.playbooks} />
        <Field label="Reports" value={suite.counts.reports} />
        <Field label="Templates" value={suite.counts.templates} />
      </div>
    </div>
  );
}

function Suites({ suites }: { suites: IndustrySuite[] }): JSX.Element {
  if (suites.length === 0) {
    return (
      <EmptyState
        icon="package"
        title="No industry suites"
        hint="Industry solution packs appear here."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {suites.map((s) => (
        <SuiteCard key={s.id} suite={s} />
      ))}
    </div>
  );
}

/* ── Compliance ──────────────────────────────────────────────────────────── */

function Compliance({
  frameworks,
  referenced,
  enabled,
}: {
  frameworks: IndustryComplianceFramework[];
  referenced: number;
  enabled: number;
}): JSX.Element {
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="shield" label="Frameworks" value={frameworks.length} tone="purple" />
        <Stat icon="checklist" label="Rules referenced" value={referenced} />
        <Stat
          icon="check"
          label="Rules enabled"
          value={`${enabled}/${referenced}`}
          tone={enabled === referenced ? 'green' : 'orange'}
        />
      </Grid>

      <OpsPanel
        title="Compliance frameworks"
        subtitle="Frameworks mapped to the platform's generic governance controls — shows backing controls enabled, not a formal attestation"
        className="mt-6 mb-0"
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {frameworks.map((f) => (
            <div key={f.id} className="rounded-2xl border border-[var(--hairline)] p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
                  <Icon name="shield" size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{f.name}</div>
                  <div className="text-2xs text-faint">{f.industries.length} industries</div>
                </div>
                <Pill tone={statusTone(f.status)}>
                  {f.enabled}/{f.total} enabled
                </Pill>
              </div>
              <p className="mt-2 text-2xs text-muted">{f.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {f.ruleRefs.map((ref) => (
                  <span
                    key={ref.id}
                    className="inline-flex items-center gap-1 rounded-full border border-white/5 px-1.5 py-0.5 text-2xs text-faint"
                  >
                    <StatusDot tone={refTone(ref)} />
                    {ref.id}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </OpsPanel>
    </div>
  );
}

/* ── Collections ─────────────────────────────────────────────────────────── */

function Collections({ collections }: { collections: IndustryCollection[] }): JSX.Element {
  return (
    <OpsPanel
      title="Industry collections"
      subtitle="Curated marketplace bundles per industry (published listings resolved live)"
      className="mb-0"
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {collections.map((c) => (
          <div key={c.id} className="rounded-2xl border border-[var(--hairline)] p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
                <Icon name="store" size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="text-2xs text-faint">{c.sector}</div>
              </div>
              <Pill tone={c.available === c.total ? 'green' : c.available > 0 ? 'orange' : 'gray'}>
                {c.available}/{c.total} live
              </Pill>
            </div>
            <div className="mt-2 flex flex-col gap-1">
              {c.entries.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-2 rounded-lg border border-white/5 px-2.5 py-1.5"
                >
                  <Icon name={entityKindIcon(e.kind)} size={14} />
                  <span className="flex-1 truncate text-2xs text-muted">{e.label}</span>
                  <StatusBadge tone={refTone(e)} label={e.present ? 'published' : 'absent'} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </OpsPanel>
  );
}

/* ── Readiness ───────────────────────────────────────────────────────────── */

function Readiness({ data }: { data: IndustryPlatformOverview }): JSX.Element {
  const suites = [...data.suites].sort((a, b) => b.readiness.activation - a.readiness.activation);
  return (
    <OpsPanel
      title="Deployment readiness"
      subtitle="Per-industry platform coverage and live activation"
      className="mb-0"
    >
      <div className="rounded-2xl border border-[var(--hairline)]">
        {suites.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-0"
          >
            <div className="w-40 min-w-0">
              <div className="truncate text-sm font-medium">{s.name}</div>
              <div className="truncate text-2xs text-faint">{s.sector}</div>
            </div>
            <div className="flex-1">
              <div className="mb-1 flex items-baseline justify-between text-2xs">
                <span className="text-faint">activation</span>
                <span className="tabular text-muted">{pct(s.readiness.activation)}</span>
              </div>
              <Bar value={s.readiness.activation} tone={activationTone(s.readiness.activation)} />
            </div>
            <Pill tone={statusTone(s.status)}>{statusLabel(s.status)}</Pill>
          </div>
        ))}
      </div>
    </OpsPanel>
  );
}
