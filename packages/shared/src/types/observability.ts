/**
 * Observability API shapes (P3.0, Increment 9).
 *
 * The platform already produces the raw telemetry — the Ecosystem gateway records
 * every request (status + latency), and NeuroCore composes a system-health snapshot.
 * This increment exposes that existing telemetry over the public API in the shapes
 * integrators' tooling already understands: Prometheus text exposition for metrics,
 * and OTLP/JSON (OpenTelemetry) for traces + logs. Types-only — the formatters live
 * in `main/observability` and read the real gateway audit + health snapshot.
 */

/** Prometheus exposition is plain text; this alias documents the intent at call sites. */
export type PrometheusExposition = string;

/** OTLP AnyValue — the tagged scalar OpenTelemetry attributes use. */
export type OtelAnyValue =
  | { stringValue: string }
  | { intValue: number }
  | { boolValue: boolean }
  | { doubleValue: number };

export interface OtelKeyValue {
  key: string;
  value: OtelAnyValue;
}

/** OTLP span kind — 2 = SERVER (an inbound request handled by the gateway). */
export type OtelSpanKind = 1 | 2 | 3 | 4 | 5;

/** OTLP status code — 0 UNSET, 1 OK, 2 ERROR. */
export type OtelStatusCode = 0 | 1 | 2;

export interface OtelSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: OtelSpanKind;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtelKeyValue[];
  status: { code: OtelStatusCode; message?: string };
}

export interface OtelScope {
  name: string;
  version?: string;
}

export interface OtelResource {
  attributes: OtelKeyValue[];
}

export interface OtelScopeSpans {
  scope: OtelScope;
  spans: OtelSpan[];
}

export interface OtelResourceSpans {
  resource: OtelResource;
  scopeSpans: OtelScopeSpans[];
}

/** OTLP/JSON trace export — the body an OTLP/HTTP consumer accepts. */
export interface OtelTraceExport {
  resourceSpans: OtelResourceSpans[];
}

export interface OtelLogRecord {
  timeUnixNano: string;
  /** OTLP severity number: 9 INFO, 13 WARN, 17 ERROR. */
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtelKeyValue[];
  traceId?: string;
  spanId?: string;
}

export interface OtelScopeLogs {
  scope: OtelScope;
  logRecords: OtelLogRecord[];
}

export interface OtelResourceLogs {
  resource: OtelResource;
  scopeLogs: OtelScopeLogs[];
}

/** OTLP/JSON logs export. */
export interface OtelLogsExport {
  resourceLogs: OtelResourceLogs[];
}
