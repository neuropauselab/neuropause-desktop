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
import { AUDIT_CHAIN_ALGO, AuditChain, auditStep, type AuditChainSnapshot, type AuditVerifyResult } from '../../security/auditChain';

/** The cohort key for rows with no resolvable owner. A real cohort, with a real chain. */
const UNATTRIBUTED = '__unattributed__';
import { createLogger } from '../../logger';
import { readStoreFile } from '../../storage/storeEnvelope';
import { DEFAULT_APPROVAL_CHAINS, DEFAULT_COMPLIANCE_RULES } from './enterpriseGovernance';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../../tenancy/storeScope';

/**
 * P13C ROUND 10 — the structural scope declaration. See tenancy/storeScope.ts.
 *
 * This store's cap WAS the third install-wide one this program found (Round 6),
 * and the file still satisfied the gate through `new TenantOwnership(...)`,
 * which takes no retention argument. The finding was fixed; the question was
 * still never asked. That gap is what Round 10 closes.
 */
declareStoreScope({
  name: 'enterprise-governance',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  /** An automatic cap inside `record`. No user-facing surface deletes an audit row. */
  retentionAuthority: 'SYSTEM',
  retention:
    'ONE removal: the audit cap (default 2000), applied PER TENANT COHORT by `pruneOwn(tenantId)` ' +
    "— `cohort()` selects the rows whose `tenantId` matches (unattributed rows form their own " +
    'cohort under `__unattributed__`), drops that cohort\'s oldest in append order, and folds each ' +
    'dropped row into THAT COHORT\'S OWN hash chain via `chainFor(tenantId).dropOldest`, which is ' +
    'what keeps the retained tail verifiable. It was ' +
    '`while (this.audit.length > this.auditCap) this.audit.shift()` over one shared array and one ' +
    "shared chain, so a tenant writing 2000 entries deleted every other tenant's compliance " +
    'evidence — gone rather than hidden, because `dropOldest` also removed it from the chain ' +
    '(Round 6). Nothing else removes: chains and rules are only ever `set` (enable/disable after a ' +
    'scoped `myChain`/`myRule` resolve), and `visibleAudit` filters the OUTPUT and never the ' +
    'order-sensitive array.',
  reason:
    'Every audit row carries the record id AND the title of the mutation it describes, so the ' +
    "trail is a complete index of one tenant's records; approval chains and compliance rules are " +
    'the controls gating that tenant\'s invoices, and `setChainEnabled` on a bare id was a ' +
    'cross-tenant CONTROL mutation (Round 5).',
});

const log = createLogger('enterprise-governance');
const DEFAULT_AUDIT_CAP = 2000;

/**
 * Deterministic serialization of an audit entry (fixed key order) for hashing.
 *
 * P13C ROUND 6 — `tenantId` is appended ONLY WHEN PRESENT.
 *
 * Adding a key unconditionally — even as `tenantId: undefined`, even at the end
 * — changes the canonical string of every historical row, and the chain would
 * report the entire pre-upgrade trail as tampered on first launch. An integrity
 * mechanism that cries forgery after a routine upgrade gets switched off, and
 * then the real thing goes unnoticed.
 *
 * So: old rows hash exactly as before; new rows extend the string. Both verify.
 */
function canonicalAudit(e: EnterpriseAuditEntry): string {
  const base = {
    action: e.action,
    actor: e.actor,
    at: e.at,
    id: e.id,
    summary: e.summary,
    target: e.target,
    workspaceId: e.workspaceId,
  };
  return e.tenantId === undefined
    ? JSON.stringify(base)
    : JSON.stringify({ ...base, tenantId: e.tenantId });
}

interface GovFile {
  approvalChains: ApprovalChain[];
  complianceRules: ComplianceRule[];
  audit: EnterpriseAuditEntry[];
  /**
   * P13C ROUND 6 — ONE CHAIN PER TENANT, keyed by tenant id.
   *
   * A hash chain is order-linear: `dropOldest` folds an entry into the base and
   * `verify` recomputes forward, which is only sound when entries leave from the
   * FRONT in append order. Per-tenant retention removes from the middle of a
   * shared array, so a single chain and per-tenant caps are mutually exclusive —
   * and the single chain is why the cap was install-wide in the first place.
   *
   * Each tenant's rows are their own append-ordered sequence, so evicting that
   * tenant's oldest IS a front removal within its own chain. Both properties hold
   * at once; neither is traded for the other.
   *
   * `integrity` (singular) is the pre-Round-6 format and is still read on load.
   */
  integrityByTenant?: Record<string, AuditChainSnapshot>;
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

