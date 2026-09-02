/**
 * Phase 6 Stage 9 — the Operations Platform tab (inside the EXISTING Operations
 * Center). Presentation over the six read-only `eops:*` reads: the service
 * catalog with resolved owners and honest gaps, the SLA report (met / breached
 * / DECLARED unmeasurable), the seven-dimension readiness assessment, the
 * incident lifecycle (transient by law, with the decision-conversion pointer),
 * continuity (honest zeros), business processes, KPIs, objectives, and the
 * Principle-C recommendations. The tab mutates nothing — every suggested action
 * points at an existing governed surface, and the tab says so.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  BusinessProcessReport,
  ContinuityView,
  IncidentLifecycleReport,
  OperationsDashboard,
  ReadinessAssessment,
  ServiceCatalog,
  SlaReport,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { OperationalHistoryPanel } from './OperationalHistoryPanel';
import { DeliveryOperationsPanel } from './DeliveryOperationsPanel';
import { PlatformHealthPanel } from './PlatformHealthPanel';
import { EmptyState, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import {
  continuityRows,
  eopsHeaderStats,
  gapLines,
  incidentRows,
  processRows,
  readinessRows,
  recommendationRows,
  serviceRows,
  slaRows,
  unavailableLines,
} from './eopsPlatformModel';

interface EopsData {
  dashboard: OperationsDashboard | null;
  catalog: ServiceCatalog | null;
  readiness: ReadinessAssessment | null;
  sla: SlaReport | null;
  processes: BusinessProcessReport | null;
  incidents: IncidentLifecycleReport | null;
  continuity: ContinuityView | null;
}

const EMPTY: EopsData = { dashboard: null, catalog: null, readiness: null, sla: null, processes: null, incidents: null, continuity: null };

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export function EopsPlatformTab(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [d, setD] = useState<EopsData>(EMPTY);

  const refresh = useCallback(async () => {
    const [dashboard, catalog, readinessResp, incidents, continuity] = await Promise.all([
      settled(ipc.eops.dashboard(), null as OperationsDashboard | null),
      settled(ipc.eops.catalog(), null as ServiceCatalog | null),
      settled(ipc.eops.readiness(), null as { readiness: ReadinessAssessment; sla: SlaReport; processes: BusinessProcessReport } | null),
      settled(ipc.eops.incidents(), null as IncidentLifecycleReport | null),
      settled(ipc.eops.continuity(), null as ContinuityView | null),
    ]);
    setD({
      dashboard,
      catalog,
      readiness: readinessResp?.readiness ?? null,
      sla: readinessResp?.sla ?? null,
      processes: readinessResp?.processes ?? null,
      incidents,
      continuity,
    });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!ready) return <LoadingBlock label="Loading the operations platform…" />;

  const stats = d.dashboard ? eopsHeaderStats(d.dashboard) : [];
  const gaps = gapLines(d.catalog);
  const unavailable = unavailableLines(
    [d.catalog, d.incidents, d.continuity, d.dashboard].filter((x): x is NonNullable<typeof x> => x !== null),
  );

  return (
    <>
      {stats.length > 0 && (
        <OpsPanel
          title="Enterprise Operations Platform"
          subtitle="Service catalog · SLA · readiness · incidents · continuity — composed from the platform's own measurements; read-only"
        >
          <div className="flex flex-wrap gap-2">
            {stats.map((s) => (
              <span key={s.label} title={s.hint}>
                <StatusBadge tone={s.tone} label={`${s.label}: ${s.value}`} />
              </span>
            ))}
          </div>
        </OpsPanel>
      )}

      {d.catalog && (
        <OpsPanel
          title={`Service catalog (${d.catalog.totals.services})`}
          subtitle="Registry × live signals — every state cites its measuring aggregate; owners resolve to real org units"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {serviceRows(d.catalog).map((s) => (
              <div key={s.serviceId} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="server" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">
                    {s.name} <span className="text-2xs text-faint">· {s.domain}</span>
                  </div>
                  <div className="mt-0.5 text-2xs text-faint">{s.stateDetail}</div>
                  <div className="mt-0.5 text-2xs text-faint">
                    Owner: {s.ownerText}
                    {s.kpiText && ` · KPIs: ${s.kpiText}`}
                  </div>
                </div>
                <StatusBadge tone={s.tone} label={s.state} />
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {d.sla && (
        <OpsPanel
          title={`SLA targets (${d.sla.totals.targets})`}
          subtitle="Measured ONLY by existing aggregates — unmeasurable targets are declared, never estimated"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {slaRows(d.sla).map((s) => (
              <div key={s.targetId} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">
                    {s.label} <span className="text-2xs text-faint">· {s.serviceId}</span>
                  </div>
                  <div className="mt-0.5 text-2xs text-faint">{s.detail}</div>
                </div>
                <StatusBadge tone={s.tone} label={s.status} />
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {d.readiness && (
        <OpsPanel
          title="Operational readiness (7 dimensions)"
          subtitle="ready · degraded · not-ready · unknown — unknown stays unknown; every state cites its evidence"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {readinessRows(d.readiness).map((r) => (
              <div key={r.key} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{r.label}</div>
                  <div className="mt-0.5 text-2xs text-faint">{r.detail}</div>
                  {r.missingText && <div className="mt-0.5 text-2xs text-muted">Missing: {r.missingText}</div>}
                </div>
                <StatusBadge tone={r.tone} label={r.state} />
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {d.incidents && (
        <OpsPanel
          title={`Incident lifecycle (${d.incidents.totals.open} open)`}
          subtitle="Transient computed views with resolved ownership — persistence is the existing governed-decision path, never a ticket store"
        >
          {d.incidents.incidents.length === 0 ? (
            <EmptyState icon="check" title="No computed incidents" hint="Nothing correlated into an incident window — as computed by the Stage 6 layer, not assumed." />
          ) : (
            <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {incidentRows(d.incidents).map((i) => (
                <div key={i.id} className="flex items-start gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {i.title} <span className="text-2xs text-faint">· {i.stage}</span>
                    </div>
                    <div className="mt-0.5 text-2xs text-faint">{i.stageDetail}</div>
                    <div className="mt-0.5 text-2xs text-faint">Owner: {i.ownerText}</div>
                    <div className="mt-0.5 text-2xs text-faint">{i.replayHint}</div>
                  </div>
                  <StatusBadge tone={i.tone} label={i.severity} />
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-faint">
            {d.incidents.incidents[0]?.conversion.how ??
              'Converting a related recommendation into a governed decision is the honest persistence path (the existing decision store).'}
          </p>
        </OpsPanel>
      )}

      {d.continuity && (
        <OpsPanel
          title="Business continuity"
          subtitle="DR posture + recorded validations + local backups + recovery mechanisms — honest zeros; observed RPO only from recorded validations"
        >
          <Grid cols={2}>
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">Posture</div>
              <ul className="space-y-1 text-xs text-muted">
                <li>
                  {d.continuity.posture
                    ? `Score ${d.continuity.posture.score}/100 · RPO target ${d.continuity.posture.rpoTargetSeconds}s · RTO target ${d.continuity.posture.rtoTargetSeconds}s · last drill ${d.continuity.posture.lastDrillAt ?? 'never'}`
                    : 'DR posture unavailable this read.'}
                </li>
                <li>
                  {d.continuity.validations
                    ? d.continuity.validations.total > 0
                      ? `${d.continuity.validations.total} recorded validation(s) · last ${d.continuity.validations.lastStatus} · observed RPO ${d.continuity.validations.rpoObservedSeconds ?? 'n/a'}s`
                      : 'ZERO recovery validations recorded — observed RPO unknown.'
                    : 'Validations unreadable.'}
                </li>
                <li>
                  {d.continuity.localBackups
                    ? d.continuity.localBackups.count > 0
                      ? `${d.continuity.localBackups.count} local backup(s) · latest ${d.continuity.localBackups.lastAt}`
                      : 'ZERO local backups (honest zero).'
                    : 'Local backups unreadable.'}
                </li>
              </ul>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">Mechanisms</div>
              <ul className="space-y-1 text-xs text-muted">
                {continuityRows(d.continuity).map((m) => (
                  <li key={m.name}>
                    <span className="font-medium text-ink">{m.name}</span> — {m.detail}
                  </li>
                ))}
              </ul>
            </div>
          </Grid>
        </OpsPanel>
      )}

      {d.processes && (
        <OpsPanel
          title={`Business processes (${d.processes.totals.registered} registered)`}
          subtitle="Registry names joined to the MINED reality — unmined and unregistered processes both surface"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {processRows(d.processes).map((p) => (
              <div key={p.processId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{p.name}</div>
                  <div className="text-2xs text-faint">{p.metricsText}</div>
                </div>
                <StatusBadge tone={p.tone} label={p.status} />
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {d.dashboard && d.dashboard.recommendations.length > 0 && (
        <OpsPanel
          title={`Recommendations (${d.dashboard.recommendations.length})`}
          subtitle="Every recommendation carries evidence · reasoning · confidence · affected systems · operational impact · expected outcome · rollback implications (Principle C, structural)"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {recommendationRows(d.dashboard).map((r) => (
              <div key={r.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{r.title}</div>
                  <div className="mt-0.5 text-2xs text-faint">{r.detail}</div>
                  <div className="mt-0.5 text-2xs text-muted">Suggested: {r.suggestedAction}</div>
                  <div className="mt-0.5 text-2xs text-faint">{r.principleC}</div>
                </div>
                <StatusBadge tone={r.tone} label={r.priority} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-faint">
            Recommendations never execute — corrective actions run only through the existing assistant → approval →
            ExecuteEngine flow.
          </p>
        </OpsPanel>
      )}

      {d.dashboard && d.dashboard.kpis.length > 0 && (
        <OpsPanel title={`KPI catalog (${d.dashboard.kpis.length})`} subtitle="Existing producers, catalogued — no metrics engine">
          <div className="flex flex-wrap gap-2">
            {d.dashboard.kpis.map((k) => (
              <span key={k.key} title={`${k.source} · ${k.label}`}>
                <StatusBadge
                  tone={k.band === 'critical' || k.band === 'at-risk' ? 'red' : k.band === 'watch' ? 'orange' : k.band === 'healthy' ? 'green' : 'blue'}
                  label={`${k.label}: ${k.display}`}
                />
              </span>
            ))}
          </div>
        </OpsPanel>
      )}

      {(gaps.length > 0 || unavailable.length > 0 || (d.dashboard?.disclosures.length ?? 0) > 0) && (
        <OpsPanel title="Disclosures, gaps & unavailable reads" subtitle="Structural honesty — stated, never papered over">
          <ul className="space-y-1 text-xs text-faint">
            {(d.dashboard?.disclosures ?? []).map((line) => (
              <li key={line}>{line}</li>
            ))}
            {gaps.map((line) => (
              <li key={`g-${line}`}>Gap — {line}</li>
            ))}
            {unavailable.map((line) => (
              <li key={`u-${line}`}>Unavailable — {line}</li>
            ))}
          </ul>
        </OpsPanel>
      )}

      <PlatformHealthPanel />
      <DeliveryOperationsPanel />
      <OperationalHistoryPanel />
    </>
  );
}
