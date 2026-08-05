/**
 * Enterprise Security primitives (NCEA 14.0, Phase 9). Reuses the cloud-core
 * `RequestSigner` (HMAC over a canonical request with a replay window) and adds
 * the pieces it lacks: nonce-based replay protection, CSRF tokens, secure-cookie
 * attributes, a Content-Security-Policy + security-header set, fixed-window rate
 * limiting, and threat-detection hooks. Signing/verification is real HMAC with a
 * timing-safe compare; nothing is simulated.
 */
import { RequestSigner, hmacHex, type Clock } from '@neuropause/cloud-core';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { SecurityAudit } from './audit';

export interface SignedRequest {
  signature: string;
  timestamp: number;
  nonce: string;
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'ok' | 'stale' | 'bad_signature' | 'replay';
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export type ThreatHook = (signal: { kind: string; severity: 'low' | 'medium' | 'high'; detail: string; at: number }) => void;

export class SecurityService {
  private readonly signer: RequestSigner;
  private readonly seenNonces = new Map<string, number>();
  private readonly csrf = new Map<string, string>();
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly threatHooks: ThreatHook[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly audit: SecurityAudit,
    private readonly secret: string,
  ) {
    this.signer = new RequestSigner(secret, clock);
  }

  /** Sign a request (HMAC + timestamp) and attach a single-use nonce. */
  signRequest(method: string, path: string, body: string): SignedRequest {
    const { signature, timestamp } = this.signer.sign(method, path, body);
    return { signature, timestamp, nonce: randomBytes(16).toString('hex') };
  }

  /** Verify signature + replay window + nonce uniqueness (anti-replay). */
  verifyRequest(method: string, path: string, body: string, sig: SignedRequest): VerifyResult {
    const result = this.signer.verify(method, path, body, sig.signature, sig.timestamp);
    if (!result.ok) return { ok: false, reason: result.error.code };
    if (this.seenNonces.has(sig.nonce)) return { ok: false, reason: 'replay' };
    this.seenNonces.set(sig.nonce, this.clock.now());
    return { ok: true, reason: 'ok' };
  }

  // ── CSRF ──
  issueCsrfToken(sessionId: string): string {
    const token = hmacHex(this.secret, `${sessionId}:${randomBytes(8).toString('hex')}`);
    this.csrf.set(sessionId, token);
    return token;
  }
  verifyCsrf(sessionId: string, token: string): boolean {
    const expected = this.csrf.get(sessionId);
    if (!expected) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ── headers / cookies ──
  securityHeaders(): Record<string, string> {
    return {
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
    };
  }
  secureCookieAttributes(): string {
    return 'HttpOnly; Secure; SameSite=Strict; Path=/';
  }

  // ── rate limiting (fixed window) ──
  rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = this.clock.now();
    let win = this.windows.get(key);
    if (!win || win.resetAt <= now) {
      win = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, win);
    }
    if (win.count >= limit) return { allowed: false, remaining: 0 };
    win.count += 1;
    return { allowed: true, remaining: limit - win.count };
  }

  // ── threat detection hooks / anomaly interface ──
  onThreat(hook: ThreatHook): void {
    this.threatHooks.push(hook);
  }
  async reportThreat(kind: string, severity: 'low' | 'medium' | 'high', detail: string): Promise<void> {
    const signal = { kind, severity, detail, at: this.clock.now() };
    for (const hook of this.threatHooks) hook(signal);
    await this.audit.record({ category: 'security', action: `threat.${severity}`, actor: 'system', target: kind, detail });
  }
}
