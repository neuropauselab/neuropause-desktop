/**
 * Operational Security (NCEA 15.0, Phase 9). Integrates with the Phase 14 security
 * layer rather than duplicating it: it subscribes to the security threat stream
 * (`SecurityService.onThreat`), and adds the operational controls that layer does
 * not own — runtime integrity checks (component hashing), configuration validation,
 * secret-rotation-age monitoring, certificate-expiry monitoring, threat-signal
 * aggregation, security-incident hooks, an operational policy set, and operational
 * audit onto the ONE chain. Real hashing is VERIFIED; wiring to live secret/cert
 * stores (Vault/ACM) is INFRA-PENDING.
 */
import { sha256Hex, systemClock, type Clock } from '@neuropause/cloud-core';
import { recordOp, type AuditSink } from './opsAudit';

export type ThreatSeverity = 'low' | 'medium' | 'high' | 'critical';
export interface ThreatSignal {
  kind: string;
  severity: ThreatSeverity;
  detail: string;
  at: number;
}

/** Structural subset of the Phase-14 SecurityService threat hook. */
export interface ThreatSource {
  onThreat(hook: (signal: { kind: string; severity: 'low' | 'medium' | 'high'; detail: string; at: number }) => void): void;
}

export interface SecretRotationEntry {
  name: string;
  lastRotatedAt: number;
  maxAgeMs: number;
}
export interface CertificateEntry {
  name: string;
  notAfter: number;
}
export interface ConfigRule {
  key: string;
  required?: boolean;
  validate?: (value: unknown) => boolean;
  message?: string;
}
export interface OperationalPolicy {
  id: string;
  description: string;
  check: (ctx: Record<string, unknown>) => boolean;
}

export interface OpsSecurityOptions {
  audit?: AuditSink;
  metrics?: { inc(name: string, by?: number): void };
  /** The Phase-14 security service — its threat stream is aggregated here. */
  security?: ThreatSource;
  /** Severity at or above which a threat raises a security incident. Default 'high'. */
  incidentThreshold?: ThreatSeverity;
}

const SEVERITY_ORDER: Record<ThreatSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export class OperationalSecurity {
  private readonly integrityBaseline = new Map<string, string>();
  private readonly secrets = new Map<string, SecretRotationEntry>();
  private readonly certs = new Map<string, CertificateEntry>();
  private readonly threats: ThreatSignal[] = [];
  private readonly incidentHooks: Array<(s: ThreatSignal) => void> = [];
  private readonly policies = new Map<string, OperationalPolicy>();
  private readonly incidentThreshold: number;

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly options: OpsSecurityOptions = {},
  ) {
    this.incidentThreshold = SEVERITY_ORDER[options.incidentThreshold ?? 'high'];
    options.security?.onThreat((s) => this.ingestThreat({ kind: s.kind, severity: s.severity, detail: s.detail, at: s.at }));
  }

  // ── runtime integrity ──
  setIntegrityBaseline(components: Array<{ name: string; content: string }>): void {
    for (const c of components) this.integrityBaseline.set(c.name, sha256Hex(c.content));
  }
  checkIntegrity(components: Array<{ name: string; content: string }>): { ok: boolean; mismatches: string[]; unknown: string[] } {
    const mismatches: string[] = [];
    const unknown: string[] = [];
    for (const c of components) {
      const expected = this.integrityBaseline.get(c.name);
      if (expected === undefined) unknown.push(c.name);
      else if (expected !== sha256Hex(c.content)) mismatches.push(c.name);
    }
    const ok = mismatches.length === 0;
    if (!ok) recordOp(this.options.audit, this.clock, { action: 'op.security.integrity.fail', target: 'runtime', payload: { mismatches } });
    return { ok, mismatches, unknown };
  }

  // ── configuration validation ──
  validateConfig(config: Record<string, unknown>, rules: ConfigRule[]): { valid: boolean; violations: Array<{ key: string; message: string }> } {
    const violations: Array<{ key: string; message: string }> = [];
    for (const rule of rules) {
      const present = Object.prototype.hasOwnProperty.call(config, rule.key) && config[rule.key] !== undefined && config[rule.key] !== '';
      if (rule.required && !present) {
        violations.push({ key: rule.key, message: rule.message ?? `missing required config '${rule.key}'` });
        continue;
      }
      if (present && rule.validate && !rule.validate(config[rule.key])) {
        violations.push({ key: rule.key, message: rule.message ?? `invalid config '${rule.key}'` });
      }
    }
    return { valid: violations.length === 0, violations };
  }

  // ── secret rotation monitoring ──
  trackSecret(entry: SecretRotationEntry): void {
    this.secrets.set(entry.name, entry);
  }
  secretsDueForRotation(now = this.clock.now()): SecretRotationEntry[] {
    return [...this.secrets.values()].filter((s) => now - s.lastRotatedAt >= s.maxAgeMs);
  }

  // ── certificate expiration monitoring ──
  trackCertificate(entry: CertificateEntry): void {
    this.certs.set(entry.name, entry);
  }
  certificatesExpiringWithin(windowMs: number, now = this.clock.now()): CertificateEntry[] {
    return [...this.certs.values()].filter((c) => c.notAfter - now <= windowMs);
  }
  certificatesExpired(now = this.clock.now()): CertificateEntry[] {
    return [...this.certs.values()].filter((c) => c.notAfter <= now);
  }

  // ── threat aggregation + security incident hooks ──
  ingestThreat(signal: ThreatSignal): void {
    this.threats.push(signal);
    this.options.metrics?.inc(`ops.security.threat.${signal.severity}`);
    if (SEVERITY_ORDER[signal.severity] >= this.incidentThreshold) {
      recordOp(this.options.audit, this.clock, { action: 'op.security.incident', target: signal.kind, payload: { severity: signal.severity, detail: signal.detail } });
      for (const hook of this.incidentHooks) hook(signal);
    }
  }
  onSecurityIncident(hook: (s: ThreatSignal) => void): void {
    this.incidentHooks.push(hook);
  }
  threatSummary(): { total: number; bySeverity: Record<ThreatSeverity, number> } {
    const bySeverity: Record<ThreatSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const t of this.threats) bySeverity[t.severity] += 1;
    return { total: this.threats.length, bySeverity };
  }

  // ── operational policies ──
  definePolicy(policy: OperationalPolicy): void {
    this.policies.set(policy.id, policy);
  }
  evaluatePolicies(ctx: Record<string, unknown>): Array<{ id: string; ok: boolean; description: string }> {
    return [...this.policies.values()].map((p) => ({ id: p.id, ok: p.check(ctx), description: p.description }));
  }
}
