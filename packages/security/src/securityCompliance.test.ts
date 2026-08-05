import { describe, it, expect, beforeEach } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { createSecurityPlatform, type SecurityPlatform } from './platform';
import type { Framework } from './compliance';

describe('Security primitives — HMAC request signing, replay, CSRF, headers, rate limit (VERIFIED)', () => {
  let clock: ManualClock;
  let p: SecurityPlatform;
  beforeEach(() => {
    clock = new ManualClock(1_000_000);
    p = createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock });
  });

  it('verifies a well-formed signed request exactly once (nonce anti-replay)', () => {
    const s = p.security();
    const signed = s.signRequest('POST', '/api/orders', '{"qty":1}');
    expect(s.verifyRequest('POST', '/api/orders', '{"qty":1}', signed)).toEqual({ ok: true, reason: 'ok' });
    // same nonce again ⇒ replay rejected
    expect(s.verifyRequest('POST', '/api/orders', '{"qty":1}', signed).reason).toBe('replay');
  });

  it('rejects a tampered body (bad signature) and a stale timestamp', () => {
    const s = p.security();
    const signed = s.signRequest('POST', '/api/orders', '{"qty":1}');
    expect(s.verifyRequest('POST', '/api/orders', '{"qty":2}', signed).reason).toBe('bad_signature');
    const fresh = s.signRequest('GET', '/api/me', '');
    clock.advance(6 * 60 * 1000); // beyond the 5-minute replay window
    expect(s.verifyRequest('GET', '/api/me', '', fresh).reason).toBe('stale');
  });

  it('issues + verifies CSRF tokens scoped to a session', () => {
    const s = p.security();
    const token = s.issueCsrfToken('sess_1');
    expect(s.verifyCsrf('sess_1', token)).toBe(true);
    expect(s.verifyCsrf('sess_1', 'wrong-token')).toBe(false);
    expect(s.verifyCsrf('sess_2', token)).toBe(false);
  });

  it('emits strict security headers + secure cookie attributes', () => {
    const h = p.security().securityHeaders();
    expect(h['Content-Security-Policy']).toContain("default-src 'self'");
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(h['Strict-Transport-Security']).toContain('max-age=');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(p.security().secureCookieAttributes()).toContain('HttpOnly');
    expect(p.security().secureCookieAttributes()).toContain('SameSite=Strict');
  });

  it('rate limits with a fixed window that resets', () => {
    const s = p.security();
    expect(s.rateLimit('ip:1', 2, 1000)).toEqual({ allowed: true, remaining: 1 });
    expect(s.rateLimit('ip:1', 2, 1000).allowed).toBe(true);
    expect(s.rateLimit('ip:1', 2, 1000).allowed).toBe(false); // limit reached
    clock.advance(1001);
    expect(s.rateLimit('ip:1', 2, 1000).allowed).toBe(true); // window reset
  });

  it('fires threat hooks and audits the signal', async () => {
    const s = p.security();
    const seen: Array<{ kind: string; severity: string }> = [];
    s.onThreat((sig) => seen.push(sig));
    await s.reportThreat('brute-force', 'high', '20 failed logins in 60s');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe('brute-force');
    expect(seen[0]!.severity).toBe('high');
    const threatEvents = p.audit().events({ category: 'security' }).filter((e) => e.action.startsWith('threat.'));
    expect(threatEvents).toHaveLength(1);
  });
});

describe('Compliance — readiness only, NEVER a certification claim (anti-fabrication)', () => {
  it('reports readiness per framework with certified:false', () => {
    const clock = new ManualClock(0);
    const p = createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock });
    const frameworks: Framework[] = ['SOC2', 'ISO27001', 'GDPR', 'HIPAA', 'PCI-DSS'];
    for (const fw of frameworks) {
      const r = p.compliance().readiness(fw);
      expect(r.certified).toBe(false);
      expect(r.total).toBeGreaterThan(0);
      expect(r.implemented + r.architectureReady + r.partial).toBeLessThanOrEqual(r.total);
      expect(p.compliance().controls(fw).every((c) => c.framework === fw)).toBe(true);
    }
  });

  it('sets retention + legal hold and exports a verified audit evidence bundle', async () => {
    const clock = new ManualClock(0);
    const p = createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock });
    await p.compliance().setRetention('audit-log', 365);
    await p.compliance().setLegalHold('acme', true);
    expect(p.compliance().underLegalHold('acme')).toBe(true);
    await p.compliance().setLegalHold('acme', false);
    expect(p.compliance().underLegalHold('acme')).toBe(false);
    const exported = await p.compliance().auditExport('acme');
    expect(exported.verified).toBe(true);
    expect(Array.isArray(exported.events)).toBe(true);
  });
});
