/**
 * Federation administration (pure). The centralized control-plane summary across
 * organization management, federation membership, shared resources, trust,
 * security review, and compliance review. No I/O.
 */
import type { DrSummary, FederatedOrg, FederationSummary, FedAdminOverview, GlobalGovSummary } from '@neuropause/shared';

export interface FedAdminInput {
  orgs: FederatedOrg[];
  fedSummary: FederationSummary;
  govSummary: GlobalGovSummary;
  drSummary: DrSummary;
  openSecurityEvents: number;
}

export function buildFedAdmin(input: FedAdminInput): FedAdminOverview {
  return {
    orgs: input.orgs,
    peers: input.fedSummary.peers,
    trustedPeers: input.fedSummary.trustedPeers,
    pendingInvites: input.fedSummary.pendingInvites,
    pendingApprovals: input.govSummary.pendingApprovals,
    sharedOut: input.fedSummary.sharedOut,
    sharedIn: input.fedSummary.sharedIn,
    policies: input.govSummary.activePolicies,
    complianceScore: input.govSummary.complianceScore,
    openSecurityEvents: input.openSecurityEvents,
    backups: input.drSummary.backups,
    replicasInSync: input.drSummary.inSync,
  };
}
