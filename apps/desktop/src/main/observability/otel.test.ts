/** P3.0 Increment 9 — OTLP projection tests (spans + logs from gateway audit). */
import { describe, expect, it } from 'vitest';
import type { GatewayAuditEntry } from '@neuropause/shared';
import { auditToLogRecords, auditToLogsExport, auditToSpans, auditToTraceExport } from './otel';

function entry(over: Partial<GatewayAuditEntry> = {}): GatewayAuditEntry {
  return { id: 'gw_1', at: '2026-01-01T00:00:00.000Z', keyId: 'k1', developerId: 'dev1', method: 'GET', path: '/modules', version: 'v1', status: 200, reason: 'OK', latencyMs: 12, ...over };
}

describe('auditToSpans', () => {
  it('maps a request to a deterministic SERVER span with request attributes', () => {
    const [s] = auditToSpans([entry()]);
    expect(s.name).toBe('GET /modules');
    expect(s.kind).toBe(2);
    expect(s.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(s.spanId).toMatch(/^[0-9a-f]{16}$/);
    // 2026-01-01T00:00:00Z = 1767225600000 ms → *1e6 ns; +12ms latency on end.
    expect(s.startTimeUnixNano).toBe('1767225600000000000');
    expect(s.endTimeUnixNano).toBe('1767225600012000000');
    expect(s.status).toEqual({ code: 1 });
    expect(s.attributes).toContainEqual({ key: 'http.response.status_code', value: { intValue: 200 } });
    expect(s.attributes).toContainEqual({ key: 'enduser.id', value: { stringValue: 'dev1' } });
  });

  it('is deterministic — same entry id yields the same ids', () => {
    expect(auditToSpans([entry()])[0].traceId).toBe(auditToSpans([entry()])[0].traceId);
  });

  it('flags 4xx/5xx as ERROR with the reason', () => {
    const [s] = auditToSpans([entry({ status: 403, reason: 'forbidden' })]);
    expect(s.status).toEqual({ code: 2, message: 'forbidden' });
  });

  it('omits credential attributes when anonymous', () => {
    const [s] = auditToSpans([entry({ keyId: null, developerId: null })]);
    expect(s.attributes.some((a) => a.key === 'enduser.id')).toBe(false);
  });

  it('wraps spans in an OTLP resourceSpans envelope', () => {
    const exp = auditToTraceExport([entry()]);
    expect(exp.resourceSpans[0].resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'neuropause-gateway' } });
    expect(exp.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
  });
});

describe('auditToLogRecords', () => {
  it('maps status to OTLP severity and a readable body', () => {
    const recs = auditToLogRecords([entry({ status: 200 }), entry({ status: 404 }), entry({ status: 502 })]);
    expect(recs.map((r) => r.severityText)).toEqual(['INFO', 'WARN', 'ERROR']);
    expect(recs.map((r) => r.severityNumber)).toEqual([9, 13, 17]);
    expect(recs[0].body.stringValue).toBe('GET /modules -> 200 (12ms)');
    expect(recs[0].traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('wraps logs in an OTLP resourceLogs envelope', () => {
    const exp = auditToLogsExport([entry()]);
    expect(exp.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1);
  });
});
