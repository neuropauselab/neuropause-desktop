/**
 * Phase 6 Stage 11 — the trust model (D-4): every signal is a recorded fact,
 * the declared level is never changed, divergence is reported in BOTH
 * directions, and unreadable sources yield `unknown` — never a guess.
 */
import { describe, expect, it } from 'vitest';
import { assessTrust, buildTrustReport, evidenceSupportedLevel, TRUST_DISCLOSURE, type TrustSignals } from './trustModel';

const NOW = '2026-07-31T12:00:00.000Z';

function fullSignals(): TrustSignals {
  return {
    // sharedIn: 0 → reciprocity NOT live → the evidence supports exactly
    // 'verified' (invitation + attestation + signatures), not 'full'.
    peers: [{ id: 'org-helios', name: 'Helios Commerce', trustLevel: 'verified', status: 'active', sharedOut: 2, sharedIn: 0 }],
    trusts: [
      { peerOrg: 'org-helios', peerOrgName: 'Helios Commerce', trustLevel: 'verified', delegatedApproval: true, canShareWorkers: true, canShareData: false },
    ],
    invitations: [{ toOrg: 'org-helios', fromOrg: 'org-home', status: 'accepted' }],
    artifacts: [{ publisherOrg: 'org-helios', signaturesEd25519: true }],
    audit: [{ peerOrg: 'org-helios' }, { peerOrg: null }],
    policies: [
      { action: 'share_data', enabled: true },
      { action: 'cross_org_run', enabled: true },
    ],
  };
}

describe('assessTrust — declared beside computed, both divergence directions', () => {
  it('every expected signal recorded → consistent', () => {
    const r = buildTrustReport({ nowIso: NOW, signals: fullSignals(), failures: {} });
    const p = r.partners[0];
    expect(p.declaredLevel).toBe('verified');
    expect(p.assessment).toBe('consistent');
    expect(r.totals.consistent).toBe(1);
  });

  it('declared level expecting absent signals → declared-above-evidence, naming the missing signals', () => {
    const s = fullSignals();
    s.artifacts = []; // the peer has published nothing → signed-artifacts not live
    const r = buildTrustReport({ nowIso: NOW, signals: s, failures: {} });
    const p = r.partners[0];
    expect(p.assessment).toBe('declared-above-evidence');
    expect(p.divergenceDetail).toContain('signed-artifacts');
    expect(p.divergenceDetail).toContain('declared remains authoritative');
    expect(p.declaredLevel).toBe('verified'); // NEVER changed
  });

  it('recorded evidence satisfying a higher level than declared → evidence-above-declared', () => {
    const s = fullSignals();
    s.peers![0].trustLevel = 'basic';
    s.trusts![0].trustLevel = 'basic';
    // Evidence present: invitation + attestation + signatures → satisfies 'verified'.
    const r = buildTrustReport({ nowIso: NOW, signals: s, failures: {} });
    const p = r.partners[0];
    expect(p.assessment).toBe('evidence-above-declared');
    expect(p.divergenceDetail).toContain("'verified'");
    expect(p.declaredLevel).toBe('basic');
  });

  it('unreadable sources → unknown, never guessed', () => {
    const s = fullSignals();
    s.invitations = null; // an expected signal's source unreadable
    const r = buildTrustReport({ nowIso: NOW, signals: s, failures: { 'fed-invitations': 'store read failed' } });
    expect(r.partners[0].assessment).toBe('unknown');
    expect(r.partners[0].divergenceDetail).toContain('never guessed');
    expect(r.unavailable).toContainEqual({ system: 'fed-invitations', reason: 'store read failed' });
  });

  it('declared none with no evidence → consistent (nothing expected, nothing required)', () => {
    const s = fullSignals();
    s.peers![0].trustLevel = 'none';
    s.trusts = [];
    s.invitations = [];
    s.artifacts = [];
    s.audit = [];
    const r = buildTrustReport({ nowIso: NOW, signals: s, failures: {} });
    expect(r.partners[0].declaredDetail).toContain('no TrustRelationship record');
    expect(['consistent', 'evidence-above-declared']).toContain(r.partners[0].assessment);
  });
});

describe('evidenceSupportedLevel — the highest level whose expectations are all recorded', () => {
  it('grades from the live signal set; any unreadable signal → null (unknown)', () => {
    const r = buildTrustReport({ nowIso: NOW, signals: fullSignals(), failures: {} });
    expect(evidenceSupportedLevel(r.partners[0].signals)).toBe('verified');
    const unknowns = r.partners[0].signals.map((x) => ({ ...x, live: null }));
    expect(evidenceSupportedLevel(unknowns)).toBeNull();
  });

  it('assessTrust never returns a mutated declared level — only an assessment beside it', () => {
    const r = buildTrustReport({ nowIso: NOW, signals: fullSignals(), failures: {} });
    const a = assessTrust('basic', r.partners[0].signals);
    expect(['consistent', 'evidence-above-declared']).toContain(a.assessment);
  });
});

describe('the disclosure', () => {
  it('states that declared trust remains authoritative', () => {
    const r = buildTrustReport({ nowIso: NOW, signals: fullSignals(), failures: {} });
    expect(r.disclosure).toBe(TRUST_DISCLOSURE);
    expect(r.disclosure).toContain('declared trust level remains authoritative');
  });
});
