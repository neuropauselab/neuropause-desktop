/**
 * Product Operations & Release Management v1.0 — the Product Operations lens.
 *
 * A continuously-updated, READ-ONLY operations dashboard: Release, Health, Quality/Certification, Commercial,
 * Deployment, Support, Marketplace and Engineering. It is a PRESENTATION LAYER — it composes EXISTING IPC
 * (updater, release diagnostics, feature flags, system health, supervisor, crash/recovery, commercial,
 * marketplace, connectors, enterprise modules) plus the renderer-static capability registry. It creates no
 * runtime, engine, store, or IPC channel, transacts nothing, and deep-links to the existing detailed centers
 * rather than duplicating them. Operational capabilities the platform lacks in-app are shown honestly, never
 * fabricated.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  AppInfo,
  BackupInfo,
  CommercialDeployment,
  CommercialOverview,
  ConnectorStats,
  CrashStatus,
  EnterpriseModuleSummary,
  FeatureFlagState,
  FeedbackEntry,
  MarketplaceEntry,
  RecoveryRecommendation,
  ReleaseDiagnostics,
  SafeModeState,
  SupervisorStatus,
  SystemHealthSnapshot,
} from '@neuropause/shared';
import type { SectionId } from '@renderer/shell/sections';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Field, Grid, KpiCard, LoadingBlock, Meter } from '@renderer/operationsCenter/primitives';
import { formatUptime } from '@renderer/operations/lib';
import { computeMaturity } from '@renderer/capability/capabilityRegistry';
import {
  DEPLOYMENT_TARGETS,
  OPERATIONAL_GAPS,
  describeLoadFailures,
  deriveReleaseReadiness,
  diagnosticTone,
  flagSourceLabel,
  gapKindMeta,
  healthLevelTone,
  signingMeta,
  targetStatusMeta,
  updatePhaseMeta,
  type GapKind,
} from './productOpsModel';

type Tab = 'overview' | 'release' | 'health' | 'quality' | 'commercial' | 'deployment' | 'support' | 'marketplace' | 'engineering';

interface Data {
  app: AppInfo | null;
  diag: ReleaseDiagnostics | null;
  health: SystemHealthSnapshot | null;
  supervisor: SupervisorStatus | null;
  crash: CrashStatus | null;
  crashRecs: RecoveryRecommendation[];
  safeMode: SafeModeState | null;
  backups: BackupInfo[];
  feedback: FeedbackEntry[];
  flags: FeatureFlagState[];
  modules: EnterpriseModuleSummary[];
  connectors: ConnectorStats | null;
  marketplace: MarketplaceEntry[];
  commercial: CommercialOverview | null;
  deployment: CommercialDeployment | null;
}

const EMPTY: Data = {
  app: null, diag: null, health: null, supervisor: null, crash: null, crashRecs: [], safeMode: null,
  backups: [], feedback: [], flags: [], modules: [], connectors: null, marketplace: [], commercial: null, deployment: null,
};

/**
 * Per-source fallback that RECORDS the failure by name (NP-008 F-N8-3): a source
 * that could not load — refused, unavailable, or failed — must surface in the
 * honest banner instead of silently rendering its fallback as data.
 */
async function settled<T>(p: Promise<T>, fallback: T, name: string, failures: string[]): Promise<T> {
  try {
    return await p;
  } catch {
    failures.push(name);
    return fallback;
  }
}

