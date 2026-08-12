/**
 * The Federation Platform data provider. Loads the federation runtime (orgs,
 * invitations, trust, shared resources), the organization exchange (artifacts,
 * scope summary), global governance (policies, approvals, audit, compliance),
 * observability, disaster recovery, administration, and the scalability report —
 * then subscribes to the federation broadcast to stay live.
 *
 * Every side effect is a typed IPC call validated in the main process.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  Backup,
  BackupScope,
  ContinuityPosture,
  DelegatedApproval,
  DrSummary,
  ExchangeArtifact,
  ExchangeKind,
  ExchangeScope,
  ExchangeSummary,
  FedAdminOverview,
  FedAuditEntry,
  FedComplianceRule,
  FederatedOrg,
  FederationSummary,
  FedPolicy,
  FedPolicyEffect,
  FedPolicyScope,
  GlobalGovSummary,
  MarketplaceScopeSummary,
  ObservabilityOverview,
  OrgInvitation,
  RecoveryValidation,
  ReplicaState,
  ScalabilityReport,
  SecurityEvent,
  ShareAccess,
  SharedResource,
  SharedResourceKind,
  TrustLevel,
  TrustRelationship,
  UsagePoint,
  VerificationStatus,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';

const log = createLogger('federation');

interface FederationContextValue {
  ready: boolean;
  // runtime
  orgs: FederatedOrg[];
  summary: FederationSummary | null;
  invitations: OrgInvitation[];
  trust: TrustRelationship[];
  shared: SharedResource[];
  // exchange + marketplace
  artifacts: ExchangeArtifact[];
  exchangeSummary: ExchangeSummary | null;
  scopeSummary: MarketplaceScopeSummary[];
  // governance
  policies: FedPolicy[];
  govSummary: GlobalGovSummary | null;
  approvals: DelegatedApproval[];
  audit: FedAuditEntry[];
  compliance: FedComplianceRule[];
  // observability
  observability: ObservabilityOverview | null;
  usage: UsagePoint[];
  securityEvents: SecurityEvent[];
  // dr
  backups: Backup[];
  replicas: ReplicaState[];
  validations: RecoveryValidation[];
  continuity: ContinuityPosture | null;
  drSummary: DrSummary | null;
  // admin + scalability
  admin: FedAdminOverview | null;
  scalability: ScalabilityReport | null;

  refreshAll: () => Promise<void>;
  // runtime actions
  inviteOrg: (input: { toOrg: string; trustLevel: TrustLevel; message?: string }) => Promise<void>;
  respondInvite: (id: string, accept: boolean) => Promise<void>;
  setTrust: (input: { peerOrg: string; trustLevel?: TrustLevel; delegatedApproval?: boolean; canShareWorkers?: boolean; canShareData?: boolean }) => Promise<void>;
  shareResource: (input: { kind: SharedResourceKind; name: string; peerOrg: string; access: ShareAccess }) => Promise<string | null>;
  revokeShare: (id: string) => Promise<void>;
  // exchange actions
  publishArtifact: (input: { kind: ExchangeKind; name: string; summary: string; scope: ExchangeScope }) => Promise<void>;
  publishVersion: (input: { artifactId: string; version: string; changelog: string }) => Promise<void>;
  rate: (artifactId: string, stars: number) => Promise<void>;
  setVerification: (artifactId: string, verification: VerificationStatus) => Promise<void>;
  rollback: (artifactId: string) => Promise<void>;
  install: (artifactId: string) => Promise<void>;
  verifyVersion: (artifactId: string, versionId: string) => Promise<boolean>;
  setScope: (artifactId: string, scope: ExchangeScope) => Promise<void>;
  // governance actions
  addPolicy: (input: { name: string; description: string; scope: FedPolicyScope; effect: FedPolicyEffect; action: string }) => Promise<void>;
  setPolicyEnabled: (id: string, enabled: boolean) => Promise<void>;
  resolveApproval: (id: string, approve: boolean) => Promise<void>;
  recordAction: (input: { action: string; peerOrg: string; peerOrgName: string; trustLevel: TrustLevel; detail: string }) => Promise<void>;
  // dr actions
  createBackup: (scope: BackupScope) => Promise<void>;
  runValidation: (backupId: string) => Promise<void>;
  checkReplication: () => Promise<void>;
}

const FederationContext = createContext<FederationContextValue | null>(null);

export function FederationProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [orgs, setOrgs] = useState<FederatedOrg[]>([]);
  const [summary, setSummary] = useState<FederationSummary | null>(null);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [trust, setTrust] = useState<TrustRelationship[]>([]);
  const [shared, setShared] = useState<SharedResource[]>([]);
  const [artifacts, setArtifacts] = useState<ExchangeArtifact[]>([]);
  const [exchangeSummary, setExchangeSummary] = useState<ExchangeSummary | null>(null);
  const [scopeSummary, setScopeSummary] = useState<MarketplaceScopeSummary[]>([]);
  const [policies, setPolicies] = useState<FedPolicy[]>([]);
  const [govSummary, setGovSummary] = useState<GlobalGovSummary | null>(null);
  const [approvals, setApprovals] = useState<DelegatedApproval[]>([]);
  const [audit, setAudit] = useState<FedAuditEntry[]>([]);
  const [compliance, setCompliance] = useState<FedComplianceRule[]>([]);
  const [observability, setObservability] = useState<ObservabilityOverview | null>(null);
  const [usage, setUsage] = useState<UsagePoint[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [replicas, setReplicas] = useState<ReplicaState[]>([]);
  const [validations, setValidations] = useState<RecoveryValidation[]>([]);
  const [continuity, setContinuity] = useState<ContinuityPosture | null>(null);
  const [drSummary, setDrSummary] = useState<DrSummary | null>(null);
  const [admin, setAdmin] = useState<FedAdminOverview | null>(null);
  const [scalability, setScalability] = useState<ScalabilityReport | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [og, sm, inv, tr, sh, ar, es, ss, pl, gs, ap, au, cp, ob, us, se, bk, rp, vl, ct, ds, ad, sc] = await Promise.all([
        ipc.federation.orgs(),
        ipc.federation.summary(),
        ipc.federation.invitations(),
        ipc.federation.trust(),
        ipc.federation.shared(),
        ipc.federation.artifacts(),
        ipc.federation.exchangeSummary(),
        ipc.federation.scopeSummary(),
        ipc.federation.policies(),
        ipc.federation.govSummary(),
        ipc.federation.approvals(),
        ipc.federation.audit(),
        ipc.federation.compliance(),
        ipc.federation.observability(),
        ipc.federation.usageSeries(),
        ipc.federation.securityEvents(),
        ipc.federation.backups(),
        ipc.federation.replicas(),
        ipc.federation.validations(),
        ipc.federation.continuity(),
        ipc.federation.drSummary(),
        ipc.federation.adminOverview(),
        ipc.federation.scalability(),
      ]);
      setOrgs(og);
      setSummary(sm);
      setInvitations(inv);
      setTrust(tr);
      setShared(sh);
      setArtifacts(ar);
      setExchangeSummary(es);
      setScopeSummary(ss);
      setPolicies(pl);
      setGovSummary(gs);
      setApprovals(ap);
      setAudit(au);
      setCompliance(cp);
      setObservability(ob);
      setUsage(us);
      setSecurityEvents(se);
      setBackups(bk);
      setReplicas(rp);
      setValidations(vl);
      setContinuity(ct);
      setDrSummary(ds);
      setAdmin(ad);
      setScalability(sc);
      setReady(true);
    } catch (err) {
      log.error('Failed to refresh federation', err);
    }
  }, []);

  const refreshLive = useCallback(async () => {
    try {
      const [og, sm, inv, tr, sh, ar, es, ss, pl, gs, ap, au, cp, ob, se, bk, rp, vl, ct, ds, ad] = await Promise.all([
        ipc.federation.orgs(),
        ipc.federation.summary(),
        ipc.federation.invitations(),
        ipc.federation.trust(),
        ipc.federation.shared(),
        ipc.federation.artifacts(),
        ipc.federation.exchangeSummary(),
        ipc.federation.scopeSummary(),
        ipc.federation.policies(),
        ipc.federation.govSummary(),
        ipc.federation.approvals(),
        ipc.federation.audit(),
        ipc.federation.compliance(),
        ipc.federation.observability(),
        ipc.federation.securityEvents(),
        ipc.federation.backups(),
        ipc.federation.replicas(),
        ipc.federation.validations(),
        ipc.federation.continuity(),
        ipc.federation.drSummary(),
        ipc.federation.adminOverview(),
      ]);
      setOrgs(og);
      setSummary(sm);
      setInvitations(inv);
      setTrust(tr);
      setShared(sh);
      setArtifacts(ar);
      setExchangeSummary(es);
      setScopeSummary(ss);
      setPolicies(pl);
      setGovSummary(gs);
      setApprovals(ap);
      setAudit(au);
      setCompliance(cp);
      setObservability(ob);
      setSecurityEvents(se);
      setBackups(bk);
      setReplicas(rp);
      setValidations(vl);
      setContinuity(ct);
      setDrSummary(ds);
      setAdmin(ad);
    } catch (err) {
      log.error('Failed to refresh federation live slices', err);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = (fn: () => void): void => {
      if (t) clearTimeout(t);
      t = setTimeout(fn, 180);
    };
    const off = ipc.federation.onEvent(() => debounced(() => void refreshLive()));
    return () => {
      if (t) clearTimeout(t);
      off();
    };
  }, [refreshAll, refreshLive]);

  const inviteOrg = useCallback(async (input: { toOrg: string; trustLevel: TrustLevel; message?: string }) => { await ipc.federation.inviteOrg(input); await refreshLive(); }, [refreshLive]);
  const respondInvite = useCallback(async (id: string, accept: boolean) => { await ipc.federation.respondInvite(id, accept); await refreshLive(); }, [refreshLive]);
  const setTrustAction = useCallback(async (input: { peerOrg: string; trustLevel?: TrustLevel; delegatedApproval?: boolean; canShareWorkers?: boolean; canShareData?: boolean }) => { await ipc.federation.setTrust(input); await refreshLive(); }, [refreshLive]);
  const shareResource = useCallback(async (input: { kind: SharedResourceKind; name: string; peerOrg: string; access: ShareAccess }) => {
    const res = await ipc.federation.shareResource(input);
    await refreshLive();
    return 'error' in res ? res.error : null;
  }, [refreshLive]);
  const revokeShare = useCallback(async (id: string) => { await ipc.federation.revokeShare(id); await refreshLive(); }, [refreshLive]);

  const publishArtifact = useCallback(async (input: { kind: ExchangeKind; name: string; summary: string; scope: ExchangeScope }) => { await ipc.federation.publishArtifact(input); await refreshLive(); }, [refreshLive]);
  const publishVersion = useCallback(async (input: { artifactId: string; version: string; changelog: string }) => { await ipc.federation.publishVersion(input); await refreshLive(); }, [refreshLive]);
  const rate = useCallback(async (artifactId: string, stars: number) => { await ipc.federation.rate(artifactId, stars); await refreshLive(); }, [refreshLive]);
  const setVerification = useCallback(async (artifactId: string, verification: VerificationStatus) => { await ipc.federation.setVerification(artifactId, verification); await refreshLive(); }, [refreshLive]);
  const rollback = useCallback(async (artifactId: string) => { await ipc.federation.rollback(artifactId); await refreshLive(); }, [refreshLive]);
  const install = useCallback(async (artifactId: string) => { await ipc.federation.install(artifactId); await refreshLive(); }, [refreshLive]);
  const verifyVersion = useCallback(async (artifactId: string, versionId: string) => (await ipc.federation.verifyVersion(artifactId, versionId)).verified, []);
  const setScope = useCallback(async (artifactId: string, scope: ExchangeScope) => { await ipc.federation.setScope(artifactId, scope); await refreshLive(); }, [refreshLive]);

  const addPolicy = useCallback(async (input: { name: string; description: string; scope: FedPolicyScope; effect: FedPolicyEffect; action: string }) => { await ipc.federation.addPolicy(input); await refreshLive(); }, [refreshLive]);
  const setPolicyEnabled = useCallback(async (id: string, enabled: boolean) => { await ipc.federation.setPolicyEnabled(id, enabled); await refreshLive(); }, [refreshLive]);
  const resolveApproval = useCallback(async (id: string, approve: boolean) => { await ipc.federation.resolveApproval(id, approve); await refreshLive(); }, [refreshLive]);
  const recordAction = useCallback(async (input: { action: string; peerOrg: string; peerOrgName: string; trustLevel: TrustLevel; detail: string }) => { await ipc.federation.recordAction(input); await refreshLive(); }, [refreshLive]);

  const createBackup = useCallback(async (scope: BackupScope) => { await ipc.federation.createBackup(scope); await refreshLive(); }, [refreshLive]);
  const runValidation = useCallback(async (backupId: string) => { await ipc.federation.runValidation(backupId); await refreshLive(); }, [refreshLive]);
  const checkReplication = useCallback(async () => { await ipc.federation.checkReplication(); await refreshLive(); }, [refreshLive]);

  const value = useMemo<FederationContextValue>(
    () => ({
      ready,
      orgs, summary, invitations, trust, shared,
      artifacts, exchangeSummary, scopeSummary,
      policies, govSummary, approvals, audit, compliance,
      observability, usage, securityEvents,
      backups, replicas, validations, continuity, drSummary,
      admin, scalability,
      refreshAll,
      inviteOrg, respondInvite, setTrust: setTrustAction, shareResource, revokeShare,
      publishArtifact, publishVersion, rate, setVerification, rollback, install, verifyVersion, setScope,
      addPolicy, setPolicyEnabled, resolveApproval, recordAction,
      createBackup, runValidation, checkReplication,
    }),
    [
      ready, orgs, summary, invitations, trust, shared,
      artifacts, exchangeSummary, scopeSummary,
      policies, govSummary, approvals, audit, compliance,
      observability, usage, securityEvents,
      backups, replicas, validations, continuity, drSummary,
      admin, scalability,
      refreshAll,
      inviteOrg, respondInvite, setTrustAction, shareResource, revokeShare,
      publishArtifact, publishVersion, rate, setVerification, rollback, install, verifyVersion, setScope,
      addPolicy, setPolicyEnabled, resolveApproval, recordAction,
      createBackup, runValidation, checkReplication,
    ],
  );

  return <FederationContext.Provider value={value}>{children}</FederationContext.Provider>;
}

export function useFederation(): FederationContextValue {
  const ctx = useContext(FederationContext);
  if (!ctx) throw new Error('useFederation must be used within FederationProvider');
  return ctx;
}
