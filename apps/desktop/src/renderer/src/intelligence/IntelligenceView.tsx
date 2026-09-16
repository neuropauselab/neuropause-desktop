/**
 * Enterprise Intelligence Workspace v1.0 — the unified, READ-ONLY executive intelligence lens.
 *
 * One workspace over EVERY intelligence surface the platform already produces: an Overview KPI strip (the
 * Enterprise Brain report) plus nine lenses — Executive, Business, Operations, Engineering, Commercial,
 * Security, AI, Organization, Developer. It is a PRESENTATION LAYER: it composes EXISTING IPC (enterprise
 * intelligence/dashboard/modules, executive center, NeuroCore health, diagnostics/supervisor, release &
 * validation, commercial, cloud/enterprise compliance & audit, AI workforce, ecosystem & developer platform)
 * and the renderer-static capability registry. It creates no runtime, engine, or store, duplicates nothing, and
 * mutates nothing — every action deep-links to the section that owns the data. Metrics the platform does not
 * source in-app are labeled honestly ("Requires telemetry / aggregation / architecture"), never fabricated.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  CommercialAdministration,
  CommercialAnalytics,
  CommercialCustomers,
  CommercialMetering,
  ComplianceFinding,
  ComplianceReport,
  DeveloperPlatformAnalytics,
  DiagnosticsReport,
  EcosystemAnalytics,
  EnterpriseAuditEntry,
  EnterpriseIntelligenceReport,
  EnterpriseModuleSummary,
  ExecutiveCenterSnapshot,
  ExecutiveSnapshot,
  Organization,
  OrgRole,
  OrgUnit,
  OrgUser,
  ReleaseDiagnostics,
  SupervisorStatus,
  SystemHealthSnapshot,
  ValidationDashboard,
} from '@neuropause/shared';
import type { WorkforceIntelligence } from '@renderer/workforce/intelligenceTypes';
import type { SectionId } from '@renderer/shell/sections';
import { computeMaturity } from '@renderer/capability/capabilityRegistry';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { formatUptime } from '@renderer/operations/lib';
import { useShell } from '@renderer/state/ShellProvider';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Field, Grid, KpiCard, LoadingBlock, Meter } from '@renderer/operationsCenter/primitives';
import { InsightCenterHost } from '@renderer/insightCenter/InsightCenterHost';
import {
  INTELLIGENCE_GAPS,
  averageHealth,
  bandTone,
  formatUsd,
  groupModulesByFamily,
  intelGapKindMeta,
  signingLabel,
  signingTone,
  stateTone,
  summarizeFindings,
  summarizeKpis,
} from './intelligenceModel';
import { emptyGraphNotice } from './intelligenceHonesty';

type Tab =
  | 'overview' | 'insight' | 'executive' | 'business' | 'operations' | 'engineering'
  | 'commercial' | 'security' | 'ai' | 'organization' | 'developer';

interface Data {
  report: EnterpriseIntelligenceReport | null;
  exec: ExecutiveSnapshot | null;
  business: ExecutiveCenterSnapshot | null;
  modules: EnterpriseModuleSummary[];
  system: SystemHealthSnapshot | null;
  diagnostics: DiagnosticsReport | null;
  supervisor: SupervisorStatus | null;
  release: ReleaseDiagnostics | null;
  validation: ValidationDashboard | null;
  metering: CommercialMetering | null;
  analytics: CommercialAnalytics | null;
  customers: CommercialCustomers | null;
  admin: CommercialAdministration | null;
  compliance: ComplianceReport | null;
  findings: ComplianceFinding[];
  audit: EnterpriseAuditEntry[];
  workforce: WorkforceIntelligence | null;
  org: { organization: Organization; units: OrgUnit[]; roles: OrgRole[]; users: OrgUser[] } | null;
  ecosystem: EcosystemAnalytics | null;
  devPlatform: DeveloperPlatformAnalytics | null;
}

const EMPTY: Data = {
  report: null, exec: null, business: null, modules: [], system: null, diagnostics: null, supervisor: null,
  release: null, validation: null, metering: null, analytics: null, customers: null, admin: null,
  compliance: null, findings: [], audit: [], workforce: null, org: null, ecosystem: null, devPlatform: null,
};

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export function IntelligenceView(): JSX.Element {
  const { setSection } = useShell();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [d, setD] = useState<Data>(EMPTY);

  const refresh = useCallback(async () => {
    const [
      report, exec, business, modules, system, diagnostics, supervisor, release, validation, metering,
      analytics, customers, admin, compliance, findings, audit, workforce, org, ecosystem, devPlatform,
    ] = await Promise.all([
      settled(ipc.enterpriseIntel.report(), null),
      settled(ipc.enterprise.dashboard(), null),
      settled(ipc.intelligence.executiveCenterSnapshot(), null),
      settled(ipc.enterpriseModules.list(), [] as EnterpriseModuleSummary[]),
      settled(ipc.system.health(), null),
      settled(ipc.diagnostics.get(), null),
      settled(ipc.supervisor.status(), null),
      settled(ipc.releaseOps.diagnostics(), null),
      settled(ipc.sandbox.validationDashboard(), null),
      settled(ipc.commercial.metering(), null),
      settled(ipc.commercial.analytics(), null),
      settled(ipc.commercial.customers(), null),
      settled(ipc.commercial.administration(), null),
      settled(ipc.cloud.adminCompliance(), null),
      settled(ipc.enterprise.compliance(), [] as ComplianceFinding[]),
      settled(ipc.enterprise.audit(50), [] as EnterpriseAuditEntry[]),
      settled(ipc.workforce.intelligence(), null),
      settled(ipc.enterprise.org(), null),
      settled(ipc.ecosystem.analytics(), null),
      settled(ipc.developerPlatform.analytics(), null),
    ]);
    setD({
      report, exec, business, modules, system, diagnostics, supervisor, release, validation, metering,
      analytics, customers, admin, compliance, findings, audit, workforce, org, ecosystem, devPlatform,
    });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    const offs = [
      ipc.enterprise.onEvent(() => void refresh()),
      ipc.commercial.onEvent(() => void refresh()),
    ];
    return () => offs.forEach((off) => off());
  }, [refresh]);

  const go: Go = { setSection };

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Overview', icon: 'gauge' },
    // Phase 6 Stage 6 — the Executive Intelligence Dashboard (composed insight).
    { id: 'insight', label: 'Intelligence Center', icon: 'sparkles' },
    { id: 'executive', label: 'Executive', icon: 'command' },
    { id: 'business', label: 'Business', icon: 'layers' },
    { id: 'operations', label: 'Operations', icon: 'pulse' },
    { id: 'engineering', label: 'Engineering', icon: 'code' },
    { id: 'commercial', label: 'Commercial', icon: 'store' },
    { id: 'security', label: 'Security', icon: 'shield' },
    { id: 'ai', label: 'AI', icon: 'cpu' },
    { id: 'organization', label: 'Organization', icon: 'user' },
    { id: 'developer', label: 'Developer', icon: 'puzzle' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--hairline)] px-8 pt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Enterprise Intelligence</h1>
            <p className="mt-0.5 text-sm text-faint">
              The unified executive lens — one workspace over every intelligence surface, composed read-only.
            </p>
          </div>
          {d.report && (
            <div className="text-right text-xs text-faint">
              <div className="font-medium text-muted">Enterprise health {d.report.health.overall}/100</div>
              <div>Risk {d.report.risk.overall}/100 · {d.report.graph.nodes} nodes</div>
              {emptyGraphNotice(d.report.graph.nodes) && (
                <div className="mt-0.5 max-w-[260px] text-warning">{emptyGraphNotice(d.report.graph.nodes)}</div>
              )}
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
        {!ready ? (
          <LoadingBlock label="Loading enterprise intelligence…" />
        ) : (
          <div className="mx-auto" style={{ maxWidth: 1120 }}>
            {tab === 'overview' && <OverviewTab d={d} />}
            {tab === 'insight' && <InsightCenterHost onNavigate={(section) => setSection(section)} />}
            {tab === 'executive' && <ExecutiveTab d={d} go={go} />}
            {tab === 'business' && <BusinessTab d={d} go={go} />}
            {tab === 'operations' && <OperationsTab d={d} go={go} />}
            {tab === 'engineering' && <EngineeringTab d={d} go={go} />}
            {tab === 'commercial' && <CommercialTab d={d} go={go} />}
            {tab === 'security' && <SecurityTab d={d} go={go} />}
            {tab === 'ai' && <AiTab d={d} go={go} />}
            {tab === 'organization' && <OrganizationTab d={d} go={go} />}
            {tab === 'developer' && <DeveloperTab d={d} go={go} />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

interface Go {
  setSection: (id: SectionId) => void;
}

function DeepLink({ label, onClick, icon = 'arrow-right' }: { label: string; onClick: () => void; icon?: IconName }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink"
    >
      {label}
      <Icon name={icon} size={13} />
    </button>
  );
}

/** An honest tile for a metric the platform does not source in-app (the "Requires …" pattern). */
function Requires({ label, note, badge }: { label: string; note?: string; badge: string }): JSX.Element {
  return (
    <div className="surface-raised rounded-2xl p-4 shadow-card">
      <div className="text-sm font-medium text-ink">{label}</div>
      {note && <div className="mt-0.5 text-2xs text-faint">{note}</div>}
      <div className="mt-2"><StatusBadge tone="blue" label={badge} /></div>
    </div>
  );
}

