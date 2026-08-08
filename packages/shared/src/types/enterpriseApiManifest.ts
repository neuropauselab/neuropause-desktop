/**
 * Enterprise API route manifest (P3.0, Increment 5) — the canonical public route
 * list, kept in shared so BOTH the desktop route registry and the SDK generator use
 * one source of truth. A desktop test asserts the live registry index equals this
 * manifest, so they can never drift. Generated data — do not hand-edit; regenerate
 * from `enterpriseApiRouteIndex()`.
 */
import type { ApiRouteInfo } from "./enterpriseApi";

export const ENTERPRISE_API_ROUTE_MANIFEST: readonly ApiRouteInfo[] = [
  {"method":"GET","path":"/health","scope":"observability:read","summary":"API liveness, version, and route count","list":false},
  {"method":"GET","path":"/metrics","scope":"observability:read","summary":"Gateway request metrics (requests, statuses, latency) over a window","list":false},
  {"method":"GET","path":"/modules","scope":"records:read","summary":"List registered ERP modules with live record counts","list":false},
  {"method":"GET","path":"/modules/:moduleId/records","scope":"records:read","summary":"List records in a module (filter by status/search; sort + cursor pagination)","list":true},
  {"method":"GET","path":"/modules/:moduleId/records/:id","scope":"records:read","summary":"Get one record by id","list":false},
  {"method":"POST","path":"/modules/:moduleId/records","scope":"records:write","summary":"Create a record","list":false},
  {"method":"PUT","path":"/modules/:moduleId/records/:id","scope":"records:write","summary":"Replace a record","list":false},
  {"method":"PATCH","path":"/modules/:moduleId/records/:id","scope":"records:write","summary":"Update a record (partial)","list":false},
  {"method":"DELETE","path":"/modules/:moduleId/records/:id","scope":"records:write","summary":"Delete a record","list":false},
  {"method":"POST","path":"/modules/:moduleId/records/:id/status","scope":"records:write","summary":"Set a record status (active/archived/deleted)","list":false},
  {"method":"GET","path":"/modules/:moduleId/search","scope":"records:read","summary":"Search records within a module","list":true},
  {"method":"POST","path":"/modules/:moduleId/records/:id/summarize","scope":"records:read","summary":"AI summary + risk for a record (existing AI pipeline)","list":false},
  {"method":"POST","path":"/modules/:moduleId/records/:id/actions/:action","scope":"records:write","summary":"Run a module-defined record action (e.g. convert a lead)","list":false},
  {"method":"POST","path":"/modules/:moduleId/records/bulk","scope":"records:write","summary":"Bulk create/update/delete/setStatus (≤100 ops), each applied independently","list":false},
  {"method":"GET","path":"/graph/counts","scope":"graph:read","summary":"Knowledge graph node/edge counts","list":false},
  {"method":"GET","path":"/graph/nodes/:id","scope":"graph:read","summary":"Get a graph node","list":false},
  {"method":"GET","path":"/graph/nodes/:id/neighbors","scope":"graph:read","summary":"Immediate neighbors of a node","list":false},
  {"method":"GET","path":"/graph/nodes/:id/subgraph","scope":"graph:read","summary":"Ego subgraph around a node","list":false},
  {"method":"GET","path":"/context/:id","scope":"context:read","summary":"Entity-360 context (neighbors + impact + timeline + memory)","list":false},
  {"method":"GET","path":"/timeline","scope":"timeline:read","summary":"Query the unified enterprise timeline","list":false},
  {"method":"GET","path":"/search","scope":"search:read","summary":"Cross-domain enterprise search","list":false},
  {"method":"GET","path":"/automation","scope":"automation:read","summary":"List automation rules + summary","list":false},
  {"method":"GET","path":"/automation/monitor","scope":"automation:read","summary":"Automation monitor rollup","list":false},
  {"method":"GET","path":"/industry/catalog","scope":"industry:read","summary":"Canonical Wave 9 industry solution-pack catalog snapshot","list":false},
  {"method":"GET","path":"/observability/metrics","scope":"observability:read","summary":"Prometheus exposition of gateway + runtime metrics (text/plain)","list":false},
  {"method":"GET","path":"/observability/health","scope":"observability:read","summary":"System-health snapshot (score, subsystems, throughput, telemetry)","list":false},
  {"method":"GET","path":"/observability/traces","scope":"observability:read","summary":"Recent gateway requests as OpenTelemetry spans (OTLP/JSON)","list":false},
  {"method":"GET","path":"/observability/logs","scope":"observability:read","summary":"Recent gateway requests as OpenTelemetry logs (OTLP/JSON)","list":false},
];