export function ProductOpsView({ onOpenSection }: { onOpenSection?: (id: SectionId) => void }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [d, setD] = useState<Data>(EMPTY);
  const [loadFailures, setLoadFailures] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const failures: string[] = [];
    const [app, diag, health, supervisor, crash, crashRecs, safeMode, backups, feedback, flags, modules, connectors, marketplace, commercial, deployment] =
      await Promise.all([
        settled(ipc.app.getInfo(), null, 'App info', failures),
        settled(ipc.releaseOps.diagnostics(), null, 'Release diagnostics', failures),
        settled(ipc.system.health(), null, 'System health', failures),
        settled(ipc.supervisor.status(), null, 'Supervisor', failures),
        settled(ipc.releaseOps.crashStatus(), null, 'Crash status', failures),
        settled(ipc.releaseOps.crashRecommendations(), [] as RecoveryRecommendation[], 'Crash recommendations', failures),
        settled(ipc.releaseOps.safeModeStatus(), null, 'Safe mode', failures),
        settled(ipc.releaseOps.listBackups(), [] as BackupInfo[], 'Backups', failures),
        settled(ipc.feedback.list(), [] as FeedbackEntry[], 'Feedback', failures),
        settled(ipc.flags.get('free'), [] as FeatureFlagState[], 'Feature flags', failures),
        settled(ipc.enterpriseModules.list(), [] as EnterpriseModuleSummary[], 'Enterprise modules', failures),
        settled(ipc.connectors.stats(), null, 'Connector stats', failures),
        settled(ipc.marketplace.catalog(), [] as MarketplaceEntry[], 'Marketplace catalog', failures),
        settled(ipc.commercial.overview(), null, 'Commercial overview', failures),
        settled(ipc.commercial.deployment(), null, 'Deployment', failures),
      ]);
    setD({ app, diag, health, supervisor, crash, crashRecs, safeMode, backups, feedback, flags, modules, connectors, marketplace, commercial, deployment });
    setLoadFailures(failures);
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.commercial.onEvent(() => void refresh());
    const offUpd = ipc.updater.onEvent(() => void refresh());
    return () => {
      off();
      offUpd();
    };
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Overview', icon: 'gauge' },
    { id: 'release', label: 'Release', icon: 'refresh' },
    { id: 'health', label: 'Health', icon: 'pulse' },
    { id: 'quality', label: 'Quality', icon: 'verified' },
    { id: 'commercial', label: 'Commercial', icon: 'store' },
    { id: 'deployment', label: 'Deployment', icon: 'globe' },
    { id: 'support', label: 'Support', icon: 'lightbulb' },
    { id: 'marketplace', label: 'Marketplace', icon: 'puzzle' },
    { id: 'engineering', label: 'Engineering', icon: 'code' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--hairline)] px-8 pt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Product Operations</h1>
            <p className="mt-0.5 text-sm text-faint">
              Release, health, certification, commercial, deployment & support — one operational lens over the live platform.
            </p>
          </div>
          {d.app && (
            <div className="text-right text-xs text-faint">
              <div className="font-medium text-muted">v{d.app.version}</div>
              <div>{d.diag ? `${d.diag.build.channel} · ${d.diag.build.commit}` : d.app.platform}</div>
            </div>
          )}
        </div>
        <nav className="mt-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium transition-colors',
                tab === t.id ? 'text-ink [border-bottom:2px_solid_var(--accent)]' : 'text-muted hover:text-ink',
              )}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
        {ready && loadFailures.length > 0 && (
          // NP-008 F-N8-3 — the Administration honest-fallback pattern: refusals and
          // failures are NAMED, so the zeros below read as fallback, not verified state.
          <div
            role="alert"
            className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-xs leading-relaxed text-danger"
          >
            <span className="min-w-0 flex-1">{describeLoadFailures(loadFailures)}</span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-danger/40 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
            >
              Retry
            </button>
          </div>
        )}
        {!ready ? (
          <LoadingBlock label="Loading product operations…" />
        ) : (
          <div className="mx-auto" style={{ maxWidth: 1120 }}>
            {tab === 'overview' && <OverviewTab d={d} go={onOpenSection} />}
            {tab === 'release' && <ReleaseTab d={d} />}
            {tab === 'health' && <HealthTab d={d} go={onOpenSection} />}
            {tab === 'quality' && <QualityTab d={d} go={onOpenSection} />}
            {tab === 'commercial' && <CommercialTab d={d} go={onOpenSection} />}
            {tab === 'deployment' && <DeploymentTab d={d} />}
            {tab === 'support' && <SupportTab d={d} go={onOpenSection} />}
            {tab === 'marketplace' && <MarketplaceTab d={d} go={onOpenSection} />}
            {tab === 'engineering' && <EngineeringTab d={d} />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

type Go = ((id: SectionId) => void) | undefined;

function DeepLink({ label, section, go, icon = 'arrow-right' }: { label: string; section: SectionId; go: Go; icon?: IconName }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => go?.(section)}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink"
    >
      {label}
      <Icon name={icon} size={13} />
    </button>
  );
}

function GapRow({ area, capability, kind, reason }: { area: string; capability: string; kind: GapKind; reason: string }): JSX.Element {
  const meta = gapKindMeta(kind);
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 shrink-0"><Icon name={meta.icon} size={14} className="text-faint" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{capability}</span>
          <span className="text-2xs text-faint">· {area}</span>
        </div>
        <div className="mt-0.5 text-xs text-faint">{reason}</div>
      </div>
      <StatusBadge tone={meta.tone} label={meta.label} />
    </div>
  );
}