function GapsPanel({ lens }: { lens?: string }): JSX.Element {
  const gaps = lens ? INTELLIGENCE_GAPS.filter((g) => g.lens === lens) : INTELLIGENCE_GAPS;
  if (gaps.length === 0) return <></>;
  return (
    <OpsPanel title="Intelligence gaps (recorded honestly)" subtitle="Executive metrics not sourced in-app — never fabricated">
      <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
        {gaps.map((g) => {
          const meta = intelGapKindMeta(g.kind);
          return (
            <div key={`${g.lens}-${g.metric}`} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 shrink-0"><Icon name={meta.icon} size={14} className="text-faint" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">{g.metric}</span>
                  <span className="text-2xs text-faint">· {g.lens}</span>
                </div>
                <div className="mt-0.5 text-xs text-faint">{g.reason}</div>
              </div>
              <StatusBadge tone={meta.tone} label={meta.label} />
            </div>
          );
        })}
      </div>
    </OpsPanel>
  );
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function OverviewTab({ d }: { d: Data }): JSX.Element {
  const report = d.report;
  if (!report) {
    return <EmptyState icon="gauge" title="Enterprise intelligence unavailable" hint="The unified intelligence report could not be loaded." />;
  }
  const kpis = report.kpis.slice(0, 12);
  const summary = summarizeKpis(report.kpis);
  const scores = report.health.scores;
  const avg = averageHealth(scores.map((s) => s.score));
  return (
    <>
      <OpsPanel title="Executive KPI strip" subtitle={`${report.kpis.length} live KPIs — composed from the enterprise graph`}>
        {kpis.length === 0 ? (
          <EmptyState icon="gauge" title="No KPIs yet" />
        ) : (
          <Grid cols={4}>
            {kpis.map((k) => <KpiCard key={k.key} kpi={k} tone={bandTone(k.band)} />)}
          </Grid>
        )}
      </OpsPanel>

      <OpsPanel title="Enterprise health & risk" subtitle={`Overall ${report.health.overall}/100 · mean of ${scores.length} scores ${avg}/100`}>
        <Grid cols={4}>
          <Stat icon="heart" label="Enterprise health" tone={bandTone(report.health.band)} value={`${report.health.overall}/100`} hint={report.health.band} />
          <Stat icon="bolt" label="Enterprise risk" tone={bandTone(report.risk.band)} value={`${report.risk.overall}/100`} hint={report.risk.band} />
          <Stat icon="grid" label="Graph nodes" value={report.graph.nodes} hint={`${report.graph.edges} edges`} />
          <Stat icon="connectors" label="Cross-domain links" value={report.graph.crossDomainEdges} hint={report.graph.truncated ? 'graph truncated' : 'full graph'} />
        </Grid>
        <div className="mt-3 surface-raised rounded-2xl px-4 py-3 shadow-card">
          {scores.map((s) => (
            <div key={s.key} className="py-2">
              <Meter value={Math.max(0, Math.min(1, s.score / 100))} tone={bandTone(s.band)} label={s.label} trailing={`${s.score}/100`} />
            </div>
          ))}
        </div>
      </OpsPanel>

      <OpsPanel title="KPI bands" subtitle="Attention across the strip">
        <Grid cols={4}>
          <Stat icon="check" label="Healthy" tone="green" value={summary.healthy} />
          <Stat icon="info" label="Watch" tone={summary.watch > 0 ? 'orange' : 'gray'} value={summary.watch} />
          <Stat icon="info" label="At risk" tone={summary.atRisk > 0 ? 'red' : 'gray'} value={summary.atRisk} />
          <Stat icon="bolt" label="Critical" tone={summary.critical > 0 ? 'red' : 'gray'} value={summary.critical} />
        </Grid>
      </OpsPanel>

      <GapsPanel />
    </>
  );
}

/* ── Executive ───────────────────────────────────────────────────────────── */

function ExecutiveTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const s = d.exec;
  const maturity = computeMaturity();
  const riskTone = s ? (s.risk.level === 'high' ? 'red' : s.risk.level === 'elevated' ? 'orange' : 'green') : 'gray';
  return (
    <>
      <OpsPanel title="Executive snapshot" subtitle="The enterprise operating rollup" actions={<DeepLink label="Open Enterprise" onClick={() => go.setSection('enterprise')} />}>
        {s ? (
          <>
            <Grid cols={4}>
              <Stat icon="grid" label="Org health" tone="accent" value={`${Math.round(s.organization.healthScore * 100)}%`} hint={s.organization.healthLabel} />
              <Stat icon="user" label="People" value={s.organization.userCount} hint={`${s.organization.workerCount} AI workers`} />
              <Stat icon="shield" label="Risk level" tone={riskTone} value={s.risk.level} hint={`${s.risk.openFindings} open · ${s.risk.criticalFindings} critical`} />
              <Stat icon="checklist" label="Approvals pending" tone={s.approvals.pending > 0 ? 'orange' : 'gray'} value={s.approvals.pending} />
            </Grid>
            <div className="mt-3">
              <Grid cols={4}>
                <Stat icon="connectors" label="Connectors" value={s.operations.connectors} hint={`${s.operations.connectedAccounts} accounts`} />
                <Stat icon="clipboard" label="Audit entries" value={s.operations.auditEntries} />
                <Stat icon="workspace" label="Installed apps" value={s.operations.installedApps} />
                <Stat icon="sparkles" label="Recommendations" value={s.intelligence.recommendationCount} />
              </Grid>
            </div>
          </>
        ) : (
          <EmptyState icon="command" title="Executive snapshot unavailable" />
        )}
      </OpsPanel>

      <OpsPanel title="Platform maturity" subtitle="From the capability registry (single source of truth)">
        <Grid cols={3}>
          <Stat icon="gauge" label="Maturity" tone="accent" value={`${maturity.maturityPct}%`} hint={`${maturity.real}/${maturity.total} real capabilities`} />
          <Stat icon="verified" label="Production-complete" tone="green" value={maturity.productionComplete} hint={`of ${maturity.total}`} />
          <Stat icon="lock" label="Managed" value={maturity.managed} hint="governed elsewhere" />
        </Grid>
      </OpsPanel>
    </>
  );
}

