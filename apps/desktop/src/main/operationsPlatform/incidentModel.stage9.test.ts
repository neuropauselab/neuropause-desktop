/**
 * Phase 6 Stage 9 — the incident lifecycle view: `transient: true` is a
 * literal on EVERY row (no incident store exists), stages compose only what
 * exists (window ended → verified-closed; actions → recovering; root cause →
 * investigating; else detected), ownership resolves registry-domain →
 * live unit lead, SOP refs ride the Stage 7 lookup null-safely, and the
 * persistence pointer names the existing decision path.
 */
import { describe, expect, it } from 'vitest';
import type { InsightIncidentView } from '@neuropause/shared';
import { buildIncidentReport, domainForIncident, stageFor, type IncidentInput } from './incidentModel';

const NOW_MS = Date.parse('2026-07-31T12:00:00.000Z');
const NOW_ISO = new Date(NOW_MS).toISOString();

function incident(over: Partial<InsightIncidentView> = {}): InsightIncidentView {
  return {
    id: 'inc-1',
    title: 'Connector sync failures spiking',
    severity: 'critical',
    startTs: NOW_MS - 3_600_000,
    endTs: 0,
    eventIds: ['ev1', 'ev2', 'ev3'],
    resourceIds: ['connector:slack'],
    rootCauseLabel: 'slack token expired',
    rootCauseConfidence: 0.8,
    blastRadius: 4,
    recommendedActions: ['Re-authenticate the Slack connector'],
    ...over,
  };
}

function input(over: Partial<IncidentInput> = {}): IncidentInput {
  return {
    nowIso: NOW_ISO,
    nowMs: NOW_MS,
    incidents: [incident()],
    units: [
      { id: 'u-it', name: 'IT', leadUserId: 'p9' },
      { id: 'u-ops', name: 'Operations', leadUserId: null },
    ],
    users: [{ id: 'p9', name: 'Ravi' }],
    knowledgeMatch: (refs) => refs.map((ref) => ({ ref, matched: ref === 'sop' })),
    failures: {},
    ...over,
  };
}

describe('domainForIncident — token mapping into the Stage 6 vocabulary', () => {
  it('maps by resource/title tokens; unmappable stays null', () => {
    expect(domainForIncident(incident())).toBe('connectors');
    expect(domainForIncident(incident({ title: 'Automation rule failures', resourceIds: [] }))).toBe('automations');
    expect(domainForIncident(incident({ title: 'Worker job backlog', resourceIds: [] }))).toBe('workflows');
    expect(domainForIncident(incident({ title: 'Approval backlog aging', resourceIds: [] }))).toBe('approvals');
    expect(domainForIncident(incident({ title: 'AI engine unstable', resourceIds: [] }))).toBe('ai');
    expect(domainForIncident(incident({ title: 'Mysterious blob', resourceIds: ['blob:1'] }))).toBeNull();
  });
});

describe('stageFor — composed from existing signals, never invented', () => {
  it('ended window → verified-closed (the Stage 6 outcome loop)', () => {
    const s = stageFor(incident({ endTs: NOW_MS - 60_000 }), NOW_MS);
    expect(s.stage).toBe('verified-closed');
  });
  it('open with recommended actions → recovering, pointing at the gated flow', () => {
    const s = stageFor(incident(), NOW_MS);
    expect(s.stage).toBe('recovering');
    expect(s.detail).toContain('existing gated flow');
  });
  it('open with root cause but no actions → investigating; neither → detected', () => {
    expect(stageFor(incident({ recommendedActions: [] }), NOW_MS).stage).toBe('investigating');
    expect(stageFor(incident({ recommendedActions: [], rootCauseLabel: null }), NOW_MS).stage).toBe('detected');
  });
});

describe('buildIncidentReport', () => {
  it('every row carries transient: true — the structural no-ticket-store honesty', () => {
    const r = buildIncidentReport(input({ incidents: [incident(), incident({ id: 'inc-2', endTs: NOW_MS - 1 })] }));
    expect(r.incidents).toHaveLength(2);
    for (const i of r.incidents) expect(i.transient).toBe(true);
  });

  it('ownership resolves the connectors domain to the live IT unit + lead', () => {
    const r = buildIncidentReport(input());
    const i = r.incidents[0];
    expect(i.domain).toBe('connectors');
    expect(i.owner).toEqual({ unitId: 'u-it', unitName: 'IT', leadUserId: 'p9', leadName: 'Ravi' });
  });

  it('an unmapped domain leaves owner null (an honest gap, never invented)', () => {
    const r = buildIncidentReport(input({ incidents: [incident({ title: 'Mysterious blob', resourceIds: ['blob:1'] })] }));
    expect(r.incidents[0].domain).toBeNull();
    expect(r.incidents[0].owner).toBeNull();
  });

  it('SOP refs ride the Stage 7 lookup; a null lookup degrades to matched:false', () => {
    const withLookup = buildIncidentReport(input());
    expect(withLookup.incidents[0].sopRefs).toEqual([
      { ref: 'sop', matched: true },
      { ref: 'connectors', matched: false },
    ]);
    const without = buildIncidentReport(input({ knowledgeMatch: null }));
    expect(without.incidents[0].sopRefs.every((s) => !s.matched)).toBe(true);
  });

  it('the conversion pointer names the EXISTING decision path and the replay hint cites the window', () => {
    const r = buildIncidentReport(input());
    const i = r.incidents[0];
    expect(i.conversion.available).toBe(true);
    expect(i.conversion.how).toContain('governed DECISION');
    expect(i.conversion.how).toContain('no incident store');
    expect(i.investigation.replayHint).toContain('Replay 3 correlated event(s)');
    expect(i.investigation.replayHint).toContain('open');
  });

  it('totals count OPEN incidents by severity; closed ones are excluded from open', () => {
    const r = buildIncidentReport(
      input({
        incidents: [
          incident(),
          incident({ id: 'inc-2', severity: 'warning' }),
          incident({ id: 'inc-3', endTs: NOW_MS - 1 }), // closed
        ],
      }),
    );
    expect(r.totals.open).toBe(2);
    const bySev = new Map(r.totals.bySeverity.map((s) => [s.severity, s.count]));
    expect(bySev.get('critical')).toBe(1);
    expect(bySev.get('warning')).toBe(1);
  });

  it('null incidents (insight unavailable) produce an empty honest report', () => {
    const r = buildIncidentReport(input({ incidents: null, failures: { insight: 'offline' } }));
    expect(r.incidents).toEqual([]);
    expect(r.unavailable).toContainEqual({ system: 'insight', reason: 'offline' });
  });
});
