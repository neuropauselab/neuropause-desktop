/**
 * P7 — the Root Cause Engine + the Incident Engine. Both correlate Timeline events (the existing Platform Event
 * Bus / durable Timeline) ACROSS the unified Enterprise Graph's dependency edges — the same union-find /
 * directly-follows idea the ERP process-mining engine uses, lifted onto events + topology.
 *
 * Root Cause: given a symptom (a target resource or the latest critical event), it walks UPSTREAM dependency
 * edges to find earlier events on resources the symptom depends on, ranking candidates by dependency proximity ×
 * temporal precedence × severity. It NEVER asserts a single cause — it returns ranked candidates each with a
 * confidence, and an overall confidence.
 *
 * Incident: clusters correlated events (by `correlationId`, then by resource + time proximity) into incidents;
 * each carries its root cause, its blast-radius impact (reusing Change-Impact), recommended actions, and a
 * confidence. Pure + deterministic; the backend maps `PlatformEvent` → `CorrelationEvent` and feeds them in.
 */
import type { ExecutiveKpi } from '../types/executiveCenter';
import { buildAdjacency, changeImpactWith, type EnterpriseAdjacency, type EnterpriseGraphModel } from './enterpriseGraph';

export type EventSeverity = 'info' | 'warning' | 'critical';

/** The minimal event the engines correlate over (mapped from PlatformEvent by the backend). */
export interface CorrelationEvent {
  id: string;
  type: string;
  /** Epoch ms. */
  ts: number;
  severity: EventSeverity;
  /** The resource/entity the event concerns (a CloudResource id, ERP id, or unified node id), or null. */
  resourceId: string | null;
  correlationId: string | null;
  source: string;
  label: string;
}

export const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
/** Bound the upstream dependency walk for root-cause search. */
export const MAX_ROOTCAUSE_DEPTH = 8;
export const MAX_INCIDENTS = 200;

const SEVERITY_WEIGHT: Record<EventSeverity, number> = { critical: 1, warning: 0.6, info: 0.25 };

/** Resolve an event's raw resource id to a node id present in the graph (`res:` / `erp:` / verbatim), given the set. */
export function resolveNodeId(present: Set<string>, rawId: string | null): string | null {
  if (!rawId) return null;
  if (present.has(rawId)) return rawId;
  if (present.has(`res:${rawId}`)) return `res:${rawId}`;
  if (present.has(`erp:${rawId}`)) return `erp:${rawId}`;
  return null;
}

/** Nodes the given node transitively DEPENDS ON (outbound dependency reach), with hop distance. Bounded. */
function upstreamHops(nodeId: string, adj: EnterpriseAdjacency): Map<string, number> {
  const hops = new Map<string, number>([[nodeId, 0]]);
  let frontier = [nodeId];
  for (let depth = 1; depth <= MAX_ROOTCAUSE_DEPTH && frontier.length; depth++) {
    const next: string[] = [];
    for (const v of frontier) {
      for (const w of adj.out.get(v) ?? []) {
        if (!hops.has(w)) {
          hops.set(w, depth);
          next.push(w);
        }
      }
    }
    frontier = next;
  }
  return hops;
}

export interface RootCauseCandidate {
  eventId: string;
  resourceId: string | null;
  label: string;
  hopDistance: number;
  score: number;
  confidence: number;
  reason: string;
}
export interface RootCauseReport {
  symptom: { eventId: string; resourceId: string | null; label: string } | null;
  candidates: RootCauseCandidate[];
  confidence: number;
  builtAt: string;
}

export interface RootCauseInput {
  events: CorrelationEvent[];
  model: EnterpriseGraphModel;
  targetResourceId?: string | null;
  windowMs?: number;
}