/* ── Business ────────────────────────────────────────────────────────────── */

function BusinessTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const s = d.business;
  const families = groupModulesByFamily(d.modules);
  return (
    <>
      <OpsPanel title="Business intelligence" subtitle="The Executive Center snapshot" actions={<DeepLink label="Open Business" onClick={() => go.setSection('business')} />}>
        {s ? (
          <>
            <Grid cols={4}>
              <Stat icon="grid" label="Org health" tone="accent" value={`${Math.round(s.orgHealth.overall)}/100`} />
              <Stat icon="bolt" label="Critical" tone={s.attentionCounts.critical > 0 ? 'red' : 'gray'} value={s.attentionCounts.critical} hint="need attention" />
              <Stat icon="info" label="High" tone={s.attentionCounts.high > 0 ? 'orange' : 'gray'} value={s.attentionCounts.high} />
              <Stat icon="list" label="Normal" value={s.attentionCounts.normal} />
            </Grid>
            {s.workforceHealth && (
              <div className="mt-3">
                <Grid cols={4}>
                  <Stat icon="cpu" label="Workers" value={s.workforceHealth.totalWorkers} hint={`${s.workforceHealth.healthy} healthy`} />
                  <Stat icon="gauge" label="Mean success" tone="green" value={`${Math.round(s.workforceHealth.meanSuccessRate * 100)}%`} />
                  <Stat icon="pulse" label="Workforce state" tone={stateTone(s.workforceHealth.state)} value={s.workforceHealth.state} />
                  <Stat icon="activity" label="Jobs run" value={s.workforceHealth.totalJobsRun} hint={`${s.workforceHealth.totalJobsFailed} failed`} />
                </Grid>
              </div>
            )}
            {s.enterprise && <p className="mt-3 text-xs text-faint">{s.enterprise.headline}</p>}
          </>
        ) : (
          <EmptyState icon="layers" title="Business snapshot unavailable" />
        )}
      </OpsPanel>

      {s?.enterprise && (
        <OpsPanel title="Enterprise insights" subtitle="Memory, knowledge & workforce footprint">
          <Grid cols={4}>
            <Stat icon="memory" label="Memory items" value={s.enterprise.memoryTotal} hint={`${s.enterprise.memoryKinds} kinds`} />
            <Stat icon="database" label="Knowledge topics" value={s.enterprise.knowledgeTopics} hint={`${s.enterprise.knowledgeCoveragePercent}% coverage`} />
            <Stat icon="cpu" label="Workforce jobs" value={s.enterprise.workforceJobs} hint={`${s.enterprise.workforceActiveWorkers} active`} />
            <Stat icon="pulse" label="Success" value={`${s.enterprise.workforceSuccessPercent}%`} hint={`${s.enterprise.workforceBottlenecks} bottlenecks`} />
          </Grid>
        </OpsPanel>
      )}

      <OpsPanel title="Business modules by family" subtitle="Live records across the enterprise module framework" actions={<DeepLink label="Open Business" onClick={() => go.setSection('business')} />}>
        {families.length === 0 ? (
          <EmptyState icon="layers" title="No modules registered" />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {families.map((f) => (
              <div key={f.family} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{f.family}</div>
                  <div className="text-2xs text-faint">{f.modules} modules</div>
                </div>
                <span className="shrink-0 text-sm text-muted">{f.records} records</span>
                <span className="shrink-0 text-2xs text-faint">· {f.active} active</span>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <GapsPanel lens="business" />
    </>
  );
}

/* ── Operations ──────────────────────────────────────────────────────────── */

function OperationsTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const sys = d.system;
  const diag = d.diagnostics;
  const sup = d.supervisor;
  return (
    <>
      <OpsPanel title="Runtime health" subtitle="NeuroCore composed system health" actions={<DeepLink label="Open Operations" onClick={() => go.setSection('opscenter')} />}>
        {sys ? (
          <>
            <Grid cols={4}>
              <Stat icon="gauge" label="System score" tone={stateTone(sys.level)} value={`${sys.score}/100`} hint={sys.level} />
              <Stat icon="clock" label="Uptime" value={formatUptime(sys.uptimeMs)} />
              <Stat icon="pulse" label="Events / min" value={Math.round(sys.throughput.eventsPerMinute)} />
              <Stat icon="cpu" label="CPU" value={`${Math.round(sys.telemetry.cpuPercent)}%`} hint={`${Math.round(sys.telemetry.memoryUsedMb)} MB used`} />
            </Grid>
            <div className="mt-3">
              <Grid cols={2}>
                <Stat icon="server" label="Backend" tone={stateTone(sys.telemetry.backendState)} value={sys.telemetry.backendState} hint={sys.telemetry.backendLatencyMs != null ? `${sys.telemetry.backendLatencyMs} ms` : 'no latency probe'} />
                <Stat icon="list" label="Subsystems" value={sys.subsystems.length} hint={`${sys.subsystems.filter((x) => stateTone(x.level) === 'green').length} healthy`} />
              </Grid>
            </div>
            <div className="mt-3 surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {sys.subsystems.map((sub) => (
                <div key={sub.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink">{sub.label}</div>
                    {sub.detail && <div className="text-2xs text-faint">{sub.detail}</div>}
                  </div>
                  <StatusBadge tone={stateTone(sub.level)} label={sub.level} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <EmptyState icon="pulse" title="System health unavailable" />
        )}
      </OpsPanel>

      <OpsPanel title="Diagnostics & recovery" subtitle="Platform diagnostics + runtime supervisor">
        <Grid cols={4}>
          <Stat icon="clipboard" label="Diagnostics" tone={diag ? stateTone(diag.overall) : 'gray'} value={diag ? diag.overall : '—'} hint={diag ? `${diag.checks.length} checks` : undefined} />
          <Stat icon="check" label="Checks OK" tone="green" value={diag ? diag.checks.filter((c) => c.status === 'ok').length : '—'} />
          <Stat icon="refresh" label="Recoveries" value={sup ? sup.recoveryCount : '—'} hint={sup ? `${sup.recovering.length} recovering` : undefined} />
          <Stat icon="info" label="Recent failures" tone={sup && sup.recentFailures > 0 ? 'orange' : 'gray'} value={sup ? sup.recentFailures : '—'} />
        </Grid>
      </OpsPanel>

      <GapsPanel lens="operations" />
    </>
  );
}

/* ── Engineering ─────────────────────────────────────────────────────────── */

function EngineeringTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const rel = d.release;
  const val = d.validation;
  return (
    <>
      <OpsPanel title="Build & signing" subtitle="Release diagnostics" actions={<DeepLink label="Open Sandbox" onClick={() => go.setSection('sandbox')} />}>
        {rel ? (
          <>
            <Grid cols={4}>
              <Stat icon="package" label="Version" value={rel.build.version} hint={rel.build.channel} />
              <Stat icon="code" label="Commit" value={rel.build.commit ? rel.build.commit.slice(0, 7) : '—'} hint={rel.build.packaged ? 'packaged' : 'dev'} />
              <Stat icon="clock" label="Built" value={new Date(rel.build.buildTime).toLocaleDateString()} />
              <Stat icon="shield" label="Signing" tone={signingTone(rel.signing.state)} value={signingLabel(rel.signing.state)} />
            </Grid>
            <div className="mt-3 surface-raised rounded-2xl px-4 py-2 shadow-card">
              <Field label="Platform" value={`${rel.build.platform} · ${rel.build.arch}`} />
              <Field label="Electron" value={rel.build.runtime.electron} />
              <Field label="Node" value={rel.build.runtime.node} />
            </div>
          </>
        ) : (
          <EmptyState icon="code" title="Release diagnostics unavailable" />
        )}
      </OpsPanel>

      <OpsPanel title="Continuous validation" subtitle="The Sandbox validation dashboard">
        {val ? (
          <Grid cols={4}>
            <Stat icon="check" label="Latest passed" tone="green" value={val.latest ? val.latest.passed : '—'} />
            <Stat icon="info" label="Latest failed" tone={val.latest && val.latest.failed > 0 ? 'red' : 'gray'} value={val.latest ? val.latest.failed : '—'} />
            <Stat icon="verified" label="Certification" tone={val.certificationStatus ? stateTone(val.certificationStatus) : 'gray'} value={val.certificationStatus ?? 'none'} />
            <Stat icon="clock" label="Queue depth" value={val.queueDepth} />
          </Grid>
        ) : (
          <EmptyState icon="beaker" title="Validation dashboard unavailable" />
        )}
      </OpsPanel>

      <OpsPanel title="CI & coverage" subtitle="Source-control CI runs off-device">
        <Grid cols={2}>
          <Requires label="CI pipeline & pass rate" note="The validation dashboard tracks sandbox runs, not repository CI" badge="Requires telemetry" />
          <Requires label="Code coverage %" note="Coverage is measured in CI, off-device" badge="Requires telemetry" />
        </Grid>
      </OpsPanel>

      <GapsPanel lens="engineering" />
    </>
  );
}

/* ── Commercial ──────────────────────────────────────────────────────────── */

function CommercialTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const m = d.metering;
  const a = d.analytics;
  const c = d.customers;
  return (
    <>
      <OpsPanel title="Commercial signals" subtitle="Usage, value & customer health — session/cloud usage, not billing" actions={<DeepLink label="Open Commercial" onClick={() => go.setSection('commercial-center')} />}>
        <Grid cols={4}>
          <Stat icon="pulse" label="Requests (30d)" value={m ? m.requests30d : '—'} />
          <Stat icon="sparkles" label="AI cost" value={m ? formatUsd(m.aiCostUsd) : '—'} hint="session/cloud usage" />
          <Stat icon="bolt" label="Net value" value={a ? formatUsd(a.netValueUsd) : '—'} hint="session/cloud usage" />
          <Stat icon="gauge" label="ROI" value={a && a.roiRatio != null ? `${a.roiRatio.toFixed(2)}×` : '—'} hint={a && a.roiRatio == null ? 'insufficient data' : undefined} />
        </Grid>
        <div className="mt-3">
          <Grid cols={3}>
            <Stat icon="download" label="Monthly saving" value={a ? formatUsd(a.monthlySavingUsd) : '—'} hint="session/cloud usage" />
            <Stat icon="heart" label="Customer health" tone="accent" value={c ? `${Math.round(c.healthOverall)}/100` : '—'} />
            <Stat icon="star" label="Adoption" value={c ? `${Math.round(c.adoptionScore)}/100` : '—'} />
          </Grid>
        </div>
        <p className="mt-3 text-xs text-faint">Money figures reflect metered session/cloud usage — not invoiced revenue.</p>
      </OpsPanel>

      <GapsPanel lens="commercial" />
    </>
  );
}

/* ── Security ────────────────────────────────────────────────────────────── */

function SecurityTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const rep = d.compliance;
  const findings = summarizeFindings(d.findings);
  return (
    <>
      {rep && (
        <OpsPanel title="Compliance frameworks" subtitle="SOC 2 / GDPR / ISO — computed scorecard" actions={<DeepLink label="Open Administration" onClick={() => go.setSection('administration')} />}>
          <div className="mb-3">
            <Meter value={Math.max(0, Math.min(1, rep.score / 100))} tone="accent" label="Compliance score" trailing={`${Math.round(rep.score)}%`} />
          </div>
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {rep.controls.slice(0, 8).map((ctrl) => (
              <div key={ctrl.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">{ctrl.control}</div>
                  <div className="text-2xs text-faint">{ctrl.framework}</div>
                </div>
                <StatusBadge tone={stateTone(ctrl.status)} label={ctrl.status} />
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      <OpsPanel title="Internal compliance findings" subtitle="Deterministic checks over live org state" actions={<DeepLink label="Open Administration" onClick={() => go.setSection('administration')} />}>
        <Grid cols={4}>
          <Stat icon="clipboard" label="Checks" tone={findings.tone} value={findings.total || '—'} />
          <Stat icon="check" label="Pass" tone="green" value={findings.pass} />
          <Stat icon="info" label="Warn" tone={findings.warn > 0 ? 'orange' : 'gray'} value={findings.warn} />
          <Stat icon="info" label="Fail" tone={findings.fail > 0 ? 'red' : 'gray'} value={findings.fail} />
        </Grid>
      </OpsPanel>

      <OpsPanel title={`Audit trail (${d.audit.length} recent)`} subtitle="Append-only governance audit (newest first)">
        {d.audit.length === 0 ? (
          <EmptyState icon="clipboard" title="No audit entries yet" />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {d.audit.slice(0, 8).map((e) => (
              <div key={e.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">{e.summary}</div>
                  <div className="text-2xs text-faint">{e.actor} · {e.action}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </>
  );
}

/* ── AI ──────────────────────────────────────────────────────────────────── */

function AiTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const w = d.workforce;
  return (
    <>
      <OpsPanel title="AI workforce intelligence" subtitle="Job execution across the digital-worker roster" actions={<DeepLink label="Open AI Workforce" onClick={() => go.setSection('workforce')} />}>
        {w ? (
          <>
            <Grid cols={4}>
              <Stat icon="cpu" label="Active workers" value={w.activeWorkers} />
              <Stat icon="activity" label="Total jobs" value={w.totalJobs} hint={`${w.inFlight} in flight`} />
              <Stat icon="gauge" label="Success rate" tone={w.overallSuccessRate >= 0.8 ? 'green' : 'orange'} value={`${Math.round(w.overallSuccessRate * 100)}%`} />
              <Stat icon="sparkles" label="AI cost" value={d.metering ? formatUsd(d.metering.aiCostUsd) : '—'} hint="session/cloud usage" />
            </Grid>
            {w.bottlenecks.length > 0 && (
              <div className="mt-3 surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                {w.bottlenecks.slice(0, 6).map((b) => (
                  <div key={`${b.scope}-${b.key}-${b.kind}`} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink">{b.key}</div>
                      <div className="text-2xs text-faint">{b.reason}</div>
                    </div>
                    <StatusBadge tone="orange" label={b.kind.replace(/_/g, ' ')} />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <EmptyState icon="cpu" title="Workforce intelligence unavailable" />
        )}
      </OpsPanel>

      <GapsPanel lens="ai" />
    </>
  );
}

/* ── Organization ────────────────────────────────────────────────────────── */

function OrganizationTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const a = d.admin;
  const org = d.org;
  return (
    <>
      <OpsPanel title="Organization administration" subtitle="People, roles & governance" actions={<DeepLink label="Open Organization" onClick={() => go.setSection('organization')} />}>
        {a ? (
          <>
            <Grid cols={4}>
              <Stat icon="grid" label="Departments" value={a.departments} hint={`${a.workspaces} workspaces`} />
              <Stat icon="user" label="People" value={a.usersHuman} hint={`${a.usersActive} active`} />
              <Stat icon="cpu" label="AI workers" value={a.usersAiWorker} />
              <Stat icon="shield" label="Roles" value={a.roles.length} />
            </Grid>
            <div className="mt-3">
              <Grid cols={3}>
                <Stat icon="checklist" label="Approval chains" value={a.approvalChains} />
                <Stat icon="clipboard" label="Compliance rules" value={a.complianceRules} />
                <Stat icon="list" label="Audit entries" value={a.auditEntries} />
              </Grid>
            </div>
          </>
        ) : (
          <EmptyState icon="user" title="Administration data unavailable" />
        )}
      </OpsPanel>

      {org && (
        <OpsPanel title="Org structure" subtitle="The enterprise org runtime">
          <Grid cols={3}>
            <Stat icon="layers" label="Org units" value={org.units.length} />
            <Stat icon="shield" label="Roles" value={org.roles.length} />
            <Stat icon="user" label="Members" value={org.users.length} />
          </Grid>
        </OpsPanel>
      )}
    </>
  );
}

/* ── Developer ───────────────────────────────────────────────────────────── */

function DeveloperTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const eco = d.ecosystem;
  const dev = d.devPlatform;
  const ecoTone = eco ? (eco.health.score >= 75 ? 'green' : eco.health.score >= 50 ? 'orange' : 'red') : 'gray';
  return (
    <>
      <OpsPanel title="Ecosystem" subtitle="Marketplace listings, installs & developers" actions={<DeepLink label="Open Developer" onClick={() => go.setSection('developer')} />}>
        {eco ? (
          <Grid cols={4}>
            <Stat icon="store" label="Listings" value={eco.totalListings} hint={`${eco.certifiedListings} certified`} />
            <Stat icon="download" label="Installs" value={eco.totalInstalls} hint={`${eco.downloads30d} in 30d`} />
            <Stat icon="user" label="Developers" value={eco.activeDevelopers} />
            <Stat icon="pulse" label="Ecosystem health" tone={ecoTone} value={`${Math.round(eco.health.score)}/100`} hint={eco.health.label} />
          </Grid>
        ) : (
          <EmptyState icon="store" title="Ecosystem analytics unavailable" />
        )}
      </OpsPanel>

      <OpsPanel title="Developer platform gateway" subtitle="Public API request analytics">
        {dev ? (
          <>
            <Grid cols={4}>
              <Stat icon="code" label="Requests" value={dev.requests} hint={`${dev.windowDays}d window`} />
              <Stat icon="check" label="Allowed" tone="green" value={dev.allowed} />
              <Stat icon="info" label="Denied" tone={dev.denied > 0 ? 'orange' : 'gray'} value={dev.denied} />
              <Stat icon="gauge" label="p95 latency" value={`${Math.round(dev.p95LatencyMs)} ms`} />
            </Grid>
            {dev.topRoutes.length > 0 && (
              <div className="mt-3 surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                {dev.topRoutes.slice(0, 6).map((r) => (
                  <div key={r.route} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.route}</span>
                    <span className="shrink-0 text-2xs text-faint">{r.requests} req</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <EmptyState icon="code" title="Developer platform analytics unavailable" />
        )}
      </OpsPanel>

      <GapsPanel lens="developer" />
    </>
  );
}