  /**
   * How many organizations exist on this install. For LEGACY AUDIT ROWS ONLY.
   *
   * P13C ROUND 6 — audit rows written before `tenantId` existed have no owner
   * and the data contains no evidence of one. There are exactly two honest
   * things to do with them, and inventing an owner is not among them:
   *
   *   - ONE organization exists → there is no other tenant those rows COULD
   *     belong to. Showing them discloses nothing, and hiding them would empty
   *     the audit trail of every existing single-tenant install on upgrade.
   *   - TWO OR MORE exist → attribution is genuinely unknown. The rows are
   *     hidden from everyone and counted by `unattributedAudit()` so they are
   *     visibly withheld rather than silently gone.
   *
   * This is an OBSERVATION, not an attribution: "there is only one possible
   * owner" is a fact about the install, and it stops being true the moment a
   * second organization is created — at which point the rows disappear from the
   * trail on their own. That is the correct direction to fail.
   *
   * Unbound reports 0, which hides legacy rows. Fail closed.
   */
  bindOrganizationCount(source: () => number): this {
    this.organizationCount = source;
    return this;
  }
  private organizationCount: () => number = () => 0;
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
  /**
   * Tenant id → that tenant's chain. Unattributed rows share one cohort under
   * `UNATTRIBUTED`, which is a real cohort with a real chain — not a bucket that
   * skips verification.
   */
  private readonly auditChains = new Map<string, AuditChain<EnterpriseAuditEntry>>();

  private chainFor(tenantId: string | undefined): AuditChain<EnterpriseAuditEntry> {
    const key = tenantId ?? UNATTRIBUTED;
    const existing = this.auditChains.get(key);
    if (existing) return existing;
    // The namespace is part of the genesis hash, so one tenant's chain values can
    // never be replayed into another's.
    const fresh = new AuditChain<EnterpriseAuditEntry>(canonicalAudit, `enterprise-governance:${key}`);
    this.auditChains.set(key, fresh);
    return fresh;
  }

  /** One tenant's rows, in append order. The unit both retention and the chain use. */
  private cohort(tenantId: string | undefined): EnterpriseAuditEntry[] {
    return this.audit.filter((e) => (e.tenantId ?? UNATTRIBUTED) === (tenantId ?? UNATTRIBUTED));
  }

