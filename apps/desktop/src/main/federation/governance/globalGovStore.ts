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
import { createLogger } from '../../logger';

const log = createLogger('federation-governance');

interface GovFile {
  policies: FedPolicy[];
  approvals: DelegatedApproval[];
  audit: FedAuditEntry[];
  seeded: boolean;
}

export class GlobalGovStore extends EventEmitter {
  private policies = new Map<string, FedPolicy>();
  private approvals = new Map<string, DelegatedApproval>();
  private audit: FedAuditEntry[] = [];
  private homeOrgId = '';
  private homeOrgName = '';

  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, homeOrgId: string, homeOrgName: string) {
    super();
    this.homeOrgId = homeOrgId;
    this.homeOrgName = homeOrgName;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<GovFile>;
      for (const p of data.policies ?? []) if (p?.id) this.policies.set(p.id, p);
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
      this.policies.set(id, { id, name, description, scope, effect, action, enabled: true, createdAt: new Date(now).toISOString() });
    };
    policy('Federated worker execution', 'Running an AI worker on behalf of a peer org requires a delegated approval.', 'all', 'require_approval', 'cross_org_run');
    policy('Partner data exchange', 'Sharing data with partner-scope peers requires approval.', 'partner', 'require_approval', 'share_data');
    policy('Public artifact publishing', 'Publishing public-scope artifacts to the marketplace is allowed.', 'all', 'allow', 'publish_public');
    policy('Untrusted policy import', 'Importing governance policies from peers is allowed only for trusted peers.', 'trusted', 'allow', 'import_policy');

    // A representative resolved + pending audit/approval pair.
    this.audit.push({
      id: `faud_${randomUUID()}`,
      at: new Date(now - 2 * 86_400_000).toISOString(),
      actorOrg: this.homeOrgId,
      actorOrgName: this.homeOrgName,
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

  listPolicies(): FedPolicy[] {
    return [...this.policies.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  listApprovals(): DelegatedApproval[] {
    return [...this.approvals.values()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }
  listAudit(): FedAuditEntry[] {
    return this.audit.slice(0, 100);
  }

  compliance(input: Omit<ComplianceInput, 'pendingApprovals' | 'auditEntries' | 'now'>): FedComplianceRule[] {
    return buildFedCompliance({
      ...input,
      auditEntries: this.audit.length,
      pendingApprovals: [...this.approvals.values()].filter((a) => a.status === 'pending').length,
      now: Date.now(),
    });
  }

  summary(complianceRules: FedComplianceRule[]): GlobalGovSummary {
    const pols = [...this.policies.values()];
    return {
      policies: pols.length,
      activePolicies: pols.filter((p) => p.enabled).length,
      pendingApprovals: [...this.approvals.values()].filter((a) => a.status === 'pending').length,
      auditEntries: this.audit.length,
      complianceScore: complianceScore(complianceRules),
    };
  }

  addPolicy(input: { name: string; description: string; scope: FedPolicyScope; effect: FedPolicyEffect; action: string }): FedPolicy {
    const id = `fpol_${randomUUID()}`;
    const policy: FedPolicy = { id, name: input.name, description: input.description, scope: input.scope, effect: input.effect, action: input.action, enabled: true, createdAt: new Date().toISOString() };
    this.policies.set(id, policy);
    this.schedulePersist();
    this.emit('changed');
    return policy;
  }

  setPolicyEnabled(id: string, enabled: boolean): FedPolicy | null {
    const p = this.policies.get(id);
    if (!p) return null;
    const next: FedPolicy = { ...p, enabled };
    this.policies.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /** Evaluate + record a federated action; open a delegated approval if required. */
  recordAction(input: { action: string; peerOrg: string; peerOrgName: string; trustLevel: TrustLevel; detail: string }): FedActionEvaluation {
    const evaluation = evaluateFederatedAction({ action: input.action, peerTrustLevel: input.trustLevel, policies: [...this.policies.values()] });
    const entry: FedAuditEntry = {
      id: `faud_${randomUUID()}`,
      at: new Date().toISOString(),
      actorOrg: this.homeOrgId,
      actorOrgName: this.homeOrgName,
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
        fromOrg: this.homeOrgId,
        fromOrgName: this.homeOrgName,
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

  resolveApproval(id: string, approve: boolean): DelegatedApproval | null {
    const a = this.approvals.get(id);
    if (!a || a.status !== 'pending') return a ?? null;
    const next: DelegatedApproval = { ...a, status: approve ? 'approved' : 'rejected', resolvedAt: new Date().toISOString(), resolver: this.homeOrgName };
    this.approvals.set(id, next);
    const entry: FedAuditEntry = {
      id: `faud_${randomUUID()}`,
      at: new Date().toISOString(),
      actorOrg: this.homeOrgId,
      actorOrgName: this.homeOrgName,
      peerOrg: a.toOrg === this.homeOrgId ? a.fromOrg : a.toOrg,
      peerOrgName: a.toOrg === this.homeOrgId ? a.fromOrgName : a.toOrgName,
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