function GapsPanel({ filter }: { filter?: (area: string) => boolean }): JSX.Element {
  const gaps = filter ? OPERATIONAL_GAPS.filter((g) => filter(g.area)) : OPERATIONAL_GAPS;
  if (gaps.length === 0) return <></>;
  return (
    <OpsPanel title="Operational gaps (recorded honestly)" subtitle="Capabilities not surfaced as in-app data — never fabricated">
      <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
        {gaps.map((g) => (
          <GapRow key={`${g.area}-${g.capability}`} {...g} />
        ))}
      </div>
    </OpsPanel>
  );
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function OverviewTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const maturity = computeMaturity();
  const health = d.health;
  const totalRecords = d.modules.reduce((s, m) => s + (m.recordCount ?? 0), 0);
  return (
    <>
      <OpsPanel title="Platform at a glance">
        <Grid cols={4}>
          <Stat icon="refresh" label="Version · channel" value={d.app ? `v${d.app.version}` : '—'} hint={d.diag?.build.channel} />
          <Stat icon="pulse" label="System health" tone={health ? healthLevelTone(health.level) : 'gray'} value={health ? `${Math.round(health.score)}` : '—'} hint={health?.level} />
          <Stat icon="verified" label="Capability maturity" value={`${maturity.maturityPct}%`} hint={`${maturity.productionComplete}/${maturity.total} production-complete`} />
          <Stat icon="grid" label="Enterprise modules" value={d.modules.length || '—'} hint={`${totalRecords.toLocaleString()} records`} />
        </Grid>
      </OpsPanel>

      {d.commercial && d.commercial.kpis.length > 0 && (
        <OpsPanel title="Commercial" actions={<DeepLink label="Commercial Center" section="commercial-center" go={go} />}>
          <Grid cols={4}>
            {d.commercial.kpis.slice(0, 4).map((k) => (
              <KpiCard key={k.key} kpi={k} />
            ))}
          </Grid>
        </OpsPanel>
      )}

      <GapsPanel />
    </>
  );
}

/* ── Release ─────────────────────────────────────────────────────────────── */

