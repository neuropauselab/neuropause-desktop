/**
 * The global governance store: federation-wide policies, compliance rules,
 * delegated approvals, and the **shared audit trail**. Recording a federated
 * action runs the governance engine, appends an immutable audit entry, and —
 * when a policy requires it — opens a delegated approval. Every federated action
 * is therefore traceable. Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  DelegatedApproval,
  FedActionEvaluation,
  FedAuditEntry,
  FedComplianceRule,
  FedPolicy,
  FedPolicyEffect,
  FedPolicyScope,
  GlobalGovSummary,
  TrustLevel,
} from '@neuropause/shared';
import { evaluateFederatedAction, buildFedCompliance, complianceScore, type ComplianceInput } from './globalGov';
import type { TenantScope } from '@neuropause/shared';
import { FederationBoundary, type FederationParties } from '../tenancy/federationBoundary';
import { createLogger } from '../../logger';
import { demoSeedsEnabled } from '../../demoSeed';

const log = createLogger('federation-governance');

interface GovFile {
  policies: FedPolicy[];
  approvals: DelegatedApproval[];
  audit: FedAuditEntry[];
  seeded: boolean;
}

/**
 * The two organizations each governance record names.
 *
 * A delegated approval is `fromOrg` → `toOrg`; an audit entry is
 * `actorOrg` ↔ `peerOrg`. Both were already relationship-shaped and neither was
 * used for authorization — the store filtered on nothing at all.
 */
function approvalParties(a: DelegatedApproval): FederationParties {
  return { owner: a.fromOrg, peer: a.toOrg };
}
function auditParties(e: FedAuditEntry): FederationParties {
  return { owner: e.actorOrg, peer: e.peerOrg };
}
function policyParties(p: FedPolicy): FederationParties {
  return { owner: p.ownerOrg ?? null, peer: null };
}

export class GlobalGovStore extends EventEmitter {
  /**
   * P13C ROUND 4 — S-10. The relationship boundary.
   *
   * This store had the same shape as `fedStore`: `homeOrgId` from the
   * CONSTRUCTOR, wired to the seeded `ORG_ID`. So every governance policy,
   * every delegated approval and every federated audit entry belonged to the
   * install, and `resolveApproval(id, approve)` took a bare payload id on a
   * channel gated by `federation:approve`.
   *
   * That last one is the sharpest: a delegated approval is the gate a federated
   * ACTION waits behind, so approving somebody else's was not a disclosure — it
   * was authorizing an action between two organizations that neither had agreed
   * to.
   */
  private readonly fed = new FederationBoundary('federation-governance');
  /**
   * Whether the caller actually has a federation relationship with an
   * organization it names. Injected, like the exchange's trust predicate, to
   * avoid a cycle with the runtime store.
   *
   * Defaults to DENY: an unwired governance store records nothing against
   * anybody rather than accepting whatever a payload names.
   */
  private relatedToCaller: (peerOrg: string) => boolean = () => false;
  /** The caller's display name for audit attribution. Falls back to the seed. */
  private actorName: () => string = () => this.homeOrgName;
  private policies = new Map<string, FedPolicy>();
  private approvals = new Map<string, DelegatedApproval>();
  private audit: FedAuditEntry[] = [];
  private homeOrgId = '';
  private homeOrgName = '';

  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  /** Bind the relationship boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.fed.bindScope(source);
    return this;
  }
  /** Wire the "do I federate with this organization?" predicate. */
  bindPeerResolver(resolver: (peerOrg: string) => boolean): this {
    this.relatedToCaller = resolver;
    return this;
  }
  /** Wire the CALLER'S display name, for audit attribution. */
  bindActorNameResolver(resolver: () => string): this {
    this.actorName = resolver;
    return this;
  }
  hasScope(): boolean {
    return this.fed.hasScope();
  }
  /** Unscoped ownership counts over approvals + policies, for the inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.fed.countOwnership([
      ...[...this.approvals.values()].map(approvalParties),
      ...[...this.policies.values()].map(policyParties),
    ]);
  }

  constructor(private readonly filePath: string, homeOrgId: string, homeOrgName: string) {
    super();
    this.homeOrgId = homeOrgId;
    this.homeOrgName = homeOrgName;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<GovFile>;
      /**
       * P13C ROUND 5 — F6. LEGACY POLICIES ARE QUARANTINED, NOT DROPPED.
       *
       * A row with no `ownerOrg` predates Round 4. It is marked
       * `migration_required` on load so that its absence from `listPolicies()`
       * is a STATE somebody can see rather than a silent disappearance.
       *
       * WHY NOT SIMPLY ATTRIBUTE THEM TO THE SEEDED ORGANIZATION.
       *
       * That was the tempting migration and it would have been a fabrication.
       * Before Round 4 `addPolicy` stamped no owner and the store's home was the
       * seeded org, so on a single-organization install the seed really is the
       * author — but ANY tenant could call `FedAddPolicy` and get an unowned
       * row. There is therefore no evidence in the data of who authored a given
       * legacy policy, and inventing one is the single thing a migration must
       * never do: the guess is silent, permanent, and indistinguishable from a
       * correct answer afterwards.
       *
       * So the honest outcome is MIGRATION_REQUIRED plus fail-closed
       * enforcement, and a human resolves it. See `recordAction` and
       * `claimPolicy`.
       */
      for (const p of data.policies ?? []) {
        if (!p?.id) continue;
        const needsMigration = typeof p.ownerOrg !== 'string' || p.ownerOrg === '';
        this.policies.set(p.id, needsMigration ? { ...p, migrationState: 'migration_required' } : p);
      }
      for (const a of data.approvals ?? []) if (a?.id) this.approvals.set(a.id, a);
      this.audit = data.audit ?? [];
      if (!data.seeded || this.policies.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Global governance ready', { policies: this.policies.size, approvals: this.approvals.size, audit: this.audit.length });
  }

