/**
 * The Enterprise Governance store: persists the editable governance config
 * (approval chains + compliance rules) and the organization-wide audit trail.
 * Roles live in the Organization Runtime; policies live with the workforce — the
 * composition root assembles them into one GovernanceConfig view.
 *
 * The audit trail is tamper-evident: entries are hash-chained via the shared
 * `AuditChain` primitive (SHA-256), so any mutation, deletion, or reordering of a
 * retained entry is detectable via `verifyAuditIntegrity()`. Retention is bounded
 * (`auditCap`, default 2000) with an explicit, checkpointed rolling drop — not the
 * silent trim it used to be.
 *
 * Seeded on first run from the engine defaults. Electron-free; the singleton
 * lives in governanceInstance.ts.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ApprovalChain, ComplianceRule, EnterpriseAuditEntry } from '@neuropause/shared';
import { AuditChain, type AuditChainSnapshot, type AuditVerifyResult } from '../../security/auditChain';
import { createLogger } from '../../logger';
import { DEFAULT_APPROVAL_CHAINS, DEFAULT_COMPLIANCE_RULES } from './enterpriseGovernance';

const log = createLogger('enterprise-governance');
const DEFAULT_AUDIT_CAP = 2000;

/** Deterministic serialization of an audit entry (fixed key order) for hashing. */
function canonicalAudit(e: EnterpriseAuditEntry): string {
  return JSON.stringify({
    action: e.action,
    actor: e.actor,
    at: e.at,
    id: e.id,
    summary: e.summary,
    target: e.target,
    workspaceId: e.workspaceId,
  });
}

interface GovFile {
  approvalChains: ApprovalChain[];
  complianceRules: ComplianceRule[];
  audit: EnterpriseAuditEntry[];
  integrity?: AuditChainSnapshot;
  seeded: boolean;
}

export class GovernanceStore extends EventEmitter {
  private approvalChains = new Map<string, ApprovalChain>();
  private complianceRules = new Map<string, ComplianceRule>();
  private audit: EnterpriseAuditEntry[] = [];
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;
  private readonly auditCap: number;
  private readonly auditChain = new AuditChain<EnterpriseAuditEntry>(canonicalAudit, 'enterprise-governance');

  constructor(
    private readonly filePath: string,
    opts: { auditCap?: number } = {},
  ) {
    super();
    this.auditCap = Math.max(1, opts.auditCap ?? DEFAULT_AUDIT_CAP);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<GovFile>;
      for (const c of data.approvalChains ?? []) if (c?.id) this.approvalChains.set(c.id, c);
      for (const r of data.complianceRules ?? []) if (r?.id) this.complianceRules.set(r.id, r);
      this.audit = Array.isArray(data.audit) ? data.audit : [];
      if (this.auditChain.restore(data.integrity)) {
        const report = this.auditChain.verify(this.audit);
        if (!report.ok) {
          log.error('Enterprise governance audit integrity check FAILED on load', {
            head: report.head.slice(0, 16),
            recomputed: report.recomputed.slice(0, 16),
            retained: report.retained,
          });
          this.emit('integrity-violation', report);
        }
      } else if (this.audit.length > 0) {
        this.auditChain.rebuild(this.audit); // legacy (unchained) file — upgrade in place
        this.schedulePersist();
      }
      if (!data.seeded || this.complianceRules.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Enterprise governance ready', {
      chains: this.approvalChains.size,
      rules: this.complianceRules.size,
      audit: this.audit.length,
    });
  }

  private applySeed(): void {
    for (const c of DEFAULT_APPROVAL_CHAINS) if (!this.approvalChains.has(c.id)) this.approvalChains.set(c.id, c);
    for (const r of DEFAULT_COMPLIANCE_RULES) if (!this.complianceRules.has(r.id)) this.complianceRules.set(r.id, r);
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const file: GovFile = {
      approvalChains: [...this.approvalChains.values()],
      complianceRules: [...this.complianceRules.values()],
      audit: this.audit,
      integrity: this.auditChain.snapshot(),
      seeded: true,
    };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drainPersist();
  }

  private async drainPersist(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Governance persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  chains(): ApprovalChain[] {
    return [...this.approvalChains.values()];
  }

  rules(): ComplianceRule[] {
    return [...this.complianceRules.values()];
  }

  auditEntries(limit = 100): EnterpriseAuditEntry[] {
    return this.audit.slice(-limit).reverse();
  }

  auditCount(): number {
    return this.audit.length;
  }

  /** Total audit entries ever recorded, including those rotated out of retention. */
  totalAudit(): number {
    return this.auditChain.totalAppended;
  }

  /** Recompute the audit hash-chain; `ok:false` means an entry was altered or removed. */
  verifyAuditIntegrity(): AuditVerifyResult {
    return this.auditChain.verify(this.audit);
  }

  setChainEnabled(id: string, enabled: boolean): ApprovalChain | null {
    const c = this.approvalChains.get(id);
    if (!c) return null;
    const next: ApprovalChain = { ...c, enabled, updatedAt: new Date().toISOString() };
    this.approvalChains.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  setRuleEnabled(id: string, enabled: boolean): ComplianceRule | null {
    const r = this.complianceRules.get(id);
    if (!r) return null;
    const next: ComplianceRule = { ...r, enabled, updatedAt: new Date().toISOString() };
    this.complianceRules.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  record(entry: Omit<EnterpriseAuditEntry, 'id' | 'at'>, now = new Date().toISOString()): EnterpriseAuditEntry {
    const full: EnterpriseAuditEntry = { id: `ea_${randomUUID()}`, at: now, ...entry };
    this.auditChain.append(full);
    this.audit.push(full);
    while (this.audit.length > this.auditCap) {
      this.auditChain.dropOldest(this.audit[0]);
      this.audit.shift();
    }
    this.schedulePersist();
    this.emit('changed');
    return full;
  }
}