  constructor(
    private readonly filePath: string,
    opts: { auditCap?: number } = {},
  ) {
    super();
    this.auditCap = Math.max(1, opts.auditCap ?? DEFAULT_AUDIT_CAP);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    /**
     * P13C ROUND 33 — QUARANTINE, NEVER RESEED OVER A CORRUPT FILE.
     *
     * The audit array in this file is the HASH-CHAINED, append-only record
     * whose entire purpose is non-repudiation — and the old
     * `catch { applySeed() }` deleted it on any parse failure and then
     * re-persisted the empty array over the original bytes, after which the
     * chain re-verified cleanly because it had been rebuilt from nothing. A
     * truncated file defeated the tamper-evidence no tampering could.
     * `readStoreFile` preserves the unreadable file beside itself
     * (`.quarantined-<ts>`) so the evidence survives for recovery.
     */
    const read = await readStoreFile<Partial<GovFile>>(this.filePath);
    if (read.state === 'loaded' && read.data !== null) {
      const data = read.data;
      for (const c of data.approvalChains ?? []) if (c?.id) this.approvalChains.set(c.id, c);
      for (const r of data.complianceRules ?? []) if (r?.id) this.complianceRules.set(r.id, r);
      this.audit = Array.isArray(data.audit) ? data.audit : [];
      this.restoreChains(data);
      if (!data.seeded || this.complianceRules.size === 0) this.applySeed();
    } else {
      if (read.state !== 'first-run') {
        log.error('Governance store unreadable — original preserved (audit trail intact on disk), starting from seed', {
          state: read.state,
          quarantinedTo: read.quarantinedTo,
        });
      }
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

  /**
   * Rebuild the per-tenant chains from whatever the file holds.
   *
   * THREE CASES, and the middle one is the migration:
   *
   *   per-tenant snapshots  → restore each and verify its own cohort.
   *   a SINGLE legacy chain → VERIFY IT FIRST over the whole array, report a
   *                           violation if it fails, and only then split into
   *                           per-tenant chains. Verifying before splitting is
   *                           the point: if rows were removed before the upgrade,
   *                           the upgrade is the last moment that is detectable,
   *                           and a migration that silently re-anchors the chain
   *                           launders exactly the tampering the chain exists to
   *                           catch.
   *   nothing               → an unchained legacy log; build chains in place.
   */
  private restoreChains(data: Partial<GovFile>): void {
    const perTenant = data.integrityByTenant;
    if (perTenant && typeof perTenant === 'object') {
      for (const [key, snap] of Object.entries(perTenant)) {
        const chain = this.chainFor(key === UNATTRIBUTED ? undefined : key);
        if (!chain.restore(snap)) continue;
        const report = chain.verify(this.cohort(key === UNATTRIBUTED ? undefined : key));
        if (!report.ok) {
          log.error('Enterprise governance audit integrity check FAILED on load', {
            tenant: key,
            head: report.head.slice(0, 16),
            recomputed: report.recomputed.slice(0, 16),
            retained: report.retained,
          });
          this.emit('integrity-violation', report);
        }
      }
      return;
    }

    if (this.audit.length === 0) return;

    const legacy = new AuditChain<EnterpriseAuditEntry>(canonicalAudit, 'enterprise-governance');
    if (legacy.restore(data.integrity)) {
      const report = legacy.verify(this.audit);
      if (!report.ok) {
        log.error('Enterprise governance audit integrity check FAILED on load (pre-split)', {
          head: report.head.slice(0, 16),
          recomputed: report.recomputed.slice(0, 16),
          retained: report.retained,
        });
        this.emit('integrity-violation', report);
      }
    }
    // Split into per-tenant chains. Also the unchained-legacy path.
    for (const key of new Set(this.audit.map((e) => e.tenantId ?? UNATTRIBUTED))) {
      this.chainFor(key === UNATTRIBUTED ? undefined : key).rebuild(
        this.cohort(key === UNATTRIBUTED ? undefined : key),
      );
    }
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const file: GovFile = {
      approvalChains: [...this.approvalChains.values()],
      complianceRules: [...this.complianceRules.values()],
      audit: this.audit,
      integrityByTenant: Object.fromEntries([...this.auditChains].map(([k, c]) => [k, c.snapshot()])),
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
      // Re-mark dirty: the flag was cleared before the failed write, so
      // without this the pending change would never retry (P13C round 33).
      this.dirty = true;
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
    const soleOrg = this.organizationCount() === 1;
    return this.audit.filter((e) => {
      /**
       * P13C ROUND 6 — THE ORGANIZATION DECIDES, NOT THE WORKSPACE.
       *
       * Round 5 filtered on `workspaceId` alone and I recorded that as scoped.
       * It was not. The stamp comes from `activeWorkspaceIdForDisplay()` — one
       * install-wide variable that never consults the principal — and its
       * unswitched value is the SHARED CONSTANT `workspace-default`. So two
       * tenants that had each never created a workspace wrote into one
       * partition and read each other's rows, and the filter that looked like a
       * boundary compared a constant to itself.
       *
       * Attributed rows now match on tenant. The workspace comparison is KEPT on
       * top of it, so nothing that was visible within a tenant becomes visible
       * across its workspaces — this narrows, it never widens.
       */
      if (e.tenantId !== undefined) {
        return e.tenantId === effective.tenantId && e.workspaceId === effective.workspaceId;
      }
      // Legacy, unattributed. See `bindOrganizationCount`.
      return soleOrg && e.workspaceId === effective.workspaceId;
    });
  }

  /**
   * Drop the OLDEST rows belonging to ONE tenant, once that tenant is over cap.
   *
   * P13C ROUND 6 — THE RETENTION CAP WAS INSTALL-WIDE.
   *
   * `while (this.audit.length > this.auditCap) this.audit.shift()` walked one
   * shared array oldest-first, so a tenant writing 2000 entries DELETED every
   * other tenant's audit history — and deleted it from the hash chain via
   * `dropOldest`, so it is gone rather than hidden. The rows destroyed are the
   * compliance evidence `verifyAuditIntegrity()` exists to protect.
   *
   * This is the third time this program has found an install-wide cap behind a
   * fixed read filter (`executionStore.save`, then `replaceAll`, then this).
   * A RETENTION CAP IS A WRITE, and it deletes what the filter merely hides.
   * `TenantOwnership.pruneOwn` and `TenantDedupe.prune` both already say so.
   *
   * The cap is now PER TENANT, so total storage scales with tenant count — the
   * deliberate trade, and the same one the two primitives make: a busy tenant
   * rotates its own history sooner and nobody else's.
   *
   * Unattributed rows (`tenantId === undefined`) prune as their own cohort. They
   * cannot be attributed, so they must not be evicted by, or evict, anyone.
   */
  private pruneOwn(tenantId: string | undefined): void {
    const own = this.cohort(tenantId);
    if (own.length <= this.auditCap) return;
    let toDrop = own.length - this.auditCap;
    // Oldest-first within the cohort. `this.audit` is append-ordered, and the
    // chain is order-sensitive, so entries are removed by identity — never by
    // rebuilding or re-sorting the array.
    const doomed = new Set<EnterpriseAuditEntry>();
    for (const e of own) {
      if (toDrop === 0) break;
      doomed.add(e);
      toDrop -= 1;
    }
    // Front removal WITHIN this tenant's own chain, which is what makes the
    // retained tail still verify.
    const chain = this.chainFor(tenantId);
    for (const e of doomed) chain.dropOldest(e);
    this.audit = this.audit.filter((e) => !doomed.has(e));
  }

  /**
   * Legacy audit rows withheld because their owner is unknown. Counts only.
   *
   * Exists so the withholding is VISIBLE. Round 5's F6 quarantine shipped as a
   * number with no way to act on it and was worse than the defect it fixed; the
   * difference here is that these rows are observational, cannot be claimed
   * without inventing provenance, and re-appear on their own if the install
   * returns to a single organization.
   */
  unattributedAudit(): number {
    return this.audit.reduce((n, e) => (e.tenantId === undefined ? n + 1 : n), 0);
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

  /**
   * Total entries ever appended to the CHAIN, across every tenant. Integrity
   * bookkeeping — NOT a tenant-readable figure.
   *
   * P13C ROUND 6 — classified rather than scoped. It cannot be scoped: the number
   * lives in the hash chain, which is one chain over one ordered array by
   * construction, and per-tenant totals would require a second counter that could
   * disagree with it. It has no production caller (tests only) and no IPC channel.
   *
   * If one is ever added, this must not be what it returns — `auditCount(scope)`
   * is the tenant-facing count. Written here because the next person to need "how
   * many audit entries are there" will find this method first.
   */
  totalAudit(): number {
    let n = 0;
    for (const c of this.auditChains.values()) n += c.totalAppended;
    return n;
  }

  /** Recompute the audit hash-chain; `ok:false` means an entry was altered or removed. */
  /**
   * Recompute EVERY tenant's chain. `ok:false` means at least one cohort was
   * altered or had rows removed.
   *
   * The aggregate hides which tenant failed on purpose — this is reachable on a
   * read capability, and "tenant X's audit trail was tampered with" is itself
   * information about tenant X. The failing cohort is named in the LOG, which is
   * where an operator looks.
   */
  verifyAuditIntegrity(): AuditVerifyResult {
    let ok = true;
    let retained = 0;
    let dropped = 0;
    let totalAppended = 0;
    let head = '';
    let recomputed = '';
    for (const [key, chain] of this.auditChains) {
      const r = chain.verify(this.cohort(key === UNATTRIBUTED ? undefined : key));
      ok = ok && r.ok;
      retained += r.retained;
      dropped += r.dropped;
      totalAppended += r.totalAppended;
      // Fold the per-cohort results so the reported pair still differs iff !ok.
      head = auditStep(head, r.head);
      recomputed = auditStep(recomputed, r.recomputed);
    }
    return { ok, algo: AUDIT_CHAIN_ALGO, head, recomputed, retained, dropped, totalAppended };
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

  /**
   * Append one audit row.
   *
   * P13C ROUND 6 — the OWNER IS RESOLVED HERE, not accepted from the caller.
   *
   * Every one of the seven call sites passes `workspaceId:
   * workspaceStore.activeWorkspaceIdForDisplay()` — the window's workspace,
   * which under a background fan-out belongs to whoever was last on screen. A
   * caller-supplied owner is not an owner; it is a suggestion. The tenant is
   * therefore taken from the same resolver every read uses, so a row is
   * readable by exactly the tenant the writer was acting as.
   *
   * An unresolved writer produces an UNATTRIBUTED row rather than a row owned by
   * the wrong tenant. It is then subject to the legacy rule above — withheld on
   * a multi-organization install. Losing a row from a view is recoverable;
   * filing it under the wrong customer is not.
   */
  record(entry: Omit<EnterpriseAuditEntry, 'id' | 'at'>, now = new Date().toISOString()): EnterpriseAuditEntry {
    const owner = this.tenancy.scopeOrDeny();
    const full: EnterpriseAuditEntry = {
      id: `ea_${randomUUID()}`,
      at: now,
      ...entry,
      // Never the caller's. `entry` is `Omit<…,'id'|'at'>`, which still carries
      // the optional `tenantId`, so the spread above could smuggle one in when
      // the resolver returns null. Cleared explicitly rather than relied upon:
      // "no call site does this today" is a fact about today.
      tenantId: undefined,
      // BOTH halves come from the resolver when it resolves. The caller's
      // `workspaceId` is exactly as untrustworthy as a caller-supplied tenant
      // would be — it is `activeWorkspaceIdForDisplay()`, the window's workspace
      // — and a row stamped with one authority and read under another is
      // invisible to its own writer. One authority, both fields.
      ...(owner ? { tenantId: owner.tenantId, workspaceId: owner.workspaceId } : {}),
    };
    this.chainFor(full.tenantId).append(full);
    this.audit.push(full);
    this.pruneOwn(full.tenantId);
    this.schedulePersist();
    this.emit('changed');
    return full;
  }
}
