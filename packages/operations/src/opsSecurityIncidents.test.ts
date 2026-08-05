import { describe, it, expect } from 'vitest';
import { ManualClock, AuditChain } from '@neuropause/cloud-core';
import { OperationalSecurity } from './opsSecurity';
import { IncidentRegistry } from './incidents';

describe('Operational Security (Phase 9)', () => {
  it('checks runtime integrity, validates config, and monitors secrets + certs', () => {
    const os = new OperationalSecurity(new ManualClock(0));
    os.setIntegrityBaseline([{ name: 'config', content: 'v1' }]);
    expect(os.checkIntegrity([{ name: 'config', content: 'v1' }]).ok).toBe(true);
    const tampered = os.checkIntegrity([{ name: 'config', content: 'TAMPERED' }]);
    expect(tampered.ok).toBe(false);
    expect(tampered.mismatches).toContain('config');

    const cfg = os.validateConfig({ port: 8080 }, [{ key: 'port', required: true }, { key: 'host', required: true }]);
    expect(cfg.valid).toBe(false);
    expect(cfg.violations.map((v) => v.key)).toContain('host');

    os.trackSecret({ name: 'api-key', lastRotatedAt: 0, maxAgeMs: 1000 });
    expect(os.secretsDueForRotation(500)).toHaveLength(0);
    expect(os.secretsDueForRotation(1000).map((s) => s.name)).toContain('api-key');

    os.trackCertificate({ name: 'tls', notAfter: 1000 });
    expect(os.certificatesExpiringWithin(500, 600).map((c) => c.name)).toContain('tls');
    expect(os.certificatesExpired(1000)).toHaveLength(1);
  });

  it('aggregates threats and raises incidents at/above the threshold', () => {
    const os = new OperationalSecurity(new ManualClock(0), { incidentThreshold: 'high' });
    let raised = 0;
    os.onSecurityIncident(() => { raised += 1; });
    os.ingestThreat({ kind: 'port-scan', severity: 'low', detail: 'noise', at: 0 });
    os.ingestThreat({ kind: 'exfil', severity: 'critical', detail: 'bad', at: 0 });
    expect(raised).toBe(1); // only the critical one crosses the threshold
    expect(os.threatSummary().total).toBe(2);
    expect(os.threatSummary().bySeverity.critical).toBe(1);
  });

  it('subscribes to the Phase-14 security threat stream', () => {
    let emit: (s: { kind: string; severity: 'low' | 'medium' | 'high'; detail: string; at: number }) => void = () => undefined;
    const fakeSecurity = { onThreat: (h: typeof emit) => { emit = h; } };
    const os = new OperationalSecurity(new ManualClock(0), { security: fakeSecurity, incidentThreshold: 'high' });
    let raised = 0;
    os.onSecurityIncident(() => { raised += 1; });
    emit({ kind: 'brute-force', severity: 'high', detail: 'many failed logins', at: 0 });
    expect(raised).toBe(1);
    expect(os.threatSummary().total).toBe(1);
  });

  it('evaluates operational policies', () => {
    const os = new OperationalSecurity(new ManualClock(0));
    os.definePolicy({ id: 'no-debug', description: 'no debug in prod', check: (ctx) => ctx.debug !== true });
    expect(os.evaluatePolicies({ debug: false })).toContainEqual({ id: 'no-debug', ok: true, description: 'no debug in prod' });
    expect(os.evaluatePolicies({ debug: true })[0]!.ok).toBe(false);
  });
});

describe('Incident Management (Phase 10) — integrates with the one audit chain', () => {
  it('runs the incident lifecycle, computes MTTR, and records to the audit chain', () => {
    const clock = new ManualClock(0);
    const chain = new AuditChain();
    const reg = new IncidentRegistry(clock, { audit: chain });
    const inc = reg.open({ title: 'DB unavailable', severity: 'sev1', services: ['db'], runbook: 'RB-42' });
    reg.acknowledge(inc.id, 'oncall');
    clock.advance(5000);
    reg.setRootCause(inc.id, 'disk full');
    reg.resolve(inc.id);

    const got = reg.get(inc.id);
    expect(got?.state).toBe('resolved');
    expect(got?.rootCause).toBe('disk full');
    expect(got?.timeline.length).toBeGreaterThanOrEqual(4);

    const status = reg.status();
    expect(status.mttrMs).toBe(5000);
    expect(status.bySeverity.sev1).toBe(1);
    expect(status.open).toBe(0);

    // every incident event landed on the ONE audit chain, verifiable
    expect(chain.list().length).toBeGreaterThanOrEqual(4);
    expect(chain.verify().valid).toBe(true);
  });

  it('tracks recovery, escalation, and generates a postmortem template', () => {
    const reg = new IncidentRegistry(new ManualClock(0));
    const inc = reg.open({ title: 'Latency spike', severity: 'sev3' });
    reg.trackRecovery(inc.id, ['failover', 'restore-cache']);
    reg.completeRecoveryStep(inc.id, 'failover');
    expect(reg.recoveryComplete(inc.id)).toBe(false);
    reg.completeRecoveryStep(inc.id, 'restore-cache');
    expect(reg.recoveryComplete(inc.id)).toBe(true);

    reg.setEscalation({ severity: 'sev3', contacts: ['team-lead'], withinMs: 600_000 });
    expect(reg.escalationFor('sev3')?.contacts).toContain('team-lead');

    reg.setRootCause(inc.id, 'cache stampede');
    const pm = reg.postmortemTemplate(inc.id);
    expect(pm).toContain('# Postmortem — Latency spike');
    expect(pm).toContain('cache stampede');
    expect(pm).toContain('## Action Items');
  });
});
