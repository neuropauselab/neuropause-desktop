/**
 * Phase 6 Stage 9 — the incident lifecycle VIEW (D-4).
 *
 * Incidents remain the Stage 6 COMPUTED views — `transient: true` is a literal
 * on every row because no incident store exists and Stage 9 does not add one.
 * The lifecycle stages compose what already exists: detection (the computed
 * incident), investigation (root cause + the existing timeline replay),
 * recovery (recommended actions through the existing gated flow), and
 * verified-closed (the incident's window ended — the Stage 6 outcome loop).
 * Ownership resolves registry-domain → live org-unit lead. Persistence is the
 * EXISTING decision path, surfaced as a pointer, never a new store. Pure.
 */
import type {
  IncidentLifecycleReport,
  IncidentLifecycleView,
  IncidentStage,
  InsightIncidentView,
  OperationalDomainKey,
  OperationsUnavailable,
  ServiceOwnerRef,
} from '@neuropause/shared';
import { DOMAIN_REGISTRY } from './operationsRegistry';
import { resolveOwner } from './serviceCatalog';

export interface IncidentInput {
  nowIso: string;
  nowMs: number;
  incidents: InsightIncidentView[] | null;
  units: { id: string; name: string; leadUserId: string | null }[] | null;
  users: { id: string; name: string }[] | null;
  /** Stage 7 knowledge lookup (does an asset topic/record back this ref?); null-safe. */
  knowledgeMatch: ((refs: string[]) => { ref: string; matched: boolean }[]) | null;
  failures: Record<string, string>;
}

/** Map a computed incident to an operational domain by its resource/title tokens. */
export function domainForIncident(incident: InsightIncidentView): OperationalDomainKey | null {
  const text = `${incident.title} ${incident.resourceIds.join(' ')}`.toLowerCase();
  if (/connector|sync|integration/.test(text)) return 'connectors';
  if (/automation|rule/.test(text)) return 'automations';
  if (/workflow|job|execution|worker/.test(text)) return 'workflows';
  if (/approval/.test(text)) return 'approvals';
  if (/\bai\b|engine|model|prompt/.test(text)) return 'ai';
  if (/project/.test(text)) return 'projects';
  if (/department|team|unit/.test(text)) return 'departments';
  if (/org|health/.test(text)) return 'organization';
  return null;
}

/** The lifecycle stage, composed from the EXISTING signals — never invented. */
export function stageFor(incident: InsightIncidentView, nowMs: number): { stage: IncidentStage; detail: string } {
  if (incident.endTs > 0 && incident.endTs < nowMs) {
    return {
      stage: 'verified-closed',
      detail: 'The incident window has ended — the Stage 6 outcome loop verified the condition cleared.',
    };
  }
  if (incident.recommendedActions.length > 0) {
    return {
      stage: 'recovering',
      detail: `${incident.recommendedActions.length} recommended action(s) — recovery runs ONLY through the existing gated flow (assistant → approval → ExecuteEngine).`,
    };
  }
  if (incident.rootCauseLabel !== null) {
    return {
      stage: 'investigating',
      detail: `Root cause "${incident.rootCauseLabel}" at ${(incident.rootCauseConfidence * 100).toFixed(0)}% confidence; replay the window on the existing timeline surface.`,
    };
  }
  return { stage: 'detected', detail: 'Detected by the Stage 6 correlation; no root cause resolved yet.' };
}

export function buildIncidentReport(input: IncidentInput): IncidentLifecycleReport {
  const unavailable: OperationsUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));

  const incidents: IncidentLifecycleView[] = (input.incidents ?? []).map((incident) => {
    const domain = domainForIncident(incident);
    const domainDef = domain ? DOMAIN_REGISTRY.find((d) => d.key === domain) : undefined;
    const owner: ServiceOwnerRef | null = domainDef
      ? resolveOwner(domainDef.owningUnitName, input.units, input.users)
      : null;
    const st = stageFor(incident, input.nowMs);
    const sopTokens = domain ? ['sop', domain] : ['sop'];
    const sopRefs = input.knowledgeMatch
      ? input.knowledgeMatch(sopTokens)
      : sopTokens.map((ref) => ({ ref, matched: false }));
    return {
      incident,
      transient: true,
      domain,
      owner,
      stage: st.stage,
      stageDetail: st.detail,
      sopRefs,
      conversion: {
        available: true,
        how: 'Convert the related recommendation into a governed DECISION via the existing decision store (the only persistent operational record) — Stage 9 adds no incident store.',
      },
      investigation: {
        rootCauseLabel: incident.rootCauseLabel,
        rootCauseConfidence: incident.rootCauseConfidence,
        eventIds: incident.eventIds.slice(0, 12),
        replayHint: `Replay ${incident.eventIds.length} correlated event(s) on the existing timeline (replay window ${new Date(incident.startTs).toISOString()} → ${incident.endTs > 0 ? new Date(incident.endTs).toISOString() : 'open'}).`,
      },
    };
  });

  const open = incidents.filter((i) => i.stage !== 'verified-closed');
  const bySeverityMap = new Map<InsightIncidentView['severity'], number>();
  for (const i of open) bySeverityMap.set(i.incident.severity, (bySeverityMap.get(i.incident.severity) ?? 0) + 1);

  return {
    generatedAt: input.nowIso,
    incidents,
    totals: {
      open: open.length,
      bySeverity: [...bySeverityMap.entries()].map(([severity, count]) => ({ severity, count })),
    },
    unavailable,
  };
}
