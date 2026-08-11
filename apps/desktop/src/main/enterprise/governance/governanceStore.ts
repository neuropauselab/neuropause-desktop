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
import type { ApprovalChain, ComplianceRule, EnterpriseAuditEntry, TenantScope } from '@neuropause/shared';
import { AuditChain, type AuditChainSnapshot, type AuditVerifyResult } from '../../security/auditChain';
import { createLogger } from '../../logger';
import { DEFAULT_APPROVAL_CHAINS, DEFAULT_COMPLIANCE_RULES } from './enterpriseGovernance';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';

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
  /**
   * P13C ROUND 5 — the tenant boundary. THIS STORE IS THREE COLLECTIONS WITH
   * THREE DIFFERENT ANSWERS, and treating it as one is how the gap survived.
   *
   * AUDIT already had the right shape — `workspaceId` is required on the type,
   * hash-chained into `canonicalAudit`, and `auditEntries`/`auditCount` take a
   * scope and filter the OUTPUT without touching the order-sensitive array. The
   * defect was the DEFAULT: the parameter is optional and `undefined` meant
   * EVERY WORKSPACE. Two callers omitted it, so an install-wide count of a trail
   * whose every row names a tenant's record ids and titles surfaced through
   * `commercial:read` — a permission with nothing to do with governance.
   *
   * CHAINS AND RULES were worse and were not covered by the inventory's existing
   * note. Both carry an `orgId`, it is seeded from the literal `ORG_ID`, and no
   * read ever filtered on it — the shape where an auditor asking "do these rows
   * have an owner?" gets yes and the value is a constant. `setChainEnabled(id)`
   * and `setRuleEnabled(id)` then took a BARE payload id, so a
   * `governance:manage` holder in one tenant could disable the approval chain
   * gating another tenant's invoices. That is a cross-tenant control mutation,
   * not a disclosure.
   */
  private readonly tenancy = new TenantOwnership('enterprise-governance');

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  /** Unscoped ownership counts over chains + rules, for the migration inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.tenancy.countOwnership([
      ...this.chainList().map((c) => ({ tenantId: c.orgId })),
      ...this.ruleList().map((r) => ({ tenantId: r.orgId })),
    ]);
  }

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
    /**
     * P13C ROUND 5, SECOND PASS — SEED FOR THE CALLER, NOT FOR THE CONSTANT.
     *
     * `DEFAULT_APPROVAL_CHAINS` and `DEFAULT_COMPLIANCE_RULES` stamp the literal
     * `ORG_ID`, so once `chains()`/`rules()` began filtering on `orgId` every
     * organization except the seeded one had ZERO approval chains and ZERO
     * compliance rules. That is a fail-open twice over: the autonomous-ops
     * governance veto reads an empty chain list as "ungoverned", and the
     * compliance score computes `passed/evaluated` with `evaluated === 0` as a
     * perfect 100%.
     *
     * The sweep caught it because the test I wrote asserted `chains() === []`
     * for a non-seeded organization and I read that as isolation working. It was
     * the breakage.
     *
     * Defaults are now materialised per organization on first read, so a second
     * tenant gets the same starting governance the first one did.
     */
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

  /** Every chain, ignoring scope. Internal only — for ownership counts. */
  private chainList(): ApprovalChain[] {
    return [...this.approvalChains.values()];
  }
  private ruleList(): ComplianceRule[] {
    return [...this.complianceRules.values()];
  }

  /**
   * The CALLER'S approval chains. Was every organization's.
   *
   * `ApprovalChain.orgId` existed all along and nothing read it. Six subsystems
   * consume this list and re-expose derived values — chain names, `appliesTo`
   * and step role ids — so the leak was not confined to the governance screen.
   */
  chains(): ApprovalChain[] {
    this.ensureDefaultsForCaller();
    return this.mine(this.chainList());
  }

  /** The CALLER'S compliance rules. Drives `evaluateCompliance`. */
  rules(): ComplianceRule[] {
    this.ensureDefaultsForCaller();
    return this.mine(this.ruleList());
  }

  /**
   * Materialise the default chains and rules for the CALLER, once.
   *
   * Lazily rather than at seed time, because a second organization may be
   * created long after the file was written — and a tenant that has never
   * opened governance should still be governed by the defaults the product
   * promises.
   */
  private ensureDefaultsForCaller(): void {
    const orgId = this.tenancy.scopeOrDeny()?.tenantId ?? null;
    if (orgId === null || orgId === '') return;
    if (this.chainList().some((c) => c.orgId === orgId)) return;
    for (const chain of DEFAULT_APPROVAL_CHAINS) {
      const id = `${chain.id}:${orgId}`;
      if (!this.approvalChains.has(id)) this.approvalChains.set(id, { ...chain, id, orgId });
    }
    for (const rule of DEFAULT_COMPLIANCE_RULES) {
      const id = `${rule.id}:${orgId}`;
      if (!this.complianceRules.has(id)) this.complianceRules.set(id, { ...rule, id, orgId });
    }
    this.schedulePersist();
  }

  /**
   * Filter on the `orgId` the records already carry.
   *
   * Not `TenantOwnership.onlyMine`, which reads `tenantId`: these two types
   * predate that convention and their owner field is `orgId`. Filtering on the
   * field that exists beats adding a second owner that could disagree with it.
   */
  private mine<T extends { orgId: string }>(rows: readonly T[]): T[] {
    const scope = this.tenancy.scopeOrDeny();
    if (scope === null || !scope.tenantId) return [];
    return rows.filter((r) => r.orgId === scope.tenantId);
  }

  /** One of the caller's chains by id, or null. */
  private myChain(id: string): ApprovalChain | null {
    const c = this.approvalChains.get(id) ?? null;
    return c !== null && this.mine([c]).length === 1 ? c : null;
  }
  private myRule(id: string): ComplianceRule | null {
    const r = this.complianceRules.get(id) ?? null;
    return r !== null && this.mine([r]).length === 1 ? r : null;
  }

  /**
   * Audit entries the caller may read, newest first.
   *
   * P12 — SCOPED. `record()` has stamped and hash-chained a `workspaceId` since
   * P11, and this read ignored it: anyone with `governance:read` saw every
   * workspace's trail. That is not a minor leak — every module mutation writes
   * the record id AND the title into the target and summary, so the audit trail
   * was a complete index of every tenant's record ids and names, and one of
   * those ids then fed the document-lines channel.
   *
   * Filters the OUTPUT and never the array. `this.audit` is order-sensitive
   * because the tamper-evident chain hashes each entry against its predecessor —
   * filtering in place would break verification for everybody.
   *
   * A `null` scope returns nothing. Entries written before P11 have no
   * workspaceId and are visible to nobody, consistent with every other store.
   */
  auditEntries(limit = 100, scope?: TenantScope | null): EnterpriseAuditEntry[] {
    return this.visibleAudit(scope).slice(-limit).reverse();
  }

  /**
   * P13C ROUND 5 — OMITTING THE SCOPE NO LONGER MEANS "EVERY WORKSPACE".
   *
   * The parameter was optional with three meanings: a scope filtered, `null`
   * denied, and `undefined` returned EVERYTHING. Two callers omitted it —
   * `commercial/index.ts` and `autonomousOps/index.ts` — so an install-wide
   * count of a trail whose every row carries a tenant's record ids and titles
   * surfaced under `commercial:read`.
   *
   * `undefined` now falls back to the store's own bound scope, which is the same
   * resolver every other store reads. An omitted argument therefore narrows to
   * the caller instead of widening to the install — the "absent field widens"
   * bypass this program has removed from six other stores, in its last place.
   *
   * An explicit `null` still denies, because a caller that has resolved "no
   * tenant" is saying so deliberately.
   */
  private visibleAudit(scope?: TenantScope | null): EnterpriseAuditEntry[] {
    const effective = scope === undefined ? this.tenancy.scopeOrDeny() : scope;
    if (effective === null) return [];
    return this.audit.filter((e) => e.workspaceId === effective.workspaceId);
  }

  /**
   * How many entries the caller may read.
   *
   * Scoped for the same reason as the read: an install-wide count answers "how
   * busy is the other tenant" without returning an entry.
   */
  auditCount(scope?: TenantScope | null): number {
    return this.visibleAudit(scope).length;
  }

  /** Total audit entries ever recorded, including those rotated out of retention. */
  totalAudit(): number {
    return this.auditChain.totalAppended;
  }

  /** Recompute the audit hash-chain; `ok:false` means an entry was altered or removed. */
  verifyAuditIntegrity(): AuditVerifyResult {
    return this.auditChain.verify(this.audit);
  }

  /**
   * Enable or disable one of the CALLER'S approval chains.
   *
   * The sharpest write in this store: an approval chain is what gates a
   * tenant's documents, so disabling another organization's chain removes a
   * control they are relying on — reachable on `governance:manage` with a bare
   * payload id.
   */
  setChainEnabled(id: string, enabled: boolean): ApprovalChain | null {
    const c = this.myChain(id);
    if (!c) return null;
    const next: ApprovalChain = { ...c, enabled, updatedAt: new Date().toISOString() };
    this.approvalChains.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /** Enable or disable one of the CALLER'S compliance rules. Was a bare id. */
  setRuleEnabled(id: string, enabled: boolean): ComplianceRule | null {
    const r = this.myRule(id);
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
