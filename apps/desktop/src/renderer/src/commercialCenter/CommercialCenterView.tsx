/**
 * P20 — Commercial Center (the NeuroPause Platform v2 commercial dashboard). A continuously-updated,
 * READ-ONLY view of the commercial layer: the 7-tier subscription catalog, license & seat management, the
 * billing center + marketplace revenue, usage metering, tenant provisioning & the 5 deployment modes,
 * customer success (health / onboarding / renewal), product analytics + ROI, the release center + feature
 * flags, organization administration, and the commercial security posture. Nothing here transacts — no
 * plan change, charge, seat assignment, or provisioning; those flow through the existing billing engine and
 * cloud control plane. No payment secret is ever shown.
 * Reads via `ipc.commercial.*`; refreshes on the existing `ecosystem:event` broadcast.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  CommercialAdministration,
  CommercialAnalytics,
  CommercialBilling,
  CommercialCustomers,
  CommercialDeployment,
  CommercialGovernance,
  CommercialLicensing,
  CommercialMetering,
  CommercialModuleStatus,
  CommercialOverview,
  CommercialReleases,
  CommercialSubscription,
  CommercialTier,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { Bar, OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill } from '@renderer/workforce/primitives';
import { bandLabel, bandTone, modeIcon, moduleIcon, priceModelLabel, segmentLabel, segmentTone } from './commercialCenterModel';

type Tab = 'overview' | 'subscription' | 'licensing' | 'billing' | 'usage' | 'deployment' | 'customers' | 'analytics' | 'releases' | 'administration' | 'governance';

export function CommercialCenterView(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<CommercialOverview | null>(null);
  const [subscription, setSubscription] = useState<CommercialSubscription | null>(null);
  const [licensing, setLicensing] = useState<CommercialLicensing | null>(null);
  const [billing, setBilling] = useState<CommercialBilling | null>(null);
  const [metering, setMetering] = useState<CommercialMetering | null>(null);
  const [deployment, setDeployment] = useState<CommercialDeployment | null>(null);
  const [customers, setCustomers] = useState<CommercialCustomers | null>(null);
  const [analytics, setAnalytics] = useState<CommercialAnalytics | null>(null);
  const [releases, setReleases] = useState<CommercialReleases | null>(null);
  const [administration, setAdministration] = useState<CommercialAdministration | null>(null);
  const [governance, setGovernance] = useState<CommercialGovernance | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [o, sub, lic, bill, met, dep, cust, an, rel, adm, gov] = await Promise.all([
        ipc.commercial.overview(),
        ipc.commercial.subscription(),
        ipc.commercial.licensing(),
        ipc.commercial.billing(),
        ipc.commercial.metering(),
        ipc.commercial.deployment(),
        ipc.commercial.customers(),
        ipc.commercial.analytics(),
        ipc.commercial.releases(),
        ipc.commercial.administration(),
        ipc.commercial.governance(),
      ]);
      setOverview(o);
      setSubscription(sub);
      setLicensing(lic);
      setBilling(bill);
      setMetering(met);
      setDeployment(dep);
      setCustomers(cust);
      setAnalytics(an);
      setReleases(rel);
      setAdministration(adm);
      setGovernance(gov);
    } catch {
      /* keep last snapshot */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.commercial.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Commercial', icon: 'store' },
    { id: 'subscription', label: 'Subscription', icon: 'sparkles' },
    { id: 'licensing', label: 'Licensing', icon: 'lock' },
    { id: 'billing', label: 'Billing', icon: 'analytics' },
    { id: 'usage', label: 'Usage', icon: 'pulse' },
    { id: 'deployment', label: 'Deployment', icon: 'globe' },
    { id: 'customers', label: 'Customers', icon: 'grid' },
    { id: 'analytics', label: 'Analytics', icon: 'lightbulb' },
    { id: 'releases', label: 'Releases', icon: 'refresh' },
    { id: 'administration', label: 'Administration', icon: 'shield' },
    { id: 'governance', label: 'Governance', icon: 'command' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">NeuroPause Platform v2</h1>
            <p className="mt-1 text-md text-muted">
              The commercial layer — buy, deploy, license, operate, govern, and scale the platform. It unifies the existing billing, licensing, tenancy, org, and usage systems into customer-facing views; nothing here transacts — plan changes, charges, seat assignments, and provisioning flow through the existing billing engine and cloud control plane, and no payment secret is ever shown.
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
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                tab === t.id ? 'bg-white/[0.08] text-ink' : 'text-muted hover:text-ink',
              )}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </nav>

        {!ready ? (
          <LoadingBlock label="Composing the commercial platform…" />
        ) : !overview ? (
          <EmptyState icon="store" title="Commercial platform unavailable" hint="No commercial data could be loaded." />
        ) : tab === 'overview' ? (
          <Overview overview={overview} />
        ) : tab === 'subscription' ? (
          <Subscription subscription={subscription} />
        ) : tab === 'licensing' ? (
          <Licensing licensing={licensing} />
        ) : tab === 'billing' ? (
          <Billing billing={billing} />
        ) : tab === 'usage' ? (
          <Usage metering={metering} />
        ) : tab === 'deployment' ? (
          <Deployment deployment={deployment} />
        ) : tab === 'customers' ? (
          <Customers customers={customers} />
        ) : tab === 'analytics' ? (
          <Analytics analytics={analytics} />
        ) : tab === 'releases' ? (
          <Releases releases={releases} />
        ) : tab === 'administration' ? (
          <Administration administration={administration} />
        ) : (
          <Governance governance={governance} />
        )}
      </div>
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

