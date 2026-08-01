/**
 * Phase 6 Stage 11 — shared operations (S9 composition): per-partner exposure
 * through the DECLARED share-kind → service map × live states/SLA; unreadable
 * services are gaps; the disclosure states exposure is declared, not measured.
 */
import { describe, expect, it } from 'vitest';
import { buildSharedOperations, EXPOSURE_DISCLOSURE } from './sharedOperations';

describe('buildSharedOperations', () => {
  it('maps each partner share kind to its declared services with live state + SLA status', () => {
    const v = buildSharedOperations({
      shares: [
        { kind: 'ai_worker', peerOrg: 'org-helios', peerOrgName: 'Helios Commerce' },
        { kind: 'connector', peerOrg: 'org-aperture', peerOrgName: 'Aperture Capital' },
      ],
      s9Services: [
        { serviceId: 'workforce-jobs', state: 'operational' },
        { serviceId: 'execution-runtime', state: 'degraded' },
        { serviceId: 'connector-fleet', state: 'operational' },
      ],
      slaStatuses: [
        { targetId: 'jobs-queue-depth', serviceId: 'workforce-jobs', status: 'met' },
        { targetId: 'connector-healthy-ratio', serviceId: 'connector-fleet', status: 'breached' },
      ],
      readiness: [{ state: 'ready' }, { state: 'ready' }, { state: 'degraded' }],
      capacityPressure: 'low',
      failures: {},
    });
    const helios = v.partners.find((p) => p.peerOrg === 'org-helios')!;
    expect(helios.services.map((s) => s.serviceId).sort()).toEqual(['execution-runtime', 'workforce-jobs']);
    expect(helios.services.find((s) => s.serviceId === 'execution-runtime')!.state).toBe('degraded');
    expect(helios.services.find((s) => s.serviceId === 'workforce-jobs')!.slaStatus).toBe('met');
    const aperture = v.partners.find((p) => p.peerOrg === 'org-aperture')!;
    expect(aperture.services[0]).toMatchObject({ serviceId: 'connector-fleet', slaStatus: 'breached' });
    expect(v.readiness).toEqual({ ready: 2, degraded: 1, notReady: 0, unknown: 0 });
    expect(v.disclosure).toBe(EXPOSURE_DISCLOSURE);
    expect(v.disclosure).toContain('declared');
  });

  it('a mapped service missing from the live catalog is a declared gap with unknown state', () => {
    const v = buildSharedOperations({
      shares: [{ kind: 'connector', peerOrg: 'p1', peerOrgName: 'P1' }],
      s9Services: [],
      slaStatuses: [],
      readiness: null,
      capacityPressure: null,
      failures: { readiness: 'unreadable' },
    });
    expect(v.partners[0].services[0]).toMatchObject({ serviceId: 'connector-fleet', state: 'unknown', slaStatus: null });
    expect(v.gaps.some((g) => g.kind === 'exposure')).toBe(true);
    expect(v.readiness).toBeNull();
    expect(v.unavailable).toContainEqual({ system: 'readiness', reason: 'unreadable' });
  });

  it('no shares → no partner exposure rows (honest zero, not a fabricated fleet)', () => {
    const v = buildSharedOperations({ shares: [], s9Services: [], slaStatuses: [], readiness: [], capacityPressure: 'low', failures: {} });
    expect(v.partners).toEqual([]);
  });
});
