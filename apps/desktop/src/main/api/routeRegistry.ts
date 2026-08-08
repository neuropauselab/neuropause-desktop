/**
 * The Enterprise REST API route table (P3.0, Increment 1).
 *
 * Declarative: each route names the EXISTING secure channel it dispatches to and a
 * `buildPayload` that only translates path params / query / body into that channel's
 * existing payload. There is no business logic here — records CRUD runs the same
 * EnterpriseModule handlers the desktop UI uses; graph / timeline / context / search
 * / automation reuse their existing channels. Three composed routes (health, metrics,
 * bulk) fan out over the same channels.
 */
import { IpcChannel } from '@neuropause/shared';
import type { GatewayMetrics, IpcChannelName } from '@neuropause/shared';
import type { ApiRoute, RouteContext, SpecialRouteDeps } from './types';
import { toPrometheus } from '../observability/prometheus';
import { auditToTraceExport, auditToLogsExport } from '../observability/otel';

/** Clamp an optional numeric query param into [1, max] with a default. */
function clampLimit(v: unknown, def: number, max = 1000): number {
  const n = numOpt(v);
  return Math.min(max, Math.max(1, n ?? def));
}

function asObj(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
function strq(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function strOpt(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
function numOpt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Bulk create/update/delete/setStatus — fans out over the SAME module channels, each independently. */
async function runBulk(ctx: RouteContext, deps: SpecialRouteDeps): Promise<unknown> {
  const moduleId = ctx.params.moduleId;
  const body = asObj(ctx.body);
  const ops = Array.isArray(body.operations) ? body.operations : [];
  if (ops.length > 100) throw new Error('Invalid request: bulk is limited to 100 operations');
  const results: Array<{ ok: boolean; op: string; data?: unknown; error?: string }> = [];
  for (const raw of ops) {
    const o = asObj(raw);
    const op = String(o.op ?? '');
    try {
      let channel: IpcChannelName;
      let payload: Record<string, unknown>;
      switch (op) {
        case 'create':
          channel = IpcChannel.EnterpriseModuleCreate;
          payload = { moduleId, title: o.title, fields: o.fields, tags: o.tags, metadata: o.metadata };
          break;
        case 'update':
          channel = IpcChannel.EnterpriseModuleUpdate;
          payload = { moduleId, id: o.id, title: o.title, fields: o.fields, tags: o.tags, metadata: o.metadata };
          break;
        case 'delete':
          channel = IpcChannel.EnterpriseModuleDelete;
          payload = { moduleId, id: o.id };
          break;
        case 'setStatus':
          channel = IpcChannel.EnterpriseModuleSetStatus;
          payload = { moduleId, id: o.id, status: o.status };
          break;
        default:
          throw new Error(`Invalid request: unknown bulk op "${op}"`);
      }
      const data = await deps.dispatch(channel, payload);
      results.push({ ok: true, op, data });
    } catch (err) {
      results.push({ ok: false, op, error: err instanceof Error ? err.message : 'error' });
    }
  }
  return { count: results.length, results };
}

export const ENTERPRISE_API_ROUTES: ApiRoute[] = [
  /* ── Observability (composed) ── */
  {
    kind: 'special', method: 'GET', path: '/health', scope: 'observability:read', list: false,
    summary: 'API liveness, version, and route count',
    run: (_ctx, d) => ({ status: 'ok', version: d.version, routes: d.routeCount, at: new Date(d.now()).toISOString() }),
  },
  {
    kind: 'special', method: 'GET', path: '/metrics', scope: 'observability:read', list: false,
    summary: 'Gateway request metrics (requests, statuses, latency) over a window',
    query: [{ name: 'windowDays', type: 'integer', description: 'Look-back window in days (default 7)' }],
    run: (ctx, d) => d.metrics(numOpt(ctx.query.windowDays) ?? 7),
  },

  /* ── ERP Modules & Records (reuse EnterpriseModule* handlers) ── */
  {
    kind: 'channel', method: 'GET', path: '/modules', scope: 'records:read', list: false,
    summary: 'List registered ERP modules with live record counts',
    channel: IpcChannel.EnterpriseModulesList, buildPayload: () => ({}),
  },
  {
    kind: 'list', method: 'GET', path: '/modules/:moduleId/records', scope: 'records:read', list: true,
    summary: 'List records in a module (filter by status/search; sort + cursor pagination)',
    query: [
      { name: 'status', type: 'string', description: 'Filter by record status', enum: ['active', 'archived', 'deleted'] },
      { name: 'search', type: 'string', description: 'Free-text filter over the records' },
    ],
    channel: IpcChannel.EnterpriseModuleList,
    buildPayload: (c) => ({ moduleId: c.params.moduleId, status: strOpt(c.query.status), search: strOpt(c.query.search), limit: 1000 }),
  },
  {
    kind: 'channel', method: 'GET', path: '/modules/:moduleId/records/:id', scope: 'records:read', list: false,
    summary: 'Get one record by id',
    channel: IpcChannel.EnterpriseModuleGet, buildPayload: (c) => ({ moduleId: c.params.moduleId, id: c.params.id }),
  },
  {
    kind: 'channel', method: 'POST', path: '/modules/:moduleId/records', scope: 'records:write', list: false,
    summary: 'Create a record',
    channel: IpcChannel.EnterpriseModuleCreate, buildPayload: (c) => ({ ...asObj(c.body), moduleId: c.params.moduleId }),
  },
  {
    kind: 'channel', method: 'PUT', path: '/modules/:moduleId/records/:id', scope: 'records:write', list: false,
    summary: 'Replace a record',
    channel: IpcChannel.EnterpriseModuleUpdate, buildPayload: (c) => ({ ...asObj(c.body), moduleId: c.params.moduleId, id: c.params.id }),
  },
  {
    kind: 'channel', method: 'PATCH', path: '/modules/:moduleId/records/:id', scope: 'records:write', list: false,
    summary: 'Update a record (partial)',
    channel: IpcChannel.EnterpriseModuleUpdate, buildPayload: (c) => ({ ...asObj(c.body), moduleId: c.params.moduleId, id: c.params.id }),
  },
  {
    kind: 'channel', method: 'DELETE', path: '/modules/:moduleId/records/:id', scope: 'records:write', list: false,
    summary: 'Delete a record',
    channel: IpcChannel.EnterpriseModuleDelete, buildPayload: (c) => ({ moduleId: c.params.moduleId, id: c.params.id }),
  },
  {
    kind: 'channel', method: 'POST', path: '/modules/:moduleId/records/:id/status', scope: 'records:write', list: false,
    summary: 'Set a record status (active/archived/deleted)',
    channel: IpcChannel.EnterpriseModuleSetStatus, buildPayload: (c) => ({ moduleId: c.params.moduleId, id: c.params.id, status: asObj(c.body).status }),
  },
  {
    kind: 'list', method: 'GET', path: '/modules/:moduleId/search', scope: 'records:read', list: true,
    summary: 'Search records within a module',
    query: [{ name: 'q', type: 'string', description: 'Search query (alias: query)' }],
    channel: IpcChannel.EnterpriseModuleSearch, buildPayload: (c) => ({ moduleId: c.params.moduleId, query: strq(c.query.q ?? c.query.query), limit: 1000 }),
  },
  {
    kind: 'channel', method: 'POST', path: '/modules/:moduleId/records/:id/summarize', scope: 'records:read', list: false,
    summary: 'AI summary + risk for a record (existing AI pipeline)',
    channel: IpcChannel.EnterpriseModuleSummarize, buildPayload: (c) => ({ moduleId: c.params.moduleId, id: c.params.id }),
  },
  {
    kind: 'channel', method: 'POST', path: '/modules/:moduleId/records/:id/actions/:action', scope: 'records:write', list: false,
    summary: 'Run a module-defined record action (e.g. convert a lead)',
    channel: IpcChannel.EnterpriseModuleAction, buildPayload: (c) => ({ moduleId: c.params.moduleId, id: c.params.id, action: c.params.action }),
  },
  {
    kind: 'special', method: 'POST', path: '/modules/:moduleId/records/bulk', scope: 'records:write', list: false,
    summary: 'Bulk create/update/delete/setStatus (≤100 ops), each applied independently',
    run: runBulk,
  },

  /* ── Knowledge Graph (reuse Graph* handlers) ── */
  { kind: 'channel', method: 'GET', path: '/graph/counts', scope: 'graph:read', list: false, summary: 'Knowledge graph node/edge counts', channel: IpcChannel.GraphCounts, buildPayload: () => ({}) },
  { kind: 'channel', method: 'GET', path: '/graph/nodes/:id', scope: 'graph:read', list: false, summary: 'Get a graph node', channel: IpcChannel.GraphNode, buildPayload: (c) => ({ id: c.params.id }) },
  {
    kind: 'channel', method: 'GET', path: '/graph/nodes/:id/neighbors', scope: 'graph:read', list: false,
    summary: 'Immediate neighbors of a node',
    query: [
      { name: 'direction', type: 'string', description: 'Edge direction', enum: ['both', 'out', 'in'] },
      { name: 'limit', type: 'integer', description: 'Max neighbors (1–500)' },
    ],
    channel: IpcChannel.GraphNeighbors, buildPayload: (c) => ({ id: c.params.id, direction: strOpt(c.query.direction), limit: numOpt(c.query.limit) }),
  },
  {
    kind: 'channel', method: 'GET', path: '/graph/nodes/:id/subgraph', scope: 'graph:read', list: false,
    summary: 'Ego subgraph around a node',
    query: [
      { name: 'depth', type: 'integer', description: 'Traversal depth (1–4)' },
      { name: 'limit', type: 'integer', description: 'Max nodes (1–500)' },
    ],
    channel: IpcChannel.GraphSubgraph, buildPayload: (c) => ({ id: c.params.id, depth: numOpt(c.query.depth), limit: numOpt(c.query.limit) }),
  },

  /* ── Context Engine — entity-360 (P2.5) ── */
  { kind: 'channel', method: 'GET', path: '/context/:id', scope: 'context:read', list: false, summary: 'Entity-360 context (neighbors + impact + timeline + memory)', channel: IpcChannel.EnterpriseContext, buildPayload: (c) => ({ id: c.params.id }) },

  /* ── Universal Timeline ── */
  {
    kind: 'channel', method: 'GET', path: '/timeline', scope: 'timeline:read', list: false,
    summary: 'Query the unified enterprise timeline',
    query: [
      { name: 'q', type: 'string', description: 'Free-text filter' },
      { name: 'entityRef', type: 'string', description: 'Only entries concerning this entity id' },
      { name: 'limit', type: 'integer', description: 'Max entries (1–500)' },
      { name: 'order', type: 'string', description: 'Chronological order', enum: ['asc', 'desc'] },
    ],
    channel: IpcChannel.EnterpriseTimelineQuery,
    buildPayload: (c) => ({ text: strOpt(c.query.q), limit: numOpt(c.query.limit), order: c.query.order === 'asc' ? 'asc' : 'desc', entityRef: strOpt(c.query.entityRef) }),
  },

  /* ── Enterprise Search ── */
  {
    kind: 'channel', method: 'GET', path: '/search', scope: 'search:read', list: false, summary: 'Cross-domain enterprise search',
    query: [
      { name: 'q', type: 'string', description: 'Search text (alias: text)' },
      { name: 'limit', type: 'integer', description: 'Max results (1–50)' },
    ],
    channel: IpcChannel.EnterpriseSearch, buildPayload: (c) => ({ text: strq(c.query.q ?? c.query.text), limit: numOpt(c.query.limit) }),
  },

  /* ── Automation ── */
  { kind: 'channel', method: 'GET', path: '/automation', scope: 'automation:read', list: false, summary: 'List automation rules + summary', channel: IpcChannel.AutomationList, buildPayload: () => ({}) },
  { kind: 'channel', method: 'GET', path: '/automation/monitor', scope: 'automation:read', list: false, summary: 'Automation monitor rollup', channel: IpcChannel.AutomationMonitor, buildPayload: () => ({}) },

  /* ── Industry (IP-12) — the canonical Wave 9 solution-pack catalog snapshot, read-only.
     Reuses the already-wired IndustrySnapshot channel (RBAC industry:read + audited); no new logic. ── */
  {
    kind: 'channel', method: 'GET', path: '/industry/catalog', scope: 'industry:read', list: false,
    summary: 'Canonical Wave 9 industry solution-pack catalog snapshot',
    channel: IpcChannel.IndustrySnapshot, buildPayload: () => ({}),
  },

  /* ── Observability (P3.0, Increment 9) — reshape existing gateway audit + health telemetry ── */
  {
    kind: 'special', method: 'GET', path: '/observability/metrics', scope: 'observability:read', list: false,
    summary: 'Prometheus exposition of gateway + runtime metrics (text/plain)',
    query: [{ name: 'windowDays', type: 'integer', description: 'Metrics look-back window in days (default 7)' }],
    run: async (ctx, d) => toPrometheus(d.metrics(numOpt(ctx.query.windowDays) ?? 7) as GatewayMetrics, await d.health()),
  },
  {
    kind: 'special', method: 'GET', path: '/observability/health', scope: 'observability:read', list: false,
    summary: 'System-health snapshot (score, subsystems, throughput, telemetry)',
    run: (_ctx, d) => d.health(),
  },
  {
    kind: 'special', method: 'GET', path: '/observability/traces', scope: 'observability:read', list: false,
    summary: 'Recent gateway requests as OpenTelemetry spans (OTLP/JSON)',
    query: [{ name: 'limit', type: 'integer', description: 'Max spans (1–1000, default 100)' }],
    run: (ctx, d) => auditToTraceExport(d.gatewayAudit(clampLimit(ctx.query.limit, 100))),
  },
  {
    kind: 'special', method: 'GET', path: '/observability/logs', scope: 'observability:read', list: false,
    summary: 'Recent gateway requests as OpenTelemetry logs (OTLP/JSON)',
    query: [{ name: 'limit', type: 'integer', description: 'Max log records (1–1000, default 100)' }],
    run: (ctx, d) => auditToLogsExport(d.gatewayAudit(clampLimit(ctx.query.limit, 100))),
  },
];
