/**
 * Phase 6 Stage 9 — the Operations Platform tab's pure view-model (no DOM, no
 * React, no I/O; tested). Projects the read-only `eops:*` surfaces — the
 * service catalog, SLA report, readiness assessment, incident lifecycle,
 * continuity, and dashboard — into presentation rows. Everything renders what
 * the main-process composition computed; gaps, unknowns, honest zeros, and
 * unavailable reasons always ride along.
 */
import type {
  BusinessProcessReport,
  ContinuityView,
  IncidentLifecycleReport,
  OperationsDashboard,
  ReadinessAssessment,
  ReadinessState,
  ServiceCatalog,
  ServiceState,
  SlaReport,
  SlaStatusKind,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';

/** Presentation tone (the Stage 7/8 pattern — accepted by StatusBadge/Pill). */
export type EopsTone = 'green' | 'orange' | 'red' | 'blue' | 'gray';

/* ── tone maps (total; tested) ────────────────────────────────────────────── */

export function serviceStateTone(state: ServiceState): EopsTone {
  switch (state) {
    case 'operational':
      return 'green';
    case 'degraded':
      return 'orange';
    case 'failed':
      return 'red';
    case 'unknown':
      return 'gray';
  }
}

export function readinessTone(state: ReadinessState): EopsTone {
  switch (state) {
    case 'ready':
      return 'green';
    case 'degraded':
      return 'orange';
    case 'not-ready':
      return 'red';
    case 'unknown':
      return 'gray';
  }
}

export function slaTone(status: SlaStatusKind): EopsTone {
  switch (status) {
    case 'met':
      return 'green';
    case 'breached':
      return 'red';
    case 'unmeasurable':
      return 'gray';
  }
}

export function severityTone(severity: 'info' | 'warning' | 'critical'): EopsTone {
  switch (severity) {
    case 'critical':
      return 'red';
    case 'warning':
      return 'orange';
    case 'info':
      return 'blue';
  }
}

export function pressureTone(p: 'low' | 'elevated' | 'high' | 'unknown'): EopsTone {
  switch (p) {
    case 'low':
      return 'green';
    case 'elevated':
      return 'orange';
    case 'high':
      return 'red';
    case 'unknown':
      return 'gray';
  }
}

/* ── header stats (dashboard) ─────────────────────────────────────────────── */

export interface EopsStat {
  label: string;
  value: string;
  hint: string;
  tone: EopsTone;
  icon: IconName;
}

export function eopsHeaderStats(d: OperationsDashboard): EopsStat[] {
  return [
    {
      label: 'Services',
      value: `${d.catalog.operational}/${d.catalog.services}`,
      hint: `${d.catalog.degraded} degraded · ${d.catalog.failed} failed · ${d.catalog.unknown} unknown · ${d.catalog.gaps} gap(s)`,
      tone: d.catalog.failed > 0 ? 'red' : d.catalog.degraded > 0 ? 'orange' : 'green',
      icon: 'server',
    },
    {
      label: 'SLA',
      value: `${d.sla.met}/${d.sla.targets}`,
      hint: `${d.sla.breached} breached · ${d.sla.unmeasurable} declared unmeasurable`,
      tone: d.sla.breached > 0 ? 'red' : 'green',
      icon: 'shield',
    },
    {
      label: 'Readiness',
      value: `${d.readiness.ready}/7`,
      hint: `${d.readiness.degraded} degraded · ${d.readiness.notReady} not ready · ${d.readiness.unknown} unknown`,
      tone: d.readiness.notReady > 0 ? 'red' : d.readiness.degraded > 0 || d.readiness.unknown > 0 ? 'orange' : 'green',
      icon: 'check',
    },
    {
      label: 'Incidents',
      value: String(d.incidents.open),
      hint: `${d.incidents.critical} critical (transient computed views — no ticket store)`,
      tone: d.incidents.critical > 0 ? 'red' : d.incidents.open > 0 ? 'orange' : 'green',
      icon: 'pulse',
    },
    {
      label: 'Capacity',
      value: d.capacity.pressure,
      hint: `${d.capacity.bottlenecks} bottleneck(s) flagged`,
      tone: pressureTone(d.capacity.pressure),
      icon: 'gauge',
    },
    {
      label: 'Continuity',
      value: d.continuity.score !== null ? `${d.continuity.score}/100` : 'n/a',
      hint: `${d.continuity.validations} validation(s) · ${d.continuity.localBackups ?? 'n/a'} local backup(s)`,
      tone: d.continuity.validations > 0 ? 'green' : 'gray',
      icon: 'database',
    },
  ];
}

/* ── rows ─────────────────────────────────────────────────────────────────── */

export interface ServiceRow {
  serviceId: string;
  name: string;
  domain: string;
  state: ServiceState;
  tone: EopsTone;
  stateDetail: string;
  ownerText: string;
  kpiText: string | null;
}

export function serviceRows(c: ServiceCatalog): ServiceRow[] {
  return c.entries.map((e) => ({
    serviceId: e.serviceId,
    name: e.name,
    domain: e.domain,
    state: e.state,
    tone: serviceStateTone(e.state),
    stateDetail: e.stateDetail,
    ownerText: e.owner
      ? `${e.owner.unitName}${e.owner.leadName ? ` · ${e.owner.leadName}` : ' · no lead assigned'}`
      : 'NO OWNER RESOLVED (gap)',
    kpiText:
      e.kpiKeys.length > 0
        ? e.kpiKeys.map((k) => `${k.key}${k.present ? '' : ' (missing)'}`).join(', ')
        : null,
  }));
}

export interface SlaRow {
  targetId: string;
  label: string;
  serviceId: string;
  status: SlaStatusKind;
  tone: EopsTone;
  detail: string;
}

export function slaRows(r: SlaReport): SlaRow[] {
  return r.statuses.map((s) => ({
    targetId: s.targetId,
    label: s.label,
    serviceId: s.serviceId,
    status: s.status,
    tone: slaTone(s.status),
    detail: s.detail,
  }));
}

export interface ReadinessRow {
  key: string;
  label: string;
  state: ReadinessState;
  tone: EopsTone;
  detail: string;
  missingText: string | null;
}

export function readinessRows(r: ReadinessAssessment): ReadinessRow[] {
  return r.dimensions.map((d) => ({
    key: d.key,
    label: d.label,
    state: d.state,
    tone: readinessTone(d.state),
    detail: d.detail,
    missingText: d.missing.length > 0 ? d.missing.join('; ') : null,
  }));
}

export interface IncidentRow {
  id: string;
  title: string;
  severity: 'info' | 'warning' | 'critical';
  tone: EopsTone;
  stage: string;
  stageDetail: string;
  ownerText: string;
  replayHint: string;
  conversionHow: string;
}

export function incidentRows(r: IncidentLifecycleReport): IncidentRow[] {
  return r.incidents.map((i) => ({
    id: i.incident.id,
    title: i.incident.title,
    severity: i.incident.severity,
    tone: severityTone(i.incident.severity),
    stage: i.stage,
    stageDetail: i.stageDetail,
    ownerText: i.owner
      ? `${i.owner.unitName}${i.owner.leadName ? ` · ${i.owner.leadName}` : ' · no lead assigned'}`
      : 'ownership gap',
    replayHint: i.investigation.replayHint,
    conversionHow: i.conversion.how,
  }));
}

export interface ContinuityRow {
  name: string;
  kind: string;
  detail: string;
  hasEvidence: boolean;
}

export function continuityRows(c: ContinuityView): ContinuityRow[] {
  return c.mechanisms.map((m) => ({ name: m.name, kind: m.kind, detail: m.detail, hasEvidence: m.evidence.length > 0 }));
}

export interface ProcessRow {
  processId: string;
  name: string;
  status: string;
  tone: EopsTone;
  metricsText: string;
}

export function processRows(p: BusinessProcessReport): ProcessRow[] {
  return p.rows.map((r) => ({
    processId: r.processId,
    name: r.name,
    status: r.status,
    tone: r.status === 'mined' ? 'green' : r.status === 'unregistered' ? 'blue' : 'gray',
    metricsText: r.metrics
      ? `${r.metrics.cases} case(s) · median ${r.metrics.medianDurationMs !== null ? `${(r.metrics.medianDurationMs / 3_600_000).toFixed(1)} h` : 'n/a'} · completion ${r.metrics.onTimeRate !== null ? `${(r.metrics.onTimeRate * 100).toFixed(0)}%` : 'n/a'}`
      : 'not mined (declared)',
  }));
}

export interface RecommendationRow {
  id: string;
  title: string;
  priority: string;
  tone: EopsTone;
  detail: string;
  suggestedAction: string;
  principleC: string;
}

export function recommendationRows(d: OperationsDashboard): RecommendationRow[] {
  return d.recommendations.map((r) => ({
    id: r.id,
    title: r.title,
    priority: r.priority,
    tone: r.priority === 'critical' ? 'red' : r.priority === 'high' ? 'orange' : r.priority === 'medium' ? 'blue' : 'gray',
    detail: r.detail,
    suggestedAction: r.suggestedAction,
    principleC: `Impact: ${r.operationalImpact} Outcome: ${r.expectedBusinessOutcome} Rollback: ${r.rollbackImplications} (confidence ${(r.confidence * 100).toFixed(0)}%, ${r.evidence.length} evidence ref(s))`,
  }));
}

/* ── honesty strips ───────────────────────────────────────────────────────── */

export function gapLines(c: ServiceCatalog | null): string[] {
  return (c?.gaps ?? []).map((g) => `${g.kind}: ${g.subject} — ${g.detail}`);
}

export function unavailableLines(parts: { unavailable: { system: string; reason: string }[] }[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const part of parts) {
    for (const u of part.unavailable) {
      const line = `${u.system}: ${u.reason}`;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}
