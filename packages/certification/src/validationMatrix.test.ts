/**
 * Validation-matrix invariants (NCEA 16.0). Enforces the anti-fabrication rules of
 * the capstone: every subsystem has an evidence tier backed by real tests;
 * production readiness is never certified as fully verified; external-audit and
 * live-infrastructure items stay out of VERIFIED; and the Phase-14/15 INFRA-PENDING
 * sets are still non-empty (the certification does not silently upgrade them).
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_MATRIX, CERTIFICATION_AREAS, EVIDENCE_TIERS, matrixSummary } from './validationMatrix';
import { INFRA_PENDING_IDS as SECURITY_INFRA_PENDING } from '@neuropause/security';
import { INFRA_PENDING_IDS as OPERATIONS_INFRA_PENDING } from '@neuropause/operations';

describe('Enterprise Validation Matrix — anti-fabrication invariants', () => {
  it('gives every subsystem a valid evidence tier and traceable tests', () => {
    expect(VALIDATION_MATRIX.length).toBe(9);
    for (const s of VALIDATION_MATRIX) {
      expect(EVIDENCE_TIERS).toContain(s.status);
      expect(s.tests).toBeGreaterThan(0); // nothing verified with zero tests
      expect(s.verified.length).toBeGreaterThan(0);
    }
  });

  it('never certifies production readiness as fully VERIFIED', () => {
    const prod = CERTIFICATION_AREAS.find((c) => c.area === 'Production Readiness');
    expect(prod?.status).toBe('pilot-verified'); // gated on a real pilot + infra
  });

  it('keeps external-audit and live-infrastructure items out of VERIFIED', () => {
    const security = VALIDATION_MATRIX.find((s) => s.subsystem === 'Security')!;
    expect(security.infraPending.length).toBeGreaterThan(0); // live IdP/KMS/attestation acknowledged
    expect(security.pilotVerified.length).toBeGreaterThan(0); // external SOC2/ISO audit acknowledged

    const ops = VALIDATION_MATRIX.find((s) => s.subsystem === 'Operations')!;
    expect(ops.infraPending.length).toBeGreaterThan(0);
    expect(ops.pilotVerified.length).toBeGreaterThan(0);
  });

  it('does not silently upgrade the Phase-14/15 INFRA-PENDING sets', () => {
    // Those honesty invariants from Security (14) and Operations (15) still hold.
    expect(SECURITY_INFRA_PENDING.size).toBeGreaterThan(0);
    expect(OPERATIONS_INFRA_PENDING.size).toBeGreaterThan(0);
    expect(SECURITY_INFRA_PENDING.has('compliance.cert')).toBe(true);
    expect(OPERATIONS_INFRA_PENDING.has('perf.scale')).toBe(true);
  });

  it('reconciles the summary with the matrix and certification areas', () => {
    const s = matrixSummary();
    expect(s.subsystems).toBe(VALIDATION_MATRIX.length);
    expect(s.totalVerifiedTests).toBe(VALIDATION_MATRIX.reduce((n, x) => n + x.tests, 0));
    expect(s.certifications).toBe(CERTIFICATION_AREAS.length);
    expect(s.certifiedVerified).toBeLessThan(s.certifications); // production readiness is not 'verified'
  });
});
