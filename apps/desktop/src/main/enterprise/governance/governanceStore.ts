/**
 * The Enterprise Governance store: persists the editable governance config
 * (approval chains + compliance rules) and the organization-wide audit trail.
 * Roles live in the Organization Runtime; policies live with the workforce — the
 * composition root assembles them into one GovernanceConfig view.
 *
 * Seeded on first run from the engine defaults. Electron-free; the singleton
 * lives in governanceInstance.ts.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ApprovalChain, ComplianceRule, EnterpriseAuditEntry } from '@neuropause/shared';
import { createLogger } from '../../logger';
import { DEFAULT_APPROVAL_CHAINS, DEFAULT_COMPLIANCE_RULES } from './enterpriseGovernance';

const log = createLogger('enterprise-governance');
const AUDIT_CAP = 2000;

interface GovFile {
  approvalChains: ApprovalChain[];
  complianceRules: ComplianceRule[];
  audit: EnterpriseAuditEntry[];
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

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<GovFile>;
      for (const c of data.approvalChains ?? []) if (c?.id) this.approvalChains.set(c.id, c);
      for (const r of data.complianceRules ?? []) if (r?.id) this.complianceRules.set(r.id, r);
      this.audit = Array.isArray(data.audit) ? data.audit : [];
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
    this.audit.push(full);
    if (this.audit.length > AUDIT_CAP) this.audit = this.audit.slice(this.audit.length - AUDIT_CAP);
    this.schedulePersist();
    this.emit('changed');
    return full;
  }
}