/** Internal: rank root causes given a prebuilt adjacency + node-id set (so incident clustering reuses them). */
function rankRootCause(events: CorrelationEvent[], adj: EnterpriseAdjacency, present: Set<string>, targetResourceId: string | null | undefined, windowMs: number, nowMs: number): RootCauseReport {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);

  const empty: RootCauseReport = { symptom: null, candidates: [], confidence: 0, builtAt: new Date(nowMs).toISOString() };
  let symptom: CorrelationEvent | null = null;
  if (targetResourceId) {
    // Match the target both raw and by resolved node id (the two intelligence handlers use different id forms).
    const targetNode = resolveNodeId(present, targetResourceId);
    const onTarget = sorted.filter((e) => e.resourceId === targetResourceId || (targetNode != null && resolveNodeId(present, e.resourceId) === targetNode));
    // A target WAS requested but has no events in the window → explicit empty report. Do NOT fall back to an
    // unrelated global-latest event, which would present a confident answer about the wrong resource.
    if (!onTarget.length) return empty;
    symptom = onTarget[onTarget.length - 1];
  } else {
    // No target: the SYMPTOM is the most recent observation; root-cause search then walks BACKWARD (earlier
    // upstream events). The latest event overall — not the latest critical, which would invert the direction when
    // the cause is critical and the symptom is a later downstream warning.
    symptom = sorted.length ? sorted[sorted.length - 1] : null;
  }
  if (!symptom) return empty;

  const symptomNode = resolveNodeId(present, symptom.resourceId);
  const upstream = symptomNode ? upstreamHops(symptomNode, adj) : new Map<string, number>();

  const byResource = new Map<string, RootCauseCandidate>();
  for (const e of sorted) {
    if (e.id === symptom.id || e.ts > symptom.ts) continue;
    const node = resolveNodeId(present, e.resourceId);
    const hop = node ? upstream.get(node) : undefined;
    const sharesCorr = !!e.correlationId && e.correlationId === symptom.correlationId;
    if (hop === undefined && !sharesCorr) continue;
    const effHop = hop ?? 2;
    const temporal = Math.max(0, 1 - (symptom.ts - e.ts) / windowMs);
    const proximity = 1 / (1 + effHop);
    const score = SEVERITY_WEIGHT[e.severity] * (0.35 + 0.65 * temporal) * (0.4 + 0.6 * proximity) + (sharesCorr ? 0.15 : 0);
    const key = e.resourceId ?? e.id;
    const prev = byResource.get(key);
    if (!prev || score > prev.score) {
      byResource.set(key, {
        eventId: e.id,
        resourceId: e.resourceId,
        label: e.label,
        hopDistance: effHop,
        score: Math.round(score * 1000) / 1000,
        confidence: 0,
        reason: hop === 0 ? 'event on the affected resource' : hop != null ? `upstream dependency (${effHop} hop${effHop === 1 ? '' : 's'})` : 'same correlation chain',
      });
    }
  }

  const candidates = [...byResource.values()].sort((a, b) => b.score - a.score || a.eventId.localeCompare(b.eventId));
  const maxScore = candidates.length ? candidates[0].score : 0;
  for (const c of candidates) c.confidence = maxScore > 0 ? Math.round((c.score / maxScore) * 100) / 100 : 0;
  const confidence = candidates.length ? Math.min(0.95, candidates[0].score) : 0;

  return {
    symptom: { eventId: symptom.id, resourceId: symptom.resourceId, label: symptom.label },
    candidates: candidates.slice(0, 10),
    confidence: Math.round(confidence * 100) / 100,
    builtAt: new Date(nowMs).toISOString(),
  };
}

/** Rank candidate root causes for a symptom by dependency proximity × temporal precedence × severity. */
export function analyzeRootCause(input: RootCauseInput, nowMs: number): RootCauseReport {
  const adj = buildAdjacency(input.model);
  const present = new Set(input.model.nodes.map((n) => n.id));
  return rankRootCause(input.events, adj, present, input.targetResourceId, input.windowMs ?? DEFAULT_WINDOW_MS, nowMs);
}

/* ── Incident Engine ─────────────────────────────────────────────────────────────── */

export interface Incident {
  id: string;
  title: string;
  startTs: number;
  endTs: number;
  severity: EventSeverity;
  correlationId: string | null;
  eventIds: string[];
  resourceIds: string[];
  rootCause: RootCauseCandidate | null;
  impact: { blastRadius: number; affectedByDomain: Record<string, number> };
  recommendedActions: string[];
  confidence: number;
}
export interface IncidentReport {
  incidents: Incident[];
  total: number;
  open: number;
  builtAt: string;
}

export interface IncidentInput {
  events: CorrelationEvent[];
  model: EnterpriseGraphModel;
  windowMs?: number;
}

const maxSeverity = (a: EventSeverity, b: EventSeverity): EventSeverity => (SEVERITY_WEIGHT[a] >= SEVERITY_WEIGHT[b] ? a : b);

