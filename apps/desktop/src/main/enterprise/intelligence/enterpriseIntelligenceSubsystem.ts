/**
 * P7 — the Enterprise Intelligence backend subsystem. It COMPOSES existing runtimes (no new runtime): it reads the
 * P6 Resource Graph (infra store), the ERP Relationship Graph (relationship provider), and the Timeline (Platform
 * Event Bus), maps them into the pure `composeEnterpriseIntelligence` engine, caches the report, and exposes it
 * read-only over the secure IPC bridge (RBAC-gated with the existing `intelligence:read` permission) plus a
 * diagnostics probe (Enterprise Health) that rolls into the one diagnostics report. It publishes nothing
 * destructive; recommendations are advisory (AI suggests, human confirms).
 */
import {
  analyzeChangeImpact,
  analyzeRootCause,
  buildEnterpriseGraph,
  composeEnterpriseIntelligence,
  EmptyRequest,
  EnterpriseIntelChangeImpactRequest,
  EnterpriseIntelRootCauseRequest,
  IpcChannel,
  type CorrelationEvent,
  type EnterpriseIntelligenceReport,
  type EventSeverity,
  type RelationshipGraphModel,
  type ResourceGraphModel,
} from '@neuropause/shared';
import type { EnterpriseIntelChangeImpactRequest as TChangeImpactReq, EnterpriseIntelRootCauseRequest as TRootCauseReq } from '@neuropause/shared';
import { createLogger } from '../../logger';
import { makeCheck, type DiagnosticProbe } from '../../platform/diagnostics';
import type { SecureHandlerDef } from '../../ipc/secureBridge';

const log = createLogger('enterprise-intelligence');
const REPORT_TTL_MS = 3_000;
const EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 5_000;

/** A minimal platform-event shape (so the subsystem stays decoupled from the concrete timeline page type). */
export interface RawTimelineEvent {
  id: string;
  type: string;
  timestamp: string;
  priority?: string | null;
  correlationId?: string | null;
  source?: string | null;
  resource?: { type?: string; id?: string; name?: string | null } | null;
}

export interface EnterpriseIntelligenceDeps {
  broadcast: (channel: string, payload: unknown) => void;
  /** Read the P6 Resource Graph (cloud/infra/identity). Guarded — returns null when infra isn't ready. */
  getResourceModel: () => ResourceGraphModel | null;
  /** Read the ERP Relationship Graph (business/CRM/finance). Guarded — returns null when ERP isn't ready. */
  getRelationshipModel: () => RelationshipGraphModel | null;
  /** Read recent timeline events for correlation (bounded window). */
  getEvents: (sinceIso: string, limit: number) => RawTimelineEvent[];
  now?: () => number;
}

export interface EnterpriseIntelligenceSubsystem {
  handlers: SecureHandlerDef[];
  probe: DiagnosticProbe;
  /** Build (or return cached) the full intelligence report. */
  report: () => EnterpriseIntelligenceReport;
  dispose: () => void;
}

/** Map a raw platform event onto the pure correlation-event shape. */
export function toCorrelationEvent(e: RawTimelineEvent): CorrelationEvent {
  const t = e.type.toLowerCase();
  let severity: EventSeverity = 'info';
  const p = (e.priority ?? '').toLowerCase();
  if (p === 'critical' || t.includes('failed') || t.includes('error') || t.includes('critical') || t.includes('down')) severity = 'critical';
  else if (p === 'high' || t.includes('degraded') || t.includes('warning') || t.includes('denied') || t.includes('rate_limit')) severity = 'warning';
  const ts = Date.parse(e.timestamp);
  return {
    id: e.id,
    type: e.type,
    ts: Number.isFinite(ts) ? ts : 0,
    severity,
    resourceId: e.resource?.id ?? null,
    correlationId: e.correlationId ?? null,
    source: e.source ?? 'platform',
    label: e.resource?.name ?? e.type,
  };
}

export function initEnterpriseIntelligence(deps: EnterpriseIntelligenceDeps): EnterpriseIntelligenceSubsystem {
  const now = deps.now ?? (() => Date.now());

  let cache: { at: number; report: EnterpriseIntelligenceReport } | null = null;

  const build = (): EnterpriseIntelligenceReport => {
    const nowMs = now();
    if (cache && nowMs - cache.at < REPORT_TTL_MS) return cache.report;
    let resource: ResourceGraphModel | null = null;
    let relationship: RelationshipGraphModel | null = null;
    let events: CorrelationEvent[] = [];
    try { resource = deps.getResourceModel(); } catch (err) { log.warn('resource model unavailable', { error: String(err) }); }
    try { relationship = deps.getRelationshipModel(); } catch (err) { log.warn('relationship model unavailable', { error: String(err) }); }
    try {
      const since = new Date(nowMs - EVENT_WINDOW_MS).toISOString();
      events = deps.getEvents(since, MAX_EVENTS).map(toCorrelationEvent);
    } catch (err) {
      log.warn('timeline events unavailable', { error: String(err) });
    }
    const report = composeEnterpriseIntelligence({ resource, relationship, events }, nowMs);
    cache = { at: nowMs, report };
    return report;
  };

  const probe: DiagnosticProbe = () => {
    const r = build();
    const overall = r.health.overall;
    const status = r.health.band === 'critical' ? 'down' : r.health.band === 'at-risk' ? 'degraded' : 'ok';
    const detail = `Enterprise health ${overall}/100 (${r.health.band}); ${r.graph.nodes} nodes, ${r.graph.crossDomainEdges} cross-domain links, ${r.incidents.open} open incident(s), ${r.risk.overall}/100 risk.`;
    return makeCheck('enterprise-intelligence', 'Enterprise Intelligence', status, { detail });
  };

  const handlers: SecureHandlerDef[] = [
    { channel: IpcChannel.EnterpriseIntelReport, schema: EmptyRequest, requireAuth: true, permission: 'intelligence:read', handler: () => build() },
    {
      channel: IpcChannel.EnterpriseIntelChangeImpact,
      schema: EnterpriseIntelChangeImpactRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: (p) => {
        const req = p as TChangeImpactReq;
        const model = buildEnterpriseGraph({ resource: safe(deps.getResourceModel), relationship: safe(deps.getRelationshipModel) }, now());
        return analyzeChangeImpact(model, req.nodeId, now());
      },
    },
    {
      channel: IpcChannel.EnterpriseIntelRootCause,
      schema: EnterpriseIntelRootCauseRequest,
      requireAuth: true,
      permission: 'intelligence:read',
      handler: (p) => {
        const req = p as TRootCauseReq;
        const model = buildEnterpriseGraph({ resource: safe(deps.getResourceModel), relationship: safe(deps.getRelationshipModel) }, now());
        const since = new Date(now() - (req.windowMs ?? EVENT_WINDOW_MS)).toISOString();
        const events = safeEvents(deps.getEvents, since).map(toCorrelationEvent);
        return analyzeRootCause({ events, model, targetResourceId: req.targetResourceId ?? null, windowMs: req.windowMs }, now());
      },
    },
  ];

  log.info('Enterprise Intelligence subsystem ready');

  return {
    handlers,
    probe,
    report: build,
    dispose: () => { cache = null; },
  };
}

function safe<T>(fn: () => T | null): T | null {
  try { return fn(); } catch { return null; }
}
function safeEvents(fn: (since: string, limit: number) => RawTimelineEvent[], since: string): RawTimelineEvent[] {
  try { return fn(since, MAX_EVENTS); } catch { return []; }
}