  private applySeed(): void {
    const now = Date.now();
    const policy = (name: string, description: string, scope: FedPolicyScope, effect: FedPolicyEffect, action: string): void => {
      const id = `fpol_${randomUUID()}`;
      // Seeded policies belong to the organization this install was seeded for.
      // They are default configuration for that org, not install-wide rules —
      // a second organization writes its own, and until it does it is governed
      // by nothing, which is the honest default for a governance engine.
      this.policies.set(id, { id, ownerOrg: this.homeOrgId, name, description, scope, effect, action, enabled: true, createdAt: new Date(now).toISOString() });
    };
    policy('Federated worker execution', 'Running an AI worker on behalf of a peer org requires a delegated approval.', 'all', 'require_approval', 'cross_org_run');
    policy('Partner data exchange', 'Sharing data with partner-scope peers requires approval.', 'partner', 'require_approval', 'share_data');
    policy('Public artifact publishing', 'Publishing public-scope artifacts to the marketplace is allowed.', 'all', 'allow', 'publish_public');
    policy('Untrusted policy import', 'Importing governance policies from peers is allowed only for trusted peers.', 'trusted', 'allow', 'import_policy');

    // The policy definitions above are legitimate configuration (the governance rules themselves) and always
    // seed. The audit entry and pending approval below are fabricated activity, so a production install starts
    // with an empty audit trail and no pending approvals — gate them behind the demo-seed flag.
    if (!demoSeedsEnabled()) {
      this.schedulePersist();
      return;
    }
    // A representative resolved + pending audit/approval pair.
    this.audit.push({
      id: `faud_${randomUUID()}`,
      at: new Date(now - 2 * 86_400_000).toISOString(),
      actorOrg: this.homeOrgId,
      actorOrgName: this.actorName(),
      peerOrg: 'org-helios',
      peerOrgName: 'Helios Commerce',
      action: 'share_worker',
      decision: 'allow',
      policyId: null,
      detail: 'Shared "Compliance Reviewer" with Helios Commerce.',
    });
    const apId = `appr_${randomUUID()}`;
    this.approvals.set(apId, {
      id: apId,
      action: 'cross_org_run',
      fromOrg: 'org-aperture',
      fromOrgName: 'Aperture Capital',
      toOrg: this.homeOrgId,
      toOrgName: this.homeOrgName,
      status: 'pending',
      requestedAt: new Date(now - 86_400_000).toISOString(),
      resolvedAt: null,
      resolver: null,
    });
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const payload: GovFile = { policies: [...this.policies.values()], approvals: [...this.approvals.values()], audit: this.audit.slice(0, 500), seeded: true };
    await fs.writeFile(tmp, JSON.stringify(payload), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drain();
  }
  private async drain(): Promise<void> {
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

  /**
   * How many policies exist that nobody can be shown to own.
   *
   * A COUNT and not a listing. The rows carry names, descriptions and actions
   * that on a multi-organization install may be another tenant's, and the
   * point of this number is to make their existence undeniable — not to
   * disclose their contents to whoever asks first.
   */
  migrationRequiredCount(): number {
    return [...this.policies.values()].filter((p) => p.migrationState === 'migration_required').length;
  }

  /**
   * The quarantined policies themselves — FOR AN ADMINISTRATOR.
   *
   * P13C ROUND 5, SECOND PASS. The first version of this fix shipped a
   * quarantine that could not be cleared: a COUNT channel, no way to learn the
   * ids, and no renderer surface. On any upgraded install that meant
   * `require_approval` for every organization forever, with a pending approval
   * opened per call. A control nobody can resolve is not a control; it is an
   * outage with a security-shaped explanation.
   *
   * The contents are disclosed here, and that is a deliberate narrowing rather
   * than a reversal. Nothing in the data says who authored these rows, so no
   * organization can be shown to own them and none can be shown NOT to. The
   * least-bad resolution is an administrator of the install — which is what
   * `federation:manage` on a desktop application means — seeing them once, and
   * deciding. The count channel remains for everybody else.
   */
  quarantinedPolicies(): FedPolicy[] {
    if (this.fed.callerOrg() === null) return [];
    return [...this.policies.values()].filter((p) => p.migrationState === 'migration_required');
  }

  /**
   * Take ownership of an unattributed legacy policy.
   *
   * SAFE BY CONSTRUCTION, which is why the caller may simply claim it: a policy
   * governs its OWNER'S federated actions, so claiming one can only constrain
   * the claimer. It is not a route to authority over anybody else, and the
   * claimer could have written the same rule for itself anyway.
   *
   * The alternative — an administrator attributing rows to other organizations —
   * needs an authority this application does not have, because nothing in the
   * data says who wrote them.
   */
  claimPolicy(id: string): FedPolicy | null {
    const me = this.fed.callerOrg();
    const p = this.policies.get(id) ?? null;
    if (me === null || p === null || p.migrationState !== 'migration_required') return null;
    const next: FedPolicy = { ...p, ownerOrg: me };
    delete (next as { migrationState?: unknown }).migrationState;
    this.policies.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /** Discard an unattributed legacy policy outright. The other resolution. */
  discardPolicy(id: string): boolean {
    const p = this.policies.get(id) ?? null;
    if (p === null || p.migrationState !== 'migration_required') return false;
    if (this.fed.callerOrg() === null) return false;
    this.policies.delete(id);
    this.schedulePersist();
    this.emit('changed');
    return true;
  }

  /** The CALLER'S governance policies. Was every organization's rule set. */
  listPolicies(): FedPolicy[] {
    return this.fed.onlyMine([...this.policies.values()], policyParties).sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Approvals the caller REQUESTED or must GRANT. Was every pending approval. */
  listApprovals(): DelegatedApproval[] {
    return this.fed
      .onlyMine([...this.approvals.values()], approvalParties)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }
  /**
   * Federated audit entries the caller is a party to.
   *
   * The OUTPUT is filtered and the array is not — the same treatment the
   * workforce and gateway audits get, for the same reason: an audit log is
   * order-sensitive evidence and rewriting it to scope a read destroys what it
   * is for. `limit` is applied after the filter, so a caller asking for 100
   * gets 100 of its own rather than whatever survives of the install's last 100.
   */
  listAudit(): FedAuditEntry[] {
    return this.fed.onlyMine(this.audit, auditParties).slice(0, 100);
  }

  compliance(input: Omit<ComplianceInput, 'pendingApprovals' | 'auditEntries' | 'now'>): FedComplianceRule[] {
    return buildFedCompliance({
      ...input,
      auditEntries: this.listAudit().length,
      pendingApprovals: this.listApprovals().filter((a) => a.status === 'pending').length,
      now: Date.now(),
    });
  }

  summary(complianceRules: FedComplianceRule[]): GlobalGovSummary {
    const pols = this.listPolicies();
    return {
      policies: pols.length,
      activePolicies: pols.filter((p) => p.enabled).length,
      pendingApprovals: this.listApprovals().filter((a) => a.status === 'pending').length,
      auditEntries: this.listAudit().length,
      complianceScore: complianceScore(complianceRules),
    };
  }

  addPolicy(input: { name: string; description: string; scope: FedPolicyScope; effect: FedPolicyEffect; action: string }): FedPolicy {
    const id = `fpol_${randomUUID()}`;
    const policy: FedPolicy = { id, ownerOrg: this.fed.requireCallerOrg(), name: input.name, description: input.description, scope: input.scope, effect: input.effect, action: input.action, enabled: true, createdAt: new Date().toISOString() };
    this.policies.set(id, policy);
    this.schedulePersist();
    this.emit('changed');
    return policy;
  }

  /** Enable or disable one of the CALLER'S policies. Was a bare id. */
  setPolicyEnabled(id: string, enabled: boolean): FedPolicy | null {
    const p = this.policies.get(id) ?? null;
    if (p === null || this.fed.roleIn(policyParties(p)) !== 'owner') return null;
    const next: FedPolicy = { ...p, enabled };
    this.policies.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /** Evaluate + record a federated action; open a delegated approval if required. */
  recordAction(input: { action: string; peerOrg: string; peerOrgName: string; trustLevel: TrustLevel; detail: string }): FedActionEvaluation {
    /**
     * Evaluated against the CALLER'S OWN policies.
     *
     * Previously `[...this.policies.values()]` — the install's. So one tenant's
     * `deny` rule blocked another tenant's federated action, and one tenant's
     * `allow` rule permitted an action another tenant's governance forbade.
     * Governance evaluating the wrong organization's rules is a control failure
     * in both directions at once.
     */
    const actorOrg = this.fed.requireCallerOrg();
    /**
     * FAIL CLOSED WHILE ANY POLICY IS UNATTRIBUTED.
     *
     * This is the actual fix for F6. Quarantining the rows stops them
     * disappearing from view; it does not by itself stop a legacy DENY rule
     * from having no effect. So while unattributed policies exist, the
     * evaluation cannot be trusted to be complete, and every federated action
     * is forced to `require_approval` regardless of what the owned policies say.
     *
     * `require_approval` rather than `deny`, deliberately: denying outright
     * would break federated work on any upgraded install until an administrator
     * intervened, and a control that takes the product down gets removed. This
     * routes the decision to a human, which is what an incomplete policy set
     * honestly warrants.
     */
    const unattributed = this.migrationRequiredCount();
    /**
     * `peerOrg` ARRIVES IN THE PAYLOAD, AND IT BINDS ANOTHER ORGANIZATION.
     *
     * Every other write in this store checks party membership on an EXISTING
     * record. This one CREATES the record and let the payload choose the second
     * party — so one call wrote attacker-controlled `action`, `peerOrgName` and
     * `detail` text permanently into an unrelated organization's federated audit
     * trail, and a self-authored `require_approval` policy then inserted a
     * pending delegated approval into that organization's queue, moving its
     * compliance score.
     *
     * An audit trail a stranger can append to is not evidence. The peer must be
     * an organization the caller actually federates with.
     */
    if (!this.relatedToCaller(input.peerOrg)) {
      throw new Error('That organization is not a federation peer of yours.');
    }
    const evaluated = evaluateFederatedAction({ action: input.action, peerTrustLevel: input.trustLevel, policies: this.listPolicies() });
    const evaluation: FedActionEvaluation =
      unattributed > 0 && evaluated.decision === 'allow'
        ? {
            ...evaluated,
            decision: 'require_approval',
            reason: `${unattributed} governance polic${unattributed === 1 ? 'y' : 'ies'} predate tenant attribution and are not being evaluated. Approval is required until they are claimed or discarded.`,
          }
        : evaluated;
    const entry: FedAuditEntry = {
      id: `faud_${randomUUID()}`,
      at: new Date().toISOString(),
      actorOrg,
      actorOrgName: this.actorName(),
      peerOrg: input.peerOrg,
      peerOrgName: input.peerOrgName,
      action: input.action,
      decision: evaluation.decision,
      policyId: evaluation.policyId,
      detail: input.detail,
    };
    this.audit = [entry, ...this.audit].slice(0, 500);

    if (evaluation.decision === 'require_approval') {
      const apId = `appr_${randomUUID()}`;
      this.approvals.set(apId, {
        id: apId,
        action: input.action,
        fromOrg: actorOrg,
        fromOrgName: this.actorName(),
        toOrg: input.peerOrg,
        toOrgName: input.peerOrgName,
        status: 'pending',
        requestedAt: new Date().toISOString(),
        resolvedAt: null,
        resolver: null,
      });
    }
    this.schedulePersist();
    this.emit('changed');
    return evaluation;
  }

  /**
   * Resolve a delegated approval THE CALLER IS A PARTY TO.
   *
   * Was `approvals.get(id)` on a bare payload id, reachable on the
   * `federation:approve` channel. A delegated approval is the gate a federated
   * ACTION waits behind, so this was not a disclosure — one tenant could
   * authorize an action between two other organizations, and the audit entry
   * then recorded the seeded organization as the actor, so the record of who
   * did it was wrong too.
   *
   * A foreign id and an invented id are the same `null`.
   */
  resolveApproval(id: string, approve: boolean): DelegatedApproval | null {
    const me = this.fed.callerOrg();
    const a = this.approvals.get(id) ?? null;
    if (me === null || a === null || !this.fed.isParty(approvalParties(a))) return null;
    if (a.status !== 'pending') return a;
    const next: DelegatedApproval = { ...a, status: approve ? 'approved' : 'rejected', resolvedAt: new Date().toISOString(), resolver: this.actorName() };
    this.approvals.set(id, next);
    const entry: FedAuditEntry = {
      id: `faud_${randomUUID()}`,
      at: new Date().toISOString(),
      actorOrg: me,
      actorOrgName: this.actorName(),
      peerOrg: a.toOrg === me ? a.fromOrg : a.toOrg,
      peerOrgName: a.toOrg === me ? a.fromOrgName : a.toOrgName,
      action: a.action,
      decision: approve ? 'allow' : 'deny',
      policyId: null,
      detail: `Delegated approval ${approve ? 'approved' : 'rejected'}.`,
    };
    this.audit = [entry, ...this.audit].slice(0, 500);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }
}