function clusterEvents(events: CorrelationEvent[], windowMs: number): CorrelationEvent[][] {
  const clusters: CorrelationEvent[][] = [];
  const byCorr = new Map<string, CorrelationEvent[]>();
  const loose: CorrelationEvent[] = [];
  for (const e of events) {
    if (e.correlationId) (byCorr.get(e.correlationId) ?? byCorr.set(e.correlationId, []).get(e.correlationId)!).push(e);
    else loose.push(e);
  }
  for (const group of byCorr.values()) clusters.push(group);
  const byResource = new Map<string, CorrelationEvent[]>();
  for (const e of loose) {
    const key = e.resourceId ?? '∅';
    (byResource.get(key) ?? byResource.set(key, []).get(key)!).push(e);
  }
  for (const group of byResource.values()) {
    const sorted = [...group].sort((a, b) => a.ts - b.ts);
    let bucket: CorrelationEvent[] = [];
    let lastTs = -Infinity;
    for (const e of sorted) {
      if (bucket.length && e.ts - lastTs > windowMs) {
        clusters.push(bucket);
        bucket = [];
      }
      bucket.push(e);
      lastTs = e.ts;
    }
    if (bucket.length) clusters.push(bucket);
  }
  return clusters;
}

/** Correlate events into incidents, each with root cause, impact, actions, and confidence. */
export function correlateIncidents(input: IncidentInput, nowMs: number): IncidentReport {
  const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS;
  const adj = buildAdjacency(input.model);
  const present = new Set(input.model.nodes.map((n) => n.id));
  const clusters = clusterEvents(input.events, windowMs);
  const incidents: Incident[] = [];

  for (const cluster of clusters) {
    const hasSignal = cluster.some((e) => e.severity !== 'info') || cluster.length >= 3;
    if (!hasSignal) continue;
    const sorted = [...cluster].sort((a, b) => a.ts - b.ts);
    const severity = cluster.reduce<EventSeverity>((s, e) => maxSeverity(s, e.severity), 'info');
    const resourceIds = [...new Set(cluster.map((e) => e.resourceId).filter((x): x is string => !!x))];
    const rc = rankRootCause(cluster, adj, present, undefined, windowMs, nowMs);
    const rootCause = rc.candidates[0] ?? null;
    const rootNode = resolveNodeId(present, rootCause?.resourceId ?? resourceIds[0] ?? null);
    const impact = rootNode ? changeImpactWith(adj, rootNode, nowMs) : null;

    const actions: string[] = [];
    if (rootCause) actions.push(`Investigate ${rootCause.label} — ${rootCause.reason} (confidence ${(rootCause.confidence * 100).toFixed(0)}%).`);
    if (impact && impact.blastRadius > 0) actions.push(`Assess ${impact.blastRadius} downstream dependents before remediating.`);
    if (severity === 'critical') actions.push('Escalate: critical-severity events correlated in this window.');
    if (!actions.length) actions.push('Monitor — correlated events without a clear upstream cause.');

    incidents.push({
      id: `incident:${sorted[0].correlationId ?? sorted[0].id}`,
      title: `${severity === 'critical' ? 'Critical' : severity === 'warning' ? 'Warning' : 'Info'} incident — ${rootCause?.label ?? sorted[sorted.length - 1].label}`,
      startTs: sorted[0].ts,
      endTs: sorted[sorted.length - 1].ts,
      severity,
      correlationId: sorted[0].correlationId ?? null,
      eventIds: sorted.map((e) => e.id).slice(0, 100),
      resourceIds: resourceIds.slice(0, 50),
      rootCause,
      impact: impact ? { blastRadius: impact.blastRadius, affectedByDomain: impact.affectedByDomain } : { blastRadius: 0, affectedByDomain: {} },
      recommendedActions: actions,
      confidence: rc.confidence,
    });
  }

  incidents.sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || b.impact.blastRadius - a.impact.blastRadius || b.startTs - a.startTs);
  const capped = incidents.slice(0, MAX_INCIDENTS);
  return { incidents: capped, total: capped.length, open: capped.filter((i) => i.severity !== 'info').length, builtAt: new Date(nowMs).toISOString() };
}

export function incidentKpis(report: IncidentReport): ExecutiveKpi[] {
  const critical = report.incidents.filter((i) => i.severity === 'critical').length;
  return [
    { key: 'enterprise.incidents.open', label: 'Open Incidents', value: report.open, display: String(report.open), band: report.open === 0 ? 'healthy' : critical > 0 ? 'critical' : report.open < 3 ? 'watch' : 'at-risk' },
  ];
}