function ReleaseTab({ d }: { d: Data }): JSX.Element {
  if (!d.diag) return <EmptyState icon="refresh" title="Release diagnostics unavailable" hint="The release diagnostics service did not respond." />;
  const r = deriveReleaseReadiness(d.diag, d.flags);
  const sign = signingMeta(d.diag.signing.state);
  const upd = updatePhaseMeta(d.diag.update.phase);
  return (
    <>
      <OpsPanel title="Release readiness" subtitle="Derived from the live Release Diagnostics + feature flags">
        <Grid cols={4}>
          <Stat icon="refresh" label="Version" value={`v${r.version}`} hint={`${r.channel} · ${r.commit}`} />
          <Stat icon="shield" label="Signing" tone={sign.tone} value={sign.label} hint={d.diag.signing.authority ?? undefined} />
          <Stat icon="download" label="Updater" tone={upd.tone} value={upd.label} hint={d.diag.update.available ? 'update available' : undefined} />
          <Stat icon="checklist" label="Release ready" tone={r.releaseReady ? 'green' : 'orange'} value={r.releaseReady ? 'Yes' : 'No'} hint={r.packaged ? 'packaged' : 'dev build'} />
        </Grid>
      </OpsPanel>

      {r.blockers.length > 0 && (
        <OpsPanel title="Release blockers">
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {r.blockers.map((b) => (
              <div key={b} className="flex items-center gap-2 py-2.5 text-sm">
                <Icon name="info" size={14} className="text-faint" /> {b}
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      <OpsPanel title="Build metadata">
        <div className="surface-raised rounded-2xl px-4 py-1 shadow-card">
          <Field label="Version" value={`v${d.diag.build.version}`} />
          <Field label="Channel" value={d.diag.build.channel} />
          <Field label="Commit" value={d.diag.build.commit} />
          <Field label="Built" value={d.diag.build.buildTime || '—'} />
          <Field label="Platform · arch" value={`${d.diag.build.platform} · ${d.diag.build.arch}`} />
          <Field label="Packaged" value={d.diag.build.packaged ? 'Yes' : 'No (dev)'} />
          <Field label="Electron · Node" value={`${d.diag.build.runtime.electron} · ${d.diag.build.runtime.node}`} />
        </div>
      </OpsPanel>

      <OpsPanel title={`Feature flags (${r.flagsEnabled}/${r.flagsTotal} on · free-tier baseline)`} subtitle="The real feature-flag service; source shown per flag">
        {d.flags.length === 0 ? (
          <EmptyState icon="info" title="No feature flags" />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {d.flags.map((f) => (
              <div key={f.key} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{f.key}</div>
                  <div className="text-xs text-faint">{f.description}</div>
                </div>
                <span className="text-2xs text-faint">{flagSourceLabel(f.source)}</span>
                <StatusBadge tone={f.enabled ? 'green' : 'gray'} label={f.enabled ? 'On' : 'Off'} />
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <OpsPanel title="Rollback readiness">
        <Grid cols={2}>
          <Stat icon="database" label="Data backups available" value={d.backups.length} hint="restore via Recovery Center" />
          <Stat icon="info" label="App-version rollback" tone="gray" value="Not supported" hint="updater runs with downgrade disabled" />
        </Grid>
      </OpsPanel>
    </>
  );
}

/* ── Health ──────────────────────────────────────────────────────────────── */

function HealthTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const h = d.health;
  const checks = d.diag?.health.checks ?? [];
  return (
    <>
      {h && (
        <OpsPanel title="System health" subtitle="NeuroCore composed snapshot" actions={<DeepLink label="Operations" section="opscenter" go={go} />}>
          <Grid cols={4}>
            <Stat icon="pulse" label="Health score" tone={healthLevelTone(h.level)} value={Math.round(h.score)} hint={h.level} />
            <Stat icon="clock" label="Uptime" value={formatUptime(h.uptimeMs)} />
            <Stat icon="activity" label="Events / min" value={Math.round(h.throughput.eventsPerMinute)} hint={`${Math.round(h.throughput.avgDispatchMs)}ms avg dispatch`} />
            <Stat icon="layers" label="Subsystems" value={h.subsystems.length} hint={`${h.subsystems.filter((s) => s.level === 'healthy').length} healthy`} />
          </Grid>
          {h.subsystems.length > 0 && (
            <div className="mt-3 surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {h.subsystems.map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 text-sm font-medium text-ink">{s.label}</span>
                  {s.detail && <span className="truncate text-xs text-faint">{s.detail}</span>}
                  <StatusBadge tone={healthLevelTone(s.level)} label={s.level} />
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      )}

      <OpsPanel title={`Diagnostics checks (${checks.length})`} subtitle="Live component probes from the platform diagnostics service">
        {checks.length === 0 ? (
          <EmptyState icon="pulse" title="No diagnostics checks reported" />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {checks.map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{c.label}</div>
                  {c.detail && <div className="truncate text-xs text-faint">{c.detail}</div>}
                </div>
                {c.latencyMs != null && <span className="text-2xs text-faint">{c.latencyMs}ms</span>}
                <StatusBadge tone={diagnosticTone(c.status)} label={c.status} />
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      {d.supervisor && (
        <OpsPanel title="Runtime recovery" subtitle="The supervisor's self-healing history">
          <Grid cols={3}>
            <Stat icon="refresh" label="Recoveries" value={d.supervisor.recoveryCount} />
            <Stat icon="info" label="Recent failures" tone={d.supervisor.recentFailures > 0 ? 'orange' : 'green'} value={d.supervisor.recentFailures} />
            <Stat icon="checklist" label="Recovering now" value={d.supervisor.recovering.length} />
          </Grid>
        </OpsPanel>
      )}
    </>
  );
}

/* ── Quality / Certification ─────────────────────────────────────────────── */

function QualityTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const m = computeMaturity();
  const aiModules = d.modules.filter((x) => x.aiSummary).length;
  const families = new Set(d.modules.map((x) => x.group).filter(Boolean)).size;
  return (
    <>
      <OpsPanel title="Capability maturity" subtitle="The single-source-of-truth capability registry">
        <Grid cols={4}>
          <Stat icon="verified" label="Maturity" value={`${m.maturityPct}%`} hint={`${m.real}/${m.total} real`} />
          <Stat icon="checklist" label="Production-complete" value={m.productionComplete} hint={`${m.completionPct}% of registry`} />
          <Stat icon="shield" label="Managed" value={m.managed} />
          <Stat icon="info" label="Not yet surfaced" tone="gray" value={m.hidden} />
        </Grid>
        <div className="mt-3">
          <Meter value={m.maturityPct / 100} tone="accent" label="Real / surfaced capabilities" trailing={`${m.maturityPct}%`} />
        </div>
      </OpsPanel>

      <OpsPanel title="Enterprise modules" subtitle="Certified business modules on the shared framework" actions={<DeepLink label="Business" section="business" go={go} />}>
        <Grid cols={4}>
          <Stat icon="grid" label="Modules" value={d.modules.length || '—'} />
          <Stat icon="layers" label="Families" value={families || '—'} />
          <Stat icon="sparkles" label="AI-enabled" value={aiModules} hint="per-record summaries" />
          <Stat icon="database" label="Records" value={d.modules.reduce((s, x) => s + (x.recordCount ?? 0), 0).toLocaleString()} />
        </Grid>
        <p className="mt-3 text-xs text-faint">
          Per-module certification levels are the delivered certification matrix (not in-app data); this surface derives from the live capability registry + module summaries.
        </p>
      </OpsPanel>
    </>
  );
}

/* ── Commercial ──────────────────────────────────────────────────────────── */

function CommercialTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  return (
    <>
      {d.commercial && d.commercial.kpis.length > 0 ? (
        <OpsPanel title="Commercial KPIs" subtitle="Read-only projection over the commercial layer" actions={<DeepLink label="Commercial Center" section="commercial-center" go={go} />}>
          <Grid cols={3}>
            {d.commercial.kpis.map((k) => (
              <KpiCard key={k.key} kpi={k} />
            ))}
          </Grid>
        </OpsPanel>
      ) : (
        <EmptyState icon="store" title="Commercial data unavailable" hint="The commercial projection did not respond." />
      )}
      <GapsPanel filter={(a) => a === 'Commercial'} />
    </>
  );
}

/* ── Deployment ──────────────────────────────────────────────────────────── */

function DeploymentTab({ d }: { d: Data }): JSX.Element {
  return (
    <>
      <OpsPanel title="Deployment targets" subtitle="Verified from the build config + backend + recon — what actually ships">
        <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
          {DEPLOYMENT_TARGETS.map((t) => {
            const meta = targetStatusMeta(t.status);
            return (
              <div key={t.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0"><Icon name={t.icon} size={14} className="text-faint" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{t.label}</div>
                  <div className="mt-0.5 text-xs text-faint">{t.detail}</div>
                </div>
                <StatusBadge tone={meta.tone} label={meta.label} />
              </div>
            );
          })}
        </div>
      </OpsPanel>

      {d.deployment && (
        <OpsPanel title="Cloud tenancy" subtitle="Live from the commercial deployment projection">
          <Grid cols={4}>
            <Stat icon="database" label="Tenants" value={d.deployment.tenantsTotal} hint={`${d.deployment.tenantsActive} active`} />
            <Stat icon="globe" label="Regions" value={d.deployment.activeRegions} hint={d.deployment.multiRegion ? 'multi-region' : 'single region'} />
            <Stat icon="lock" label="SSO connections" value={d.deployment.ssoActive} hint={d.deployment.scimEnabled ? 'SCIM on' : 'SCIM off'} />
            <Stat icon="shield" label="MFA required" tone={d.deployment.mfaRequired ? 'green' : 'gray'} value={d.deployment.mfaRequired ? 'Yes' : 'No'} />
          </Grid>
          <p className="mt-3 text-xs text-faint">Multi-region / private-cloud tenancy is modeled; single desktop + cloud backend is the deployed reality.</p>
        </OpsPanel>
      )}
    </>
  );
}

/* ── Support ─────────────────────────────────────────────────────────────── */

function SupportTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  return (
    <>
      <OpsPanel title="Operational support" subtitle="Diagnostics, recovery, crash capture & feedback" actions={<DeepLink label="Runtime" section="operations" go={go} />}>
        <Grid cols={4}>
          <Stat icon="shield" label="Safe mode" tone={d.safeMode?.enabled ? 'orange' : 'green'} value={d.safeMode?.enabled ? 'Active' : 'Normal'} />
          <Stat icon="database" label="Backups" value={d.backups.length} />
          <Stat icon="info" label="Crashes (local)" tone={(d.crash?.total ?? 0) > 0 ? 'orange' : 'green'} value={d.crash?.total ?? 0} hint={d.crash?.optedIn ? 'capture on' : 'capture off'} />
          <Stat icon="lightbulb" label="Feedback" value={d.feedback.length} />
        </Grid>
      </OpsPanel>

      {d.crashRecs.length > 0 && (
        <OpsPanel title="Recovery recommendations">
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {d.crashRecs.map((r) => (
              <div key={r.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{r.title}</div>
                  <div className="text-xs text-faint">{r.detail}</div>
                </div>
                <StatusBadge tone={r.severity === 'critical' ? 'red' : r.severity === 'warning' ? 'orange' : 'blue'} label={r.severity} />
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      <GapsPanel filter={(a) => a === 'Support'} />
    </>
  );
}

/* ── Marketplace ─────────────────────────────────────────────────────────── */

function MarketplaceTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const c = d.connectors;
  return (
    <>
      <OpsPanel title="Marketplace & connectors" subtitle="Governed catalog + the connector registry" actions={<DeepLink label="Enterprise Marketplace" section="marketplace" go={go} />}>
        <Grid cols={4}>
          <Stat icon="store" label="Listings" value={d.marketplace.length} />
          <Stat icon="connectors" label="Connectors" value={c?.total ?? '—'} hint={c ? `${c.configured} configured` : undefined} />
          <Stat icon="check" label="Connected" value={c?.connected ?? '—'} hint={c ? `${c.accounts} accounts` : undefined} />
          <Stat icon="puzzle" label="Marketplace" value="Governed" hint="Ed25519-signed" />
        </Grid>
      </OpsPanel>
      <OpsPanel title="Developer platform" actions={<DeepLink label="Developer" section="developer" go={go} />}>
        <p className="text-sm text-muted">
          SDKs (TypeScript, CLI, REST, webhooks) and the plugin host are production; Go / Java / .NET SDKs are planned.
          Publishing runs against the local single-org registry (no remote registry yet).
        </p>
      </OpsPanel>
    </>
  );
}

/* ── Engineering ─────────────────────────────────────────────────────────── */

function EngineeringTab({ d }: { d: Data }): JSX.Element {
  return (
    <>
      <OpsPanel title="Build identity" subtitle="The only engineering facts the running app can know">
        {d.diag ? (
          <div className="surface-raised rounded-2xl px-4 py-1 shadow-card">
            <Field label="Version" value={`v${d.diag.build.version}`} />
            <Field label="Channel" value={d.diag.build.channel} />
            <Field label="Commit" value={d.diag.build.commit} />
            <Field label="Built" value={d.diag.build.buildTime || '—'} />
            <Field label="Runtime" value={`Electron ${d.diag.build.runtime.electron} · Chrome ${d.diag.build.runtime.chrome} · V8 ${d.diag.build.runtime.v8}`} />
          </div>
        ) : (
          <EmptyState icon="code" title="Build identity unavailable" />
        )}
      </OpsPanel>
      <GapsPanel filter={(a) => a === 'Engineering'} />
      <p className="text-xs text-faint">
        Test results, coverage, typecheck, lint and regression history are produced in CI and are not accessible to the running application — shown here honestly as external rather than fabricated.
      </p>
    </>
  );
}
