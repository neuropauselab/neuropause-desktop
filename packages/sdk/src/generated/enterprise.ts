/**
 * AUTO-GENERATED from ENTERPRISE_API_ROUTE_MANIFEST — do not edit by hand.
 * Regenerate with: npm run generate -w @neuropause/sdk
 *
 * Every method delegates to the single Transport request builder (no per-endpoint
 * request code) and executes an existing enterprise handler under gateway auth + RBAC.
 */
import type { ApiListPage } from '@neuropause/shared';
import type { Transport } from '../transport';

export class EnterpriseResource {
  constructor(private readonly t: Transport) {}

  /** GET /health — API liveness, version, and route count */
  getHealth<T = unknown>(query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/health`, query, scope: 'observability:read' }).then((r) => r.data);
  }

  /** GET /metrics — Gateway request metrics (requests, statuses, latency) over a window */
  getMetrics<T = unknown>(query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/metrics`, query, scope: 'observability:read' }).then((r) => r.data);
  }

  /** GET /modules — List registered ERP modules with live record counts */
  getModules<T = unknown>(query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/modules`, query, scope: 'records:read' }).then((r) => r.data);
  }

  /** GET /modules/:moduleId/records — List records in a module (filter by status/search; sort + cursor pagination) */
  getModulesModuleIdRecords<T = unknown>(moduleId: string, query?: Record<string, string | number | boolean | undefined>): Promise<ApiListPage<T>> {
    return this.t.request<ApiListPage<T>>({ method: 'GET', path: `/modules/${encodeURIComponent(moduleId)}/records`, query, scope: 'records:read' }).then((r) => r.data);
  }

  /** GET /modules/:moduleId/records/:id — Get one record by id */
  getModulesModuleIdRecordsId<T = unknown>(moduleId: string, id: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/modules/${encodeURIComponent(moduleId)}/records/${encodeURIComponent(id)}`, query, scope: 'records:read' }).then((r) => r.data);
  }

  /** POST /modules/:moduleId/records — Create a record */
  postModulesModuleIdRecords<T = unknown>(moduleId: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'POST', path: `/modules/${encodeURIComponent(moduleId)}/records`, query, body, scope: 'records:write' }).then((r) => r.data);
  }

  /** PUT /modules/:moduleId/records/:id — Replace a record */
  putModulesModuleIdRecordsId<T = unknown>(moduleId: string, id: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'PUT', path: `/modules/${encodeURIComponent(moduleId)}/records/${encodeURIComponent(id)}`, query, body, scope: 'records:write' }).then((r) => r.data);
  }

  /** PATCH /modules/:moduleId/records/:id — Update a record (partial) */
  patchModulesModuleIdRecordsId<T = unknown>(moduleId: string, id: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'PATCH', path: `/modules/${encodeURIComponent(moduleId)}/records/${encodeURIComponent(id)}`, query, body, scope: 'records:write' }).then((r) => r.data);
  }

  /** DELETE /modules/:moduleId/records/:id — Delete a record */
  deleteModulesModuleIdRecordsId<T = unknown>(moduleId: string, id: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'DELETE', path: `/modules/${encodeURIComponent(moduleId)}/records/${encodeURIComponent(id)}`, query, scope: 'records:write' }).then((r) => r.data);
  }

  /** POST /modules/:moduleId/records/:id/status — Set a record status (active/archived/deleted) */
  postModulesModuleIdRecordsIdStatus<T = unknown>(moduleId: string, id: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'POST', path: `/modules/${encodeURIComponent(moduleId)}/records/${encodeURIComponent(id)}/status`, query, body, scope: 'records:write' }).then((r) => r.data);
  }

  /** GET /modules/:moduleId/search — Search records within a module */
  getModulesModuleIdSearch<T = unknown>(moduleId: string, query?: Record<string, string | number | boolean | undefined>): Promise<ApiListPage<T>> {
    return this.t.request<ApiListPage<T>>({ method: 'GET', path: `/modules/${encodeURIComponent(moduleId)}/search`, query, scope: 'records:read' }).then((r) => r.data);
  }

  /** POST /modules/:moduleId/records/:id/summarize — AI summary + risk for a record (existing AI pipeline) */
  postModulesModuleIdRecordsIdSummarize<T = unknown>(moduleId: string, id: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'POST', path: `/modules/${encodeURIComponent(moduleId)}/records/${encodeURIComponent(id)}/summarize`, query, body, scope: 'records:read' }).then((r) => r.data);
  }

  /** POST /modules/:moduleId/records/:id/actions/:action — Run a module-defined record action (e.g. convert a lead) */
  postModulesModuleIdRecordsIdActionsAction<T = unknown>(moduleId: string, id: string, action: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'POST', path: `/modules/${encodeURIComponent(moduleId)}/records/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`, query, body, scope: 'records:write' }).then((r) => r.data);
  }

  /** POST /modules/:moduleId/records/bulk — Bulk create/update/delete/setStatus (≤100 ops), each applied independently */
  postModulesModuleIdRecordsBulk<T = unknown>(moduleId: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'POST', path: `/modules/${encodeURIComponent(moduleId)}/records/bulk`, query, body, scope: 'records:write' }).then((r) => r.data);
  }

  /** GET /graph/counts — Knowledge graph node/edge counts */
  getGraphCounts<T = unknown>(query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/graph/counts`, query, scope: 'graph:read' }).then((r) => r.data);
  }

  /** GET /graph/nodes/:id — Get a graph node */
  getGraphNodesId<T = unknown>(id: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/graph/nodes/${encodeURIComponent(id)}`, query, scope: 'graph:read' }).then((r) => r.data);
  }

  /** GET /graph/nodes/:id/neighbors — Immediate neighbors of a node */
  getGraphNodesIdNeighbors<T = unknown>(id: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/graph/nodes/${encodeURIComponent(id)}/neighbors`, query, scope: 'graph:read' }).then((r) => r.data);
  }

  /** GET /graph/nodes/:id/subgraph — Ego subgraph around a node */
  getGraphNodesIdSubgraph<T = unknown>(id: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/graph/nodes/${encodeURIComponent(id)}/subgraph`, query, scope: 'graph:read' }).then((r) => r.data);
  }

  /** GET /context/:id — Entity-360 context (neighbors + impact + timeline + memory) */
  getContextId<T = unknown>(id: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/context/${encodeURIComponent(id)}`, query, scope: 'context:read' }).then((r) => r.data);
  }

  /** GET /timeline — Query the unified enterprise timeline */
  getTimeline<T = unknown>(query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/timeline`, query, scope: 'timeline:read' }).then((r) => r.data);
  }

  /** GET /search — Cross-domain enterprise search */
  getSearch<T = unknown>(query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/search`, query, scope: 'search:read' }).then((r) => r.data);
  }

  /** GET /automation — List automation rules + summary */
  getAutomation<T = unknown>(query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/automation`, query, scope: 'automation:read' }).then((r) => r.data);
  }

  /** GET /automation/monitor — Automation monitor rollup */
  getAutomationMonitor<T = unknown>(query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.t.request<T>({ method: 'GET', path: `/automation/monitor`, query, scope: 'automation:read' }).then((r) => r.data);
  }
}
