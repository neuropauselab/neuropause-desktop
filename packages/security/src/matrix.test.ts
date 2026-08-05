import { describe, it, expect } from 'vitest';
import { SECURITY_MATRIX, THREAT_MODEL, INFRA_PENDING_IDS, readinessSummary, type StrideCategory } from './matrix';

describe('Production Readiness Matrix — anti-fabrication invariants', () => {
  it('never marks certification as verified', () => {
    const cert = SECURITY_MATRIX.find((e) => e.id === 'compliance.cert');
    expect(cert).toBeDefined();
    expect(cert!.evidence).toBe('infra-pending');
  });

  it('marks live IdP federation, real KMS/HSM, and hardware attestation as infra-pending', () => {
    for (const id of ['federation.oidc', 'federation.saml', 'keys.kms', 'authn.attestation', 'compliance.cert']) {
      expect(INFRA_PENDING_IDS.has(id)).toBe(true);
      expect(SECURITY_MATRIX.find((e) => e.id === id)?.evidence).toBe('infra-pending');
    }
  });

  it('gives every capability a unique id, an area, and a declared evidence level', () => {
    const ids = new Set<string>();
    for (const e of SECURITY_MATRIX) {
      expect(['verified', 'infra-pending']).toContain(e.evidence);
      expect(e.area).toBeTruthy();
      expect(e.capability).toBeTruthy();
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
    }
  });

  it('keeps the readiness summary counts consistent with the matrix', () => {
    const s = readinessSummary();
    expect(s.total).toBe(SECURITY_MATRIX.length);
    expect(s.verified + s.infraPending).toBe(s.total);
    expect(s.infraPending).toBe(INFRA_PENDING_IDS.size);
    // real crypto/logic makes the majority VERIFIED, but infra-dependent items remain honest
    expect(s.verified).toBeGreaterThan(0);
    expect(s.infraPending).toBeGreaterThan(0);
  });
});

describe('Security Threat Model — STRIDE coverage', () => {
  it('covers all six STRIDE categories with a mitigation and an honest status', () => {
    const categories: StrideCategory[] = ['spoofing', 'tampering', 'repudiation', 'information-disclosure', 'denial-of-service', 'elevation-of-privilege'];
    const covered = new Set(THREAT_MODEL.map((t) => t.category));
    for (const c of categories) expect(covered.has(c)).toBe(true);
    for (const t of THREAT_MODEL) {
      expect(t.threat).toBeTruthy();
      expect(t.mitigation).toBeTruthy();
      expect(['verified', 'infra-pending']).toContain(t.status);
    }
  });

  it('honestly marks the IdP-assertion-forgery mitigation as infra-pending', () => {
    const t = THREAT_MODEL.find((x) => x.id === 'T-09');
    expect(t?.category).toBe('spoofing');
    expect(t?.status).toBe('infra-pending');
  });
});