function ModuleCard({ m }: { m: CommercialModuleStatus }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name={moduleIcon(m.id)} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{m.name}</span>
            <StatusBadge tone={bandTone(m.band)} label={bandLabel(m.band)} />
            {!m.live && <Pill tone="gray">idle</Pill>}
          </div>
          <div className="text-2xs text-faint">{m.coordinates}</div>
        </div>
        <div className="text-right text-lg font-semibold tabular">{m.entityCount.toLocaleString()}</div>
      </div>
      <div className="mt-2 text-2xs text-faint">source: {m.source}</div>
    </div>
  );
}

function Overview({ overview }: { overview: CommercialOverview }): JSX.Element {
  const s = overview.summary;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="sparkles" label="Commercial tier" value={s.tierName} hint={s.subscriptionStatus} />
        <Stat icon="lock" label="Seats" value={`${s.seatsUsed}${s.seats < 0 ? '' : ` / ${s.seats}`}`} tone="blue" />
        <Stat icon="store" label="Est. monthly" value={`${s.currency}${s.estimatedMonthlyCost.toLocaleString()}`} tone="purple" />
        <Stat icon="pulse" label="Customer health" value={`${s.healthOverall}/100`} tone={bandTone(s.healthBand)} />
      </Grid>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat icon="globe" label="Deployment" value={s.currentDeploymentMode.replace('_', ' ')} hint={`${s.tenants} tenants · ${s.activeRegions} regions`} />
        <Stat icon="grid" label="Adoption" value={`${s.adoptionScore}/100`} tone={bandTone(s.healthBand)} />
        <Stat icon="lightbulb" label="Monthly value (ROI)" value={`${s.currency}${s.monthlySavingUsd.toLocaleString()}`} tone="green" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {overview.modules.map((m) => (
          <ModuleCard key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}

/* ── Subscription (7-tier catalog) ────────────────────────────────────────── */

function TierCard({ t }: { t: CommercialTier }): JSX.Element {
  return (
    <div className={cn('rounded-2xl border p-4', t.current ? 'border-[color:var(--accent)] [background:var(--fill-1)]' : 'border-[var(--hairline)]')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{t.name}</span>
        {t.current && <StatusBadge tone="green" label="Current" />}
        <Pill tone={segmentTone(t.segment)}>{segmentLabel(t.segment)}</Pill>
      </div>
      <div className="mt-1 text-lg font-semibold">{t.priceHint}</div>
      <div className="text-2xs text-faint">{priceModelLabel(t.priceModel)} · {t.seatModel} · {t.targetSegment}</div>
      <ul className="mt-2 space-y-1">
        {t.entitlements.map((e) => (
          <li key={e} className="flex items-start gap-1.5 text-2xs text-muted"><Icon name="arrow-right" size={11} /> <span>{e}</span></li>
        ))}
      </ul>
    </div>
  );
}

function Subscription({ subscription }: { subscription: CommercialSubscription | null }): JSX.Element {
  if (!subscription) return <EmptyState icon="sparkles" title="No subscription" hint="No subscription data available." />;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="sparkles" label="Current tier" value={subscription.tierName} hint={subscription.status} />
        <Stat icon="lock" label="Entitled plan" value={subscription.entitledPlan} tone={subscription.licenseState === 'valid' ? 'green' : 'orange'} />
        <Stat icon="command" label="License" value={subscription.licenseState} tone={subscription.licenseState === 'valid' ? 'green' : subscription.licenseState === 'grace' ? 'orange' : 'red'} />
        <Stat icon="refresh" label="Renews" value={subscription.renewsAt.slice(0, 10)} />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {subscription.tiers.map((t) => (
          <TierCard key={t.id} t={t} />
        ))}
      </div>
    </div>
  );
}

/* ── Licensing ────────────────────────────────────────────────────────────── */

function Licensing({ licensing }: { licensing: CommercialLicensing | null }): JSX.Element {
  if (!licensing) return <EmptyState icon="lock" title="No licensing" hint="No licensing data available." />;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="lock" label="Seats used" value={`${licensing.seatsUsed}${licensing.seatsTotal < 0 ? '' : ` / ${licensing.seatsTotal}`}`} />
        <Stat icon="grid" label="Seat utilization" value={`${licensing.seatUtilizationPct}%`} tone="blue" />
        <Stat icon="package" label="Active licenses" value={licensing.activeLicenses} tone="green" />
        <Stat icon="command" label="License state" value={licensing.licenseState} tone={bandTone(licensing.licenseBand)} />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OpsPanel title="Seat assignments" subtitle="Joined to org members">
          {licensing.seats.length === 0 ? (
            <p className="px-1 py-3 text-2xs text-faint">No seats assigned.</p>
          ) : (
            <div className="divide-y divide-[var(--hairline)]">
              {licensing.seats.map((s) => (
                <div key={s.seatId} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-2xs">{s.userName}</span>
                  {s.bound ? <Pill tone="green">member</Pill> : <Pill tone="orange">unbound</Pill>}
                  <span className="text-2xs text-faint">{s.assignedAt.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
        <OpsPanel title="Licenses">
          {licensing.licenses.length === 0 ? (
            <p className="px-1 py-3 text-2xs text-faint">No licenses issued.</p>
          ) : (
            <div className="divide-y divide-[var(--hairline)]">
              {licensing.licenses.map((l) => (
                <div key={l.id} className="flex items-center gap-2 py-2">
                  <StatusBadge tone={bandTone(l.band)} label={l.status} />
                  <span className="min-w-0 flex-1 truncate text-2xs">{l.listingName}</span>
                  <Pill tone="gray">{l.kind}</Pill>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>
    </div>
  );
}

/* ── Billing ──────────────────────────────────────────────────────────────── */

function Billing({ billing }: { billing: CommercialBilling | null }): JSX.Element {
  if (!billing) return <EmptyState icon="analytics" title="No billing" hint="No billing data available." />;
  return (
    <div>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
        <Icon name="lock" size={15} />
        <span className="text-2xs text-muted">Figures are derived aggregates (plan price, metered requests, marketplace purchases). No card, token, or payment-provider id is shown, and no charge is made here.</span>
      </div>
      <Grid cols={4}>
        <Stat icon="store" label={`${billing.planName} plan`} value={`${billing.currency}${billing.priceMonthly}/mo`} />
        <Stat icon="analytics" label="Est. this period" value={`${billing.currency}${billing.estimatedCost.toLocaleString()}`} tone="blue" />
        <Stat icon="pulse" label="Metered requests" value={billing.periodRequests.toLocaleString()} hint={`${billing.includedRequests.toLocaleString()} included`} />
        <Stat icon="lightbulb" label="Marketplace spend" value={`${billing.currency}${billing.revenueGross.toLocaleString()}`} tone="green" hint={`lifetime · ${billing.currency}${billing.revenuePlatformFees} fees`} />
      </Grid>
      <OpsPanel title={`Invoice — ${billing.invoicePeriod}`} subtitle={`${billing.invoiceStatus} · total ${billing.currency}${billing.invoiceTotal.toLocaleString()}`} className="mt-6">
        {billing.invoiceLines.length === 0 ? (
          <p className="px-1 py-3 text-2xs text-faint">No invoice lines.</p>
        ) : (
          <div className="divide-y divide-[var(--hairline)]">
            {billing.invoiceLines.map((l, i) => (
              <div key={i} className="flex items-center gap-2 py-2">
                <Pill tone="gray">{l.kind}</Pill>
                <span className="min-w-0 flex-1 truncate text-2xs">{l.description}</span>
                <span className="text-2xs text-faint">{l.quantity} × {billing.currency}{l.unitPrice}</span>
                <span className="text-2xs font-semibold tabular">{billing.currency}{l.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Usage metering ───────────────────────────────────────────────────────── */

function Usage({ metering }: { metering: CommercialMetering | null }): JSX.Element {
  if (!metering) return <EmptyState icon="pulse" title="No usage" hint="No usage metering available." />;
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="pulse" label="Requests (30d)" value={metering.requests30d.toLocaleString()} />
        <Stat icon="lightbulb" label="AI cost (MTD)" value={`${metering.currency}${metering.aiCostUsd}`} tone="blue" />
        <Stat icon="store" label="Cloud spend" value={`${metering.currency}${metering.monthlySpend}`} tone="purple" />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {metering.meters.map((m) => (
          <div key={m.key} className="rounded-2xl border border-[var(--hairline)] p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{m.label}</span>
              <span className="ml-auto"><StatusBadge tone={bandTone(m.band)} label={m.display} /></span>
            </div>
            {m.utilizationPct != null && <div className="mt-2"><Bar value={m.utilizationPct / 100} tone={bandTone(m.band)} /></div>}
            <div className="mt-2 text-2xs text-faint">source: {m.source}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Deployment (tenants + 5 modes) ───────────────────────────────────────── */

function Deployment({ deployment }: { deployment: CommercialDeployment | null }): JSX.Element {
  if (!deployment) return <EmptyState icon="globe" title="No deployment" hint="No deployment data available." />;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="globe" label="Tenants" value={deployment.tenantsTotal} hint={`${deployment.tenantsActive} active · ${deployment.tenantsProvisioning} provisioning`} />
        <Stat icon="grid" label="Active regions" value={deployment.activeRegions} tone="blue" />
        <Stat icon="shield" label="SSO" value={`${deployment.ssoActive}/${deployment.ssoConnections}`} hint={deployment.scimEnabled ? 'SCIM on' : 'SCIM off'} />
        <Stat icon="lock" label="MFA" value={deployment.mfaRequired ? 'Required' : 'Optional'} tone={deployment.mfaRequired ? 'green' : 'orange'} />
      </Grid>
      <OpsPanel title="Deployment modes" subtitle="Commercial deployment offerings" className="mt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {deployment.modes.map((m) => (
            <div key={m.id} className={cn('rounded-xl border p-3', m.current ? 'border-[color:var(--accent)] [background:var(--fill-1)]' : 'border-[var(--hairline)]')}>
              <div className="flex items-center gap-2">
                <Icon name={modeIcon(m.id)} size={15} />
                <span className="text-2xs font-semibold">{m.name}</span>
                {m.current && <span className="ml-auto"><StatusBadge tone="green" label="Current" /></span>}
              </div>
              <div className="mt-1.5 text-2xs text-muted">{m.description}</div>
              <div className="mt-1.5 text-2xs text-faint">{m.isolation} · {m.residencySupport}</div>
            </div>
          ))}
        </div>
      </OpsPanel>
      <OpsPanel title="Regions" className="mt-4">
        <div className="divide-y divide-[var(--hairline)]">
          {deployment.regions.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-2">
              <StatusBadge tone={bandTone(r.band)} label={r.residency.toUpperCase()} />
              <span className="min-w-0 flex-1 truncate text-2xs">{r.name}</span>
              <span className="text-2xs text-faint">{r.tenants} tenants · {r.deployments} deps · {r.replication}</span>
            </div>
          ))}
        </div>
      </OpsPanel>
    </div>
  );
}

/* ── Customers ────────────────────────────────────────────────────────────── */

function Customers({ customers }: { customers: CommercialCustomers | null }): JSX.Element {
  if (!customers) return <EmptyState icon="grid" title="No customer data" hint="No customer success data available." />;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="pulse" label="Customer health" value={`${customers.healthOverall}/100`} tone={bandTone(customers.healthBand)} />
        <Stat icon="grid" label="Adoption" value={`${customers.adoptionScore}/100`} tone="blue" />
        <Stat icon="refresh" label="Onboarding" value={`${customers.onboardingProgressPct}%`} tone={customers.onboardingCompleted ? 'green' : 'orange'} />
        <Stat icon="command" label="Renewal" value={`${customers.daysToRenewal}d`} tone={bandTone(customers.renewalRisk)} hint={customers.renewsAt.slice(0, 10)} />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OpsPanel title="Health dimensions">
          <div className="space-y-2">
            {customers.dimensions.map((d) => (
              <div key={d.key}>
                <div className="flex items-center gap-2 text-2xs"><span className="flex-1">{d.label}</span><StatusBadge tone={bandTone(d.band)} label={`${d.score}`} /></div>
                <div className="mt-1"><Bar value={d.score / 100} tone={bandTone(d.band)} /></div>
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Onboarding" subtitle={customers.onboardingNextStep ? `Next: ${customers.onboardingNextStep}` : 'Complete'}>
          <div className="divide-y divide-[var(--hairline)]">
            {customers.onboardingSteps.map((st) => (
              <div key={st.id} className="flex items-center gap-2 py-2">
                <Icon name={st.done ? 'arrow-right' : 'dot'} size={13} />
                <span className="min-w-0 flex-1 truncate text-2xs">{st.title}</span>
                {st.done ? <Pill tone="green">done</Pill> : <Pill tone="gray">todo</Pill>}
              </div>
            ))}
          </div>
        </OpsPanel>
      </div>
    </div>
  );
}

/* ── Analytics ────────────────────────────────────────────────────────────── */

function Analytics({ analytics }: { analytics: CommercialAnalytics | null }): JSX.Element {
  if (!analytics) return <EmptyState icon="lightbulb" title="No analytics" hint="No product analytics available." />;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="lightbulb" label="Monthly value" value={`$${analytics.monthlySavingUsd.toLocaleString()}`} tone="green" />
        <Stat icon="pulse" label="AI cost" value={`$${analytics.aiCostUsd}`} tone="blue" />
        <Stat icon="store" label="Cloud spend" value={`$${analytics.cloudSpendUsd}`} tone="purple" />
        <Stat icon="grid" label="ROI" value={analytics.roiRatio == null ? 'n/a' : `${analytics.roiRatio}×`} tone={analytics.roiRatio != null && analytics.roiRatio >= 1 ? 'green' : 'orange'} />
      </Grid>
      <OpsPanel title="Adoption dimensions" className="mt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {analytics.dimensions.map((d) => (
            <div key={d.key} className="rounded-xl border border-[var(--hairline)] p-3">
              <div className="flex items-center gap-2">
                <span className="text-2xs font-semibold">{d.label}</span>
                <span className="ml-auto"><StatusBadge tone={bandTone(d.band)} label={d.display} /></span>
              </div>
              <div className="mt-1 text-2xs text-faint">{d.detail}</div>
            </div>
          ))}
        </div>
      </OpsPanel>
    </div>
  );
}

/* ── Releases + flags ─────────────────────────────────────────────────────── */

function Releases({ releases }: { releases: CommercialReleases | null }): JSX.Element {
  if (!releases) return <EmptyState icon="refresh" title="No releases" hint="No release data available." />;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="refresh" label="Version" value={releases.currentVersion} hint={releases.updateChannel} />
        <Stat icon="command" label="Update" value={releases.updateAvailable ?? releases.updatePhase} tone={releases.updateAvailable ? 'blue' : 'green'} />
        <Stat icon="sparkles" label="Feature flags" value={`${releases.enabledFlags}/${releases.totalFlags}`} tone="blue" />
        <Stat icon="lock" label="Entitled plan" value={releases.entitledPlan} tone="purple" />
      </Grid>
      <OpsPanel title="Feature flags (plan entitlements)" className="mt-6">
        {releases.featureFlags.length === 0 ? (
          <p className="px-1 py-3 text-2xs text-faint">No feature flags.</p>
        ) : (
          <div className="divide-y divide-[var(--hairline)]">
            {releases.featureFlags.map((f) => (
              <div key={f.key} className="flex items-center gap-2 py-2">
                {f.enabled ? <Pill tone="green">on</Pill> : <Pill tone="gray">off</Pill>}
                <span className="min-w-0 flex-1 truncate text-2xs">{f.description}</span>
                <Pill tone="gray">{f.source}</Pill>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Administration ───────────────────────────────────────────────────────── */

function Administration({ administration }: { administration: CommercialAdministration | null }): JSX.Element {
  if (!administration) return <EmptyState icon="shield" title="No administration" hint="No administration data available." />;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="shield" label="Users" value={administration.usersTotal} hint={`${administration.usersHuman} human · ${administration.usersAiWorker} AI`} />
        <Stat icon="grid" label="Departments" value={administration.departments} tone="blue" />
        <Stat icon="lock" label="Roles" value={administration.roles.length} tone="purple" />
        <Stat icon="command" label="Policies" value={administration.approvalChains + administration.complianceRules} hint={`${administration.approvalChains} chains · ${administration.complianceRules} rules`} />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OpsPanel title="RBAC roles">
          <div className="divide-y divide-[var(--hairline)]">
            {administration.roles.map((r) => (
              <div key={r.name} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-2xs">{r.name}</span>
                {r.builtIn && <Pill tone="gray">built-in</Pill>}
                <span className="text-2xs text-faint">{r.permissionCount} perms</span>
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Membership">
          <div className="grid grid-cols-2 gap-3">
            <Stat icon="grid" label="Active" value={administration.usersActive} tone="green" />
            <Stat icon="command" label="Invited" value={administration.usersInvited} tone="orange" />
            <Stat icon="lock" label="Suspended" value={administration.usersSuspended} tone={administration.usersSuspended > 0 ? 'red' : 'gray'} />
            <Stat icon="shield" label="Workspaces" value={administration.workspaces} />
          </div>
        </OpsPanel>
      </div>
    </div>
  );
}

/* ── Governance ───────────────────────────────────────────────────────────── */

function Governance({ governance }: { governance: CommercialGovernance | null }): JSX.Element {
  if (!governance) return <EmptyState icon="command" title="No governance" hint="No governance posture available." />;
  return (
    <div>
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-[color:var(--danger-soft-border,var(--hairline))] [background:var(--fill-1)] px-3 py-2.5">
        <Icon name="lock" size={16} />
        <div>
          <div className="text-2xs font-semibold text-ink">Data protection</div>
          <div className="text-2xs text-muted">{governance.dataProtection}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OpsPanel title="Reused systems" subtitle="Each keeps its own production RBAC scope">
          <div className="divide-y divide-[var(--hairline)]">
            {governance.reusedSystems.map((r) => (
              <div key={r.system} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-2xs">{r.system}</span>
                <Pill tone="gray">{r.permission}</Pill>
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Audit + sanitization posture">
          <div className="space-y-1.5">
            {governance.auditSources.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-2xs text-muted"><Icon name="grid" size={12} /> {a}</div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5 border-t border-[var(--hairline)] pt-3">
            {governance.redactions.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-2xs text-faint"><Icon name="lock" size={12} /> <span>{r}</span></div>
            ))}
          </div>
        </OpsPanel>
      </div>
    </div>
  );
}
