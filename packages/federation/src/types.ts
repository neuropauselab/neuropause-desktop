/**
 * Wave 6 core types. Federations, organizations, trust, regions, clusters, deployment
 * descriptors, shared artifacts, and marketplace listings — all in-process registry
 * records. Cloud/region/cluster/deployment records are DESCRIPTORS ONLY (no real
 * infrastructure); every record carries an evidence level so the honesty classification
 * is structural.
 */
import type { DeploymentTarget, TrustLevel, ArtifactKind, MarketplaceKind } from './constants';

export type EvidenceLevel = 'live-verified' | 'adapter-verified' | 'infra-pending';

export type FederationStatus = 'active' | 'archived';
export type OrgStatus = 'active' | 'archived';

export interface Organization {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
  nemsTenantId?: string;
  status: OrgStatus;
  createdAt: number;
  updatedAt: number;
}

export interface Federation {
  id: string;
  name: string;
  ownerOrgId: string;
  members: string[];
  metadata: Record<string, unknown>;
  status: FederationStatus;
  createdAt: number;
}

export interface TrustRelationship {
  id: string;
  federationId: string;
  fromOrg: string;
  toOrg: string;
  level: TrustLevel;
  establishedAt: number;
}

export interface Region {
  id: string;
  name: string;
  provider: string;
  zones: string[];
  edgeNodes: string[];
  /** descriptors only — no real region provisioned. */
  evidence: EvidenceLevel;
}

export interface ClusterNode {
  id: string;
  role: 'control-plane' | 'worker' | 'edge';
}

export interface Cluster {
  id: string;
  regionId: string;
  name: string;
  nodes: ClusterNode[];
  services: string[];
  /** simulation only — no real cluster. */
  evidence: EvidenceLevel;
}

export interface DeploymentDescriptor {
  id: string;
  target: DeploymentTarget;
  name: string;
  spec: Record<string, unknown>;
  /** adapter-verified for cloud targets (shape only); real deployment is infra-pending. */
  evidence: EvidenceLevel;
  note: string;
}

export interface SharedArtifact {
  id: string;
  kind: ArtifactKind;
  name: string;
  fromOrg: string;
  toOrg: string;
  federationId: string;
  payload: Record<string, unknown>;
  sharedAt: number;
}

export interface MarketplaceListing {
  id: string;
  kind: MarketplaceKind;
  name: string;
  publisherOrg: string;
  version: string;
  description: string;
  payload: Record<string, unknown>;
  publishedAt: number;
  installs: number;
}
