/**
 * OpenTelemetry (OTLP/JSON) projection of the gateway audit trail (P3.0, Increment 9).
 *
 * Every public API call the Ecosystem gateway already records — method, path,
 * status, latency, credential — becomes one OTLP SERVER span and one correlated log
 * record. Pure + deterministic: ids are derived from the audit entry id (stable
 * across calls) and timestamps from the recorded `at` + latency, so there is no new
 * telemetry and nothing to mock. Formatters only; the route wires the real audit.
 */
import type {
  GatewayAuditEntry,
  OtelKeyValue,
  OtelLogRecord,
  OtelLogsExport,
  OtelResource,
  OtelSpan,
  OtelTraceExport,
} from '@neuropause/shared';

const SERVICE_NAME = 'neuropause-gateway';
const SCOPE_NAME = 'neuropause.gateway';

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic lowercase-hex id of `bytes` length, expanded from a seed. */
function hexId(seed: string, bytes: number): string {
  let out = '';
  for (let salt = 0; out.length < bytes * 2; salt += 1) {
    out += fnv1a(`${seed}:${salt}`).toString(16).padStart(8, '0');
  }
  return out.slice(0, bytes * 2);
}

function startNano(at: string): bigint {
  const ms = Date.parse(at);
  return BigInt(Number.isFinite(ms) ? ms : 0) * 1_000_000n;
}

function str(key: string, value: string): OtelKeyValue {
  return { key, value: { stringValue: value } };
}
function int(key: string, value: number): OtelKeyValue {
  return { key, value: { intValue: Math.trunc(value) } };
}

function requestAttributes(e: GatewayAuditEntry): OtelKeyValue[] {
  const attrs: OtelKeyValue[] = [
    str('http.request.method', e.method),
    str('url.path', e.path),
    int('http.response.status_code', e.status),
    str('neuropause.api.version', e.version),
  ];
  if (e.developerId) attrs.push(str('enduser.id', e.developerId));
  if (e.keyId) attrs.push(str('neuropause.credential.id', e.keyId));
  return attrs;
}

function resource(): OtelResource {
  return { attributes: [str('service.name', SERVICE_NAME)] };
}

/** One OTLP SERVER span per recorded request. */
export function auditToSpans(entries: readonly GatewayAuditEntry[]): OtelSpan[] {
  return entries.map((e) => {
    const start = startNano(e.at);
    const end = start + BigInt(Math.max(0, Math.round(e.latencyMs * 1_000_000)));
    const errored = e.status >= 400;
    return {
      traceId: hexId(e.id, 16),
      spanId: hexId(`${e.id}:span`, 8),
      name: `${e.method} ${e.path}`,
      kind: 2,
      startTimeUnixNano: start.toString(),
      endTimeUnixNano: end.toString(),
      attributes: requestAttributes(e),
      status: errored ? { code: 2, message: e.reason } : { code: 1 },
    };
  });
}

export function auditToTraceExport(entries: readonly GatewayAuditEntry[]): OtelTraceExport {
  return {
    resourceSpans: [{ resource: resource(), scopeSpans: [{ scope: { name: SCOPE_NAME }, spans: auditToSpans(entries) }] }],
  };
}

function severity(status: number): { severityNumber: number; severityText: string } {
  if (status >= 500) return { severityNumber: 17, severityText: 'ERROR' };
  if (status >= 400) return { severityNumber: 13, severityText: 'WARN' };
  return { severityNumber: 9, severityText: 'INFO' };
}

/** One OTLP log record per recorded request, correlated to its span. */
export function auditToLogRecords(entries: readonly GatewayAuditEntry[]): OtelLogRecord[] {
  return entries.map((e) => {
    const sev = severity(e.status);
    return {
      timeUnixNano: startNano(e.at).toString(),
      severityNumber: sev.severityNumber,
      severityText: sev.severityText,
      body: { stringValue: `${e.method} ${e.path} -> ${e.status} (${e.latencyMs}ms)` },
      attributes: requestAttributes(e),
      traceId: hexId(e.id, 16),
      spanId: hexId(`${e.id}:span`, 8),
    };
  });
}

export function auditToLogsExport(entries: readonly GatewayAuditEntry[]): OtelLogsExport {
  return {
    resourceLogs: [{ resource: resource(), scopeLogs: [{ scope: { name: SCOPE_NAME }, logRecords: auditToLogRecords(entries) }] }],
  };
}
