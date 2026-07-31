/**
 * Phase 6 Stage 10 — the Enterprise tab (inside the EXISTING P14 Strategy
 * Center). Presentation over the six read-only `estrat:*` reads: objectives
 * measured only by existing aggregates, the initiative portfolio whose
 * milestones are observable conditions (never dates), business value computed
 * from the outcome loop + measured deltas (never estimated — no currency),
 * the Enterprise Capability Map, strategic risks (substantiated only by live
 * signals), executive planning focus (Principle-C recommendations), unit
 * alignment, and the board report. The tab mutates nothing — every suggested
 * action points at an existing governed surface, and the tab says so.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  BoardReport,
  BusinessValueReport,
  ObjectivesReport,
  PlanningReport,
  PortfolioReport,
  StrategyDashboard,
  StrategyHealthView,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, LoadingBlock } from '@renderer/operationsCenter/primitives';
import {
  alignmentRows,
  capabilityRows,
  estratHeaderStats,
  focusRows,
  initiativeRows,
  objectiveRows,
  riskRows,
  unavailableLines,
  valueRows,
} from './estratPlatformModel';

interface EstratData {
  dashboard: StrategyDashboard | null;
  objectives: ObjectivesReport | null;
  portfolio: PortfolioReport | null;
  value: BusinessValueReport | null;
  planning: PlanningReport | null;
  health: StrategyHealthView | null;
  board: BoardReport | null;
}

const EMPTY: EstratData = { dashboard: null, objectives: null, portfolio: null, value: null, planning: null, health: null, board: null };

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export function EstratPlatformTab(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [d, setD] = useState<EstratData>(EMPTY);

  const refresh = useCallback(async () => {
    const [dashboard, objectives, portfolioResp, planning, health, board] = await Promise.all([
      settled(ipc.estrat.dashboard(), null as StrategyDashboard | null),
      settled(ipc.estrat.objectives(), null as ObjectivesReport | null),
      settled(ipc.estrat.portfolio(), null as { portfolio: PortfolioReport; value: BusinessValueReport } | null),
      settled(ipc.estrat.planning(), null as PlanningReport | null),
      settled(ipc.estrat.health(), null as StrategyHealthView | null),
      settled(ipc.estrat.report(), null as BoardReport | null),
    ]);
    setD({
      dashboard,
      objectives,
      portfolio: portfolioResp?.portfolio ?? null,
      value: portfolioResp?.value ?? null,
      planning,
      health,
      board,
    });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!ready) return <LoadingBlock label="Loading the strategy platform…" />;

  const stats = d.dashboard ? estratHeaderStats(d.dashboard) : [];
  const unavailable = unavailableLines(
    [d.dashboard, d.objectives, d.portfolio, d.value, d.planning, d.health].filter(
      (x): x is NonNullable<typeof x> => x !== null,
    ),
  );

  return (
    <>
      {stats.length > 0 && (
        <OpsPanel
          title="Enterprise Strategy Platform"
          subtitle="Objectives · portfolio · value · capabilities · risks · planning — composed from the platform's own live aggregates; read-only"
        >
          <div className="flex flex-wrap gap-2">
            {stats.map((s) => (
              <span key={s.label} title={s.hint}>
                <StatusBadge tone={s.tone} label={`${s.label}: ${s.value}`} />
              </span>
            ))}
          </div>
          {d.dashboard && d.dashboard.disclosures.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {d.dashboard.disclosures.map((line) => (
                <div key={line} className="flex items-center gap-2 text-2xs text-faint">
                  <Icon name="shield" size={12} />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      )}

      {d.objectives && (
        <OpsPanel
          title={`Objectives (${d.objectives.company.length} company + ${d.objectives.departments.length} department)`}
          subtitle="Health computed from live measures only — KPI bands, Stage 9 SLA statuses, Stage 6 domain bands; company objectives cannot outrank their worst rolling-up department"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {objectiveRows(d.objectives).map((o) => (
              <div key={o.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="checklist" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{o.label}</span>
                    <StatusBadge tone={o.tone} label={o.health} />
                    <span className="text-2xs text-faint">{o.kindText}</span>
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{o.healthDetail}</div>
                  <div className="mt-0.5 text-2xs text-faint">
                    {o.measureText} · owner: {o.ownerText} · capabilities: {o.capabilityText}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {d.objectives.gaps.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {d.objectives.gaps.map((g, i) => (
                <div key={`${g.subject}-${i}`} className="text-2xs text-orange-1">
                  gap · {g.kind}: {g.subject} — {g.detail}
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      )}

      {d.portfolio && (
        <OpsPanel
          title={`Initiative portfolio (${d.portfolio.initiatives.length})`}
          subtitle="Composed from existing records — UDM projects, Stage 8 playbooks, Stage 9 services, governed decisions; milestones are observable conditions, never dates"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {initiativeRows(d.portfolio).map((i) => (
              <div key={i.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="bolt" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{i.label}</span>
                    <StatusBadge tone={i.tone} label={i.state} />
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{i.stateDetail}</div>
                  <div className="mt-0.5 text-2xs text-faint">
                    {i.milestoneText} · owner: {i.ownerText} · capabilities: {i.capabilityText}
                  </div>
                  {i.blockerText && <div className="mt-0.5 text-2xs text-orange-1">blockers: {i.blockerText}</div>}
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {d.value && (
        <OpsPanel
          title={`Business value (${d.value.decisions.length} governed decision(s))`}
          subtitle="Computed from the decision record × Stage 6 outcome loop × measured 90-day health deltas — never estimated; the platform records no currency"
        >
          {d.value.decisions.length === 0 ? (
            <EmptyState icon="gauge" title="No governed decisions recorded" hint="There is no value history to compute — stated honestly, not padded." />
          ) : (
            <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {valueRows(d.value).map((v) => (
                <div key={v.decisionId} className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 shrink-0">
                    <Icon name="gauge" size={15} className="text-faint" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{v.title}</span>
                      <StatusBadge tone={v.tone} label={v.verdict} />
                      <span className="text-2xs text-faint">{v.category}</span>
                    </div>
                    <div className="mt-0.5 text-2xs text-muted">{v.verdictDetail}</div>
                    <div className="mt-0.5 text-2xs text-faint">{v.stageText} · {v.deltaText}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-2xs text-faint">{d.value.disclosure}</div>
        </OpsPanel>
      )}

      {d.health && (
        <OpsPanel
          title="Enterprise Capability Map (12 business capabilities)"
          subtitle="Condition composed only from each capability's declared live evidence; investment focus counts initiatives + governed decisions (attention, never currency)"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {capabilityRows(d.health.capabilities).map((c) => (
              <div key={c.key} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="grid" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    <StatusBadge tone={c.tone} label={c.condition} />
                    <span className="text-2xs text-faint">{c.coverageText}</span>
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{c.countsText} · owner: {c.ownerText}</div>
                  <div className="mt-0.5 text-2xs text-faint">operational risk: {c.riskText}</div>
                  {c.gapText && <div className="mt-0.5 text-2xs text-orange-1">gaps: {c.gapText}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-2xs text-faint">{d.health.capabilities.disclosure}</div>
        </OpsPanel>
      )}

      {d.health && (
        <OpsPanel
          title={`Strategic risks (${d.health.risks.filter((r) => r.substantiated).length} substantiated / ${d.health.risks.length} registered)`}
          subtitle="A risk is substantiated ONLY when its evidencing live signals fire — quiet risks stay unsubstantiated, stated honestly, never escalated"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {riskRows(d.health).map((r) => (
              <div key={r.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="shield" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.label}</span>
                    <StatusBadge tone={r.tone} label={r.substantiated ? 'substantiated' : 'quiet'} />
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{r.detail}</div>
                  <div className="mt-0.5 text-2xs text-faint">capabilities: {r.capabilityText}</div>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {d.planning && (
        <OpsPanel
          title="Executive planning focus"
          subtitle="Relative horizons computed from the clock (no stored dates); every item is a Principle-C recommendation pointing at an existing governed surface — nothing executes from here"
        >
          {focusRows(d.planning).length === 0 ? (
            <EmptyState icon="pin" title="No focus items" hint="Nothing requires executive focus by the composed signals." />
          ) : (
            <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {focusRows(d.planning).map((f) => (
                <div key={f.id} className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 shrink-0">
                    <Icon name="pin" size={15} className="text-faint" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{f.title}</span>
                      <StatusBadge tone={f.tone} label={f.priority} />
                      <span className="text-2xs text-faint">{f.horizonLabel}</span>
                    </div>
                    <div className="mt-0.5 text-2xs text-muted">{f.detail}</div>
                    <div className="mt-0.5 text-2xs text-muted">Suggested: {f.suggestedAction}</div>
                    <div className="mt-0.5 text-2xs text-faint">{f.principleC}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      )}

      {d.health && (
        <OpsPanel
          title="Organizational alignment"
          subtitle="Which units carry department objectives bound to company objectives — unbound units are alignment gaps, stated honestly"
        >
          <div className="flex flex-wrap gap-2">
            {alignmentRows(d.health).map((a) => (
              <span key={a.unitName} title={a.detail}>
                <StatusBadge tone={a.tone} label={a.unitName} />
              </span>
            ))}
          </div>
        </OpsPanel>
      )}

      {d.board && (
        <OpsPanel title={d.board.title} subtitle="Sectioned, evidence-cited composition of the same computed views — no new facts are introduced at report level">
          <div className="flex flex-col gap-3">
            {d.board.sections.map((s) => (
              <div key={s.title} className="rounded-2xl border border-[var(--hairline)] p-3">
                <div className="text-sm font-semibold">{s.title}</div>
                <div className="mt-1 flex flex-col gap-0.5">
                  {s.lines.map((line, i) => (
                    <div key={i} className="text-2xs text-muted">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {unavailable.length > 0 && (
        <OpsPanel title="Declared unavailability" subtitle="Sources this composition could not read this pass — declared, never silently defaulted">
          <div className="flex flex-col gap-1">
            {unavailable.map((line) => (
              <div key={line} className="text-2xs text-faint">
                {line}
              </div>
            ))}
          </div>
        </OpsPanel>
      )}
    </>
  );
}
